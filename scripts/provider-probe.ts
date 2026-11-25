/**
 * Manual provider probe. Uploads a small random blob to each candidate Blossom
 * server using a freshly generated Nostr identity, verifies the round trip and
 * attempts cleanup. Results feed PROVIDERS.md.
 *
 * Usage: npx tsx scripts/provider-probe.ts [--size 1048576]
 */
import { createHash, randomBytes } from 'node:crypto';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { buildBlossomAuthHeader } from '../src/lib/blossom/auth';

const serversArg = process.argv.indexOf('--servers');
const SERVERS = serversArg > -1
  ? (process.argv[serversArg + 1] ?? '').split(',').filter(Boolean)
  : ['https://nostr.download'];

const sizeArg = process.argv.indexOf('--size');
const SIZE = sizeArg > -1 ? Number(process.argv[sizeArg + 1]) : 64 * 1024;
const mimeArg = process.argv.indexOf('--mime');
const MIME = mimeArg > -1 ? process.argv[mimeArg + 1] : 'application/octet-stream';

interface ProbeResult {
  server: string;
  options: string;
  preflight: string;
  upload: string;
  uploadMs?: number;
  getMs?: number;
  hashVerified?: boolean;
  descriptor?: unknown;
  deleteStatus?: string;
  error?: string;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function probe(server: string, secretKey: Uint8Array, blob: Uint8Array): Promise<ProbeResult> {
  const hash = sha256Hex(blob);
  const result: ProbeResult = { server, options: 'n/a', preflight: 'n/a', upload: 'n/a' };
  const auth = (verb: 'upload' | 'delete' | 'get', sha?: string) =>
    buildBlossomAuthHeader(secretKey, { verb, server, sha256: sha, content: 'Upload Blob' });

  try {
    const options = await fetch(`${server}/upload`, { method: 'OPTIONS' });
    result.options = `${options.status} ${options.headers.get('allow') ?? options.headers.get('access-control-allow-methods') ?? ''}`;
  } catch (error) {
    result.options = `ERR ${(error as Error).message}`;
  }

  try {
    const head = await fetch(`${server}/upload`, {
      method: 'HEAD',
      headers: {
        Authorization: auth('upload', hash),
        'X-SHA-256': hash,
        'X-Content-Length': String(blob.length),
        'X-Content-Type': MIME,
      },
    });
    result.preflight = `${head.status} ${head.headers.get('x-reason') ?? ''}`;
  } catch (error) {
    result.preflight = `ERR ${(error as Error).message}`;
  }

  const started = Date.now();
  try {
    const upload = await fetch(`${server}/upload`, {
      method: 'PUT',
      headers: {
        Authorization: auth('upload', hash),
        'Content-Type': MIME,
        'Content-Length': String(blob.length),
        'X-SHA-256': hash,
      },
      body: blob as unknown as BodyInit,
    });
    result.uploadMs = Date.now() - started;
    result.upload = `${upload.status} ${upload.headers.get('x-reason') ?? ''}`.trim();
    const text = await upload.text();
    if (!upload.ok) {
      result.error = text.slice(0, 300);
      return result;
    }
    const descriptor = JSON.parse(text) as { url: string; sha256: string; size: number };
    result.descriptor = { url: descriptor.url, sha256Matches: descriptor.sha256 === hash, size: descriptor.size };
    if (descriptor.sha256 !== hash) {
      result.error = 'descriptor hash mismatch';
      return result;
    }

    const getStarted = Date.now();
    const download = await fetch(descriptor.url);
    const bytes = new Uint8Array(await download.arrayBuffer());
    result.getMs = Date.now() - getStarted;
    result.hashVerified = sha256Hex(bytes) === hash && bytes.length === blob.length;

    try {
      const del = await fetch(`${server}/${hash}`, {
        method: 'DELETE',
        headers: { Authorization: auth('delete', hash) },
      });
      result.deleteStatus = String(del.status);
    } catch (error) {
      result.deleteStatus = `ERR ${(error as Error).message}`;
    }
  } catch (error) {
    result.error = (error as Error).message;
  }
  return result;
}

async function main() {
  const secretKey = generateSecretKey();
  const blob = new Uint8Array(randomBytes(SIZE));
  console.log(`blob: ${(SIZE / 1024).toFixed(1)} KiB, sha256 ${sha256Hex(blob).slice(0, 16)}…`);
  console.log(`pubkey: ${getPublicKey(secretKey)}`);
  for (const server of SERVERS) {
    const result = await probe(server, secretKey, blob);
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
