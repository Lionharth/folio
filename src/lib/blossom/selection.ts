/**
 * Provider fallback ordering. The user's selection is always tried first, then
 * the remaining presets in their declared order. Pure so it can be unit tested
 * without loading the Expo file system.
 */
import { httpOrigin, trimServerUrl } from './origin';

function providerKey(url: string): string {
  const origin = httpOrigin(url);
  if (origin) return origin;
  const trimmed = trimServerUrl(url);
  return trimmed ? trimmed.toLowerCase() : '';
}

export function buildProviderCandidates(selectedUrl: string, presets: readonly string[]): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];

  const add = (url: string) => {
    const trimmed = trimServerUrl(url);
    const key = providerKey(trimmed);
    if (!key || seen.has(key)) return;
    seen.add(key);
    candidates.push(trimmed);
  };

  add(selectedUrl);
  for (const preset of presets) add(preset);
  return candidates;
}

/**
 * Backup targets for an already-uploaded blob. The provider that actually
 * stored the primary copy is excluded, then candidates follow the same
 * selected-first, preset-order rule as the fallback list.
 */
export function buildMirrorCandidates(
  primaryUrl: string,
  selectedUrl: string,
  presets: readonly string[],
  max = 1
): string[] {
  const limit = Math.max(0, Math.floor(max));
  if (limit === 0) return [];
  if (!httpOrigin(primaryUrl)) return [];
  const primaryKey = providerKey(primaryUrl);
  if (!primaryKey) return [];

  const mirrors: string[] = [];
  for (const candidate of buildProviderCandidates(selectedUrl, presets)) {
    if (providerKey(candidate) === primaryKey) continue;
    mirrors.push(candidate);
    if (mirrors.length >= limit) break;
  }
  return mirrors;
}

/**
 * Providers a recipient can ask to mirror a clip. Origins already holding the
 * primary or a known copy are skipped so repeat opens do not re-send requests.
 */
export function buildRecipientMirrorTargets(
  primaryUrl: string,
  existingMirrors: readonly string[],
  providers: readonly string[]
): string[] {
  const primaryKey = httpOrigin(primaryUrl, { httpsOnly: true, publicHostOnly: true });
  if (!primaryKey) return [];

  const skip = new Set<string>([primaryKey]);
  for (const mirror of existingMirrors) {
    const key = httpOrigin(mirror, { httpsOnly: true, publicHostOnly: true });
    if (key) skip.add(key);
  }

  const targets: string[] = [];
  for (const provider of providers) {
    const key = httpOrigin(provider, { httpsOnly: true, publicHostOnly: true });
    if (!key || skip.has(key)) continue;
    skip.add(key);
    targets.push(trimServerUrl(provider));
  }
  return targets;
}

export const MAX_MIRROR_URLS = 4;

/**
 * Mirrors are sender-supplied download fallbacks, so they are untrusted input.
 * Keep only public https blobs, one per origin, bounded in number.
 */
export function sanitizeMirrorUrls(value: unknown, max = MAX_MIRROR_URLS): string[] {
  if (!Array.isArray(value)) return [];
  const limit = Math.max(0, Math.floor(max));
  if (limit === 0) return [];

  const seen = new Set<string>();
  const urls: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const origin = httpOrigin(trimmed, { httpsOnly: true, publicHostOnly: true });
    if (!origin || seen.has(origin)) continue;
    seen.add(origin);
    urls.push(trimServerUrl(trimmed));
    if (urls.length >= limit) break;
  }
  return urls;
}

/**
 * Merge existing and newly created copies, keeping only public https blobs,
 * one per origin, in the existing-first order recipients already trust.
 */
export function mergeMirrorUrls(
  existing: readonly string[],
  added: readonly string[],
  max = MAX_MIRROR_URLS
): string[] {
  return sanitizeMirrorUrls([...existing, ...added], max);
}
