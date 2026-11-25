import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';

import { BlossomClient } from '../lib/blossom/client';
import { base64ToBytes, bytesToBase64 } from '../lib/crypto/bytes';
import { generateMediaKey } from '../lib/crypto/expoAes';
import { encryptMediaFile } from '../lib/crypto/mediaFiles';
import { createPool, DEFAULT_DM_RELAYS } from '../lib/nostr/relays';
import {
  publishKeyMessage,
  resolveInboxRelays,
  wrapKeyMessage,
  type VlogKeyPayload,
} from '../lib/nostr/dm';
import { getPublicKey } from 'nostr-tools/pure';
import { getDatabase } from '../lib/database/db';
import { listCircleMembers, upsertVlog } from '../lib/database/vlogs';
import { saveMediaKey } from '../lib/security/mediaKeys';
import type { Circle, Clip, Vlog } from '../types/models';

export type PublishStage =
  | 'preparing'
  | 'encrypting'
  | 'checking-provider'
  | 'uploading'
  | 'verifying'
  | 'distributing'
  | 'saving';

export interface PublishProgress {
  stage: PublishStage;
  fraction?: number;
  detail?: string;
}

export interface PublishVlogInput {
  identityId: string;
  secretKey: Uint8Array;
  circle: Circle;
  sourceUri: string;
  mimeType: string;
  durationMs: number;
  width?: number;
  height?: number;
  title?: string;
  description?: string;
  providerUrl: string;
  onProgress?: (progress: PublishProgress) => void;
}

export interface PublishVlogResult {
  vlogId: string;
  clipId: string;
  rumorId: string;
  url: string;
  encryptedSha256: string;
  encryptedSize: number;
  plaintextSize: number;
  relays: string[];
}

function mediaDirectory(): Directory {
  const dir = new Directory(Paths.document, 'folio-media');
  if (!dir.exists) dir.create();
  return dir;
}

function cacheDirectory(): Directory {
  const dir = new Directory(Paths.cache, 'folio-work');
  if (!dir.exists) dir.create();
  return dir;
}

async function copyIntoPrivateStore(sourceUri: string, destination: File): Promise<void> {
  const source = new File(sourceUri);
  if (!source.exists) throw new Error('The selected video is no longer available');
  if (destination.exists) destination.delete();
  destination.create();
  const sourceHandle = source.open(FileMode.ReadOnly);
  const destinationHandle = destination.open(FileMode.ReadWrite);
  let offset = 0;
  try {
    for (;;) {
      const chunk = await sourceHandle.readBytes(4 * 1024 * 1024);
      if (chunk.length === 0) break;
      destinationHandle.offset = offset;
      await destinationHandle.writeBytes(chunk);
      offset += chunk.length;
    }
  } finally {
    sourceHandle.close();
    destinationHandle.close();
  }
}

/**
 * Full publish pipeline: private copy -> SHA-256 -> encrypt -> preflight ->
 * upload -> verify -> gift-wrap the media key to every active member -> persist.
 * Media is encrypted before any network operation and plaintext is never
 * uploaded.
 */
export async function publishVlog(input: PublishVlogInput): Promise<PublishVlogResult> {
  const remoteVlogId = randomUUID();
  const remoteClipId = randomUUID();
  const senderPubkey = getPublicKey(input.secretKey);
  const localVlogId = `${senderPubkey.slice(0, 10)}-${remoteVlogId}`;
  const clipId = `${senderPubkey.slice(0, 10)}-${remoteClipId}`;
  const mediaDir = mediaDirectory();
  const workDir = cacheDirectory();
  const plaintextFile = new File(mediaDir, `${clipId}.mp4`);
  const encryptedFile = new File(workDir, `${clipId}.fc1`);
  let uploadedUrl = '';
  let rumorId = '';

  const report = (progress: PublishProgress) => input.onProgress?.(progress);

  try {
    report({ stage: 'preparing' });
    await copyIntoPrivateStore(input.sourceUri, plaintextFile);
    const plaintextSha256 = await plaintextFile.digest('SHA-256');

    report({ stage: 'encrypting' });
    const mediaKey = await generateMediaKey();
    const encrypted = await encryptMediaFile(plaintextFile, encryptedFile, mediaKey, {
      onProgress: (processed, total) => report({ stage: 'encrypting', fraction: total > 0 ? processed / total : 1 }),
    });

    const provider = new BlossomClient(input.providerUrl);
    report({ stage: 'checking-provider' });
    const preflight = await provider.preflight(input.secretKey, encrypted.encryptedSize, encrypted.sha256);
    if (preflight.supported && preflight.status >= 400) {
      throw new Error(preflight.reason ?? `This provider rejected the upload (HTTP ${preflight.status})`);
    }

    report({ stage: 'uploading', fraction: 0 });
    const upload = await provider.uploadFile(encryptedFile, {
      sha256: encrypted.sha256,
      size: encrypted.encryptedSize,
      mimeType: 'application/octet-stream',
      secretKey: input.secretKey,
      onProgress: ({ bytesSent, totalBytes }) =>
        report({ stage: 'uploading', fraction: totalBytes > 0 ? bytesSent / totalBytes : 0 }),
    });
    uploadedUrl = upload.descriptor.url;

    report({ stage: 'verifying' });
    if (!upload.verified) {
      throw new Error('The uploaded file could not be verified on the storage provider');
    }

    report({ stage: 'distributing' });
    await saveMediaKey(clipId, mediaKey);
    const members = await listCircleMembers(input.circle.id);
    const recipientPubkeys = members
      .filter((member) => member.status === 'active' && member.pubkey !== senderPubkey)
      .map((member) => member.pubkey);

    const payload: VlogKeyPayload = {
      v: 1,
      vlogId: remoteVlogId,
      clipId: remoteClipId,
      circleId: input.circle.id,
      title: input.title?.trim() || undefined,
      description: input.description?.trim() || undefined,
      format: 'FOLIOFC1',
      keyB64: bytesToBase64(mediaKey),
      encryptedSha256: encrypted.sha256,
      plaintextSha256,
      encryptedSize: encrypted.encryptedSize,
      plaintextSize: encrypted.plaintextSize,
      durationMs: Math.round(input.durationMs),
      mimeType: input.mimeType || 'video/mp4',
      width: input.width,
      height: input.height,
      createdAt: Math.floor(Date.now() / 1000),
    };

    const pool = createPool({ secretKey: input.secretKey });
    let relays: string[] = [];
    try {
      const inboxLists = await Promise.all(
        recipientPubkeys.map(async (pubkey) => [pubkey, await resolveInboxRelays(pool, pubkey, DEFAULT_DM_RELAYS)] as const)
      );
      const inboxMap = new Map(inboxLists);
      const message = wrapKeyMessage({
        secretKey: input.secretKey,
        recipientPubkeys,
        payload,
        primaryUrl: uploadedUrl,
      });
      rumorId = message.rumorId;
      relays = await publishKeyMessage(pool, message, {
        relaysForPubkey: (pubkey) => inboxMap.get(pubkey) ?? DEFAULT_DM_RELAYS,
        fallbackRelays: DEFAULT_DM_RELAYS,
      });
    } finally {
      pool.destroy();
    }

    report({ stage: 'saving' });

    const now = Date.now();
    const vlog: Vlog = {
      id: localVlogId,
      viewerPubkey: senderPubkey,
      remoteId: remoteVlogId,
      rumorId: rumorId || null,
      authorPubkey: senderPubkey,
      circleId: input.circle.id,
      circleName: input.circle.name,
      title: payload.title ?? null,
      description: payload.description ?? null,
      createdAt: Math.floor(now / 1000),
      receivedAt: now,
      state: 'published',
      unread: false,
      isFavourite: false,
      format: payload.format,
    };
    const clip: Clip = {
      id: clipId,
      vlogId: localVlogId,
      position: 0,
      provider: provider.id,
      url: uploadedUrl,
      mirrors: null,
      encryptedSha256: encrypted.sha256,
      plaintextSha256,
      encryptedSize: encrypted.encryptedSize,
      plaintextSize: encrypted.plaintextSize,
      durationMs: payload.durationMs,
      mimeType: payload.mimeType,
      width: payload.width ?? null,
      height: payload.height ?? null,
      localUri: plaintextFile.uri,
      state: 'downloaded',
      createdAt: now,
    };
    await upsertVlog(vlog, [clip]);

    return {
      vlogId: localVlogId,
      clipId,
      rumorId,
      url: uploadedUrl,
      encryptedSha256: encrypted.sha256,
      encryptedSize: encrypted.encryptedSize,
      plaintextSize: encrypted.plaintextSize,
      relays,
    };
  } catch (error) {
    // Never leave a partial encrypted artifact; the plaintext draft stays for retry.
    if (encryptedFile.exists) encryptedFile.delete();
    throw error;
  } finally {
    if (encryptedFile.exists) encryptedFile.delete();
  }
}

export async function storeIncomingKey(payload: {
  clipId: string;
  keyB64: string;
}): Promise<void> {
  await saveMediaKey(payload.clipId, base64ToBytes(payload.keyB64));
}

export async function markVlogReady(vlogId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE vlogs SET state = ? WHERE id = ?', 'published', vlogId);
}
