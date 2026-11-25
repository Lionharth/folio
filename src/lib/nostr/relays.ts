import { finalizeEvent, verifyEvent, type Event } from 'nostr-tools/pure';
import { AbstractSimplePool } from 'nostr-tools/abstract-pool';

export interface RelayInfo {
  url: string;
  read: boolean;
  write: boolean;
}

/**
 * Bootstrap relays used before a user configures their own. These are general
 * purpose public relays that have historically accepted NIP-59 gift wraps.
 * Availability is not guaranteed; the app must degrade gracefully and the list
 * is user-replaceable (see PROVIDERS.md).
 */
export const DEFAULT_RELAYS: RelayInfo[] = [
  { url: 'wss://relay.damus.io', read: true, write: true },
  { url: 'wss://nos.lol', read: true, write: true },
  { url: 'wss://relay.primal.net', read: true, write: true },
];

export const DEFAULT_DM_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];

export function relayUrls(relays: RelayInfo[], direction: 'read' | 'write'): string[] {
  return relays.filter((relay) => relay[direction]).map((relay) => relay.url);
}

export interface PoolOptions {
  secretKey: Uint8Array;
  onConnectionFailure?: (url: string) => void;
  onConnectionSuccess?: (url: string) => void;
}

/**
 * Creates a pool that can answer NIP-42 AUTH challenges. Gift wraps are only
 * served to authenticated recipients by well-behaved relays, so AUTH support is
 * mandatory for private messaging.
 */
export type Pool = AbstractSimplePool;

export function createPool(options: PoolOptions): Pool {
  return new AbstractSimplePool({
    verifyEvent: (event) => verifyEvent(event),
    automaticallyAuth: () => async (template) => finalizeEvent(template, options.secretKey),
    onRelayConnectionFailure: options.onConnectionFailure,
    onRelayConnectionSuccess: options.onConnectionSuccess,
    enableReconnect: true,
    enablePing: true,
    maxWaitForConnection: 8_000,
  });
}

export interface PublishReport {
  accepted: string[];
  rejected: { url: string; reason: string }[];
}

export async function publishToRelays(
  pool: Pool,
  relays: string[],
  event: Event,
  options: { timeoutMs?: number } = {}
): Promise<PublishReport> {
  if (relays.length === 0) throw new Error('No relays configured');
  const results = await Promise.allSettled(
    pool.publish(relays, event, { maxWait: options.timeoutMs ?? 10_000 })
  );
  const report: PublishReport = { accepted: [], rejected: [] };
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      report.accepted.push(relays[index]);
    } else {
      report.rejected.push({ url: relays[index], reason: String(result.reason?.message ?? result.reason) });
    }
  });
  if (report.accepted.length === 0) {
    throw new Error(`Relay rejected the event on every relay: ${report.rejected.map((r) => `${r.url}: ${r.reason}`).join('; ')}`);
  }
  return report;
}

export interface QuerySubscription {
  close: () => void;
}

export interface SubscribeOptions {
  relays: string[];
  filter: { kinds?: number[]; authors?: string[]; '#p'?: string[]; since?: number; until?: number; limit?: number; ids?: string[] };
  onEvent: (event: Event) => void;
  onEose?: () => void;
  onClose?: (reasons: { url: string; reason: string }[]) => void;
  maxWaitMs?: number;
  signal?: AbortSignal;
}

/**
 * Incremental subscription with deduplication by event id.
 */
export function subscribe(pool: Pool, options: SubscribeOptions): QuerySubscription {
  const seen = new Set<string>();
  return pool.subscribeMany(options.relays, options.filter, {
    onevent: (event) => {
      if (seen.has(event.id)) return;
      seen.add(event.id);
      options.onEvent(event);
    },
    onclose: options.onClose,
    oneose: options.onEose,
    maxWait: options.maxWaitMs ?? 10_000,
    abort: options.signal,
  });
}

export async function queryRelays(
  pool: Pool,
  relays: string[],
  filter: SubscribeOptions['filter'],
  maxWaitMs = 8_000
): Promise<Event[]> {
  if (relays.length === 0) return [];
  const events = await pool.querySync(relays, filter, { maxWait: maxWaitMs });
  const unique = new Map<string, Event>();
  for (const event of events) unique.set(event.id, event);
  return [...unique.values()];
}

export interface RelayQueryResult {
  events: Event[];
  ok: boolean;
  reason: string | null;
}

export function queryRelay(
  pool: Pool,
  relay: string,
  filter: SubscribeOptions['filter'],
  timeoutMs = 8_000
): Promise<RelayQueryResult> {
  return new Promise((resolve) => {
    const events: Event[] = [];
    const abort = new AbortController();
    let settled = false;
    let eoseSeen = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let sub: { close: (reason?: string) => void } | null = null;

    const finish = (ok: boolean, reason: string | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      abort.abort();
      Promise.resolve()
        .then(() => sub?.close('query finished'))
        .catch(() => undefined);
      resolve({ events, ok, reason });
    };

    timer = setTimeout(() => finish(false, 'timeout'), timeoutMs);
    try {
      sub = pool.subscribe([relay], filter, {
        onevent: (event) => events.push(event),
        oneose: () => {
          eoseSeen = true;
          finish(true, 'eose');
        },
        onclose: (reasons) => finish(eoseSeen, reasons[0]?.reason ?? null),
        maxWait: timeoutMs + 30_000,
        abort: abort.signal,
      });
      if (settled) {
        Promise.resolve()
          .then(() => sub?.close('query finished'))
          .catch(() => undefined);
      }
    } catch (error) {
      finish(false, error instanceof Error ? error.message : String(error));
    }
  });
}

export { AbstractSimplePool };
