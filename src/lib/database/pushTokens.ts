import { getDatabase } from './db';
import type { PushPlatform } from '../notifications/push';

export interface StoredPushToken {
  viewerPubkey: string;
  ownerPubkey: string;
  circleId: string;
  deviceId: string;
  token: string;
  platform: PushPlatform;
  allowPosts: boolean;
  allowActivity: boolean;
  allowInvites: boolean;
  muted: boolean;
  updatedAt: number;
}

interface PushTokenRow {
  viewer_pubkey: string;
  owner_pubkey: string;
  circle_id: string;
  device_id: string;
  token: string;
  platform: string;
  allow_posts: number;
  allow_activity: number;
  allow_invites: number;
  muted: number;
  updated_at: number;
}

function mapToken(row: PushTokenRow): StoredPushToken {
  return {
    viewerPubkey: row.viewer_pubkey,
    ownerPubkey: row.owner_pubkey,
    circleId: row.circle_id,
    deviceId: row.device_id,
    token: row.token,
    platform: row.platform === 'ios' ? 'ios' : 'android',
    allowPosts: row.allow_posts === 1,
    allowActivity: row.allow_activity === 1,
    allowInvites: row.allow_invites === 1,
    muted: row.muted === 1,
    updatedAt: row.updated_at,
  };
}

/** Stores a token only when it is at least as new as the row it replaces. */
export async function upsertPushToken(input: StoredPushToken): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO push_tokens
       (viewer_pubkey, owner_pubkey, circle_id, device_id, token, platform,
        allow_posts, allow_activity, allow_invites, muted, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(viewer_pubkey, owner_pubkey, circle_id, device_id) DO UPDATE SET
       token = excluded.token,
       platform = excluded.platform,
       allow_posts = excluded.allow_posts,
       allow_activity = excluded.allow_activity,
       allow_invites = excluded.allow_invites,
       muted = excluded.muted,
       updated_at = excluded.updated_at
     WHERE excluded.updated_at >= push_tokens.updated_at`,
    input.viewerPubkey,
    input.ownerPubkey,
    input.circleId,
    input.deviceId,
    input.token,
    input.platform,
    input.allowPosts ? 1 : 0,
    input.allowActivity ? 1 : 0,
    input.allowInvites ? 1 : 0,
    input.muted ? 1 : 0,
    input.updatedAt
  );
}

/** Removes one device token, but only if the removal is not older than the stored row. */
export async function deletePushToken(input: {
  viewerPubkey: string;
  ownerPubkey: string;
  circleId: string;
  deviceId: string;
  at: number;
}): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `DELETE FROM push_tokens
     WHERE viewer_pubkey = ? AND owner_pubkey = ? AND circle_id = ? AND device_id = ? AND updated_at <= ?`,
    input.viewerPubkey,
    input.ownerPubkey,
    input.circleId,
    input.deviceId,
    input.at
  );
}

export async function listPushTokensForOwners(
  viewerPubkey: string,
  circleId: string,
  ownerPubkeys: string[]
): Promise<StoredPushToken[]> {
  const owners = [...new Set(ownerPubkeys)].filter(Boolean);
  if (owners.length === 0) return [];
  const db = await getDatabase();
  const placeholders = owners.map(() => '?').join(',');
  const rows = await db.getAllAsync<PushTokenRow>(
    `SELECT * FROM push_tokens
     WHERE viewer_pubkey = ? AND circle_id = ? AND owner_pubkey IN (${placeholders})
     ORDER BY updated_at DESC`,
    viewerPubkey,
    circleId,
    ...owners
  );
  return rows.map(mapToken);
}

/**
 * Returns a contact's tokens from any shared circle. Used to deliver an
 * invitation for a new circle to a contact whose device is already known.
 */
export async function listPushTokensForOwnerAnyCircle(
  viewerPubkey: string,
  ownerPubkey: string
): Promise<StoredPushToken[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<PushTokenRow>(
    'SELECT * FROM push_tokens WHERE viewer_pubkey = ? AND owner_pubkey = ? ORDER BY updated_at DESC',
    viewerPubkey,
    ownerPubkey
  );
  return rows.map(mapToken);
}

/** Drops tokens of a member removed from one circle, for every local viewer. */
export async function deletePushTokensForCircleMember(
  circleId: string,
  ownerPubkey: string
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'DELETE FROM push_tokens WHERE circle_id = ? AND owner_pubkey = ?',
    circleId,
    ownerPubkey
  );
}

/** Drops every token cached for a circle after the viewer leaves or is removed. */
export async function deletePushTokensForCircle(
  viewerPubkey: string,
  circleId: string
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'DELETE FROM push_tokens WHERE viewer_pubkey = ? AND circle_id = ?',
    viewerPubkey,
    circleId
  );
}

export async function deletePushTokensByToken(tokens: string[]): Promise<void> {
  const unique = [...new Set(tokens)].filter(Boolean);
  if (unique.length === 0) return;
  const db = await getDatabase();
  const placeholders = unique.map(() => '?').join(',');
  await db.runAsync(`DELETE FROM push_tokens WHERE token IN (${placeholders})`, ...unique);
}

/** Old rows are tokens that no longer re-register; keeps the table from growing forever. */
export async function prunePushTokens(updatedBefore: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM push_tokens WHERE updated_at < ?', updatedBefore);
}
