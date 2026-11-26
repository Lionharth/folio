import { File, FileMode } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';

import { PROVIDER_PRESETS } from '../constants/providers';
import { BlossomClient, BlossomError, type UploadOptions, type UploadResult } from '../lib/blossom/client';
import { NO_TRUSTED_PROVIDER, STORAGE_UNREACHABLE, classifyBlossomError, type BlossomFailureKind } from '../lib/blossom/errors';
import { buildProviderCandidates } from '../lib/blossom/selection';
import { base64ToBytes, bytesToBase64 } from '../lib/crypto/bytes';
import { generateMediaKey } from '../lib/crypto/expoAes';
import { encryptMediaFile } from '../lib/crypto/mediaFiles';
import { mediaDirectory, workDirectory } from '../lib/media/paths';
import { createPool, DEFAULT_DM_RELAYS } from '../lib/nostr/relays';
import {
  publishKeyMessage,
  resolveInboxRelays,
  wrapKeyMessage,
  type VlogKeyPayload,
  type VlogThumbnailPayload,
} from '../lib/nostr/dm';
import { getPublicKey } from 'nostr-tools/pure';
import { getDatabase } from '../lib/database/db';
import { listCircleMembers, upsertVlog } from '../lib/database/vlogs';
import { saveMediaKey, saveThumbnailKey } from '../lib/security/mediaKeys';
import { prepareVideoForPublish, storeThumbnail } from './media';
import type { Circle, Clip, Vlog } from '../types/models';

export type PublishStage =
  | 'preparing'
  | 'compressing'
  | 'encrypting'
  | 'checking-provider'
  | 'uploading'
  | 'verifying'
  | 'thumbnail'
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
  authorName?: string;
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
  provider: string;
  coverUri: string | null;
  encryptedSha256: string;
  encryptedSize: number;
  plaintextSize: number;
  relays: string[];
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

interface ProviderUploadInput {
  sha256: string;
  size: number;
  mimeType?: string;
  secretKey: Uint8Array;
}

/**
 * Tries the selected provider first, then the remaining presets. Transport,
 * TLS, 5xx and verification failures fall through to the next candidate; a 4xx
 * is a policy answer and is surfaced immediately.
 */
async function uploadWithFallback(
  candidates: string[],
  file: File,
  input: ProviderUploadInput,
  report: (progress: PublishProgress) => void
): Promise<{ client: BlossomClient; upload: UploadResult }> {
  const failures: string[] = [];
  let sawTlsFailure = false;
  let lastKind: BlossomFailureKind = 'unknown';

  for (const url of candidates) {
    const client = new BlossomClient(url);
    const detail = candidates.length > 1 ? client.name : undefined;
    report({ stage: 'checking-provider', detail });

    const probe = await client.probe();
    if (!probe.ok) {
      const kind = probe.kind ?? (probe.status !== undefined && probe.status >= 500 ? 'server' : 'unreachable');
      lastKind = kind === 'unreachable' ? lastKind : kind;
      if (kind === 'tls') sawTlsFailure = true;
      failures.push(`${client.name}: ${kind}`);
      continue;
    }

    const preflight = await client.preflight(input.secretKey, input.size, input.sha256, input.mimeType);
    if (!preflight.supported) {
      if (preflight.kind === 'unreachable') {
        lastKind = preflight.failure ?? lastKind;
        if (preflight.failure === 'tls') sawTlsFailure = true;
        failures.push(`${client.name}: ${preflight.failure ?? 'unreachable'}`);
        continue;
      }
    } else if (preflight.status >= 500) {
      lastKind = 'server';
      failures.push(`${client.name}: HTTP ${preflight.status}`);
      continue;
    } else if (preflight.status >= 400) {
      throw new BlossomError(
        preflight.reason ?? `This provider rejected the upload (HTTP ${preflight.status})`,
        preflight.status,
        preflight.reason
      );
    }

    report({ stage: 'uploading', fraction: 0, detail });
    const options: UploadOptions = {
      sha256: input.sha256,
      size: input.size,
      mimeType: input.mimeType,
      secretKey: input.secretKey,
      onProgress: ({ bytesSent, totalBytes }) =>
        report({
          stage: 'uploading',
          fraction: totalBytes > 0 ? bytesSent / totalBytes : 0,
          detail,
        }),
    };

    try {
      const upload = await client.uploadFile(file, options);
      if (!upload.verified) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        if (!(await client.verifyBlob(upload.descriptor.url, input.size))) {
          lastKind = 'server';
          failures.push(`${client.name}: verification`);
          continue;
        }
        return { client, upload: { ...upload, verified: true } };
      }
      return { client, upload };
    } catch (error) {
      if (error instanceof BlossomError) {
        if (error.status !== undefined && error.status >= 500) {
          lastKind = 'server';
          failures.push(`${client.name}: HTTP ${error.status}`);
          continue;
        }
        if (error.status !== undefined) {
          throw new BlossomError(
            error.reason ? `${error.message}: ${error.reason}` : error.message,
            error.status,
            error.reason,
            error.kind,
            error.detail
          );
        }
        if (error.kind === 'tls' || error.kind === 'transport') {
          lastKind = error.kind;
          if (error.kind === 'tls') sawTlsFailure = true;
          failures.push(`${client.name}: ${error.kind}`);
          continue;
        }
        throw error;
      }
      const kind = classifyBlossomError(error);
      if (kind !== 'tls' && kind !== 'transport') throw error;
      lastKind = kind;
      if (kind === 'tls') sawTlsFailure = true;
      failures.push(`${client.name}: ${kind}`);
    }
  }

  throw new BlossomError(
    sawTlsFailure ? NO_TRUSTED_PROVIDER : STORAGE_UNREACHABLE,
    undefined,
    failures.join('; '),
    sawTlsFailure ? 'tls' : lastKind
  );
}

/**
 * Full publish pipeline: private copy -> SHA-256 -> encrypt -> provider
 * selection (selected, then presets) -> upload -> verify -> gift-wrap the media
 * key to every active member -> persist. Media is encrypted before any network
 * operation and plaintext is never uploaded.
 */
export async function publishVlog(input: PublishVlogInput): Promise<PublishVlogResult> {
  const remoteVlogId = randomUUID();
  const remoteClipId = randomUUID();
  const senderPubkey = getPublicKey(input.secretKey);
  const localVlogId = `${senderPubkey.slice(0, 10)}-${remoteVlogId}`;
  const clipId = `${senderPubkey.slice(0, 10)}-${remoteClipId}`;
  const mediaDir = mediaDirectory();
  const workDir = workDirectory();
  const plaintextFile = new File(mediaDir, `${clipId}.mp4`);
  const encryptedFile = new File(workDir, `${clipId}.fc1`);
  let uploadedUrl = '';
  let rumorId = '';

  const report = (progress: PublishProgress) => input.onProgress?.(progress);

  try {
    report({ stage: 'preparing' });
    const prepared = await prepareVideoForPublish(
      {
        uri: input.sourceUri,
        durationMs: input.durationMs,
        width: input.width,
        height: input.height,
      },
      (progress) => report({ stage: progress.stage, fraction: progress.fraction })
    );
    await copyIntoPrivateStore(prepared.uri, plaintextFile);
    const plaintextSha256 = await plaintextFile.digest('SHA-256');

    // The cover is stored locally first so the author's feed shows it even if
    // the optional encrypted cover upload fails.
    let coverFile: File | null = null;
    if (prepared.thumbnail) {
      try {
        coverFile = await storeThumbnail(prepared.thumbnail.uri, clipId);
      } catch {
        coverFile = null;
      }
    }

    report({ stage: 'encrypting' });
    const mediaKey = await generateMediaKey();
    const encrypted = await encryptMediaFile(plaintextFile, encryptedFile, mediaKey, {
      onProgress: (processed, total) => report({ stage: 'encrypting', fraction: total > 0 ? processed / total : 1 }),
    });

    const providerCandidates = buildProviderCandidates(input.providerUrl, PROVIDER_PRESETS.map((preset) => preset.url));
    const { client: provider, upload } = await uploadWithFallback(providerCandidates, encryptedFile, {
      sha256: encrypted.sha256,
      size: encrypted.encryptedSize,
      mimeType: 'application/octet-stream',
      secretKey: input.secretKey,
    }, report);
    uploadedUrl = upload.descriptor.url;

    report({ stage: 'verifying' });

    let thumbnail: VlogThumbnailPayload | undefined;
    if (coverFile && prepared.thumbnail) {
      report({ stage: 'thumbnail' });
      const thumbnailKey = await generateMediaKey();
      const encryptedThumbnailFile = new File(workDir, `${clipId}-thumb.fc1`);
      try {
        const sealedThumbnail = await encryptMediaFile(coverFile, encryptedThumbnailFile, thumbnailKey);
        const thumbnailUpload = await provider.uploadFile(encryptedThumbnailFile, {
          sha256: sealedThumbnail.sha256,
          size: sealedThumbnail.encryptedSize,
          mimeType: 'application/octet-stream',
          secretKey: input.secretKey,
        });
        if (thumbnailUpload.verified) {
          await saveThumbnailKey(clipId, thumbnailKey);
          thumbnail = {
            url: thumbnailUpload.descriptor.url,
            keyB64: bytesToBase64(thumbnailKey),
            sha256: sealedThumbnail.sha256,
            plaintextSha256: await coverFile.digest('SHA-256'),
            size: sealedThumbnail.encryptedSize,
            plaintextSize: sealedThumbnail.plaintextSize,
            mimeType: 'image/jpeg',
            width: prepared.thumbnail.width,
            height: prepared.thumbnail.height,
          };
        }
      } catch {
        // Covers are optional: publishing succeeds without one.
      } finally {
        if (encryptedThumbnailFile.exists) encryptedThumbnailFile.delete();
      }
    }

    report({ stage: 'distributing' });
    await saveMediaKey(clipId, mediaKey);
    const members = await listCircleMembers(input.circle.id);
    // Invited members already have the owner's authorization; sending them
    // content keys means a lost acceptance message cannot lock them out.
    const recipientPubkeys = members
      .filter((member) => member.status !== 'removed' && member.pubkey !== senderPubkey)
      .map((member) => member.pubkey);

    const payload: VlogKeyPayload = {
      v: 1,
      vlogId: remoteVlogId,
      clipId: remoteClipId,
      circleId: input.circle.id,
      authorName: input.authorName?.trim() || undefined,
      title: input.title?.trim() || undefined,
      description: input.description?.trim() || undefined,
      format: 'FOLIOFC1',
      keyB64: bytesToBase64(mediaKey),
      encryptedSha256: encrypted.sha256,
      plaintextSha256,
      encryptedSize: encrypted.encryptedSize,
      plaintextSize: encrypted.plaintextSize,
      durationMs: Math.round(prepared.durationMs),
      mimeType: prepared.mimeType || 'video/mp4',
      width: prepared.width ?? undefined,
      height: prepared.height ?? undefined,
      thumbnail,
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
      coverUri: coverFile?.uri ?? null,
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
      provider: provider.id,
      coverUri: coverFile?.uri ?? null,
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
