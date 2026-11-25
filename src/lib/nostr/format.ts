import { decode, npubEncode } from 'nostr-tools/nip19';

/** Accepts npub1… or 64-char hex and returns lowercase hex, or null. */
export function pubkeyFromInput(value: string): string | null {
  const trimmed = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return trimmed.toLowerCase();
  if (trimmed.startsWith('npub1')) {
    try {
      const decoded = decode(trimmed);
      if (decoded.type === 'npub') return decoded.data as string;
    } catch {
      return null;
    }
  }
  return null;
}

export function shortNpub(pubkey: string): string {
  try {
    const npub = npubEncode(pubkey);
    return `${npub.slice(0, 10)}…${npub.slice(-4)}`;
  } catch {
    return `${pubkey.slice(0, 8)}…`;
  }
}

export function shortHex(pubkey: string): string {
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
}
