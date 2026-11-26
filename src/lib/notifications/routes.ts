/**
 * Shared notification URL contract. Both the copy builders and the tap router
 * must use these helpers so a format change cannot silently break navigation.
 */

export type NotificationRoute =
  | { kind: 'vlog'; vlogId: string; comments: boolean }
  | { kind: 'updates'; circleId?: string }
  | { kind: 'circles' };

export const VLOG_PATH = '/vlog/';
export const UPDATES_PATH = '/updates';
export const CIRCLES_PATH = '/circles';

export function vlogNotificationUrl(vlogId: string): string {
  return `${VLOG_PATH}${vlogId}`;
}

export function commentsNotificationUrl(vlogId: string): string {
  return `${VLOG_PATH}${vlogId}?comments=1`;
}

export function updatesNotificationUrl(circleId: string): string {
  return `${UPDATES_PATH}?circleId=${encodeURIComponent(circleId)}`;
}

export function circlesNotificationUrl(): string {
  return CIRCLES_PATH;
}

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function updatesCircleId(query: string): string | undefined {
  if (!query) return undefined;
  for (const part of query.split('&')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const rawKey = part.slice(0, separator);
    const rawValue = part.slice(separator + 1);
    if (rawKey !== 'circleId' || !rawValue) continue;
    return decode(rawValue) ?? undefined;
  }
  return undefined;
}

function commentsRequested(query: string): boolean {
  if (!query) return false;
  for (const part of query.split('&')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator) === 'comments' && part.slice(separator + 1) === '1') return true;
  }
  return false;
}

export function resolveNotificationRoute(
  url: string,
  viewerPubkey: string
): NotificationRoute | null {
  const trimmed = url.trim();
  const hashIndex = trimmed.indexOf('#');
  const withoutHash = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  const queryIndex = withoutHash.indexOf('?');
  const path = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const query = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : '';
  const normalizedPath = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;

  if (normalizedPath.startsWith(VLOG_PATH)) {
    const vlogId = decode(normalizedPath.slice(VLOG_PATH.length));
    if (!vlogId || vlogId.includes('/')) return null;
    if (!vlogId.startsWith(`${viewerPubkey.slice(0, 10)}-`)) return null;
    return { kind: 'vlog', vlogId, comments: commentsRequested(query) };
  }

  if (normalizedPath === UPDATES_PATH) {
    return { kind: 'updates', circleId: updatesCircleId(query) };
  }

  if (normalizedPath === CIRCLES_PATH) {
    return { kind: 'circles' };
  }

  return null;
}
