import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEvent, useEventListener } from 'expo';
import { Image } from 'expo-image';
import Feather from '@expo/vector-icons/Feather';

import { CommentComposer, type ComposerMode } from '../../components/social/CommentComposer';
import { CommentThread } from '../../components/social/CommentThread';
import { ReactionBar } from '../../components/social/ReactionBar';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Divider } from '../../components/ui/Card';
import { ScreenScroll } from '../../components/ui/Screen';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { listComments } from '../../lib/database/comments';
import { getContactName, listContactNames } from '../../lib/database/contacts';
import { listCommentReactions, listReactions } from '../../lib/database/reactions';
import { getCircleMember, getVlog, markVlogRead, setFavourite } from '../../lib/database/vlogs';
import { shortNpub } from '../../lib/nostr/format';
import { readSecretKey } from '../../lib/nostr/identity';
import {
  buildCommentThreads,
  isParticipatingStatus,
  summarizeReactions,
  type ThreadedComment,
} from '../../lib/social/rules';
import { ensureLocalClip } from '../../services/playback';
import { createComment, deleteComment, editComment, setReaction } from '../../services/social';
import { useTheme } from '../../theme/ThemeProvider';
import { useSession } from '../../stores/session';
import type { Reaction } from '../../types/models';
import { formatBytes, formatDate, formatDuration } from '../../utils/time';

function Player({ uri, onEnded }: { uri: string; onEnded?: () => void }) {
  const theme = useTheme();
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
    instance.play();
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { status } = useEvent(player, 'statusChange', { status: player.status });

  useEventListener(player, 'playToEnd', () => onEnded?.());

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <VideoView
        player={player}
        style={{ width: '100%', aspectRatio: 9 / 13, backgroundColor: '#000', borderRadius: theme.radius.lg, overflow: 'hidden' }}
        contentFit="contain"
        nativeControls
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <AppText variant="caption" color="textSecondary">
          {status === 'error' ? 'This video could not be played on this device' : isPlaying ? 'Playing' : 'Paused'}
        </AppText>
        <Button
          label={isPlaying ? 'Pause' : 'Play'}
          variant="ghost"
          onPress={() => (isPlaying ? player.pause() : player.play())}
        />
      </View>
    </View>
  );
}

export default function VlogScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const identity = useSession((state) => state.identity);
  const { id } = useLocalSearchParams<{ id: string }>();
  const [localUris, setLocalUris] = useState<Record<string, string>>({});
  const [clipIndex, setClipIndex] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [composerMode, setComposerMode] = useState<ComposerMode>('create');
  const [composerTarget, setComposerTarget] = useState<ThreadedComment | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef<Set<string>>(new Set());

  const vlogQuery = useQuery({
    queryKey: ['vlog', identity?.pubkey, id],
    queryFn: () => getVlog(identity!.pubkey, id),
    enabled: Boolean(identity),
  });
  const authorNameQuery = useQuery({
    queryKey: ['contact-name', vlogQuery.data?.authorPubkey],
    queryFn: () => getContactName(vlogQuery.data!.authorPubkey),
    enabled: Boolean(vlogQuery.data?.authorPubkey),
  });

  const vlog = vlogQuery.data;
  const clips = vlog?.clips ?? [];
  const currentClip = clips[clipIndex];

  const contactsQuery = useQuery({ queryKey: ['contact-names'], queryFn: listContactNames });
  const memberQuery = useQuery({
    queryKey: ['circle-member', identity?.pubkey, vlog?.circleId],
    queryFn: () => getCircleMember(vlog!.circleId!, identity!.pubkey),
    enabled: Boolean(identity && vlog?.circleId),
  });
  const commentsQuery = useQuery({
    queryKey: ['comments', identity?.pubkey, vlog?.remoteId, vlog?.circleId],
    queryFn: () => listComments(identity!.pubkey, vlog!.remoteId, vlog!.circleId ?? ''),
    enabled: Boolean(identity && vlog?.remoteId && vlog?.circleId),
  });
  const vlogReactionsQuery = useQuery({
    queryKey: ['reactions', identity?.pubkey, 'vlog', vlog?.remoteId, vlog?.circleId],
    queryFn: () => listReactions(identity!.pubkey, 'vlog', vlog!.remoteId, vlog!.circleId ?? ''),
    enabled: Boolean(identity && vlog?.remoteId && vlog?.circleId),
  });
  const commentReactionsQuery = useQuery({
    queryKey: ['comment-reactions', identity?.pubkey, vlog?.remoteId, vlog?.circleId],
    queryFn: () => listCommentReactions(identity!.pubkey, vlog!.remoteId, vlog!.circleId ?? ''),
    enabled: Boolean(identity && vlog?.remoteId && vlog?.circleId),
  });

  const threads = useMemo(() => buildCommentThreads(commentsQuery.data ?? []), [commentsQuery.data]);
  const commentCount = useMemo(
    () => threads.reduce((total, thread) => total + 1 + thread.replies.length, 0),
    [threads]
  );
  const vlogReactionSummary = useMemo(
    () => summarizeReactions(vlogReactionsQuery.data ?? [], identity?.pubkey),
    [vlogReactionsQuery.data, identity?.pubkey]
  );
  const commentReactionsByComment = useMemo(() => {
    const grouped: Record<string, Reaction[]> = {};
    for (const reaction of commentReactionsQuery.data ?? []) {
      grouped[reaction.targetId] = [...(grouped[reaction.targetId] ?? []), reaction];
    }
    const summary: Record<string, ReturnType<typeof summarizeReactions>> = {};
    for (const [commentId, reactions] of Object.entries(grouped)) {
      summary[commentId] = summarizeReactions(reactions, identity?.pubkey);
    }
    return summary;
  }, [commentReactionsQuery.data, identity?.pubkey]);

  useEffect(() => {
    if (id) markVlogRead(id).catch(() => undefined);
  }, [id]);

  useEffect(() => {
    if (!currentClip) return;
    const clip = currentClip;
    if (localUris[clip.id] || errors[clip.id] || inFlight.current.has(clip.id)) return;
    let cancelled = false;
    inFlight.current.add(clip.id);
    ensureLocalClip(clip)
      .then((uri) => {
        if (!cancelled) setLocalUris((current) => ({ ...current, [clip.id]: uri }));
      })
      .catch((error) => {
        if (!cancelled) {
          setErrors((current) => ({
            ...current,
            [clip.id]: error instanceof Error ? error.message : 'The video is not available',
          }));
        }
      })
      .finally(() => {
        inFlight.current.delete(clip.id);
      });
    return () => {
      cancelled = true;
    };
  }, [currentClip, localUris, errors]);

  if (vlogQuery.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <LoadingState label="Opening the moment" />
      </View>
    );
  }

  if (!vlog) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: theme.layout.screenMargin, justifyContent: 'center', gap: theme.spacing.lg }}>
        <AppText variant="title">This vlog is not on this device</AppText>
        <Button label="Back" variant="secondary" onPress={() => router.back()} />
      </View>
    );
  }

  const nameFor = (pubkey: string) =>
    pubkey === identity?.pubkey ? (identity?.label ?? 'You') : (contactsQuery.data?.[pubkey] ?? shortNpub(pubkey));
  const canInteract = isParticipatingStatus(memberQuery.data?.status);
  const errorMessage = (error: unknown) => (error instanceof Error ? error.message : 'Unknown error');

  const refreshSocial = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['comments'] }),
      queryClient.invalidateQueries({ queryKey: ['reactions'] }),
      queryClient.invalidateQueries({ queryKey: ['comment-reactions'] }),
    ]);

  const cancelComposer = () => {
    setComposerMode('create');
    setComposerTarget(null);
  };

  const submitComment = async (body: string): Promise<boolean> => {
    if (!identity || submitting || body.trim().length === 0) return false;
    setSubmitting(true);
    try {
      const secretKey = await readSecretKey(identity.id);
      if (composerMode === 'edit' && composerTarget) {
        await editComment({ secretKey, comment: composerTarget, body });
      } else {
        await createComment({
          secretKey,
          vlog,
          body,
          replyToId: composerMode === 'reply' ? composerTarget?.id : undefined,
          authorName: identity.label,
        });
      }
      cancelComposer();
      await refreshSocial();
      return true;
    } catch (error) {
      Alert.alert('Could not save comment', errorMessage(error));
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const startReply = (comment: ThreadedComment) => {
    if (!canInteract) return;
    setComposerMode('reply');
    setComposerTarget(comment);
  };

  const startEdit = (comment: ThreadedComment) => {
    if (!canInteract) return;
    setComposerMode('edit');
    setComposerTarget(comment);
  };

  const removeComment = (comment: ThreadedComment) => {
    const remove = async () => {
      if (!identity) return;
      try {
        const secretKey = await readSecretKey(identity.id);
        await deleteComment({ secretKey, comment });
        if (composerTarget?.id === comment.id) cancelComposer();
        await refreshSocial();
      } catch (error) {
        Alert.alert('Could not delete comment', errorMessage(error));
      }
    };
    Alert.alert(
      'Delete comment?',
      'It will be replaced by a deleted marker for everyone in the circle.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void remove() },
      ]
    );
  };

  const saveReaction = async (
    targetType: 'vlog' | 'comment',
    targetId: string,
    emoji: string,
    active: boolean
  ) => {
    if (!identity || !canInteract) return;
    try {
      const secretKey = await readSecretKey(identity.id);
      await setReaction({
        secretKey,
        vlog,
        targetType,
        targetId,
        emoji,
        active,
        authorName: identity.label,
      });
      await refreshSocial();
    } catch (error) {
      Alert.alert('Could not update reaction', errorMessage(error));
    }
  };

  const author =
    vlog.authorPubkey === identity?.pubkey
      ? (identity?.label ?? 'You')
      : (authorNameQuery.data ?? shortNpub(vlog.authorPubkey));
  const currentUri = currentClip ? localUris[currentClip.id] : undefined;
  const playbackError = currentClip ? (errors[currentClip.id] ?? null) : null;
  const loadingClip = Boolean(currentClip && !currentUri && !playbackError);

  return (
    <ScreenScroll>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: theme.spacing.md }}>
        <Button label="Back" variant="ghost" onPress={() => router.back()} />
        <Button
          label={vlog.isFavourite ? 'Favourite' : 'Add to favourites'}
          variant="ghost"
          icon={<Feather name="bookmark" size={16} color={vlog.isFavourite ? theme.colors.textPrimary : theme.colors.textSecondary} />}
          onPress={async () => {
            await setFavourite(vlog.id, !vlog.isFavourite);
            await vlogQuery.refetch();
          }}
        />
      </View>

      <View style={{ gap: theme.spacing.xs, marginTop: theme.spacing.sm }}>
        <AppText variant="title">{vlog.title?.trim() || 'Untitled moment'}</AppText>
        <AppText variant="caption" color="textSecondary">
          {author}
          {vlog.circleName ? `  ·  ${vlog.circleName}` : ''}  ·  {formatDate(vlog.createdAt * 1000)}
        </AppText>
      </View>

      <View style={{ marginTop: theme.spacing.lg }}>
        {playbackError ? (
          <ErrorState
            title="Could not open this clip"
            message={playbackError}
            actionLabel="Try again"
            onAction={() =>
              setErrors((current) => {
                const next = { ...current };
                if (currentClip) delete next[currentClip.id];
                return next;
              })
            }
          />
        ) : loadingClip || !currentUri ? (
          <View
            style={{
              aspectRatio: 9 / 13,
              borderRadius: theme.radius.lg,
              backgroundColor: theme.colors.surfaceSubtle,
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            {vlog.coverUri ? (
              <Image
                source={{ uri: vlog.coverUri }}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                contentFit="cover"
              />
            ) : null}
            <View
              style={{
                alignItems: 'center',
                gap: theme.spacing.sm,
                paddingHorizontal: theme.spacing.lg,
                paddingVertical: theme.spacing.md,
                borderRadius: theme.radius.md,
                backgroundColor: vlog.coverUri ? 'rgba(0,0,0,0.55)' : 'transparent',
              }}
            >
              {vlog.coverUri ? <ActivityIndicator color="#fff" /> : null}
              <AppText variant="caption" color={vlog.coverUri ? undefined : 'textSecondary'} style={vlog.coverUri ? { color: '#fff' } : undefined}>
                Downloading and decrypting
              </AppText>
            </View>
          </View>
        ) : (
          <Player
            key={currentUri}
            uri={currentUri}
            onEnded={() => {
              if (clipIndex + 1 < clips.length) setClipIndex(clipIndex + 1);
            }}
          />
        )}
      </View>

      {clips.length > 1 ? (
        <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.sm }}>
          <AppText variant="label" color="textSecondary">
            CLIPS · {clipIndex + 1} OF {clips.length}
          </AppText>
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
            {clips.map((clip, index) => (
              <Button
                key={clip.id}
                label={`${index + 1} · ${formatDuration(clip.durationMs)}`}
                variant={index === clipIndex ? 'primary' : 'secondary'}
                onPress={() => setClipIndex(index)}
              />
            ))}
          </View>
        </View>
      ) : null}

      {vlogReactionSummary.length > 0 || canInteract ? (
        <View style={{ marginTop: theme.spacing.lg }}>
          <ReactionBar
            reactions={vlogReactionSummary}
            disabled={!canInteract}
            onToggle={(emoji, active) => void saveReaction('vlog', vlog.remoteId, emoji, active)}
          />
        </View>
      ) : null}

      {vlog.description ? (
        <>
          <View style={{ marginTop: theme.spacing.xl }}>
            <Divider />
          </View>
          <AppText variant="body" color="textSecondary" style={{ marginTop: theme.spacing.lg }}>
            {vlog.description}
          </AppText>
        </>
      ) : null}

      {currentClip ? (
        <View style={{ marginTop: theme.spacing.xxl, gap: theme.spacing.xs }}>
          <AppText variant="label" color="textSecondary">
            ABOUT THIS CLIP
          </AppText>
          <AppText variant="caption" color="textTertiary">
            {formatDuration(currentClip.durationMs)} · {formatBytes(currentClip.plaintextSize ?? currentClip.encryptedSize)}
            {currentClip.width && currentClip.height ? ` · ${currentClip.width}×${currentClip.height}` : ''}
          </AppText>
          <AppText variant="mono" color="textTertiary" numberOfLines={1}>
            {currentClip.encryptedSha256}
          </AppText>
          <AppText variant="caption" color="textTertiary">
            Encrypted and verified on this device before playback. Only members of this circle can see it.
          </AppText>
        </View>
      ) : null}

      <View style={{ marginTop: theme.spacing.xxl, gap: theme.spacing.lg }}>
        <Divider />
        <View style={{ gap: theme.spacing.xs }}>
          <AppText variant="label" color="textSecondary">
            COMMENTS
          </AppText>
          {commentCount > 0 ? (
            <AppText variant="caption" color="textTertiary">
              {commentCount} {commentCount === 1 ? 'comment' : 'comments'}
            </AppText>
          ) : null}
        </View>
        {threads.length === 0 ? (
          <AppText variant="body" color="textSecondary">
            No comments yet.
          </AppText>
        ) : (
          <CommentThread
            threads={threads}
            names={contactsQuery.data ?? {}}
            selfPubkey={identity?.pubkey}
            selfLabel={identity?.label ?? undefined}
            canInteract={canInteract}
            reactionsByComment={commentReactionsByComment}
            onReply={startReply}
            onEdit={startEdit}
            onDelete={removeComment}
            onToggleReaction={(commentId, emoji, active) =>
              void saveReaction('comment', commentId, emoji, active)
            }
          />
        )}
        {memberQuery.isLoading ? null : canInteract ? (
          <CommentComposer
            key={`${composerMode}:${composerTarget?.id ?? 'new'}`}
            initialValue={composerMode === 'edit' ? (composerTarget?.body ?? '') : ''}
            mode={composerMode}
            contextLabel={
              composerMode === 'reply' && composerTarget
                ? `Replying to ${nameFor(composerTarget.authorPubkey)}`
                : composerMode === 'edit'
                  ? 'Editing your comment'
                  : null
            }
            submitting={submitting}
            onSubmit={submitComment}
            onCancel={composerMode === 'create' ? undefined : cancelComposer}
          />
        ) : (
          <AppText variant="caption" color="textTertiary">
            You can no longer comment in this circle.
          </AppText>
        )}
      </View>
    </ScreenScroll>
  );
}
