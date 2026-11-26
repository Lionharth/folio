import type { Activity, ActivityKind, ReactionTargetType } from '../../types/models';
import { getDatabase } from './db';

interface ActivityRow {
  viewer_pubkey: string;
  id: string;
  kind: string;
  actor_pubkey: string;
  circle_id: string | null;
  remote_vlog_id: string | null;
  comment_id: string | null;
  target_comment_id: string | null;
  target_type: string | null;
  emoji: string | null;
  invite_id: string | null;
  created_at: number;
  received_at: number;
  read_at: number | null;
  local_vlog_id?: string | null;
  vlog_title?: string | null;
  circle_name?: string | null;
}

function mapActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    viewerPubkey: row.viewer_pubkey,
    kind: row.kind as ActivityKind,
    actorPubkey: row.actor_pubkey,
    circleId: row.circle_id,
    circleName: row.circle_name ?? null,
    remoteVlogId: row.remote_vlog_id,
    localVlogId: row.local_vlog_id ?? null,
    vlogTitle: row.vlog_title ?? null,
    commentId: row.comment_id,
    targetCommentId: row.target_comment_id,
    targetType: (row.target_type as ReactionTargetType | null) ?? null,
    emoji: row.emoji,
    inviteId: row.invite_id,
    createdAt: row.created_at,
    receivedAt: row.received_at,
    readAt: row.read_at,
  };
}

const VISIBLE_ACTIVITY = `(c.muted IS NULL OR c.muted = 0)
  AND (a.kind IN ('invite', 'member-removed') OR m.pubkey IS NOT NULL)`;

export async function listActivity(
  viewerPubkey: string,
  options: { limit: number; offset?: number }
): Promise<Activity[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<ActivityRow>(
    `SELECT a.*, v.id AS local_vlog_id, v.title AS vlog_title,
            COALESCE(c.name, i.name) AS circle_name
     FROM activity a
     LEFT JOIN vlogs v
       ON v.viewer_pubkey = a.viewer_pubkey AND v.remote_id = a.remote_vlog_id
     LEFT JOIN circles c ON c.id = a.circle_id
     LEFT JOIN circle_invites i
       ON i.id = a.invite_id AND i.recipient_pubkey = a.viewer_pubkey
     LEFT JOIN circle_members m
       ON m.circle_id = a.circle_id AND m.pubkey = a.viewer_pubkey AND m.status = 'active'
     WHERE a.viewer_pubkey = ?
       AND ${VISIBLE_ACTIVITY}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT ? OFFSET ?`,
    viewerPubkey,
    options.limit,
    options.offset ?? 0
  );
  return rows.map(mapActivity);
}

export async function countUnreadActivity(viewerPubkey: string): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM activity a
     LEFT JOIN circles c ON c.id = a.circle_id
     LEFT JOIN circle_members m
       ON m.circle_id = a.circle_id AND m.pubkey = a.viewer_pubkey AND m.status = 'active'
     WHERE a.viewer_pubkey = ?
       AND a.read_at IS NULL
       AND ${VISIBLE_ACTIVITY}`,
    viewerPubkey
  );
  return row?.count ?? 0;
}

export async function markAllActivityRead(viewerPubkey: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE activity SET read_at = ? WHERE viewer_pubkey = ? AND read_at IS NULL',
    Date.now(),
    viewerPubkey
  );
}

export async function pruneActivity(viewerPubkey: string, max = 200): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `DELETE FROM activity
     WHERE viewer_pubkey = ?
       AND id NOT IN (
         SELECT id FROM activity
         WHERE viewer_pubkey = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?
       )`,
    viewerPubkey,
    viewerPubkey,
    max
  );
}

export interface CommentActivityInput {
  viewerPubkey: string;
  actorPubkey: string;
  kind: Extract<ActivityKind, 'comment' | 'reply'>;
  circleId: string;
  remoteVlogId: string;
  localVlogId?: string | null;
  commentId: string;
  targetCommentId?: string | null;
  createdAt: number;
}

export async function recordCommentActivity(input: CommentActivityInput): Promise<Activity | null> {
  if (input.actorPubkey === input.viewerPubkey) return null;
  const db = await getDatabase();
  const id = `comment:${input.commentId}`;
  const receivedAt = Date.now();
  const result = await db.runAsync(
    `INSERT OR IGNORE INTO activity
      (viewer_pubkey, id, kind, actor_pubkey, circle_id, remote_vlog_id, comment_id,
       target_comment_id, target_type, emoji, invite_id, created_at, received_at, read_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL)`,
    input.viewerPubkey,
    id,
    input.kind,
    input.actorPubkey,
    input.circleId,
    input.remoteVlogId,
    input.commentId,
    input.targetCommentId ?? null,
    input.createdAt,
    receivedAt
  );
  if (result.changes === 0) return null;
  return {
    id,
    viewerPubkey: input.viewerPubkey,
    kind: input.kind,
    actorPubkey: input.actorPubkey,
    circleId: input.circleId,
    remoteVlogId: input.remoteVlogId,
    localVlogId: input.localVlogId ?? null,
    commentId: input.commentId,
    targetCommentId: input.targetCommentId ?? null,
    createdAt: input.createdAt,
    receivedAt,
    readAt: null,
  };
}

export async function removeCommentActivity(viewerPubkey: string, commentId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'DELETE FROM activity WHERE viewer_pubkey = ? AND id = ?',
    viewerPubkey,
    `comment:${commentId}`
  );
}

export function reactionActivityId(
  targetType: ReactionTargetType,
  targetId: string,
  actorPubkey: string,
  emoji: string
): string {
  return `reaction:${targetType}:${targetId}:${actorPubkey}:${emoji}`;
}

export interface ReactionActivityInput {
  viewerPubkey: string;
  actorPubkey: string;
  circleId: string;
  remoteVlogId: string;
  localVlogId?: string | null;
  targetType: ReactionTargetType;
  targetId: string;
  emoji: string;
  createdAt: number;
}

export async function recordReactionActivity(input: ReactionActivityInput): Promise<Activity | null> {
  if (input.actorPubkey === input.viewerPubkey) return null;
  const db = await getDatabase();
  const id = reactionActivityId(input.targetType, input.targetId, input.actorPubkey, input.emoji);
  const receivedAt = Date.now();
  await db.runAsync(
    `INSERT INTO activity
      (viewer_pubkey, id, kind, actor_pubkey, circle_id, remote_vlog_id, comment_id,
       target_comment_id, target_type, emoji, invite_id, created_at, received_at, read_at)
     VALUES (?, ?, 'reaction', ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, NULL)
     ON CONFLICT(viewer_pubkey, id) DO UPDATE SET
       created_at = excluded.created_at,
       received_at = excluded.received_at,
       read_at = NULL`,
    input.viewerPubkey,
    id,
    input.actorPubkey,
    input.circleId,
    input.remoteVlogId,
    input.targetType === 'comment' ? input.targetId : null,
    input.targetType,
    input.emoji,
    input.createdAt,
    receivedAt
  );
  return {
    id,
    viewerPubkey: input.viewerPubkey,
    kind: 'reaction',
    actorPubkey: input.actorPubkey,
    circleId: input.circleId,
    remoteVlogId: input.remoteVlogId,
    localVlogId: input.localVlogId ?? null,
    targetCommentId: input.targetType === 'comment' ? input.targetId : null,
    targetType: input.targetType,
    emoji: input.emoji,
    createdAt: input.createdAt,
    receivedAt,
    readAt: null,
  };
}

export async function removeReactionActivity(
  viewerPubkey: string,
  targetType: ReactionTargetType,
  targetId: string,
  actorPubkey: string,
  emoji: string
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'DELETE FROM activity WHERE viewer_pubkey = ? AND id = ?',
    viewerPubkey,
    reactionActivityId(targetType, targetId, actorPubkey, emoji)
  );
}

export interface InviteActivityInput {
  viewerPubkey: string;
  actorPubkey: string;
  circleId: string;
  inviteId: string;
  createdAt: number;
}

export async function recordInviteActivity(input: InviteActivityInput): Promise<void> {
  if (input.actorPubkey === input.viewerPubkey) return;
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR IGNORE INTO activity
      (viewer_pubkey, id, kind, actor_pubkey, circle_id, remote_vlog_id, comment_id,
       target_comment_id, target_type, emoji, invite_id, created_at, received_at, read_at)
     VALUES (?, ?, 'invite', ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, NULL)`,
    input.viewerPubkey,
    `invite:${input.inviteId}`,
    input.actorPubkey,
    input.circleId,
    input.inviteId,
    input.createdAt,
    Date.now()
  );
}

export interface MembershipActivityInput {
  viewerPubkey: string;
  actorPubkey: string;
  subjectPubkey: string;
  circleId: string;
  kind: Extract<ActivityKind, 'member-joined' | 'member-removed'>;
  createdAt: number;
}

export async function recordMembershipActivity(input: MembershipActivityInput): Promise<void> {
  if (input.actorPubkey === input.viewerPubkey) return;
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR IGNORE INTO activity
      (viewer_pubkey, id, kind, actor_pubkey, circle_id, remote_vlog_id, comment_id,
       target_comment_id, target_type, emoji, invite_id, created_at, received_at, read_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, NULL)`,
    input.viewerPubkey,
    `membership:${input.circleId}:${input.subjectPubkey}:${input.kind}:${input.createdAt}`,
    input.kind,
    input.actorPubkey,
    input.circleId,
    input.createdAt,
    Date.now()
  );
}
