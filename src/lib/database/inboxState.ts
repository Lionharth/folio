import { getDatabase } from './db';

export interface InboxSyncState {
  recipientPubkey: string;
  backfillComplete: boolean;
  backfillUntil: number | null;
  lastSyncAt: number | null;
}

export interface RelaySyncState {
  relay: string;
  backfillUntil: number | null;
  backfillComplete: boolean;
  incrementalUntil: number | null;
  incrementalComplete: boolean;
}

interface InboxStateRow {
  recipient_pubkey: string;
  backfill_complete: number;
  backfill_until: number | null;
  last_sync_at: number | null;
  updated_at: number;
}

function mapState(row: InboxStateRow): InboxSyncState {
  return {
    recipientPubkey: row.recipient_pubkey,
    backfillComplete: row.backfill_complete === 1,
    backfillUntil: row.backfill_until,
    lastSyncAt: row.last_sync_at,
  };
}

export async function getInboxState(recipientPubkey: string): Promise<InboxSyncState | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<InboxStateRow>(
    'SELECT * FROM inbox_sync_state WHERE recipient_pubkey = ?',
    recipientPubkey
  );
  return row ? mapState(row) : null;
}

export async function saveInboxState(state: InboxSyncState): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO inbox_sync_state
      (recipient_pubkey, backfill_complete, backfill_until, last_sync_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(recipient_pubkey) DO UPDATE SET
       backfill_complete = excluded.backfill_complete,
       backfill_until = excluded.backfill_until,
       last_sync_at = excluded.last_sync_at,
       updated_at = excluded.updated_at`,
    state.recipientPubkey,
    state.backfillComplete ? 1 : 0,
    state.backfillUntil,
    state.lastSyncAt,
    Date.now()
  );
}

interface RelayStateRow {
  relay: string;
  backfill_until: number | null;
  backfill_complete: number;
  incremental_until: number | null;
  incremental_complete: number;
}

export async function listRelayStates(
  recipientPubkey: string,
  relays: string[]
): Promise<Map<string, RelaySyncState>> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<RelayStateRow>(
    'SELECT * FROM inbox_relay_state WHERE recipient_pubkey = ?',
    recipientPubkey
  );
  const known = new Map(
    rows.map((row) => [
      row.relay,
      {
        relay: row.relay,
        backfillUntil: row.backfill_until,
        backfillComplete: row.backfill_complete === 1,
        incrementalUntil: row.incremental_until,
        incrementalComplete: row.incremental_complete === 1,
      } satisfies RelaySyncState,
    ])
  );
  return new Map(
    relays.map((relay) => [
      relay,
      known.get(relay) ?? {
        relay,
        backfillUntil: null,
        backfillComplete: false,
        incrementalUntil: null,
        incrementalComplete: false,
      },
    ])
  );
}

export async function saveRelayStates(
  recipientPubkey: string,
  states: Iterable<RelaySyncState>
): Promise<void> {
  const db = await getDatabase();
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    for (const state of states) {
      await db.runAsync(
        `INSERT INTO inbox_relay_state
          (recipient_pubkey, relay, backfill_until, backfill_complete,
           incremental_until, incremental_complete, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(recipient_pubkey, relay) DO UPDATE SET
           backfill_until = excluded.backfill_until,
           backfill_complete = excluded.backfill_complete,
           incremental_until = excluded.incremental_until,
           incremental_complete = excluded.incremental_complete,
           updated_at = excluded.updated_at`,
        recipientPubkey,
        state.relay,
        state.backfillUntil,
        state.backfillComplete ? 1 : 0,
        state.incrementalUntil,
        state.incrementalComplete ? 1 : 0,
        now
      );
    }
  });
}
