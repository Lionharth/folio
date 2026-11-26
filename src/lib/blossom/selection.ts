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
