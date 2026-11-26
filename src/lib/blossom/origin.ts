/**
 * Shared URL rules for storage providers and sender-supplied mirrors. Kept
 * pure so publish and receive paths can be tested without Expo modules.
 */
export function trimServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(trimServerUrl(url));
  } catch {
    return null;
  }
}

const BLOCKED_IPV4_RANGES: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function ipv4Number(host: string): number | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function isPublicIpv4(host: string): boolean {
  const value = ipv4Number(host);
  if (value === null) return true;
  for (const [base, bits] of BLOCKED_IPV4_RANGES) {
    const baseValue = ipv4Number(base)!;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((value & mask) === (baseValue & mask)) return false;
  }
  return true;
}

function isPublicIpv6(host: string): boolean {
  const normalized = host.toLowerCase();
  if (normalized === '::' || normalized === '::1') return false;

  // IPv4-mapped addresses can reach private IPv4 space.
  const mapped = normalized.match(/(?:^|:)ffff:(.+)$/);
  if (mapped) {
    const tail = mapped[1];
    if (tail.includes('.')) return isPublicIpv4(tail);
    return false;
  }

  const firstHextet = normalized.split(':')[0];
  const first = parseInt(firstHextet, 16);
  if (!Number.isFinite(first)) return true;
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link local
  if ((first & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  return true;
}

/**
 * Mirrors and providers must not point a recipient's device at its own
 * loopback, LAN, link-local metadata services or single-label search domains.
 */
export function isPublicHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;

  if (host.startsWith('[') && host.endsWith(']')) {
    return isPublicIpv6(host.slice(1, -1));
  }
  if (host.includes(':')) return isPublicIpv6(host);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return isPublicIpv4(host);

  // Single-label names may resolve through a local search domain.
  return host.includes('.');
}

export interface OriginOptions {
  httpsOnly?: boolean;
  publicHostOnly?: boolean;
}

/**
 * Returns the normalized `protocol//host` for an http(s) URL, or null when the
 * URL is malformed, uses another scheme, carries userinfo or violates the
 * requested safety options.
 */
export function httpOrigin(url: string, options: OriginOptions = {}): string | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (options.httpsOnly && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  if (options.publicHostOnly && !isPublicHostname(parsed.hostname)) return null;
  return `${parsed.protocol}//${parsed.host}`.toLowerCase();
}
