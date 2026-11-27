/**
 * Manual server-side mirror probe. Uploads a tiny random blob to the first
 * Blossom server with identity A, then asks every other server to mirror it
 * using a different identity B. B is not the uploader, which is the
 * recipient-assisted case. Results feed PROVIDERS.md.
 *
 * Usage: npx tsx scripts/mirror-probe.ts [--origin https://blossom.data.haus]
 */
import { createHash, randomBytes } from 'node:crypto';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';

import { buildBlossomAuthHeader } from '../src/lib/blossom/auth';

const SERVERS = [
  'https://nostr.download',
  'https://blossom.yakihonne.com',
  'https://blossom.ditto.pub',
  'https://blossom.data.haus',
];

const originArg = process.argv.indexOf('--origin');
const origin = originArg > -1 ? (process.argv[originArg + 1] ?? SERVERS[0]) : SERVERS[0];
const destinations = SERVERS.filter((server) => server !== origin);

const SIZE = 4 * 1024;

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function upload(server: string, secretKey: Uint8Array, blob: Uint8Array, hash: string) {
  const auth = buildBlossomAuthHeader(secretKey, {
    verb: 'upload',
    server,
    sha256: hash,
    content: 'Upload Blob',
  });
  const response = await fetch(`${server}/upload`, {
    method: 'PUT',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(blob.length),
      'X-SHA-256': hash,
    },
    body: blob as unknown as BodyInit,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`upload ${response.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as { url: string; sha256: string; size: number };
}

async function options(server: string, path: string): Promise<string> {
  try {
    const response = await fetch(`${server}${path}`, { method: 'OPTIONS' });
    const methods =
      response.headers.get('allow') ?? response.headers.get('access-control-allow-methods') ?? '';
    return `${response.status} ${methods}`.trim();
  } catch (error) {
    return `ERR ${(error as Error).message}`;
  }
}

async function mirror(
  server: string,
  method: 'bud04' | 'bud13',
  sourceUrl: string,
  hash: string,
  secretKey: Uint8Array
) {
  const auth = buildBlossomAuthHeader(secretKey, {
    verb: 'upload',
    server,
    sha256: hash,
    content: 'Mirror Blob',
  });
  const response =
    method === 'bud04'
      ? await fetch(`${server}/mirror`, {
          method: 'PUT',
          headers: { Authorization: auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: sourceUrl }),
        })
      : await fetch(`${server}/${hash}`, {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'text/plain; charset=utf-8' },
          body: `${sourceUrl}\n`,
        });
  const text = await response.text();
  return {
    status: response.status,
    reason: response.headers.get('x-reason') ?? '',
    body: text,
  };
}

async function remove(server: string, hash: string, secretKey: Uint8Array) {
  try {
    const auth = buildBlossomAuthHeader(secretKey, {
      verb: 'delete',
      server,
      sha256: hash,
      content: 'Delete Blob',
    });
    await fetch(`${server}/${hash}`, { method: 'DELETE', headers: { Authorization: auth } });
  } catch {
    // Cleanup is best-effort.
  }
}

async function main() {
  const uploaderKey = generateSecretKey();
  const mirrorKey = generateSecretKey();
  const blob = new Uint8Array(randomBytes(SIZE));
  const hash = sha256Hex(blob);

  console.log(`uploader: ${getPublicKey(uploaderKey)}`);
  console.log(`mirrorer: ${getPublicKey(mirrorKey)}`);
  console.log(`blob: ${SIZE} bytes, sha256 ${hash.slice(0, 16)}…`);

  console.log(`${origin} upload OPTIONS: ${await options(origin, '/upload')}`);
  const stored = await upload(origin, uploaderKey, blob, hash);
  console.log(`${origin} stored ${stored.url}`);

  try {
    for (const server of destinations) {
      const bud04 = await options(server, '/mirror');
      const bud13 = await options(server, `/${hash}`);
      const method = bud04.includes('PUT') ? 'bud04' : bud13.includes('POST') ? 'bud13' : null;
      console.log(`\n${server}`);
      console.log(`  OPTIONS /mirror: ${bud04}`);
      console.log(`  OPTIONS /<sha256>: ${bud13}`);
      if (!method) {
        console.log('  mirror: unsupported');
        continue;
      }
      const result = await mirror(server, method, stored.url, hash, mirrorKey);
      console.log(
        `  mirror (${method}, non-uploader token): ${result.status} ${result.reason} ${result.body}`.trim()
      );
      if (result.status === 200 || result.status === 201) {
        await remove(server, hash, mirrorKey);
      }
    }
  } finally {
    await remove(origin, hash, uploaderKey);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
