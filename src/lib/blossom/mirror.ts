/**
 * Blob descriptor parsing shared by uploads and server-side mirroring. Kept
 * free of Expo imports so mirror responses can be validated in unit tests.
 */
import { httpOrigin } from './origin';

export interface BlobDescriptor {
  url: string;
  sha256: string;
  size: number;
  type: string;
  uploaded?: number;
}

export interface BlobDescriptorExpectation {
  sha256: string;
  size?: number;
}

export class BlobDescriptorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlobDescriptorError';
  }
}

/**
 * Validates a BUD-02 blob descriptor against the bytes the caller asked the
 * server to store. Both `PUT /upload` and the mirror endpoints return this
 * shape, so the checks live in one place.
 */
export function parseBlobDescriptor(body: string, expected: BlobDescriptorExpectation): BlobDescriptor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new BlobDescriptorError('Server response was not a blob descriptor');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new BlobDescriptorError('Server response was not a blob descriptor');
  }

  const candidate = parsed as Record<string, unknown>;
  const url = typeof candidate.url === 'string' ? candidate.url.trim() : '';
  if (!httpOrigin(url, { httpsOnly: true, publicHostOnly: true })) {
    throw new BlobDescriptorError('Server returned an invalid blob URL');
  }

  const sha256 = typeof candidate.sha256 === 'string' ? candidate.sha256.toLowerCase() : '';
  if (sha256 !== expected.sha256.toLowerCase()) {
    throw new BlobDescriptorError('Server returned a different blob hash than the uploaded bytes');
  }

  const reportedSize =
    typeof candidate.size === 'number' && Number.isFinite(candidate.size) ? candidate.size : undefined;
  const size = reportedSize ?? expected.size;
  if (size === undefined) {
    throw new BlobDescriptorError('Server returned a blob without a size');
  }
  if (expected.size !== undefined && size !== expected.size) {
    throw new BlobDescriptorError('Server stored a different size than the uploaded bytes');
  }

  const type = typeof candidate.type === 'string' ? candidate.type : 'application/octet-stream';
  const uploaded = typeof candidate.uploaded === 'number' ? candidate.uploaded : undefined;
  return { url, sha256, size, type, ...(uploaded !== undefined ? { uploaded } : {}) };
}
