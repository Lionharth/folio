import { getDatabase } from './db';

const LOCK_KEY = 'inbox.sync.lock';
const LOCK_TTL_MS = 120_000;
const RETRY_MS = 500;

interface LockRecord {
  owner: string;
  at: number;
}

export interface SyncLock {
  owner: string;
  release: () => Promise<void>;
}

let ownerCounter = 0;

function newOwner(): string {
  ownerCounter += 1;
  return `${Date.now()}-${ownerCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseLock(value: string | null | undefined): LockRecord | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<LockRecord>;
    if (typeof parsed.owner === 'string' && typeof parsed.at === 'number') {
      return { owner: parsed.owner, at: parsed.at };
    }
  } catch {
    // A corrupt lock is reclaimed below.
  }
  return null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function isLockHeld(): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    LOCK_KEY
  );
  const current = parseLock(row?.value);
  return Boolean(current && Date.now() - current.at < LOCK_TTL_MS);
}

async function tryAcquire(owner: string): Promise<boolean> {
  const db = await getDatabase();
  let acquired = false;
  await db.withExclusiveTransactionAsync(async (txn) => {
    const row = await txn.getFirstAsync<{ value: string }>(
      'SELECT value FROM settings WHERE key = ?',
      LOCK_KEY
    );
    const current = parseLock(row?.value);
    if (current && Date.now() - current.at < LOCK_TTL_MS) return;
    const now = Date.now();
    await txn.runAsync(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      LOCK_KEY,
      JSON.stringify({ owner, at: now } satisfies LockRecord),
      now
    );
    acquired = true;
  });
  return acquired;
}

async function release(owner: string): Promise<void> {
  try {
    const db = await getDatabase();
    await db.withExclusiveTransactionAsync(async (txn) => {
      const row = await txn.getFirstAsync<{ value: string }>(
        'SELECT value FROM settings WHERE key = ?',
        LOCK_KEY
      );
      if (parseLock(row?.value)?.owner !== owner) return;
      await txn.runAsync('DELETE FROM settings WHERE key = ?', LOCK_KEY);
    });
  } catch {
    // The lock has a TTL, so a failed release cannot deadlock the next run.
  }
}

/**
 * Serializes foreground and headless inbox syncs. Background runs pass 0 and
 * skip immediately; foreground syncs may wait briefly for a background run.
 */
export async function acquireSyncLock(waitMs = 0): Promise<SyncLock | null> {
  const owner = newOwner();
  const deadline = Date.now() + Math.max(0, waitMs);
  let attempt = 0;
  for (;;) {
    if (!(await isLockHeld()) && (await tryAcquire(owner))) {
      return { owner, release: () => release(owner) };
    }
    if (Date.now() >= deadline) return null;
    attempt += 1;
    const backoff = Math.min(2_000, RETRY_MS * 2 ** Math.min(attempt - 1, 4));
    await delay(Math.min(backoff, Math.max(0, deadline - Date.now())));
  }
}
