/**
 * Provider fallback ordering. The user's selection is always tried first, then
 * the remaining presets in their declared order. Pure so it can be unit tested
 * without loading the Expo file system.
 */
function trimServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function providerKey(url: string): string {
  const trimmed = trimServerUrl(url);
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
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
