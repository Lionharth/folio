import { PROVIDER_PRESETS } from '../constants/providers';
import { buildRecipientMirrorTargets, mergeMirrorUrls } from '../lib/blossom/selection';
import { updateClipMirrors } from '../lib/database/vlogs';
import type { Clip } from '../types/models';
import { mirrorToProviders } from './mirrorTargets';

/** Publish caps plaintext at 25 MiB; 32 MiB leaves room for FC1 framing. */
const MAX_MIRROR_BYTES = 32 * 1024 * 1024;
/** Avoid re-running a full fan-out on every mount after a failed attempt. */
const FAILED_ATTEMPT_TTL_MS = 5 * 60_000;
const failedAttempts = new Map<string, number>();

export interface MirrorReceivedClipInput {
  clip: Clip;
  secretKey: Uint8Array;
  providers?: readonly string[];
}

export interface MirrorReceivedClipResult {
  added: string[];
  mirrors: string[];
}

/**
 * Best-effort recipient-side redundancy. Every reachable provider is asked to
 * pull the ciphertext from the clip's primary URL; the destination performs
 * the download, so the device never re-uploads the blob. Successful URLs are
 * saved to the local clip for future playback fallbacks.
 */
export async function mirrorReceivedClip(
  input: MirrorReceivedClipInput
): Promise<MirrorReceivedClipResult> {
  const currentMirrors = input.clip.mirrors ?? [];
  const sourceUrl = input.clip.url?.trim();
  if (!sourceUrl) return { added: [], mirrors: currentMirrors };

  // A malicious member controls the payload size; refuse anything larger than
  // this app can publish so they cannot exhaust a recipient's provider quota.
  if (
    !Number.isFinite(input.clip.encryptedSize) ||
    input.clip.encryptedSize <= 0 ||
    input.clip.encryptedSize > MAX_MIRROR_BYTES
  ) {
    return { added: [], mirrors: currentMirrors };
  }

  const lastFailure = failedAttempts.get(input.clip.id);
  if (lastFailure && Date.now() - lastFailure < FAILED_ATTEMPT_TTL_MS) {
    return { added: [], mirrors: currentMirrors };
  }

  const providers = input.providers ?? PROVIDER_PRESETS.map((preset) => preset.url);
  const targets = buildRecipientMirrorTargets(sourceUrl, currentMirrors, providers);
  if (targets.length === 0) return { added: [], mirrors: currentMirrors };

  const results = await mirrorToProviders(targets, {
    sourceUrl,
    sha256: input.clip.encryptedSha256,
    size: input.clip.encryptedSize,
    secretKey: input.secretKey,
  });

  const added = results.map((result) => result.url);
  if (added.length === 0) {
    failedAttempts.set(input.clip.id, Date.now());
    return { added: [], mirrors: currentMirrors };
  }

  const merged = mergeMirrorUrls(currentMirrors, added);
  await updateClipMirrors(input.clip.id, merged.length > 0 ? merged : null);
  failedAttempts.delete(input.clip.id);
  return { added, mirrors: merged };
}
