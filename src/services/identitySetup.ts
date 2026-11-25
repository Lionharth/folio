import { publishInboxRelays } from '../lib/nostr/dm';
import { readSecretKey } from '../lib/nostr/identity';
import { createPool, DEFAULT_DM_RELAYS } from '../lib/nostr/relays';

/**
 * Best-effort NIP-17 inbox announcement. Failure is safe: private messages
 * fall back to the bootstrap relay set, and later syncs continue to work.
 */
export async function announceInboxRelays(identityId: string): Promise<void> {
  try {
    const secretKey = await readSecretKey(identityId);
    const pool = createPool({ secretKey });
    try {
      await publishInboxRelays(pool, secretKey, DEFAULT_DM_RELAYS);
    } finally {
      pool.destroy();
    }
  } catch {
    // Best-effort by design.
  }
}
