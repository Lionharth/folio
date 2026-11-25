import { isNewerOp, MAX_REACTIONS_PER_TARGET } from '../social/rules';
import type { Reaction } from '../../types/models';
import type { CircleReactionPayload, ReactionTargetType } from '../nostr/socialControl';
import { getDatabase } from './db';

interface ReactionRow {
  viewer_pubkey: string;
  target_type: string;
  target_id: string;
  remote_vlog_id: string;
  circle_id: string;
  author_pubkey: string;
  emoji: string;
  active: number;
  updated_at: number;
  last_op_id: string;
  received_at: number;
}

function mapReaction(row: ReactionRow): Reaction {
  return {
    targetType: row.target_type as ReactionTargetType,
    targetId: row.target_id,
    remoteVlogId: row.remote_vlog_id,
    circleId: row.circle_id,
    authorPubkey: row.author_pubkey,
    emoji: row.emoji,
    active: row.active === 1,
    updatedAt: row.updated_at,
  };
}

export async function listReactions(
  viewerPubkey: string,
  targetType: ReactionTargetType,
  targetId: string,
  circleId: string
): Promise<Reaction[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<ReactionRow>(
    `SELECT * FROM reactions
     WHERE viewer_pubkey = ? AND target_type = ? AND target_id = ? AND circle_id = ? AND active = 1
     ORDER BY updated_at ASC`,
    viewerPubkey,
    targetType,
    targetId,
    circleId
  );
  return rows.map(mapReaction);
}

export async function listCommentReactions(
  viewerPubkey: string,
  remoteVlogId: string,
  circleId: string
): Promise<Reaction[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<ReactionRow>(
    `SELECT * FROM reactions
     WHERE viewer_pubkey = ? AND target_type = 'comment' AND remote_vlog_id = ? AND circle_id = ? AND active = 1
     ORDER BY updated_at ASC`,
    viewerPubkey,
    remoteVlogId,
    circleId
  );
  return rows.map(mapReaction);
}

export async function countActiveReactionsForAuthor(
  viewerPubkey: string,
  targetType: ReactionTargetType,
  targetId: string,
  authorPubkey: string,
  excludingEmoji?: string
): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM reactions
     WHERE viewer_pubkey = ? AND target_type = ? AND target_id = ? AND author_pubkey = ?
       AND active = 1 AND emoji != ?`,
    viewerPubkey,
    targetType,
    targetId,
    authorPubkey,
    excludingEmoji ?? ''
  );
  return row?.count ?? 0;
}

export async function applyReactionOp(
  viewerPubkey: string,
  senderPubkey: string,
  payload: CircleReactionPayload
): Promise<boolean> {
  const db = await getDatabase();
  const existing = await db.getFirstAsync<ReactionRow>(
    `SELECT * FROM reactions
     WHERE viewer_pubkey = ? AND target_type = ? AND target_id = ? AND author_pubkey = ? AND emoji = ?`,
    viewerPubkey,
    payload.targetType,
    payload.targetId,
    senderPubkey,
    payload.emoji
  );

  const order = { at: payload.at, opId: payload.opId };
  if (existing && !isNewerOp(order, { at: existing.updated_at, opId: existing.last_op_id })) {
    return false;
  }

  if (payload.active) {
    const additions = await countActiveReactionsForAuthor(
      viewerPubkey,
      payload.targetType,
      payload.targetId,
      senderPubkey,
      payload.emoji
    );
    const alreadyActive = existing?.active === 1;
    if (!alreadyActive && additions >= MAX_REACTIONS_PER_TARGET) return false;
  }

  const now = Date.now();
  await db.runAsync(
    `INSERT INTO reactions
      (viewer_pubkey, target_type, target_id, remote_vlog_id, circle_id, author_pubkey, emoji,
       active, updated_at, last_op_id, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(viewer_pubkey, target_type, target_id, author_pubkey, emoji) DO UPDATE SET
       active = excluded.active,
       updated_at = excluded.updated_at,
       last_op_id = excluded.last_op_id,
       received_at = excluded.received_at`,
    viewerPubkey,
    payload.targetType,
    payload.targetId,
    payload.vlogId,
    payload.circleId,
    senderPubkey,
    payload.emoji,
    payload.active ? 1 : 0,
    payload.at,
    payload.opId,
    now
  );
  return true;
}
