import { isCommentIdForAuthor, isNewerOp } from '../social/rules';
import type { Comment } from '../../types/models';
import type { CircleCommentPayload } from '../nostr/socialControl';
import { getDatabase } from './db';

interface CommentRow {
  viewer_pubkey: string;
  id: string;
  remote_vlog_id: string;
  circle_id: string;
  author_pubkey: string;
  body: string;
  reply_to_id: string | null;
  created_at: number;
  updated_at: number;
  last_op_id: string;
  edited_at: number | null;
  deleted_at: number | null;
  placeholder: number;
  received_at: number;
}

function mapComment(row: CommentRow): Comment {
  return {
    id: row.id,
    remoteVlogId: row.remote_vlog_id,
    circleId: row.circle_id,
    authorPubkey: row.author_pubkey,
    body: row.body,
    replyToId: row.reply_to_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    placeholder: row.placeholder === 1,
  };
}

export async function listComments(
  viewerPubkey: string,
  remoteVlogId: string,
  circleId: string
): Promise<Comment[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<CommentRow>(
    `SELECT * FROM comments
     WHERE viewer_pubkey = ? AND remote_vlog_id = ? AND circle_id = ? AND placeholder = 0
     ORDER BY created_at ASC, id ASC`,
    viewerPubkey,
    remoteVlogId,
    circleId
  );
  return rows.map(mapComment);
}

export async function getComment(viewerPubkey: string, id: string): Promise<Comment | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<CommentRow>(
    'SELECT * FROM comments WHERE viewer_pubkey = ? AND id = ?',
    viewerPubkey,
    id
  );
  return row ? mapComment(row) : null;
}

export interface CommentApplyResult {
  applied: boolean;
}

function opOrder(payload: CircleCommentPayload) {
  return { at: payload.at, opId: payload.opId };
}

function storedOrder(row: CommentRow) {
  return { at: row.updated_at, opId: row.last_op_id };
}

export async function applyCommentOp(
  viewerPubkey: string,
  senderPubkey: string,
  payload: CircleCommentPayload
): Promise<CommentApplyResult> {
  const rejected = { applied: false };
  if (payload.action === 'create' && !isCommentIdForAuthor(payload.commentId, senderPubkey)) {
    return rejected;
  }

  const db = await getDatabase();
  const row = await db.getFirstAsync<CommentRow>(
    'SELECT * FROM comments WHERE viewer_pubkey = ? AND id = ?',
    viewerPubkey,
    payload.commentId
  );
  const now = Date.now();

  if (!row) {
    const body = payload.action === 'delete' ? '' : (payload.body ?? '');
    const editedAt = payload.action === 'edit' ? payload.at : null;
    const deletedAt = payload.action === 'delete' ? payload.at : null;
    const placeholder = payload.action === 'create' ? 0 : 1;
    await db.runAsync(
      `INSERT INTO comments
        (viewer_pubkey, id, remote_vlog_id, circle_id, author_pubkey, body, reply_to_id,
         created_at, updated_at, last_op_id, edited_at, deleted_at, placeholder, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      viewerPubkey,
      payload.commentId,
      payload.vlogId,
      payload.circleId,
      senderPubkey,
      body,
      payload.action === 'create' ? (payload.replyToId ?? null) : null,
      payload.at,
      payload.at,
      payload.opId,
      editedAt,
      deletedAt,
      placeholder,
      now
    );
    return { applied: true };
  }

  if (payload.action === 'create') {
    if (row.placeholder === 1 && row.author_pubkey !== senderPubkey) {
      await db.runAsync(
        `UPDATE comments
         SET author_pubkey = ?, remote_vlog_id = ?, circle_id = ?, body = ?, reply_to_id = ?,
             created_at = ?, updated_at = ?, last_op_id = ?, edited_at = NULL, deleted_at = NULL,
             placeholder = 0, received_at = ?
         WHERE viewer_pubkey = ? AND id = ?`,
        senderPubkey,
        payload.vlogId,
        payload.circleId,
        payload.body ?? '',
        payload.replyToId ?? null,
        payload.at,
        payload.at,
        payload.opId,
        now,
        viewerPubkey,
        payload.commentId
      );
      return { applied: true };
    }
    if (
      row.author_pubkey !== senderPubkey ||
      row.remote_vlog_id !== payload.vlogId ||
      row.circle_id !== payload.circleId
    ) {
      return rejected;
    }
    const metadataChanged = row.placeholder === 1 || row.created_at !== payload.at;
    if (metadataChanged) {
      await db.runAsync(
        `UPDATE comments
         SET created_at = ?, reply_to_id = COALESCE(reply_to_id, ?), placeholder = 0, received_at = ?
         WHERE viewer_pubkey = ? AND id = ?`,
        payload.at,
        payload.replyToId ?? null,
        now,
        viewerPubkey,
        payload.commentId
      );
    }
    return { applied: metadataChanged };
  }

  if (
    row.author_pubkey !== senderPubkey ||
    row.remote_vlog_id !== payload.vlogId ||
    row.circle_id !== payload.circleId
  ) {
    return rejected;
  }

  if (payload.action === 'delete' && !row.deleted_at) {
    const order = opOrder(payload);
    if (isNewerOp(order, storedOrder(row))) {
      await db.runAsync(
        `UPDATE comments
         SET body = '', deleted_at = ?, updated_at = ?, last_op_id = ?, received_at = ?
         WHERE viewer_pubkey = ? AND id = ?`,
        payload.at,
        payload.at,
        payload.opId,
        now,
        viewerPubkey,
        payload.commentId
      );
      return { applied: true };
    }
    return { applied: false };
  }

  if (payload.action === 'edit' && !row.deleted_at) {
    const body = payload.body ?? '';
    const order = opOrder(payload);
    if (isNewerOp(order, storedOrder(row))) {
      await db.runAsync(
        `UPDATE comments
         SET body = ?, edited_at = ?, updated_at = ?, last_op_id = ?, received_at = ?
         WHERE viewer_pubkey = ? AND id = ?`,
        body,
        payload.at,
        payload.at,
        payload.opId,
        now,
        viewerPubkey,
        payload.commentId
      );
      return { applied: true };
    }
  }

  return { applied: false };
}
