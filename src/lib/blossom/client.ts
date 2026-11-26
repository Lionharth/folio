import { Directory, File, Paths, UploadType, type UploadResult as FileUploadResult } from 'expo-file-system';

import { buildBlossomAuthHeader } from './auth';
import { classifyBlossomError, describeBlossomError, extractBlossomDetail, type BlossomFailureKind } from './errors';

export interface MediaProviderInfo {
  /** Stable id, normally the origin. */
  id: string;
  name: string;
  url: string;
  /** Whether this provider is enabled for new uploads. */
  uploadEnabled: boolean;
}

export interface BlobDescriptor {
  url: string;
  sha256: string;
  size: number;
  type: string;
  uploaded?: number;
}

export interface UploadProgressInfo {
  bytesSent: number;
  totalBytes: number;
}

export interface UploadOptions {
  /** Lowercase hex sha256 of the exact encrypted bytes. */
  sha256: string;
  size: number;
  mimeType?: string;
  secretKey: Uint8Array;
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgressInfo) => void;
}

export interface UploadResult {
  provider: string;
  descriptor: BlobDescriptor;
  verified: boolean;
}

export interface ProbeResult {
  ok: boolean;
  status?: number;
  latencyMs: number;
  kind?: BlossomFailureKind;
  detail?: string;
}

export type PreflightResult =
  | { supported: true; status: number; reason?: string }
  | { supported: false; kind: 'unsupported' | 'unreachable'; reason: string; failure?: BlossomFailureKind };

function normalizeServerUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Blossom server URL must be http(s)');
  }
  return trimmed;
}

export class BlossomError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly reason?: string,
    readonly kind?: BlossomFailureKind,
    readonly detail?: string
  ) {
    super(message);
    this.name = 'BlossomError';
  }
}

async function readReason(response: Response): Promise<string | undefined> {
  const header = response.headers.get('x-reason') ?? response.headers.get('X-Reason');
  if (header) return header;
  try {
    const text = await response.text();
    return text.slice(0, 200) || undefined;
  } catch {
    return undefined;
  }
}

/**
 * RN's shared OkHttp client has no default timeouts, so every bounded request
 * needs its own abort signal.
 */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class BlossomClient {
  readonly url: string;
  readonly name: string;

  constructor(server: string, name?: string) {
    this.url = normalizeServerUrl(server);
    this.name = name ?? new URL(this.url).host;
  }

  get id(): string {
    return this.url;
  }

  info(): MediaProviderInfo {
    return { id: this.id, name: this.name, url: this.url, uploadEnabled: true };
  }

  /**
   * Cheap reachability probe. Uses a short timeout and never throws so the
   * publish pipeline can decide whether to fall back to another provider.
   */
  async probe(timeoutMs = 4000): Promise<ProbeResult> {
    const started = Date.now();
    try {
      const response = await fetchWithTimeout(`${this.url}/`, { method: 'HEAD' }, timeoutMs);
      return { ok: response.status < 500, status: response.status, latencyMs: Date.now() - started };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        kind: classifyBlossomError(error),
        detail: extractBlossomDetail(error),
      };
    }
  }

  /** OPTIONS /upload feature discovery (BUD-01). */
  async discover(): Promise<{ put: boolean; head: boolean; get: boolean }> {
    try {
      const response = await fetch(`${this.url}/upload`, { method: 'OPTIONS' });
      const allow = (response.headers.get('allow') ?? '').toUpperCase();
      const cors = (response.headers.get('access-control-allow-methods') ?? '').toUpperCase();
      const has = (verb: string) => allow.includes(verb) || cors.includes(verb);
      return { put: has('PUT') || has('POST'), head: has('HEAD'), get: has('GET') };
    } catch {
      return { put: false, head: false, get: false };
    }
  }

  /**
   * BUD-06 preflight. Servers that implement it report policy rejection before
   * the upload starts, which is how we can show meaningful size limits.
   */
  async preflight(
    secretKey: Uint8Array,
    size: number,
    sha256: string,
    mimeType = 'application/octet-stream',
    timeoutMs = 8000
  ): Promise<PreflightResult> {
    let response: Response;
    try {
      response = await fetchWithTimeout(
        `${this.url}/upload`,
        {
          method: 'HEAD',
          headers: {
            Authorization: buildBlossomAuthHeader(secretKey, { verb: 'upload', server: this.url, sha256, content: 'Upload Blob' }),
            'X-SHA-256': sha256,
            'X-Content-Length': String(size),
            'X-Content-Type': mimeType,
          },
        },
        timeoutMs
      );
    } catch (error) {
      return {
        supported: false,
        kind: 'unreachable',
        reason: describeBlossomError(error, this.name),
        failure: classifyBlossomError(error),
      };
    }
    if (response.status === 405 || response.status === 501) {
      return { supported: false, kind: 'unsupported', reason: 'Server does not advertise upload preflight' };
    }
    if (response.ok) return { supported: true, status: response.status };
    const reason = (await readReason(response)) ?? `Rejected with HTTP ${response.status}`;
    return { supported: true, status: response.status, reason };
  }

  /**
   * PUT /upload (BUD-02). The server hashes the exact bytes it receives; we
   * still verify the returned descriptor against our local hash and size.
   */
  async uploadFile(file: File, options: UploadOptions): Promise<UploadResult> {
    if (!options.sha256 || options.sha256.length !== 64) throw new BlossomError('Missing blob hash');
    if (file.size !== options.size) throw new BlossomError('File size changed before upload');

    const authorization = buildBlossomAuthHeader(options.secretKey, {
      verb: 'upload',
      server: this.url,
      sha256: options.sha256,
      content: 'Upload Blob',
      lifetimeSeconds: 900,
    });

    let result: FileUploadResult;
    try {
      result = await file.upload(`${this.url}/upload`, {
        httpMethod: 'PUT',
        uploadType: UploadType.BINARY_CONTENT,
        headers: {
          Authorization: authorization,
          'Content-Type': options.mimeType ?? 'application/octet-stream',
          'X-SHA-256': options.sha256,
          'Content-Length': String(options.size),
        },
        mimeType: options.mimeType ?? 'application/octet-stream',
        onProgress: options.onProgress,
        signal: options.signal,
      });
    } catch (error) {
      const kind = classifyBlossomError(error);
      throw new BlossomError(
        describeBlossomError(error, this.name),
        undefined,
        undefined,
        kind,
        extractBlossomDetail(error)
      );
    }

    if (result.status !== 200 && result.status !== 201) {
      let reason: string | undefined;
      try {
        const parsed = JSON.parse(result.body) as { message?: string; reason?: string };
        reason = parsed.message ?? parsed.reason;
      } catch {
        reason = result.body?.slice(0, 200);
      }
      throw new BlossomError(`Upload rejected (HTTP ${result.status})`, result.status, reason);
    }

    let descriptor: BlobDescriptor;
    try {
      descriptor = JSON.parse(result.body) as BlobDescriptor;
    } catch {
      throw new BlossomError('Upload response was not a blob descriptor');
    }
    if (descriptor.sha256 !== options.sha256) {
      throw new BlossomError('Server returned a different blob hash than the uploaded bytes');
    }
    if (typeof descriptor.size === 'number' && descriptor.size !== options.size) {
      throw new BlossomError('Server stored a different size than the uploaded bytes');
    }
    if (!/^https?:\/\//.test(descriptor.url)) {
      throw new BlossomError('Server returned an invalid blob URL');
    }

    const verified = await this.verifyBlob(descriptor.url, options.size);
    return { provider: this.id, descriptor, verified };
  }

  /** HEAD /<sha256> (BUD-01) to confirm the blob exists with the expected length. */
  async verifyBlob(url: string, expectedSize?: number, timeoutMs = 5000): Promise<boolean> {
    const target = new URL(url);
    if (target.protocol !== 'https:' && target.protocol !== 'http:') return false;
    try {
      const response = await fetchWithTimeout(url, { method: 'HEAD' }, timeoutMs);
      if (!response.ok) return false;
      const length = Number(response.headers.get('content-length'));
      if (expectedSize !== undefined && Number.isFinite(length) && length !== expectedSize) return false;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Downloads the encrypted blob to a cache file and verifies its SHA-256
   * against the expected hash before the caller attempts decryption.
   */
  async downloadToFile(
    url: string,
    destination: File,
    options: {
      expectedSha256: string;
      expectedSize?: number;
      onProgress?: (progress: { bytesWritten: number; totalBytes: number }) => void;
      signal?: AbortSignal;
    }
  ): Promise<File> {
    if (destination.exists) destination.delete();
    const file = await File.downloadFileAsync(url, destination, {
      idempotent: true,
      onProgress: options.onProgress,
      signal: options.signal,
    });
    if (options.expectedSize !== undefined && file.size !== options.expectedSize) {
      file.delete();
      throw new BlossomError('Downloaded blob has an unexpected size');
    }
    const digest = await file.digest('SHA-256');
    if (digest !== options.expectedSha256) {
      file.delete();
      throw new BlossomError('Downloaded blob failed hash verification');
    }
    return file;
  }
}

export function newCacheFile(name: string): File {
  const dir = new Directory(Paths.cache, 'folio-downloads');
  if (!dir.exists) dir.create();
  return new File(dir, name);
}

