import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { shortNpub } from '../../lib/nostr/format';
import type { ReactionSummary, ThreadedComment } from '../../lib/social/rules';
import { useTheme } from '../../theme/ThemeProvider';
import { formatRelativeTime } from '../../utils/time';
import { ReactionBar } from './ReactionBar';

export interface CommentThreadProps {
  threads: ThreadedComment[];
  names: Record<string, string>;
  selfPubkey?: string | null;
  selfLabel?: string;
  canInteract?: boolean;
  reactionsByComment: Record<string, ReactionSummary[]>;
  onReply: (comment: ThreadedComment) => void;
  onEdit: (comment: ThreadedComment) => void;
  onDelete: (comment: ThreadedComment) => void;
  onToggleReaction: (commentId: string, emoji: string, active: boolean) => void;
}

function flatten(threads: ThreadedComment[]): ThreadedComment[] {
  const list: ThreadedComment[] = [];
  const visit = (comment: ThreadedComment) => {
    list.push(comment);
    for (const reply of comment.replies) visit(reply);
  };
  for (const thread of threads) visit(thread);
  return list;
}

export function CommentThread({
  threads,
  names,
  selfPubkey,
  selfLabel,
  canInteract = true,
  reactionsByComment,
  onReply,
  onEdit,
  onDelete,
  onToggleReaction,
}: CommentThreadProps) {
  const byId = useMemo(() => new Map(flatten(threads).map((comment) => [comment.id, comment])), [threads]);
  const nameFor = (pubkey: string) =>
    pubkey === selfPubkey ? (selfLabel ?? 'You') : (names[pubkey] ?? shortNpub(pubkey));

  return (
    <View style={{ gap: 24 }}>
      {threads.map((thread) => (
        <ThreadItem
          key={thread.id}
          thread={thread}
          byId={byId}
          nameFor={nameFor}
          selfPubkey={selfPubkey}
          canInteract={canInteract}
          reactionsByComment={reactionsByComment}
          onReply={onReply}
          onEdit={onEdit}
          onDelete={onDelete}
          onToggleReaction={onToggleReaction}
        />
      ))}
    </View>
  );
}

function ThreadItem({
  thread,
  byId,
  nameFor,
  selfPubkey,
  canInteract,
  reactionsByComment,
  onReply,
  onEdit,
  onDelete,
  onToggleReaction,
}: {
  thread: ThreadedComment;
  byId: Map<string, ThreadedComment>;
  nameFor: (pubkey: string) => string;
  selfPubkey?: string | null;
  canInteract: boolean;
  reactionsByComment: Record<string, ReactionSummary[]>;
  onReply: (comment: ThreadedComment) => void;
  onEdit: (comment: ThreadedComment) => void;
  onDelete: (comment: ThreadedComment) => void;
  onToggleReaction: (commentId: string, emoji: string, active: boolean) => void;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const visibleReplies = expanded ? thread.replies : thread.replies.slice(0, 3);
  const hiddenReplies = thread.replies.length - visibleReplies.length;

  const replyName = (comment: ThreadedComment) => {
    if (!comment.replyToId) return null;
    const target = byId.get(comment.replyToId);
    return target ? nameFor(target.authorPubkey) : 'a missing comment';
  };

  return (
    <View style={{ gap: theme.spacing.md }}>
      <CommentRow
        comment={thread}
        replyName={replyName(thread)}
        nameFor={nameFor}
        selfPubkey={selfPubkey}
        canInteract={canInteract}
        reactions={reactionsByComment[thread.id] ?? []}
        onReply={onReply}
        onEdit={onEdit}
        onDelete={onDelete}
        onToggleReaction={onToggleReaction}
      />
      {thread.replies.length > 0 ? (
        <View
          style={{
            gap: theme.spacing.lg,
            paddingLeft: theme.spacing.lg,
            borderLeftWidth: 1,
            borderLeftColor: theme.colors.border,
          }}
        >
          {visibleReplies.map((reply) => (
            <CommentRow
              key={reply.id}
              comment={reply}
              replyName={replyName(reply)}
              nameFor={nameFor}
              selfPubkey={selfPubkey}
              canInteract={canInteract}
              reactions={reactionsByComment[reply.id] ?? []}
              onReply={onReply}
              onEdit={onEdit}
              onDelete={onDelete}
              onToggleReaction={onToggleReaction}
            />
          ))}
          {hiddenReplies > 0 ? (
            <Button
              label={`Show ${hiddenReplies} ${hiddenReplies === 1 ? 'reply' : 'replies'}`}
              variant="ghost"
              onPress={() => setExpanded(true)}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function CommentRow({
  comment,
  replyName,
  nameFor,
  selfPubkey,
  canInteract,
  reactions,
  onReply,
  onEdit,
  onDelete,
  onToggleReaction,
}: {
  comment: ThreadedComment;
  replyName: string | null;
  nameFor: (pubkey: string) => string;
  selfPubkey?: string | null;
  canInteract: boolean;
  reactions: ReactionSummary[];
  onReply: (comment: ThreadedComment) => void;
  onEdit: (comment: ThreadedComment) => void;
  onDelete: (comment: ThreadedComment) => void;
  onToggleReaction: (commentId: string, emoji: string, active: boolean) => void;
}) {
  const theme = useTheme();
  const deleted = Boolean(comment.deletedAt);
  const own = comment.authorPubkey === selfPubkey && !deleted;
  const author = nameFor(comment.authorPubkey);

  return (
    <View style={{ gap: theme.spacing.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
        <AppText variant="bodyStrong">{author}</AppText>
        <AppText variant="caption" color="textTertiary">
          {formatRelativeTime(comment.createdAt)}
          {comment.editedAt && !deleted ? '  \u00b7  edited' : ''}
        </AppText>
      </View>
      {replyName ? (
        <AppText variant="caption" color="textTertiary">
          Replying to {replyName}
        </AppText>
      ) : null}
      <AppText variant="body" color={deleted ? 'textTertiary' : undefined}>
        {deleted ? 'This comment was deleted.' : comment.body}
      </AppText>
      {!deleted ? (
        <>
          {reactions.length > 0 || canInteract ? (
            <ReactionBar
              compact
              reactions={reactions}
              disabled={!canInteract}
              onToggle={(emoji, active) => onToggleReaction(comment.id, emoji, active)}
            />
          ) : null}
          {canInteract ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg }}>
              <CommentAction label="Reply" onPress={() => onReply(comment)} />
              {own ? <CommentAction label="Edit" onPress={() => onEdit(comment)} /> : null}
              {own ? <CommentAction label="Delete" onPress={() => onDelete(comment)} /> : null}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function CommentAction({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        justifyContent: 'center',
        opacity: pressed ? 0.7 : 1,
        paddingVertical: theme.spacing.xs,
      })}
    >
      <AppText variant="caption" color="textSecondary">
        {label}
      </AppText>
    </Pressable>
  );
}
