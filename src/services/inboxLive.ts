import { getPublicKey } from 'nostr-tools/pure';

import { readSecretKey, type StoredIdentity } from '../lib/nostr/identity';
import {
  DEFAULT_DM_RELAYS,
  createPool,
  subscribe,
  type Pool,
  type QuerySubscription,
} from '../lib/nostr/relays';

export interface InboxLiveHandle {
  close: () => void;
}

export interface InboxLiveOptions {
  identity: StoredIdentity;
  relays?: string[];
  onWrap: (wrapId: string) => void;
}

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * Keeps a foreground WebSocket subscription to the identity's inbox relays.
 * This only wakes the app while JS is running; background delivery still uses
 * the periodic task and remote push.
 */
export async function startInboxLiveSubscription(
  options: InboxLiveOptions
): Promise<InboxLiveHandle> {
  const secretKey = await readSecretKey(options.identity.id);
  const pubkey = getPublicKey(secretKey);
  const relays = options.relays ?? DEFAULT_DM_RELAYS;
  const pool: Pool = createPool({ secretKey });
  let subscription: QuerySubscription | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoff = RECONNECT_MIN_MS;
  let closed = false;
  const seen = new Map<string, number>();
  let newest = Math.floor(Date.now() / 1000) - 60;

  const open = () => {
    if (closed) return;
    const now = Math.floor(Date.now() / 1000);
    newest = Math.max(newest, now - 60);
    for (const [id, at] of seen) {
      if (now - at > 300) seen.delete(id);
    }
    subscription = subscribe(pool, {
      relays,
      filter: {
        kinds: [1059],
        '#p': [pubkey],
        since: Math.max(0, newest - 5),
      },
      onEvent: (event) => {
        if (seen.has(event.id)) return;
        seen.set(event.id, event.created_at);
        newest = Math.max(newest, event.created_at);
        options.onWrap(event.id);
      },
      onEose: () => {
        backoff = RECONNECT_MIN_MS;
      },
      onClose: () => {
        if (closed) return;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
          open();
        }, backoff);
      },
      maxWaitMs: 30_000,
    });
  };

  open();

  return {
    close() {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      subscription?.close();
      subscription = null;
      pool.destroy();
    },
  };
}
