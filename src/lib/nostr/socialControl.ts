import {
  normalizeAt,
  normalizeCommentBody,
  normalizeEmoji,
  normalizeSocialId,
  normalizeSocialName,
} from '../social/rules';

export type CommentAction = 'create' | 'edit' | 'delete';

export interface CircleCommentPayload {
  v: 1;
  type: 'circle-comment';
  opId: string;
  action: CommentAction;
  commentId: string;
  circleId: string;
  vlogId: string;
  body?: string;
  replyToId?: string;
  authorName?: string;
  at: number;
}

export type ReactionTargetType = 'vlog' | 'comment';

export interface CircleReactionPayload {
  v: 1;
  type: 'circle-reaction';
  opId: string;
  targetType: ReactionTargetType;
  targetId: string;
  vlogId: string;
  circleId: string;
  emoji: string;
  active: boolean;
  authorName?: string;
  at: number;
}

export type SocialControlPayload = CircleCommentPayload | CircleReactionPayload;

function parseComment(value: Record<string, unknown>): CircleCommentPayload | null {
  if (value.action !== 'create' && value.action !== 'edit' && value.action !== 'delete') return null;
  const opId = normalizeSocialId(value.opId);
  const commentId = normalizeSocialId(value.commentId);
  const circleId = normalizeSocialId(value.circleId);
  const vlogId = normalizeSocialId(value.vlogId);
  const at = normalizeAt(value.at);
  if (!opId || !commentId || !circleId || !vlogId || at === null) return null;

  if (value.action === 'delete') {
    if (value.body !== undefined || value.replyToId !== undefined || value.authorName !== undefined) {
      return null;
    }
    return {
      v: 1,
      type: 'circle-comment',
      opId,
      action: 'delete',
      commentId,
      circleId,
      vlogId,
      at,
    };
  }

  const body = normalizeCommentBody(value.body);
  if (!body) return null;

  let replyToId: string | undefined;
  if (value.action === 'create' && value.replyToId !== undefined) {
    const parsed = normalizeSocialId(value.replyToId);
    if (!parsed || parsed === commentId) return null;
    replyToId = parsed;
  } else if (value.action === 'edit' && value.replyToId !== undefined) {
    return null;
  }

  let authorName: string | undefined;
  if (value.action === 'create' && value.authorName !== undefined) {
    const parsed = normalizeSocialName(value.authorName);
    if (!parsed) return null;
    authorName = parsed;
  } else if (value.action === 'edit' && value.authorName !== undefined) {
    return null;
  }

  const payload: CircleCommentPayload = {
    v: 1,
    type: 'circle-comment',
    opId,
    action: value.action,
    commentId,
    circleId,
    vlogId,
    body,
    at,
  };
  if (replyToId) payload.replyToId = replyToId;
  if (authorName) payload.authorName = authorName;
  return payload;
}

function parseReaction(value: Record<string, unknown>): CircleReactionPayload | null {
  if (value.targetType !== 'vlog' && value.targetType !== 'comment') return null;
  const opId = normalizeSocialId(value.opId);
  const targetId = normalizeSocialId(value.targetId);
  const vlogId = normalizeSocialId(value.vlogId);
  const circleId = normalizeSocialId(value.circleId);
  const at = normalizeAt(value.at);
  const emoji = normalizeEmoji(value.emoji);
  if (!opId || !targetId || !vlogId || !circleId || at === null || !emoji) return null;
  if (typeof value.active !== 'boolean') return null;
  if (value.targetType === 'vlog' && targetId !== vlogId) return null;

  let authorName: string | undefined;
  if (value.authorName !== undefined) {
    const parsed = normalizeSocialName(value.authorName);
    if (!parsed) return null;
    authorName = parsed;
  }

  const payload: CircleReactionPayload = {
    v: 1,
    type: 'circle-reaction',
    opId,
    targetType: value.targetType,
    targetId,
    vlogId,
    circleId,
    emoji,
    active: value.active,
    at,
  };
  if (authorName) payload.authorName = authorName;
  return payload;
}

export function parseSocialControl(value: Record<string, unknown>): SocialControlPayload | null {
  if (value.v !== 1) return null;
  if (value.type === 'circle-comment') return parseComment(value);
  if (value.type === 'circle-reaction') return parseReaction(value);
  return null;
}
