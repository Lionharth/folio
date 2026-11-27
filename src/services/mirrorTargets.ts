import { BlossomClient } from '../lib/blossom/client';

/** The destination downloads the blob server-side, so allow a generous pull window. */
export const MIRROR_PULL_TIMEOUT_MS = 30_000;

export interface MirrorTargetInput {
  sourceUrl: string;
  sha256: string;
  size: number;
  secretKey: Uint8Array;
}

export interface MirrorTargetResult {
  provider: string;
  url: string;
}

/**
 * Asks every target provider to pull the same ciphertext server-side. Results
 * are best-effort: a failure on one provider never rejects the whole batch.
 */
export async function mirrorToProviders(
  targets: readonly string[],
  input: MirrorTargetInput,
  onAttempt?: (provider: string) => void
): Promise<MirrorTargetResult[]> {
  if (targets.length === 0) return [];

  const results = await Promise.allSettled(
    targets.map(async (target): Promise<MirrorTargetResult> => {
      const client = new BlossomClient(target);
      onAttempt?.(client.name);
      const mirrored = await client.mirrorBlob(input.sourceUrl, {
        sha256: input.sha256,
        expectedSize: input.size,
        secretKey: input.secretKey,
        timeoutMs: MIRROR_PULL_TIMEOUT_MS,
      });
      if (!mirrored.verified) throw new Error('Mirror was not verified');
      return { provider: client.url, url: mirrored.descriptor.url };
    })
  );

  return results
    .filter((result): result is PromiseFulfilledResult<MirrorTargetResult> => result.status === 'fulfilled')
    .map((result) => result.value);
}
