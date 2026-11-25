import { getDatabase } from './db';
import type { Circle, CircleMember, Clip, Vlog } from '../../types/models';

interface CircleRow {
  id: string;
  owner_pubkey: string;
  name: string;
  description: string | null;
  cover_uri: string | null;
  membership_version: number;
  created_at: number;
  updated_at: number;
  muted: number;
}

interface MemberRow {
  circle_id: string;
  pubkey: string;
  role: string;
  status: string;
  joined_at: number;
}

interface VlogRow {
  id: string;
  viewer_pubkey: string;
  remote_id: string;
  rumor_id: string | null;
  author_pubkey: string;
  circle_id: string | null;
  circle_name: string | null;
  title: string | null;
  description: string | null;
  cover_uri: string | null;
  created_at: number;
  received_at: number;
  state: string;
  unread: number;
  is_favourite: number;
  format: string | null;
  metadata: string | null;
}

interface ClipRow {
  id: string;
  vlog_id: string;
  position: number;
  provider: string | null;
  url: string | null;
  mirrors: string | null;
  encrypted_sha256: string;
  plaintext_sha256: string | null;
  encrypted_size: number;
  plaintext_size: number | null;
  duration_ms: number;
  mime_type: string;
  width: number | null;
  height: number | null;
  local_uri: string | null;
  thumbnail: string | null;
  state: string;
  created_at: number;
}

function mapCircle(row: CircleRow): Circle {
  return {
    id: row.id,
    ownerPubkey: row.owner_pubkey,
    name: row.name,
    description: row.description,
    coverUri: row.cover_uri,
    membershipVersion: row.membership_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    muted: row.muted === 1,
  };
}

function mapMember(row: MemberRow): CircleMember {
  return {
    circleId: row.circle_id,
    pubkey: row.pubkey,
    role: row.role as CircleMember['role'],
    status: row.status as CircleMember['status'],
    joinedAt: row.joined_at,
  };
}

function mapVlog(row: VlogRow): Vlog {
  return {
    id: row.id,
    viewerPubkey: row.viewer_pubkey,
    remoteId: row.remote_id,
    rumorId: row.rumor_id,
    authorPubkey: row.author_pubkey,
    circleId: row.circle_id,
    circleName: row.circle_name,
    title: row.title,
    description: row.description,
    coverUri: row.cover_uri,
    createdAt: row.created_at,
    receivedAt: row.received_at,
    state: row.state as Vlog['state'],
    unread: row.unread === 1,
    isFavourite: row.is_favourite === 1,
    format: row.format,
  };
}

function mapClip(row: ClipRow): Clip {
  let thumbnail: Clip['thumbnail'] = null;
  if (row.thumbnail) {
    try {
      thumbnail = JSON.parse(row.thumbnail) as Clip['thumbnail'];
    } catch {
      thumbnail = null;
    }
  }
  return {
    id: row.id,
    vlogId: row.vlog_id,
    position: row.position,
    provider: row.provider,
    url: row.url,
    mirrors: row.mirrors ? (JSON.parse(row.mirrors) as string[]) : null,
    encryptedSha256: row.encrypted_sha256,
    plaintextSha256: row.plaintext_sha256,
    encryptedSize: row.encrypted_size,
    plaintextSize: row.plaintext_size,
    durationMs: row.duration_ms,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    localUri: row.local_uri,
    thumbnail,
    state: row.state as Clip['state'],
    createdAt: row.created_at,
  };
}

export async function listCircles(): Promise<Circle[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<CircleRow>('SELECT * FROM circles ORDER BY created_at ASC');
  return rows.map(mapCircle);
}

/** Circles the given identity is an active member of. Invited circles stay hidden until accepted. */
export async function listCirclesForViewer(viewerPubkey: string): Promise<Circle[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<CircleRow>(
    `SELECT c.* FROM circles c
     JOIN circle_members m ON m.circle_id = c.id
     WHERE m.pubkey = ? AND m.status = 'active'
     ORDER BY c.created_at ASC`,
    viewerPubkey
  );
  return rows.map(mapCircle);
}

export async function getCircle(id: string): Promise<Circle | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<CircleRow>('SELECT * FROM circles WHERE id = ?', id);
  return row ? mapCircle(row) : null;
}

export async function listCircleMembers(circleId: string): Promise<CircleMember[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<MemberRow>(
    'SELECT * FROM circle_members WHERE circle_id = ? AND status != ? ORDER BY joined_at ASC',
    circleId,
    'removed'
  );
  return rows.map(mapMember);
}

export async function getCircleMember(circleId: string, pubkey: string): Promise<CircleMember | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<MemberRow>(
    'SELECT * FROM circle_members WHERE circle_id = ? AND pubkey = ?',
    circleId,
    pubkey
  );
  return row ? mapMember(row) : null;
}

/** Applies a remote removal without incrementing the owner's membership version again. */
export async function markCircleMemberRemoved(circleId: string, pubkey: string): Promise<boolean> {
  const db = await getDatabase();
  const current = await getCircleMember(circleId, pubkey);
  if (!current || current.status === 'removed') return false;
  await db.runAsync(
    "UPDATE circle_members SET status = 'removed' WHERE circle_id = ? AND pubkey = ?",
    circleId,
    pubkey
  );
  await db.runAsync('UPDATE circles SET updated_at = ? WHERE id = ?', Date.now(), circleId);
  return true;
}

export async function createCircle(input: {
  id: string;
  ownerPubkey: string;
  name: string;
  description?: string;
  members: { pubkey: string; role?: CircleMember['role']; status?: CircleMember['status'] }[];
}): Promise<Circle> {
  const db = await getDatabase();
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'INSERT INTO circles (id, owner_pubkey, name, description, membership_version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
      input.id,
      input.ownerPubkey,
      input.name,
      input.description ?? null,
      now,
      now
    );
    await db.runAsync(
      'INSERT OR REPLACE INTO circle_members (circle_id, pubkey, role, status, joined_at) VALUES (?, ?, ?, ?, ?)',
      input.id,
      input.ownerPubkey,
      'owner',
      'active',
      now
    );
    for (const member of input.members) {
      if (member.pubkey === input.ownerPubkey) continue;
      await db.runAsync(
        'INSERT OR REPLACE INTO circle_members (circle_id, pubkey, role, status, joined_at) VALUES (?, ?, ?, ?, ?)',
        input.id,
        member.pubkey,
        member.role ?? 'member',
        member.status ?? 'active',
        now
      );
    }
  });
  const circle = await getCircle(input.id);
  if (!circle) throw new Error('Circle was not created');
  return circle;
}

export async function addCircleMember(
  circleId: string,
  pubkey: string,
  status: 'invited' | 'active' = 'invited'
): Promise<void> {
  const db = await getDatabase();
  const now = Date.now();
  await db.runAsync(
    'INSERT INTO circle_members (circle_id, pubkey, role, status, joined_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(circle_id, pubkey) DO UPDATE SET status = excluded.status',
    circleId,
    pubkey,
    'member',
    status,
    now
  );
  await db.runAsync('UPDATE circles SET membership_version = membership_version + 1, updated_at = ? WHERE id = ?', now, circleId);
}

export async function markCircleMemberActive(circleId: string, pubkey: string): Promise<boolean> {
  const db = await getDatabase();
  const current = await db.getFirstAsync<{ status: string }>(
    'SELECT status FROM circle_members WHERE circle_id = ? AND pubkey = ?',
    circleId,
    pubkey
  );
  if (!current || current.status === 'active' || current.status === 'removed') return false;
  await db.runAsync("UPDATE circle_members SET status = 'active' WHERE circle_id = ? AND pubkey = ?", circleId, pubkey);
  await db.runAsync('UPDATE circles SET updated_at = ? WHERE id = ?', Date.now(), circleId);
  return true;
}

/** Creates the local circle from a delivered invitation and joins as an active member. */
export async function addCircleFromInvite(input: {
  id: string;
  ownerPubkey: string;
  name: string;
  description?: string | null;
  membershipVersion: number;
  members: string[];
  selfPubkey: string;
}): Promise<Circle> {
  const db = await getDatabase();
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'INSERT INTO circles (id, owner_pubkey, name, description, membership_version, created_at, updated_at, muted) VALUES (?, ?, ?, ?, ?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, membership_version = MAX(circles.membership_version, excluded.membership_version), updated_at = excluded.updated_at',
      input.id,
      input.ownerPubkey,
      input.name,
      input.description ?? null,
      input.membershipVersion,
      now,
      now
    );
    const everyone = [...new Set([input.ownerPubkey, ...input.members, input.selfPubkey])];
    for (const pubkey of everyone) {
      const role = pubkey === input.ownerPubkey ? 'owner' : 'member';
      const status = pubkey === input.selfPubkey ? 'active' : 'active';
      await db.runAsync(
        'INSERT INTO circle_members (circle_id, pubkey, role, status, joined_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(circle_id, pubkey) DO UPDATE SET role = excluded.role, status = excluded.status',
        input.id,
        pubkey,
        role,
        status,
        now
      );
    }
  });
  const circle = await getCircle(input.id);
  if (!circle) throw new Error('Circle was not created from the invitation');
  return circle;
}

export async function removeCircleMember(circleId: string, pubkey: string): Promise<void> {
  const db = await getDatabase();
  const now = Date.now();
  await db.runAsync('UPDATE circle_members SET status = ? WHERE circle_id = ? AND pubkey = ?', 'removed', circleId, pubkey);
  await db.runAsync('UPDATE circles SET membership_version = membership_version + 1, updated_at = ? WHERE id = ?', now, circleId);
}

export async function setCircleMuted(circleId: string, muted: boolean): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE circles SET muted = ?, updated_at = ? WHERE id = ?', muted ? 1 : 0, Date.now(), circleId);
}

export async function upsertVlog(vlog: Vlog, clips: Clip[]): Promise<void> {
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO vlogs (id, viewer_pubkey, remote_id, rumor_id, author_pubkey, circle_id, circle_name, title, description, cover_uri,
        created_at, received_at, state, unread, is_favourite, format, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         rumor_id = excluded.rumor_id,
         title = excluded.title,
         description = excluded.description,
         cover_uri = COALESCE(excluded.cover_uri, vlogs.cover_uri),
         state = excluded.state,
         format = excluded.format,
         metadata = excluded.metadata`,
      vlog.id,
      vlog.viewerPubkey,
      vlog.remoteId,
      vlog.rumorId ?? null,
      vlog.authorPubkey,
      vlog.circleId ?? null,
      vlog.circleName ?? null,
      vlog.title ?? null,
      vlog.description ?? null,
      vlog.coverUri ?? null,
      vlog.createdAt,
      vlog.receivedAt,
      vlog.state,
      vlog.unread ? 1 : 0,
      vlog.isFavourite ? 1 : 0,
      vlog.format ?? null,
      JSON.stringify({})
    );
    for (const clip of clips) {
      await db.runAsync(
        `INSERT INTO clips (id, vlog_id, position, provider, url, mirrors, encrypted_sha256, plaintext_sha256, encrypted_size,
          plaintext_size, duration_ms, mime_type, width, height, local_uri, thumbnail, state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           position = excluded.position,
           provider = excluded.provider,
           url = excluded.url,
           mirrors = excluded.mirrors,
           local_uri = excluded.local_uri,
           thumbnail = COALESCE(excluded.thumbnail, clips.thumbnail),
           state = excluded.state`,
        clip.id,
        clip.vlogId,
        clip.position,
        clip.provider ?? null,
        clip.url ?? null,
        clip.mirrors ? JSON.stringify(clip.mirrors) : null,
        clip.encryptedSha256,
        clip.plaintextSha256 ?? null,
        clip.encryptedSize,
        clip.plaintextSize ?? null,
        clip.durationMs,
        clip.mimeType,
        clip.width ?? null,
        clip.height ?? null,
        clip.localUri ?? null,
        clip.thumbnail ? JSON.stringify(clip.thumbnail) : null,
        clip.state,
        clip.createdAt
      );
    }
  });
}

export interface ListVlogsOptions {
  circleId?: string | null;
  search?: string;
  favouritesOnly?: boolean;
  limit?: number;
  offset?: number;
}

export async function listVlogs(viewerPubkey: string, options: ListVlogsOptions = {}): Promise<Vlog[]> {
  const db = await getDatabase();
  const clauses: string[] = ['viewer_pubkey = ?'];
  const params: (string | number)[] = [viewerPubkey];
  if (options.circleId) {
    clauses.push('circle_id = ?');
    params.push(options.circleId);
  }
  if (options.favouritesOnly) clauses.push('is_favourite = 1');
  if (options.search?.trim()) {
    clauses.push('(LOWER(COALESCE(title, \'\')) LIKE ? OR LOWER(COALESCE(description, \'\')) LIKE ?)');
    const needle = `%${options.search.trim().toLowerCase()}%`;
    params.push(needle, needle);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await db.getAllAsync<VlogRow>(
    `SELECT * FROM vlogs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ...params,
    options.limit ?? 50,
    options.offset ?? 0
  );
  const vlogs = rows.map(mapVlog);
  return attachClips(vlogs);
}

export async function getVlog(viewerPubkey: string, id: string): Promise<Vlog | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<VlogRow>('SELECT * FROM vlogs WHERE id = ? AND viewer_pubkey = ?', id, viewerPubkey);
  if (!row) return null;
  const [vlog] = await attachClips([mapVlog(row)]);
  return vlog;
}

async function attachClips(vlogs: Vlog[]): Promise<Vlog[]> {
  if (vlogs.length === 0) return vlogs;
  const db = await getDatabase();
  const placeholders = vlogs.map(() => '?').join(',');
  const rows = await db.getAllAsync<ClipRow>(
    `SELECT * FROM clips WHERE vlog_id IN (${placeholders}) ORDER BY position ASC`,
    ...vlogs.map((vlog) => vlog.id)
  );
  const byVlog = new Map<string, Clip[]>();
  for (const row of rows) {
    const list = byVlog.get(row.vlog_id) ?? [];
    list.push(mapClip(row));
    byVlog.set(row.vlog_id, list);
  }
  return vlogs.map((vlog) => ({ ...vlog, clips: byVlog.get(vlog.id) ?? [] }));
}

export async function markVlogRead(vlogId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE vlogs SET unread = 0 WHERE id = ?', vlogId);
}

export async function setFavourite(vlogId: string, favourite: boolean): Promise<void> {
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE vlogs SET is_favourite = ? WHERE id = ?', favourite ? 1 : 0, vlogId);
    if (favourite) {
      await db.runAsync('INSERT OR IGNORE INTO favourites (vlog_id, created_at) VALUES (?, ?)', vlogId, Date.now());
    } else {
      await db.runAsync('DELETE FROM favourites WHERE vlog_id = ?', vlogId);
    }
  });
}

export async function updateClipLocalUri(clipId: string, localUri: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE clips SET local_uri = ?, state = ? WHERE id = ?', localUri, 'downloaded', clipId);
}

export async function updateVlogCover(vlogId: string, coverUri: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE vlogs SET cover_uri = ? WHERE id = ?', coverUri, vlogId);
}

export async function countUnread(viewerPubkey: string): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM vlogs WHERE unread = 1 AND viewer_pubkey = ?',
    viewerPubkey
  );
  return row?.count ?? 0;
}

export async function hasVlogByRumor(viewerPubkey: string, rumorId: string): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM vlogs WHERE rumor_id = ? AND viewer_pubkey = ? LIMIT 1',
    rumorId,
    viewerPubkey
  );
  return Boolean(row);
}
