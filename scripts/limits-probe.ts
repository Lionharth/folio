/**
 * Maps upload-size policy per Blossom server using BUD-06 HEAD /upload, which
 * lets servers reject impossible uploads without transferring the body.
 *
 * Usage: npx tsx scripts/limits-probe.ts
 */
import { randomBytes } from 'node:crypto';
import { generateSecretKey } from 'nostr-tools/pure';
import { buildBlossomAuthHeader } from '../src/lib/blossom/auth';

const SERVERS = [
  'https://nostr.download',
  'https://blossom.yakihonne.com',
  'https://blossom.psbt.me',
  'https://blossom.primal.net',
  'https://blossom.band',
  'https://cdn.nostrcheck.me',
  'https://blossom.nostr.build',
  'https://blossom.ditto.pub',
  'https://blossom.data.haus',
];

const SIZES = [1_000_000, 10_000_000, 50_000_000, 100_000_000, 500_000_000];

async function main() {
  const secretKey = generateSecretKey();
  for (const server of SERVERS) {
    const rows: string[] = [];
    for (const size of SIZES) {
      const hash = randomBytes(32).toString('hex');
      const auth = buildBlossomAuthHeader(secretKey, {
        verb: 'upload',
        server,
        sha256: hash,
        content: 'Upload Blob',
      });
      try {
        const response = await fetch(`${server}/upload`, {
          method: 'HEAD',
          headers: {
            Authorization: auth,
            'X-SHA-256': hash,
            'X-Content-Length': String(size),
            'X-Content-Type': 'application/octet-stream',
          },
        });
        rows.push(`${(size / 1_000_000).toFixed(0)}MB=${response.status}${response.headers.get('x-reason') ? ` (${response.headers.get('x-reason')})` : ''}`);
      } catch (error) {
        rows.push(`${(size / 1_000_000).toFixed(0)}MB=ERR`);
      }
    }
    console.log(`${server}\n  ${rows.join('  ')}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
