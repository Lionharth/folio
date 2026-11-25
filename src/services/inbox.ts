import { getPublicKey } from 'nostr-tools/pure';

import { base64ToBytes } from '../lib/crypto/bytes';
import { upsertContactName } from '../lib/database/contacts';
import { upsertInvite } from '../lib/database/invites';
import { getCircle, hasVlogByRumor, markCircleMemberActive, upsertVlog } from '../lib/database/vlogs';
import { fetchInboxMessages, type InboxMessage } from '../lib/nostr/dm';
import { DEFAULT_DM_RELAYS, createPool } from '../lib/nostr/relays';
import { saveMediaKey, saveThumbnailKey } from '../lib/security/mediaKeys';
import type { Clip, Vlog } from '../types/models';

export interface InboxRefreshResult {
  received: number;
  added: number;
  invites: number;
  accepted: number;
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

/**
 * Pulls gift wraps addressed to this identity, decrypts key messages and circle
 * invitations, and persists anything new. Safe to call repeatedly: rumors are
 * deduplicated by id and invitations by circle/owner/version.
 */
export async function refreshInbox(
  secretKey: Uint8Array,
  relays: string[] = DEFAULT_DM_RELAYS
): Promise<InboxRefreshResult> {
  const pubkey = getPublicKey(secretKey);
  const pool = createPool({ secretKey });
  try {
    const { files, controls } = await fetchInboxMessages(pool, relays, secretKey, { limit: 200 });

    let invites = 0;
    let accepted = 0;
    for (const control of controls) {
      if (control.payload.type === 'circle-invite') {
        const { circle } = control.payload;
        if (circle.ownerPubkey !== control.senderPubkey) continue;
        if (!circle.members.includes(pubkey)) continue;
        if (circle.ownerName) await upsertContactName(circle.ownerPubkey, circle.ownerName);
        if (circle.names) {
          for (const [pubkey, name] of Object.entries(circle.names)) {
            await upsertContactName(pubkey, name);
          }
        }
        const stored = await upsertInvite({
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
        if (stored.created) invites += 1;
        continue;
      }

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

    return {
      received: files.length + controls.length,
      added,
      invites,
      accepted,
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
