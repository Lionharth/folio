import { getPublicKey } from 'nostr-tools/pure';

import { base64ToBytes } from '../lib/crypto/bytes';
import { upsertContactName } from '../lib/database/contacts';
import { setInviteStatus, upsertInvite } from '../lib/database/invites';
import { getMembershipEvidence, markReceiptPublished, upsertMembershipEvidence } from '../lib/database/memberships';
import {
  addCircleFromInvite,
  getCircle,
  getCircleMember,
  hasVlogByRumor,
  markCircleMemberActive,
  upsertVlog,
} from '../lib/database/vlogs';
import {
  type CircleInvitePayload,
  type CircleMembershipPayload,
} from '../lib/nostr/circleControl';
import { fetchInboxMessages, type InboxMessage } from '../lib/nostr/dm';
import { isNewerEvidence, decideInviteOutcome } from '../lib/nostr/membershipRules';
import { DEFAULT_DM_RELAYS, createPool } from '../lib/nostr/relays';
import { saveMediaKey, saveThumbnailKey } from '../lib/security/mediaKeys';
import type { Clip, Vlog } from '../types/models';
import {
  flushControlOutbox,
  flushMembershipReceipts,
  recordMembershipReceipt,
  restoreCircleFromReceipt,
  seedMembershipReceipts,
  sendCircleAccept,
  suppressCircleFromReceipt,
} from './membership';

export interface InboxRefreshResult {
  received: number;
  added: number;
  invites: number;
  accepted: number;
  restored: number;
  suppressed: number;
  scanned: number;
}

function toVlog(message: InboxMessage, viewerPubkey: string): { vlog: Vlog; clip: Clip } {
  const { payload } = message;
  const receivedAt = Date.now();
  const prefix = viewerPubkey.slice(0, 10);
  const localVlogId = `${prefix}-${payload.vlogId}`;
  const clip: Clip = {
    id: `${prefix}-${payload.clipId}`,
    vlogId: localVlogId,
    position: 0,
    provider: originOf(message.content),
    url: message.content,
    mirrors: payload.mirrors ?? null,
    encryptedSha256: payload.encryptedSha256,
    plaintextSha256: payload.plaintextSha256,
    encryptedSize: payload.encryptedSize,
    plaintextSize: payload.plaintextSize,
    durationMs: payload.durationMs,
    mimeType: payload.mimeType,
    width: payload.width ?? null,
    height: payload.height ?? null,
    localUri: null,
    thumbnail: payload.thumbnail
      ? {
          url: payload.thumbnail.url,
          sha256: payload.thumbnail.sha256,
          encryptedSize: payload.thumbnail.size,
          plaintextSha256: payload.thumbnail.plaintextSha256 ?? null,
          plaintextSize: payload.thumbnail.plaintextSize ?? null,
          mimeType: payload.thumbnail.mimeType,
          width: payload.thumbnail.width,
          height: payload.thumbnail.height,
        }
      : null,
    state: 'remote',
    createdAt: receivedAt,
  };
  const vlog: Vlog = {
    id: localVlogId,
    viewerPubkey,
    remoteId: payload.vlogId,
    rumorId: message.rumorId,
    authorPubkey: message.senderPubkey,
    circleId: payload.circleId,
    circleName: null,
    title: payload.title ?? null,
    description: payload.description ?? null,
    createdAt: payload.createdAt,
    receivedAt,
    state: 'published',
    unread: true,
    isFavourite: false,
    format: payload.format,
  };
  return { vlog, clip };
}

interface EvidenceCandidate {
  payload: CircleMembershipPayload;
  source: 'self' | 'removed';
}

function evidenceOrder(payload: CircleMembershipPayload) {
  return { membershipVersion: payload.membershipVersion, at: payload.at };
}

function considerCandidate(
  candidates: Map<string, EvidenceCandidate>,
  candidate: EvidenceCandidate
): void {
  const key = `${candidate.payload.circleId}:${candidate.payload.ownerPubkey}`;
  const current = candidates.get(key);
  if (!current || isNewerEvidence(evidenceOrder(candidate.payload), evidenceOrder(current.payload))) {
    candidates.set(key, candidate);
  }
}

async function learnNames(snapshot: CircleInvitePayload['circle']): Promise<void> {
  if (snapshot.ownerName) await upsertContactName(snapshot.ownerPubkey, snapshot.ownerName);
  if (snapshot.names) {
    for (const [pubkey, name] of Object.entries(snapshot.names)) {
      await upsertContactName(pubkey, name);
    }
  }
}

async function applyCircleSnapshot(snapshot: CircleInvitePayload['circle'], selfPubkey: string): Promise<boolean> {
  const local = await getCircle(snapshot.id);
  if (local && local.membershipVersion > snapshot.membershipVersion) return false;
  await addCircleFromInvite({
    id: snapshot.id,
    ownerPubkey: snapshot.ownerPubkey,
    name: snapshot.name,
    description: snapshot.description ?? null,
    membershipVersion: snapshot.membershipVersion,
    members: snapshot.members,
    selfPubkey,
  });
  return true;
}

/**
 * Pulls gift wraps addressed to this identity, applies durable membership
 * evidence, restores circles that were previously joined, and persists new
 * invitations. Safe to call repeatedly.
 */
export async function refreshInbox(
  secretKey: Uint8Array,
  relays: string[] = DEFAULT_DM_RELAYS
): Promise<InboxRefreshResult> {
  const pubkey = getPublicKey(secretKey);
  const pool = createPool({ secretKey });
  try {
    await flushMembershipReceipts(secretKey, pool);
    await flushControlOutbox(secretKey, pool);

    const { files, controls } = await fetchInboxMessages(pool, relays, secretKey, { limit: 500 });

    const candidates = new Map<string, EvidenceCandidate>();
    for (const control of controls) {
      const payload = control.payload;
      if (payload.type !== 'circle-membership') continue;
      if (payload.memberPubkey !== pubkey) continue;

      if (control.senderPubkey === pubkey) {
        considerCandidate(candidates, { payload, source: 'self' });
        continue;
      }

      if (payload.action !== 'removed') continue;
      // Only the claimed owner can remove this identity. The owner key is also
      // part of the evidence key, so a forged owner cannot suppress another
      // circle's invitation.
      if (payload.ownerPubkey !== control.senderPubkey) continue;
      considerCandidate(candidates, { payload, source: 'removed' });
    }

    let restored = 0;
    let suppressed = 0;
    for (const candidate of candidates.values()) {
      const { payload } = candidate;
      const existing = await getMembershipEvidence(pubkey, payload.circleId, payload.ownerPubkey);
      if (existing && !isNewerEvidence(evidenceOrder(payload), evidenceOrder(existing.payload))) {
        continue;
      }

      if (candidate.source === 'self') {
        const { stored } = await upsertMembershipEvidence({ recipientPubkey: pubkey, payload });
        if (!stored) continue;
        // It was received from a relay, so this evidence is already durable.
        await markReceiptPublished({
          recipientPubkey: pubkey,
          circleId: payload.circleId,
          ownerPubkey: payload.ownerPubkey,
          membershipVersion: payload.membershipVersion,
          publishedAt: Date.now(),
        });
      } else {
        const result = await recordMembershipReceipt({ secretKey, payload, pool });
        if (!result.evidence) continue;
      }

      if (payload.action === 'join') {
        const result = await restoreCircleFromReceipt({
          payload,
          selfPubkey: pubkey,
          secretKey,
          pool,
        });
        if (result?.created) restored += 1;
      } else {
        await suppressCircleFromReceipt({ payload, selfPubkey: pubkey });
        suppressed += 1;
      }
    }

    let invites = 0;
    let accepted = 0;
    for (const control of controls) {
      if (control.payload.type === 'circle-accept') {
        if (control.payload.memberPubkey !== control.senderPubkey) continue;
        if (control.payload.memberName) {
          await upsertContactName(control.payload.memberPubkey, control.payload.memberName);
        }
        const circle = await getCircle(control.payload.circleId);
        if (!circle || circle.ownerPubkey !== pubkey) continue;
        if (await markCircleMemberActive(circle.id, control.payload.memberPubkey)) {
          accepted += 1;
        }
        continue;
      }

      if (control.payload.type !== 'circle-invite') continue;
      const { circle } = control.payload;
      if (circle.ownerPubkey !== control.senderPubkey) continue;
      if (!circle.members.includes(pubkey)) continue;
      await learnNames(circle);

      const selfMember = await getCircleMember(circle.id, pubkey);
      const evidence = await getMembershipEvidence(pubkey, circle.id, circle.ownerPubkey);
      const outcome = decideInviteOutcome({
        inviteVersion: circle.membershipVersion,
        selfStatus: selfMember?.status ?? null,
        evidence: evidence
          ? { action: evidence.action, membershipVersion: evidence.membershipVersion }
          : null,
      });

      const stored = await upsertInvite({
        recipientPubkey: pubkey,
        circleId: circle.id,
        ownerPubkey: circle.ownerPubkey,
        ownerName: circle.ownerName ?? null,
        name: circle.name,
        description: circle.description ?? null,
        members: circle.members,
        memberNames: circle.names,
        membershipVersion: circle.membershipVersion,
        invitedAt: control.payload.invitedAt,
      });

      if (outcome === 'pending') {
        if (stored.created) invites += 1;
        continue;
      }

      if (outcome === 'suppress') {
        await setInviteStatus(pubkey, stored.invite.id, 'declined');
        suppressed += 1;
        continue;
      }

      const wasActive = selfMember?.status === 'active';
      const applied = await applyCircleSnapshot(circle, pubkey);
      await setInviteStatus(pubkey, stored.invite.id, 'accepted');
      if (outcome === 'restore') {
        if (!wasActive && applied) {
          restored += 1;
          if (circle.ownerPubkey !== pubkey) {
            try {
              await sendCircleAccept({
                pool,
                secretKey,
                ownerPubkey: circle.ownerPubkey,
                circleId: circle.id,
              });
            } catch {
              // Best-effort: the owner already authorized this invitation.
            }
          }
        }
      }
    }

    let added = 0;
    for (const message of files) {
      if (message.payload.authorName) {
        await upsertContactName(message.senderPubkey, message.payload.authorName);
      }
      if (await hasVlogByRumor(pubkey, message.rumorId)) continue;
      const { vlog, clip } = toVlog(message, pubkey);
      await saveMediaKey(clip.id, base64ToBytes(message.payload.keyB64));
      if (message.payload.thumbnail) {
        await saveThumbnailKey(clip.id, base64ToBytes(message.payload.thumbnail.keyB64));
      }
      await upsertVlog(vlog, [clip]);
      added += 1;
    }

    await seedMembershipReceipts(secretKey, pool);

    return {
      received: files.length + controls.length,
      added,
      invites,
      accepted,
      restored,
      suppressed,
      scanned: files.length + controls.length,
    };
  } finally {
    pool.destroy();
  }
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
