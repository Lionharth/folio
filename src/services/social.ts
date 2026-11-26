import { getPublicKey } from 'nostr-tools/pure';
import { randomUUID } from 'expo-crypto';

import {
  recordCommentActivity,
  recordReactionActivity,
  removeCommentActivity,
  removeReactionActivity,
} from '../lib/database/activity';
import { upsertContactName } from '../lib/database/contacts';
import { applyCommentOp, getComment } from '../lib/database/comments';
import { getDatabase } from '../lib/database/db';
import { enqueueControls, markControlSent } from '../lib/database/outbox';
import { applyReactionOp, countActiveReactionsForAuthor } from '../lib/database/reactions';
import {
  getCircle,
  getCircleMember,
  getVlogCircleByRemoteId,
  listCircleMembers,
} from '../lib/database/vlogs';
import { wrapControlForRecipients } from '../lib/nostr/circleControl';
import { resolveInboxRelays } from '../lib/nostr/dm';
import { createPool, DEFAULT_DM_RELAYS, publishToRelays } from '../lib/nostr/relays';
import type {
  CircleCommentPayload,
  CircleReactionPayload,
  CommentAction,
  ReactionTargetType,
  SocialControlPayload,
} from '../lib/nostr/socialControl';
import {
  MAX_REACTIONS_PER_TARGET,
  isParticipatingStatus,
  normalizeCommentBody,
  normalizeEmoji,
  normalizeSocialName,
} from '../lib/social/rules';
import type { Activity, Circle, CircleMember, Comment, Vlog } from '../types/models';

export class SocialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SocialError';
  }
}

export interface SocialValidationCache {
  circles: Map<string, Circle | null>;
  members: Map<string, CircleMember | null>;
  vlogs: Map<string, { id: string; circleId: string | null; authorPubkey: string } | null>;
  comments: Map<string, Comment | null>;
}

export function createSocialValidationCache(): SocialValidationCache {
  return {
    circles: new Map(),
    members: new Map(),
    vlogs: new Map(),
    comments: new Map(),
  };
}

async function cachedCircle(
  cache: SocialValidationCache | undefined,
  circleId: string
): Promise<Circle | null> {
  if (cache?.circles.has(circleId)) return cache.circles.get(circleId) ?? null;
  const circle = await getCircle(circleId);
  cache?.circles.set(circleId, circle);
  return circle;
}

async function cachedMember(
  cache: SocialValidationCache | undefined,
  circleId: string,
  pubkey: string
): Promise<CircleMember | null> {
  const key = `${circleId}:${pubkey}`;
  if (cache?.members.has(key)) return cache.members.get(key) ?? null;
  const member = await getCircleMember(circleId, pubkey);
  cache?.members.set(key, member);
  return member;
}

async function cachedVlog(
  cache: SocialValidationCache | undefined,
  viewerPubkey: string,
  remoteId: string
): Promise<{ id: string; circleId: string | null; authorPubkey: string } | null> {
  const key = `${viewerPubkey}:${remoteId}`;
  if (cache?.vlogs.has(key)) return cache.vlogs.get(key) ?? null;
  const vlog = await getVlogCircleByRemoteId(viewerPubkey, remoteId);
  cache?.vlogs.set(key, vlog);
  return vlog;
}

async function cachedComment(
  cache: SocialValidationCache | undefined,
  viewerPubkey: string,
  commentId: string
): Promise<Comment | null> {
  const key = `${viewerPubkey}:${commentId}`;
  if (cache?.comments.has(key)) return cache.comments.get(key) ?? null;
  const comment = await getComment(viewerPubkey, commentId);
  cache?.comments.set(key, comment);
  return comment;
}

function invalidateCachedComment(
  cache: SocialValidationCache | undefined,
  viewerPubkey: string,
  commentId: string
): void {
  cache?.comments.delete(`${viewerPubkey}:${commentId}`);
}

export async function socialRecipients(circleId: string, selfPubkey: string): Promise<string[]> {
  const members = await listCircleMembers(circleId);
  return [
    ...new Set([
      selfPubkey,
      ...members.filter((member) => isParticipatingStatus(member.status)).map((member) => member.pubkey),
    ]),
  ];
}

async function canPostInCircle(circleId: string, selfPubkey: string): Promise<boolean> {
  const member = await getCircleMember(circleId, selfPubkey);
  return isParticipatingStatus(member?.status);
}

async function persistAndQueue(
  secretKey: Uint8Array,
  recipients: string[],
  payload: SocialControlPayload,
  apply: () => Promise<unknown>
): Promise<Map<string, string>> {
  const db = await getDatabase();
  const senderPubkey = getPublicKey(secretKey);
  let queued: string[] = [];
  await db.withTransactionAsync(async () => {
    await apply();
    queued = await enqueueControls(
      senderPubkey,
      recipients.map((recipientPubkey) => ({ recipientPubkey, payload })),
      { transaction: false }
    );
  });
  return new Map(recipients.map((recipient, index) => [recipient, queued[index]]));
}

function deliverQueued(
  secretKey: Uint8Array,
  byRecipient: Map<string, string>,
  payload: SocialControlPayload
): void {
  const recipients = [...byRecipient.keys()];
  const senderPubkey = getPublicKey(secretKey);
  const pool = createPool({ secretKey });
  void (async () => {
    try {
      const senderMember = await getCircleMember(payload.circleId, senderPubkey);
      if (!isParticipatingStatus(senderMember?.status)) {
        await Promise.all([...byRecipient.values()].map((id) => markControlSent(id)));
        return;
      }
      const relayLists = await Promise.all(
        recipients.map(async (recipient) => [
          recipient,
          await resolveInboxRelays(pool, recipient, DEFAULT_DM_RELAYS),
        ] as const)
      );
      const relaysFor = new Map(relayLists);
      const { wraps } = wrapControlForRecipients(payload, secretKey, recipients);
      await Promise.all(
        wraps.map(async (wrap) => {
          const recipient = wrap.tags.find((tag) => tag[0] === 'p')?.[1];
          if (!recipient) return;
          const id = byRecipient.get(recipient);
          if (recipient !== senderPubkey) {
            const member = await getCircleMember(payload.circleId, recipient);
            if (!isParticipatingStatus(member?.status)) {
              if (id) await markControlSent(id);
              return;
            }
          }
          const relays = relaysFor.get(recipient) ?? DEFAULT_DM_RELAYS;
          try {
            const report = await publishToRelays(pool, relays, wrap);
            if (report.accepted.length > 0 && id) await markControlSent(id);
          } catch {
            return;
          }
        })
      );
    } catch {
      return;
    } finally {
      pool.destroy();
    }
  })().catch(() => undefined);
}

function makeCommentId(authorPubkey: string): string {
  return `${authorPubkey.slice(0, 10)}-${randomUUID()}`;
}

function commentPayload(input: {
  action: CommentAction;
  commentId: string;
  circleId: string;
  vlogId: string;
  body?: string;
  replyToId?: string;
  authorName?: string;
}): CircleCommentPayload {
  return {
    v: 1,
    type: 'circle-comment',
    opId: randomUUID(),
    action: input.action,
    commentId: input.commentId,
    circleId: input.circleId,
    vlogId: input.vlogId,
    body: input.body,
    replyToId: input.replyToId,
    authorName: input.authorName,
    at: Date.now(),
  };
}

async function assertCanPost(circleId: string | null | undefined, selfPubkey: string): Promise<string> {
  if (!circleId) throw new SocialError('This vlog is not part of a circle');
  const circle = await getCircle(circleId);
  if (!circle) throw new SocialError('This circle is no longer available');
  if (!(await canPostInCircle(circleId, selfPubkey))) {
    throw new SocialError('You can no longer post in this circle');
  }
  return circleId;
}

export async function createComment(input: {
  secretKey: Uint8Array;
  vlog: Vlog;
  body: string;
  replyToId?: string | null;
  authorName?: string;
}): Promise<Comment> {
  const selfPubkey = getPublicKey(input.secretKey);
  const circleId = await assertCanPost(input.vlog.circleId, selfPubkey);
  const body = normalizeCommentBody(input.body);
  if (!body) throw new SocialError('Write something first');

  if (input.replyToId) {
    const target = await getComment(selfPubkey, input.replyToId);
    if (!target || target.placeholder) throw new SocialError('That comment is no longer available');
    if (target.remoteVlogId !== input.vlog.remoteId || target.circleId !== circleId) {
      throw new SocialError('That comment belongs to another vlog');
    }
    if (target.deletedAt) throw new SocialError('That comment was deleted');
  }

  const authorName = normalizeSocialName(input.authorName) ?? undefined;
  const payload = commentPayload({
    action: 'create',
    commentId: makeCommentId(selfPubkey),
    circleId,
    vlogId: input.vlog.remoteId,
    body,
    replyToId: input.replyToId ?? undefined,
    authorName,
  });
  const recipients = await socialRecipients(circleId, selfPubkey);
  const queued = await persistAndQueue(input.secretKey, recipients, payload, async () => {
    const applied = await applyCommentOp(selfPubkey, selfPubkey, payload);
    if (!applied.applied) throw new SocialError('The comment could not be saved');
    if (authorName) await upsertContactName(selfPubkey, authorName);
  });
  deliverQueued(input.secretKey, queued, payload);

  const created = await getComment(selfPubkey, payload.commentId);
  if (!created) throw new SocialError('The comment could not be saved');
  return created;
}

export async function editComment(input: {
  secretKey: Uint8Array;
  comment: Comment;
  body: string;
}): Promise<Comment> {
  const selfPubkey = getPublicKey(input.secretKey);
  const current = await getComment(selfPubkey, input.comment.id);
  if (!current || current.placeholder) throw new SocialError('That comment is no longer available');
  if (current.authorPubkey !== selfPubkey) throw new SocialError('You can only edit your own comments');
  if (current.deletedAt) throw new SocialError('That comment was deleted');
  await assertCanPost(current.circleId, selfPubkey);

  const body = normalizeCommentBody(input.body);
  if (!body) throw new SocialError('Write something first');
  if (body === current.body) return current;

  const payload = commentPayload({
    action: 'edit',
    commentId: current.id,
    circleId: current.circleId,
    vlogId: current.remoteVlogId,
    body,
  });
  const recipients = await socialRecipients(current.circleId, selfPubkey);
  const queued = await persistAndQueue(input.secretKey, recipients, payload, async () => {
    const applied = await applyCommentOp(selfPubkey, selfPubkey, payload);
    if (!applied.applied) throw new SocialError('The comment could not be edited');
  });
  deliverQueued(input.secretKey, queued, payload);
  return (await getComment(selfPubkey, current.id)) ?? current;
}

export async function deleteComment(input: {
  secretKey: Uint8Array;
  comment: Comment;
}): Promise<Comment> {
  const selfPubkey = getPublicKey(input.secretKey);
  const current = await getComment(selfPubkey, input.comment.id);
  if (!current || current.placeholder) throw new SocialError('That comment is no longer available');
  if (current.authorPubkey !== selfPubkey) throw new SocialError('You can only delete your own comments');
  if (current.deletedAt) return current;
  await assertCanPost(current.circleId, selfPubkey);

  const payload = commentPayload({
    action: 'delete',
    commentId: current.id,
    circleId: current.circleId,
    vlogId: current.remoteVlogId,
  });
  const recipients = await socialRecipients(current.circleId, selfPubkey);
  const queued = await persistAndQueue(input.secretKey, recipients, payload, async () => {
    const applied = await applyCommentOp(selfPubkey, selfPubkey, payload);
    if (!applied.applied) throw new SocialError('The comment could not be deleted');
  });
  deliverQueued(input.secretKey, queued, payload);
  return (await getComment(selfPubkey, current.id)) ?? current;
}

function reactionPayload(input: {
  targetType: ReactionTargetType;
  targetId: string;
  circleId: string;
  vlogId: string;
  emoji: string;
  active: boolean;
  authorName?: string;
}): CircleReactionPayload {
  return {
    v: 1,
    type: 'circle-reaction',
    opId: randomUUID(),
    targetType: input.targetType,
    targetId: input.targetId,
    vlogId: input.vlogId,
    circleId: input.circleId,
    emoji: input.emoji,
    active: input.active,
    authorName: input.authorName,
    at: Date.now(),
  };
}

export async function setReaction(input: {
  secretKey: Uint8Array;
  vlog: Vlog;
  targetType: ReactionTargetType;
  targetId: string;
  emoji: string;
  active: boolean;
  authorName?: string;
}): Promise<void> {
  const selfPubkey = getPublicKey(input.secretKey);
  const circleId = await assertCanPost(input.vlog.circleId, selfPubkey);
  const emoji = normalizeEmoji(input.emoji);
  if (!emoji) throw new SocialError('That is not a reaction');
  if (input.targetType === 'vlog' && input.targetId !== input.vlog.remoteId) {
    throw new SocialError('That vlog does not match');
  }

  if (input.targetType === 'comment') {
    const target = await getComment(selfPubkey, input.targetId);
    if (!target || target.placeholder) throw new SocialError('That comment is no longer available');
    if (target.remoteVlogId !== input.vlog.remoteId || target.circleId !== circleId) {
      throw new SocialError('That comment belongs to another vlog');
    }
    if (input.active && target.deletedAt) throw new SocialError('That comment was deleted');
  }

  if (input.active) {
    const existing = await countActiveReactionsForAuthor(
      selfPubkey,
      input.targetType,
      input.targetId,
      selfPubkey,
      emoji
    );
    if (existing >= MAX_REACTIONS_PER_TARGET) {
      throw new SocialError(`You can add up to ${MAX_REACTIONS_PER_TARGET} reactions`);
    }
  }

  const authorName = normalizeSocialName(input.authorName) ?? undefined;
  const payload = reactionPayload({
    targetType: input.targetType,
    targetId: input.targetId,
    circleId,
    vlogId: input.vlog.remoteId,
    emoji,
    active: input.active,
    authorName,
  });
  const recipients = await socialRecipients(circleId, selfPubkey);
  const queued = await persistAndQueue(input.secretKey, recipients, payload, async () => {
    const applied = await applyReactionOp(selfPubkey, selfPubkey, payload);
    if (!applied) throw new SocialError('The reaction could not be saved');
    if (authorName) await upsertContactName(selfPubkey, authorName);
  });
  deliverQueued(input.secretKey, queued, payload);
}

export interface SocialApplyResult {
  applied: boolean;
  type: 'comment' | 'reaction';
  activity: Activity | null;
}

export async function applySocialControl(input: {
  viewerPubkey: string;
  senderPubkey: string;
  payload: SocialControlPayload;
  cache?: SocialValidationCache;
  recordActivity?: boolean;
}): Promise<SocialApplyResult> {
  const { viewerPubkey, senderPubkey, payload, cache, recordActivity = false } = input;
  const kind: SocialApplyResult['type'] = payload.type === 'circle-comment' ? 'comment' : 'reaction';
  const rejected = (): SocialApplyResult => ({ applied: false, type: kind, activity: null });

  const circle = await cachedCircle(cache, payload.circleId);
  if (!circle) return rejected();

  const viewerMember = await cachedMember(cache, payload.circleId, viewerPubkey);
  if (!isParticipatingStatus(viewerMember?.status)) return rejected();
  const senderMember = await cachedMember(cache, payload.circleId, senderPubkey);
  if (!isParticipatingStatus(senderMember?.status)) return rejected();

  const vlog = await cachedVlog(cache, viewerPubkey, payload.vlogId);
  if (vlog && vlog.circleId !== payload.circleId) return rejected();

  const db = await getDatabase();

  if (payload.type === 'circle-comment') {
    const replyTarget =
      payload.action === 'create' && payload.replyToId
        ? await cachedComment(cache, viewerPubkey, payload.replyToId)
        : null;
    if (
      replyTarget &&
      (replyTarget.remoteVlogId !== payload.vlogId || replyTarget.circleId !== payload.circleId)
    ) {
      return rejected();
    }

    let applied = false;
    let activity: Activity | null = null;
    const shouldRecord = recordActivity && senderPubkey !== viewerPubkey;
    if (!shouldRecord) {
      const result = await applyCommentOp(viewerPubkey, senderPubkey, payload);
      applied = result.applied;
      if (applied) invalidateCachedComment(cache, viewerPubkey, payload.commentId);
      return { applied, type: 'comment', activity: null };
    }

    await db.withTransactionAsync(async () => {
      const result = await applyCommentOp(viewerPubkey, senderPubkey, payload);
      applied = result.applied;
      if (!applied) return;
      invalidateCachedComment(cache, viewerPubkey, payload.commentId);

      if (payload.action === 'create') {
        const activityKind =
          replyTarget?.authorPubkey === viewerPubkey
            ? 'reply'
            : vlog?.authorPubkey === viewerPubkey
              ? 'comment'
              : null;
        if (!activityKind) return;
        activity = await recordCommentActivity({
          viewerPubkey,
          actorPubkey: senderPubkey,
          kind: activityKind,
          circleId: payload.circleId,
          remoteVlogId: payload.vlogId,
          localVlogId: vlog?.id ?? null,
          commentId: payload.commentId,
          targetCommentId: payload.replyToId ?? null,
          createdAt: payload.at,
        });
      } else if (payload.action === 'delete') {
        await removeCommentActivity(viewerPubkey, payload.commentId);
      }
    });
    return { applied, type: 'comment', activity };
  }

  const reactionTarget =
    payload.targetType === 'comment'
      ? await cachedComment(cache, viewerPubkey, payload.targetId)
      : null;
  if (reactionTarget) {
    if (reactionTarget.remoteVlogId !== payload.vlogId || reactionTarget.circleId !== payload.circleId) {
      return rejected();
    }
    if (payload.active && reactionTarget.deletedAt) return rejected();
  }

  let applied = false;
  let activity: Activity | null = null;
  const shouldRecord = recordActivity && senderPubkey !== viewerPubkey;
  if (!shouldRecord) {
    applied = await applyReactionOp(viewerPubkey, senderPubkey, payload);
    return { applied, type: 'reaction', activity: null };
  }

  await db.withTransactionAsync(async () => {
    applied = await applyReactionOp(viewerPubkey, senderPubkey, payload);
    if (!applied) return;

    if (!payload.active) {
      await removeReactionActivity(
        viewerPubkey,
        payload.targetType,
        payload.targetId,
        senderPubkey,
        payload.emoji
      );
      return;
    }

    const isMine =
      payload.targetType === 'vlog'
        ? vlog?.authorPubkey === viewerPubkey
        : reactionTarget?.authorPubkey === viewerPubkey;
    if (!isMine) return;

    activity = await recordReactionActivity({
      viewerPubkey,
      actorPubkey: senderPubkey,
      circleId: payload.circleId,
      remoteVlogId: payload.vlogId,
      localVlogId: vlog?.id ?? null,
      targetType: payload.targetType,
      targetId: payload.targetId,
      emoji: payload.emoji,
      createdAt: payload.at,
    });
  });
  return { applied, type: 'reaction', activity };
}
