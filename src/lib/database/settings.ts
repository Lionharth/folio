import { getDatabase } from './db';

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    key,
    value,
    Date.now()
  );
}

export async function deleteSetting(key: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM settings WHERE key = ?', key);
}
