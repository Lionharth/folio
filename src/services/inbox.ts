import { getPublicKey } from 'nostr-tools/pure';

import { base64ToBytes } from '../lib/crypto/bytes';

import { hasVlogByRumor, upsertVlog } from '../lib/database/vlogs';
import { fetchKeyMessages, type InboxMessage } from '../lib/nostr/dm';
import { createPool, DEFAULT_DM_RELAYS } from '../lib/nostr/relays';
import { saveMediaKey } from '../lib/security/mediaKeys';
import type { Clip, Vlog } from '../types/models';

export interface InboxRefreshResult {
  received: number;
  added: number;
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
 * Pulls gift wraps addressed to this identity, decrypts the key messages and
 * persists any new vlog. Safe to call repeatedly: rumors are deduplicated by
 * id, so redelivery from multiple relays does not create duplicates.
 */
export async function refreshInbox(secretKey: Uint8Array, relays: string[] = DEFAULT_DM_RELAYS): Promise<InboxRefreshResult> {
  const pubkey = getPublicKey(secretKey);
  const pool = createPool({ secretKey });
  try {
    const messages = await fetchKeyMessages(pool, relays, secretKey, { limit: 200 });
    let added = 0;
    for (const message of messages) {
      if (await hasVlogByRumor(pubkey, message.rumorId)) continue;
      const { vlog, clip } = toVlog(message, pubkey);
      await saveMediaKey(clip.id, base64ToBytes(message.payload.keyB64));
      await upsertVlog(vlog, [clip]);
      added += 1;
    }
    return { received: messages.length, added, scanned: messages.length };
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
