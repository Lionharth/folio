import { File } from 'expo-file-system';

import { BlossomClient, newCacheFile } from '../lib/blossom/client';
import { decryptMediaFile, mediaCacheFile } from '../lib/crypto/mediaFiles';
import { updateClipLocalUri } from '../lib/database/vlogs';
import { loadMediaKey } from '../lib/security/mediaKeys';
import type { Clip } from '../types/models';

export interface PlaybackProgress {
  stage: 'downloading' | 'decrypting' | 'verifying' | 'ready';
  fraction?: number;
}

export class MediaUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaUnavailableError';
  }
}

/**
 * Ensures a decrypted local copy exists, verifying both the ciphertext hash and
 * (when known) the plaintext hash. Downloads never start without a media key,
 * and a failed verification deletes the partial file.
 */
export async function ensureLocalClip(
  clip: Clip,
  options: { onProgress?: (progress: PlaybackProgress) => void } = {}
): Promise<string> {
  if (clip.localUri) {
    const existing = new File(clip.localUri);
    if (existing.exists && existing.size > 0) return existing.uri;
  }

  const key = await loadMediaKey(clip.id);
  if (!key) {
    throw new MediaUnavailableError('The media key for this clip is not on this device');
  }
  const sources = [clip.url, ...(clip.mirrors ?? [])].filter((value): value is string => Boolean(value));
  if (sources.length === 0) {
    throw new MediaUnavailableError('This clip has no known download location');
  }

  const encryptedFile = newCacheFile(`${clip.id}.fc1`);
  let lastError: unknown = null;
  for (const url of sources) {
    try {
      options.onProgress?.({ stage: 'downloading', fraction: 0 });
      const client = new BlossomClient(new URL(url).origin);
      await client.downloadToFile(url, encryptedFile, {
        expectedSha256: clip.encryptedSha256,
        expectedSize: clip.encryptedSize,
        onProgress: ({ bytesWritten, totalBytes }) =>
          options.onProgress?.({ stage: 'downloading', fraction: totalBytes > 0 ? bytesWritten / totalBytes : 0 }),
      });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) {
    if (encryptedFile.exists) encryptedFile.delete();
    throw lastError instanceof Error ? lastError : new MediaUnavailableError('Download failed');
  }

  const plaintextFile = mediaCacheFile(`${clip.id}.mp4`);
  try {
    options.onProgress?.({ stage: 'decrypting' });
    await decryptMediaFile(encryptedFile, plaintextFile, key, {
      onProgress: () => options.onProgress?.({ stage: 'decrypting' }),
    });

    if (clip.plaintextSha256) {
      options.onProgress?.({ stage: 'verifying' });
      const digest = await plaintextFile.digest('SHA-256');
      if (digest !== clip.plaintextSha256) {
        plaintextFile.delete();
        throw new MediaUnavailableError('Decrypted video failed integrity verification');
      }
    }
    await updateClipLocalUri(clip.id, plaintextFile.uri);
    options.onProgress?.({ stage: 'ready' });
    return plaintextFile.uri;
  } finally {
    if (encryptedFile.exists) encryptedFile.delete();
  }
}

export async function deleteLocalClip(clip: Clip): Promise<void> {
  if (!clip.localUri) return;
  const file = new File(clip.localUri);
  if (file.exists) file.delete();
}
