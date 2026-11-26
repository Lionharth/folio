/** Normalizes a timestamp that may be seconds or milliseconds to milliseconds. */
export function toMillis(value: number): number {
  return value > 1e12 ? value : value * 1000;
}

export function formatRelativeTime(seconds: number, now = Date.now()): string {
  const timestamp = seconds > 1e12 ? seconds : seconds * 1000;
  const diff = Math.max(0, now - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return 'Just now';
  if (diff < hour) {
    const minutes = Math.floor(diff / minute);
    return `${minutes} min ago`;
  }
  if (diff < day) {
    const hours = Math.floor(diff / hour);
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }
  if (diff < 2 * day) return 'Yesterday';
  if (diff < 7 * day) {
    const days = Math.floor(diff / day);
    return `${days} days ago`;
  }
  return formatDate(timestamp);
}

export function formatDate(timestampMs: number): string {
  return new Date(timestampMs).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: new Date(timestampMs).getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}

export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

export function dayLabel(seconds: number): string {
  const date = new Date(seconds * 1000);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}
