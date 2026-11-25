import { BlossomClient, newCacheFile } from '../lib/blossom/client';
import { decryptMediaFile } from '../lib/crypto/mediaFiles';
import { updateVlogCover } from '../lib/database/vlogs';
import { thumbnailFile } from '../lib/media/paths';
import { loadThumbnailKey } from '../lib/security/mediaKeys';
import type { Clip, Vlog } from '../types/models';

const MAX_CONCURRENT = 2;
const FAILURE_TTL_MS = 60_000;

let active = 0;
const waiting: (() => void)[] = [];
const inflight = new Map<string, Promise<string | null>>();
const failedAt = new Map<string, number>();

async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  while (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active += 1;
  try {
    return await task();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

/**
 * Resolves a locally usable cover for a clip. Author uploads already have a
 * local file; recipient clips download and decrypt the small cover blob once,
 * cache it in the private archive and remember it on the vlog row.
 */
export async function ensureClipThumbnail(vlog: Vlog, clip: Clip): Promise<string | null> {
  const local = thumbnailFile(clip.id);
  if (local.exists && local.size > 0) {
    if (vlog.coverUri !== local.uri) {
      await updateVlogCover(vlog.id, local.uri).catch(() => undefined);
    }
    return local.uri;
  }

  if (!clip.thumbnail) return null;
  const failedUntil = failedAt.get(clip.id) ?? 0;
  if (failedUntil > Date.now()) return null;
  failedAt.delete(clip.id);

  const pending = inflight.get(clip.id);
  if (pending) return pending;

  const task = withSlot(() => downloadThumbnail(vlog, clip))
    .finally(() => inflight.delete(clip.id));
  inflight.set(clip.id, task);
  return task;
}

async function downloadThumbnail(vlog: Vlog, clip: Clip): Promise<string | null> {
  const descriptor = clip.thumbnail;
  if (!descriptor) return null;

  const key = await loadThumbnailKey(clip.id);
  if (!key) {
    failedAt.set(clip.id, Date.now() + FAILURE_TTL_MS);
    return null;
  }

  const encrypted = newCacheFile(`${clip.id}.thumb.fc1`);
  const destination = thumbnailFile(clip.id);
  try {
    const client = new BlossomClient(new URL(descriptor.url).origin);
    await client.downloadToFile(descriptor.url, encrypted, {
      expectedSha256: descriptor.sha256,
      expectedSize: descriptor.encryptedSize,
    });

    if (destination.exists) destination.delete();
    const header = await decryptMediaFile(encrypted, destination, key);

    if (descriptor.plaintextSize && header.plaintextSize !== descriptor.plaintextSize) {
      throw new Error('Thumbnail size mismatch');
    }
    if (descriptor.plaintextSha256) {
      const digest = await destination.digest('SHA-256');
      if (digest !== descriptor.plaintextSha256) throw new Error('Thumbnail failed verification');
    }

    await updateVlogCover(vlog.id, destination.uri);
    failedAt.delete(clip.id);
    return destination.uri;
  } catch {
    failedAt.set(clip.id, Date.now() + FAILURE_TTL_MS);
    if (destination.exists) destination.delete();
    return null;
  } finally {
    if (encrypted.exists) encrypted.delete();
  }
}
