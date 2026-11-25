import { getPublicKey } from 'nostr-tools/pure';

import { base64ToBytes } from '../lib/crypto/bytes';
import { upsertContactName } from '../lib/database/contacts';
import {
  getInboxState,
  listRelayStates,
  saveInboxState,
  saveRelayStates,
  type RelaySyncState,
} from '../lib/database/inboxState';
import { setInviteStatus, upsertInvite } from '../lib/database/invites';
import { getMembershipEvidence, markReceiptPublished, upsertMembershipEvidence } from '../lib/database/memberships';
import {
  addCircleFromInvite,
  applyCircleRosterUpdate,
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
import {
  fetchInboxMessages,
  type ControlInboxMessage,
  type InboxMessage,
  type InboxPageResult,
} from '../lib/nostr/dm';
import { isNewerEvidence, decideInviteOutcome } from '../lib/nostr/membershipRules';
import { DEFAULT_DM_RELAYS, createPool, type Pool } from '../lib/nostr/relays';
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
import { applySocialControl, createSocialValidationCache } from './social';

const PAGE_SIZE = 500;
const MAX_BACKFILL_PAGES = 20;
const MAX_INCREMENTAL_PAGES = 20;
const INBOX_OVERLAP_SECONDS = 3 * 24 * 60 * 60;

export interface InboxRefreshResult {
  received: number;
  added: number;
  invites: number;
  accepted: number;
  restored: number;
  suppressed: number;
  scanned: number;
}

interface CollectedInbox {
  files: Map<string, InboxMessage>;
  controls: Map<string, ControlInboxMessage>;
}

function collectPage(collected: CollectedInbox, page: InboxPageResult): void {
  for (const file of page.files) {
    if (!collected.files.has(file.rumorId)) collected.files.set(file.rumorId, file);
  }
  for (const control of page.controls) {
    if (!collected.controls.has(control.rumorId)) collected.controls.set(control.rumorId, control);
  }
}

interface RelayWindowCursor {
  until: number | null;
  complete: boolean;
  failed: boolean;
}

interface WindowResult {
  states: Map<string, RelayWindowCursor>;
  anyOk: boolean;
  allComplete: boolean;
}

async function fetchWindow(
  pool: Pool,
  relays: string[],
  secretKey: Uint8Array,
  options: { since?: number; states: Map<string, RelayWindowCursor> },
  maxPages: number,
  collected: CollectedInbox
): Promise<WindowResult> {
  const states = options.states;
  const uniqueRelays = [...new Set(relays)];
  let anyOk = false;
  const startedAt = Date.now();

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const active = uniqueRelays.filter((relay) => {
      const state = states.get(relay);
      return state && !state.complete && !state.failed;
    });
    if (active.length === 0) break;

    const untilByRelay = new Map(
      active.map((relay) => [relay, states.get(relay)?.until ?? null])
    );
    const page = await fetchInboxMessages(pool, active, secretKey, {
      since: options.since,
      untilByRelay,
      limit: PAGE_SIZE,
      timeoutMs: 8_000,
    });
    collectPage(collected, page);

    for (const relayPage of page.relays) {
      const state = states.get(relayPage.relay);
      if (!state) continue;
      if (!relayPage.ok) {
        state.failed = true;
        continue;
      }
      anyOk = true;
      if (relayPage.rawCount === 0 || relayPage.oldestCreatedAt === null) {
        state.complete = true;
        state.until = null;
        continue;
      }
      if (options.since !== undefined && relayPage.oldestCreatedAt <= options.since) {
        state.complete = true;
        state.until = null;
        continue;
      }
      state.until = relayPage.oldestCreatedAt - 1;
    }

    if (uniqueRelays.every((relay) => states.get(relay)?.complete || states.get(relay)?.failed)) {
      break;
    }
    if (Date.now() - startedAt > 15_000) break;
  }

  return {
    states,
    anyOk,
    allComplete: uniqueRelays.every((relay) => states.get(relay)?.complete === true),
  };
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

interface NameCandidate {
  name: string;
  at: number;
}

function recordName(
  names: Map<string, NameCandidate>,
  pubkey: string,
  name: string | null | undefined,
  at: number
): void {
  if (!name) return;
  const current = names.get(pubkey);
  if (!current || at > current.at) names.set(pubkey, { name, at });
}

function recordSnapshotNames(
  names: Map<string, NameCandidate>,
  snapshot: CircleInvitePayload['circle'] | undefined,
  at: number
): void {
  if (!snapshot) return;
  recordName(names, snapshot.ownerPubkey, snapshot.ownerName, at);
  for (const [pubkey, name] of Object.entries(snapshot.names ?? {})) {
    recordName(names, pubkey, name, at);
  }
}

async function learnNamesInOrder(
  controls: ControlInboxMessage[],
  files: Map<string, InboxMessage>
): Promise<void> {
  const names = new Map<string, NameCandidate>();
  for (const control of controls) {
    const payload = control.payload;
    const at = control.createdAt;
    if (payload.type === 'circle-invite') {
      if (payload.circle.ownerPubkey === control.senderPubkey) {
        recordSnapshotNames(names, payload.circle, at);
      }
    } else if (payload.type === 'circle-accept') {
      if (payload.memberPubkey === control.senderPubkey) {
        recordName(names, payload.memberPubkey, payload.memberName, at);
      }
    } else if (payload.type === 'circle-membership') {
      if (
        payload.ownerPubkey === control.senderPubkey ||
        payload.memberPubkey === control.senderPubkey
      ) {
        recordSnapshotNames(names, payload.circle, at);
      }
    } else if (payload.authorName) {
      recordName(names, control.senderPubkey, payload.authorName, at);
    }
  }
  for (const message of files.values()) {
    recordName(names, message.senderPubkey, message.payload.authorName, message.createdAt);
  }
  const ordered = [...names.entries()].sort(
    (a, b) => (a[1].at !== b[1].at ? a[1].at - b[1].at : a[0].localeCompare(b[0]))
  );
  for (const [pubkey, candidate] of ordered) {
    await upsertContactName(pubkey, candidate.name);
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

export async function refreshInbox(
  secretKey: Uint8Array,
  relays: string[] = DEFAULT_DM_RELAYS
): Promise<InboxRefreshResult> {
  const pubkey = getPublicKey(secretKey);
  const syncStartedAt = Math.floor(Date.now() / 1000);
  const pool = createPool({ secretKey });
  try {
    const state = await getInboxState(pubkey);
    const relayStates = await listRelayStates(pubkey, relays);
    const collected: CollectedInbox = { files: new Map(), controls: new Map() };
    const backfillStates = new Map<string, RelayWindowCursor>();
    const incrementalStates = new Map<string, RelayWindowCursor>();
    for (const [relay, relayState] of relayStates) {
      backfillStates.set(relay, {
        until: relayState.backfillUntil,
        complete: relayState.backfillComplete,
        failed: false,
      });
      incrementalStates.set(relay, {
        until: relayState.incrementalUntil,
        complete: relayState.incrementalComplete,
        failed: false,
      });
    }

    let incrementalResult: WindowResult | null = null;
    let backfillResult: WindowResult | null = null;
    if (state?.lastSyncAt) {
      const since = Math.max(0, state.lastSyncAt - INBOX_OVERLAP_SECONDS);
      incrementalResult = await fetchWindow(
        pool,
        relays,
        secretKey,
        { since, states: incrementalStates },
        MAX_INCREMENTAL_PAGES,
        collected
      );
    }
    if ([...backfillStates.values()].some((relayState) => !relayState.complete)) {
      backfillResult = await fetchWindow(
        pool,
        relays,
        secretKey,
        { states: backfillStates },
        MAX_BACKFILL_PAGES,
        collected
      );
    }

    const controls = [...collected.controls.values()];
    await learnNamesInOrder(controls, collected.files);
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

    for (const control of controls) {
      const payload = control.payload;
      if (payload.type !== 'circle-membership') continue;
      if (payload.action !== 'removed') continue;
      if (payload.memberPubkey === pubkey) continue;
      if (payload.ownerPubkey !== control.senderPubkey) continue;
      if (!payload.circle || !payload.circle.members.includes(pubkey)) continue;

      const circle = await getCircle(payload.circleId);
      if (!circle || circle.ownerPubkey !== payload.ownerPubkey) continue;
      if (payload.membershipVersion <= circle.membershipVersion) continue;
      await applyCircleRosterUpdate({
        id: payload.circle.id,
        ownerPubkey: payload.circle.ownerPubkey,
        name: payload.circle.name,
        description: payload.circle.description ?? null,
        membershipVersion: payload.circle.membershipVersion,
        members: payload.circle.members,
        selfPubkey: pubkey,
        removedPubkey: payload.memberPubkey,
      });
    }

    const socialCache = createSocialValidationCache();
    for (const control of controls) {
      const payload = control.payload;
      if (payload.type !== 'circle-comment' && payload.type !== 'circle-reaction') continue;
      await applySocialControl({
        viewerPubkey: pubkey,
        senderPubkey: control.senderPubkey,
        payload,
        cache: socialCache,
      });
    }

    let added = 0;
    for (const message of collected.files.values()) {
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

    const backfillComplete = [...backfillStates.values()].every((relayState) => relayState.complete);
    const incrementalComplete = incrementalResult?.allComplete ?? true;
    const anyOk = Boolean(incrementalResult?.anyOk || backfillResult?.anyOk);
    const previousLastSync = state?.lastSyncAt ?? null;
    const nextLastSync =
      incrementalComplete && previousLastSync
        ? syncStartedAt
        : !previousLastSync && (anyOk || backfillComplete)
          ? syncStartedAt
          : previousLastSync;
    const resetIncremental = !incrementalResult || incrementalResult.allComplete;
    const savedRelayStates: RelaySyncState[] = [...relayStates.keys()].map((relay) => {
      const backfill = backfillStates.get(relay)!;
      const incremental = incrementalStates.get(relay)!;
      return {
        relay,
        backfillUntil: backfill.complete ? null : backfill.until,
        backfillComplete: backfill.complete,
        incrementalUntil: resetIncremental || incremental.complete ? null : incremental.until,
        incrementalComplete: resetIncremental ? false : incremental.complete,
      };
    });
    await saveRelayStates(pubkey, savedRelayStates);
    await saveInboxState({
      recipientPubkey: pubkey,
      backfillComplete,
      backfillUntil: null,
      lastSyncAt: nextLastSync,
    });

    await flushControlOutbox(secretKey, pool, 5_000);
    await flushMembershipReceipts(secretKey, pool, 3_000);

    return {
      received: collected.files.size + controls.length,
      added,
      invites,
      accepted,
      restored,
      suppressed,
      scanned: collected.files.size + controls.length,
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
