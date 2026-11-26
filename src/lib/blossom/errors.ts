/**
 * Pure classification for failures coming out of Blossom uploads and network
 * probes. Kept free of Expo and React Native imports so the rules can be unit
 * tested, and so the same copy is used from the publish pipeline, the client
 * and the protocol lab.
 */
export type BlossomFailureKind = 'tls' | 'transport' | 'server' | 'policy' | 'unknown';

const TLS_PATTERNS = [
  /CertPathValidatorException/i,
  /Trust anchor for certification path not found/i,
  /SSLHandshakeException/i,
  /SSLPeerUnverifiedException/i,
  /CERTIFICATE_VERIFY_FAILED/i,
  /CertificateException/i,
  /CertificateExpiredException/i,
  /CertificateNotYetValidException/i,
  /timestamp check failed/i,
  /certificate has expired/i,
  /Hostname .* not verified/i,
  /not trusted/i,
  /self[- ]signed certificate/i,
  /PKIX path/i,
];

const TRANSPORT_PATTERNS = [
  /UnknownHostException/i,
  /ConnectException/i,
  /SocketTimeoutException/i,
  /Network request failed/i,
  /Unable to resolve host/i,
  /No address associated with hostname/i,
  /timed out/i,
  /AbortError/i,
  /ENOTFOUND/i,
  /ETIMEDOUT/i,
  /ECONNREFUSED/i,
  /ECONNRESET/i,
  /EHOSTUNREACH/i,
];

export const NO_TRUSTED_PROVIDER =
  'No storage provider is trusted by this phone. Check the device date or network, then try again.';
export const STORAGE_UNREACHABLE = 'Storage is unreachable right now. Try again in a moment.';

function messageOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) {
    const cause = value.cause instanceof Error ? value.cause.message : typeof value.cause === 'string' ? value.cause : '';
    return [value.message, cause, String(value)].filter(Boolean).join(' | ');
  }
  if (value && typeof value === 'object' && 'message' in value) {
    return String((value as { message: unknown }).message);
  }
  return String(value ?? '');
}

/** Raw diagnostic text suitable for logs and the protocol lab, never for the UI. */
export function extractBlossomDetail(error: unknown): string {
  return messageOf(error).replace(/\s+/g, ' ').trim().slice(0, 240);
}

export function classifyBlossomError(error: unknown): BlossomFailureKind {
  const message = messageOf(error);
  if (!message) return 'unknown';
  if (TLS_PATTERNS.some((pattern) => pattern.test(message))) return 'tls';
  if (TRANSPORT_PATTERNS.some((pattern) => pattern.test(message))) return 'transport';
  if (/\b(500|502|503|504)\b/.test(message) || /internal server error|bad gateway|service unavailable/i.test(message)) {
    return 'server';
  }
  return 'unknown';
}

/** Short, actionable copy for a single host. */
export function describeBlossomError(error: unknown, host: string): string {
  const kind = classifyBlossomError(error);
  if (kind === 'tls') return `${host} is not trusted by this phone.`;
  if (kind === 'transport') return `Could not reach ${host}.`;
  return `The upload to ${host} failed.`;
}
