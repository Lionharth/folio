import { getDatabase } from './db';

const HEX64 = /^[0-9a-f]{64}$/;
export const MAX_DISPLAY_NAME = 40;

/** Trims and collapses whitespace; returns null for empty or invalid names. */
export function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0 || cleaned.length > MAX_DISPLAY_NAME) return null;
  return cleaned;
}

export function isPubkey(value: string): boolean {
  return HEX64.test(value);
}

/**
 * Local cache of names learned from encrypted Folio messages. Names are never
 * fetched from public metadata relays.
 */
export async function upsertContactName(pubkey: string, name: string): Promise<void> {
  const normalized = normalizeDisplayName(name);
  if (!normalized || !isPubkey(pubkey)) return;
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO contact_profiles (pubkey, display_name, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(pubkey) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`,
    pubkey,
    normalized,
    Date.now()
  );
}

export async function getContactName(pubkey: string): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ display_name: string }>(
    'SELECT display_name FROM contact_profiles WHERE pubkey = ?',
    pubkey
  );
  return row?.display_name ?? null;
}

export async function getContactNames(pubkeys: string[]): Promise<Record<string, string>> {
  if (pubkeys.length === 0) return {};
  const db = await getDatabase();
  const unique = [...new Set(pubkeys)];
  const placeholders = unique.map(() => '?').join(',');
  const rows = await db.getAllAsync<{ pubkey: string; display_name: string }>(
    `SELECT pubkey, display_name FROM contact_profiles WHERE pubkey IN (${placeholders})`,
    ...unique
  );
  const map: Record<string, string> = {};
  for (const row of rows) map[row.pubkey] = row.display_name;
  return map;
}

export async function listContactNames(): Promise<Record<string, string>> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ pubkey: string; display_name: string }>(
    'SELECT pubkey, display_name FROM contact_profiles ORDER BY display_name ASC'
  );
  const map: Record<string, string> = {};
  for (const row of rows) map[row.pubkey] = row.display_name;
  return map;
}
