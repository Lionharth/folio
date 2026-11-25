import * as SQLite from 'expo-sqlite';

const DATABASE_NAME = 'folio.db';
const SCHEMA_VERSION = 8;

let database: SQLite.SQLiteDatabase | null = null;
let opening: Promise<SQLite.SQLiteDatabase> | null = null;

const MIGRATION_1 = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS relays (
  url TEXT PRIMARY KEY NOT NULL,
  read INTEGER NOT NULL DEFAULT 1,
  write INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'unknown',
  last_checked_at INTEGER,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS media_providers (
  url TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  upload_enabled INTEGER NOT NULL DEFAULT 1,
  max_upload_bytes INTEGER,
  last_checked_at INTEGER,
  health TEXT NOT NULL DEFAULT 'unknown'
);

CREATE TABLE IF NOT EXISTS circles (
  id TEXT PRIMARY KEY NOT NULL,
  owner_pubkey TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  cover_uri TEXT,
  membership_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  muted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS circle_members (
  circle_id TEXT NOT NULL,
  pubkey TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'active',
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (circle_id, pubkey),
  FOREIGN KEY (circle_id) REFERENCES circles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS vlogs (
  id TEXT PRIMARY KEY NOT NULL,
  remote_id TEXT NOT NULL,
  rumor_id TEXT,
  author_pubkey TEXT NOT NULL,
  circle_id TEXT,
  circle_name TEXT,
  title TEXT,
  description TEXT,
  cover_uri TEXT,
  created_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'published',
  unread INTEGER NOT NULL DEFAULT 1,
  is_favourite INTEGER NOT NULL DEFAULT 0,
  format TEXT,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS vlogs_created_at_idx ON vlogs (created_at DESC);
CREATE INDEX IF NOT EXISTS vlogs_circle_idx ON vlogs (circle_id, created_at DESC);

CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY NOT NULL,
  vlog_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  provider TEXT,
  url TEXT,
  mirrors TEXT,
  encrypted_sha256 TEXT NOT NULL,
  plaintext_sha256 TEXT,
  encrypted_size INTEGER NOT NULL,
  plaintext_size INTEGER,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  mime_type TEXT NOT NULL DEFAULT 'video/mp4',
  width INTEGER,
  height INTEGER,
  local_uri TEXT,
  thumbnail TEXT,
  state TEXT NOT NULL DEFAULT 'remote',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (vlog_id) REFERENCES vlogs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS clips_vlog_idx ON clips (vlog_id, position);

CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT,
  description TEXT,
  circle_id TEXT,
  cover_uri TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'editing'
);

CREATE TABLE IF NOT EXISTS draft_clips (
  id TEXT PRIMARY KEY NOT NULL,
  draft_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  local_uri TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'video/mp4',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  size_bytes INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (draft_id) REFERENCES drafts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS draft_clips_draft_idx ON draft_clips (draft_id, position);

CREATE TABLE IF NOT EXISTS upload_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  clip_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  retry_count INTEGER NOT NULL DEFAULT 0,
  progress REAL NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS favourites (
  vlog_id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL
);
`;

const MIGRATION_2 = `
ALTER TABLE vlogs ADD COLUMN viewer_pubkey TEXT NOT NULL DEFAULT '';
UPDATE vlogs SET viewer_pubkey = author_pubkey WHERE viewer_pubkey = '';
CREATE INDEX IF NOT EXISTS vlogs_viewer_idx ON vlogs (viewer_pubkey, created_at DESC);
`;

const MIGRATION_3 = `
CREATE TABLE IF NOT EXISTS circle_invites (
  id TEXT PRIMARY KEY NOT NULL,
  circle_id TEXT NOT NULL,
  owner_pubkey TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  members TEXT NOT NULL,
  membership_version INTEGER NOT NULL,
  invited_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE UNIQUE INDEX IF NOT EXISTS circle_invites_unique
  ON circle_invites (circle_id, owner_pubkey, membership_version);
CREATE INDEX IF NOT EXISTS circle_invites_status_idx ON circle_invites (status, received_at DESC);
`;

const MIGRATION_4_TABLE = `
CREATE TABLE IF NOT EXISTS contact_profiles (
  pubkey TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

const MIGRATION_7_TABLES = `
CREATE TABLE IF NOT EXISTS comments (
  viewer_pubkey TEXT NOT NULL,
  id TEXT NOT NULL,
  remote_vlog_id TEXT NOT NULL,
  circle_id TEXT NOT NULL,
  author_pubkey TEXT NOT NULL,
  body TEXT NOT NULL,
  reply_to_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_op_id TEXT NOT NULL,
  edited_at INTEGER,
  deleted_at INTEGER,
  placeholder INTEGER NOT NULL DEFAULT 0,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (viewer_pubkey, id)
);

CREATE INDEX IF NOT EXISTS comments_vlog_idx
  ON comments (viewer_pubkey, remote_vlog_id, created_at);
CREATE INDEX IF NOT EXISTS comments_reply_idx
  ON comments (viewer_pubkey, remote_vlog_id, reply_to_id);

CREATE TABLE IF NOT EXISTS reactions (
  viewer_pubkey TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  remote_vlog_id TEXT NOT NULL,
  circle_id TEXT NOT NULL,
  author_pubkey TEXT NOT NULL,
  emoji TEXT NOT NULL,
  active INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_op_id TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (viewer_pubkey, target_type, target_id, author_pubkey, emoji)
);

CREATE INDEX IF NOT EXISTS reactions_target_idx
  ON reactions (viewer_pubkey, target_type, target_id, active);

CREATE TABLE IF NOT EXISTS inbox_sync_state (
  recipient_pubkey TEXT PRIMARY KEY NOT NULL,
  backfill_complete INTEGER NOT NULL DEFAULT 0,
  backfill_until INTEGER,
  last_sync_at INTEGER,
  updated_at INTEGER NOT NULL
);
`;

const MIGRATION_6_TABLES = `
CREATE TABLE IF NOT EXISTS circle_memberships (
  recipient_pubkey TEXT NOT NULL,
  circle_id TEXT NOT NULL,
  owner_pubkey TEXT NOT NULL,
  membership_version INTEGER NOT NULL,
  action TEXT NOT NULL,
  at INTEGER NOT NULL,
  payload TEXT NOT NULL,
  published_at INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (recipient_pubkey, circle_id, owner_pubkey)
);

CREATE INDEX IF NOT EXISTS circle_memberships_publish_idx
  ON circle_memberships (recipient_pubkey, published_at);

CREATE TABLE IF NOT EXISTS control_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  sender_pubkey TEXT NOT NULL,
  recipient_pubkey TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);

CREATE INDEX IF NOT EXISTS control_outbox_sender_idx
  ON control_outbox (sender_pubkey, sent_at);
`;

const MIGRATION_8_TABLES = `
CREATE TABLE IF NOT EXISTS inbox_relay_state (
  recipient_pubkey TEXT NOT NULL,
  relay TEXT NOT NULL,
  backfill_until INTEGER,
  backfill_complete INTEGER NOT NULL DEFAULT 0,
  incremental_until INTEGER,
  incremental_complete INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (recipient_pubkey, relay)
);

CREATE INDEX IF NOT EXISTS vlogs_remote_idx
  ON vlogs (viewer_pubkey, remote_id);
`;

async function addColumnIfMissing(
  db: SQLite.SQLiteDatabase,
  table: string,
  column: string,
  definition: string
): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table});`);
  if (!columns.some((entry) => entry.name === column)) {
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
}

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  const current = row?.user_version ?? 0;
  if (current < 1) {
    await db.execAsync(MIGRATION_1);
  }
  if (current < 2) {
    // Fresh databases already have viewer_pubkey from MIGRATION_1? No: only
    // MIGRATION_1 ran, so add the column in both fresh and upgrade paths.
    await db.execAsync(MIGRATION_2).catch(async (error) => {
      if (String(error).includes('duplicate column')) return;
      throw error;
    });
  }
  if (current < 3) {
    await db.execAsync(MIGRATION_3);
  }
  if (current < 4) {
    await db.execAsync(MIGRATION_4_TABLE);
    await addColumnIfMissing(db, 'circle_invites', 'owner_name', 'TEXT');
    await addColumnIfMissing(db, 'circle_invites', 'member_names', 'TEXT');
  }
  if (current < 5) {
    await addColumnIfMissing(db, 'clips', 'thumbnail', 'TEXT');
  }
  if (current < 6) {
    await db.execAsync(MIGRATION_6_TABLES);
    await addColumnIfMissing(db, 'circle_invites', 'recipient_pubkey', 'TEXT');
    // Legacy invitations were not scoped to an identity, so they cannot be
    // attributed safely. They are re-fetched on the next sync.
    await db.execAsync(`
      DROP INDEX IF EXISTS circle_invites_unique;
      DROP INDEX IF EXISTS circle_invites_status_idx;
      DELETE FROM circle_invites WHERE recipient_pubkey IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS circle_invites_unique
        ON circle_invites (recipient_pubkey, circle_id, owner_pubkey, membership_version);
      CREATE INDEX IF NOT EXISTS circle_invites_recipient_status_idx
        ON circle_invites (recipient_pubkey, status, received_at DESC);
    `);
  }
  if (current < 7) {
    await db.execAsync(MIGRATION_7_TABLES);
  }
  if (current < 8) {
    await db.execAsync(MIGRATION_8_TABLES);
  }
  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (database) return database;
  if (opening) return opening;
  opening = (async () => {
    const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
    await migrate(db);
    database = db;
    opening = null;
    return db;
  })();
  return opening;
}

export async function resetDatabaseForTests(): Promise<void> {
  if (!database) return;
  await database.closeAsync();
  database = null;
  opening = null;
}

export type Database = SQLite.SQLiteDatabase;
