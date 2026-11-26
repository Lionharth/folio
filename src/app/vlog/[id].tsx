import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Alert,
  BackHandler,
  Easing,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
  type ScrollViewInstance,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import Feather from '@expo/vector-icons/Feather';

import { CommentComposer, type ComposerMode } from '../../components/social/CommentComposer';
import { CommentThread } from '../../components/social/CommentThread';
import { ReactionBar } from '../../components/social/ReactionBar';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Divider } from '../../components/ui/Card';
import { IconButton } from '../../components/ui/IconButton';
import { InlineNotice } from '../../components/ui/Notice';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { CinematicPlayer } from '../../components/vlog/CinematicPlayer';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { listComments } from '../../lib/database/comments';
import { getContactName, listContactNames } from '../../lib/database/contacts';
import { listCommentReactions, listReactions } from '../../lib/database/reactions';
import { getCircleMember, getVlog, markVlogRead, setFavourite } from '../../lib/database/vlogs';
import { shortNpub } from '../../lib/nostr/format';
import { readSecretKey } from '../../lib/nostr/identity';
import { invalidateSocial, invalidateVlogs, queryKeys } from '../../lib/queryKeys';
import { syncVlogReadCaches } from '../../lib/vlogCache';
import {
  buildCommentThreads,
  isParticipatingStatus,
  summarizeReactions,
  type ThreadedComment,
} from '../../lib/social/rules';
import { ensureLocalClip, type PlaybackProgress } from '../../services/playback';
import { createComment, deleteComment, editComment, setReaction } from '../../services/social';
import { useInboxSync } from '../../stores/inboxSync';
import { useSession } from '../../stores/session';
import { ThemeScope, useTheme } from '../../theme/ThemeProvider';
import type { Reaction } from '../../types/models';
import { formatBytes, formatDate, formatDuration } from '../../utils/time';

export default function VlogScreen() {
  const { id, comments } = useLocalSearchParams<{ id: string; comments?: string }>();
  const expandComments = comments === '1';
  return (
    <ThemeScope scheme="dark">
      <StatusBar style="light" />
      <VlogContent
        key={`${id}:${expandComments ? 'comments' : 'viewer'}`}
        id={id}
        expandComments={expandComments}
      />
    </ThemeScope>
  );
}

function VlogContent({ id, expandComments }: { id: string; expandComments: boolean }) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const identity = useSession((state) => state.identity);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const { offline } = useNetworkStatus();
  const restoring = useInboxSync((state) => state.restoring && state.identityId === identity?.id);

  const [localUris, setLocalUris] = useState<Record<string, string>>({});
  const [clipIndex, setClipIndex] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [progressByClip, setProgressByClip] = useState<Record<string, PlaybackProgress>>({});
  const [playerAttempt, setPlayerAttempt] = useState(0);
  const [composerMode, setComposerMode] = useState<ComposerMode>('create');
  const [composerTarget, setComposerTarget] = useState<ThreadedComment | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [socialError, setSocialError] = useState<string | null>(null);
  const [savingFavourite, setSavingFavourite] = useState(false);
  const [showClipDetails, setShowClipDetails] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(expandComments);
  const inFlight = useRef<Set<string>>(new Set());
  const mounted = useRef(true);
  const sheetScroll = useRef<ScrollViewInstance>(null);

  const headerHeight = insets.top + 60;
  const availableHeight = Math.max(240, height - headerHeight);
  const collapsedHeight = Math.min(158 + insets.bottom, Math.max(96, availableHeight * 0.35));
  const playerHeight = Math.max(72, availableHeight - collapsedHeight);
  const minimumSheetHeight = Math.max(180, availableHeight * 0.32);
  const expandedPlayerHeight = Math.min(
    Math.max(110, availableHeight * 0.25),
    Math.max(64, availableHeight - minimumSheetHeight)
  );
  const sheetMaxHeight = Math.max(collapsedHeight, availableHeight - expandedPlayerHeight);
  const sheetTravel = Math.max(1, sheetMaxHeight - collapsedHeight);
  const [sheetProgress] = useState(() => new Animated.Value(expandComments ? 1 : 0));
  const [dockProgress] = useState(() => new Animated.Value(expandComments ? 1 : 0));
  const [entrance] = useState(() => new Animated.Value(0));

  const vlogQuery = useQuery({
    queryKey: queryKeys.vlog(identity?.pubkey, id),
    queryFn: () => getVlog(identity!.pubkey, id),
    enabled: Boolean(identity && id),
  });
  const authorNameQuery = useQuery({
    queryKey: queryKeys.contact(vlogQuery.data?.authorPubkey),
    queryFn: () => getContactName(vlogQuery.data!.authorPubkey),
    enabled: Boolean(vlogQuery.data?.authorPubkey),
  });

  const vlog = vlogQuery.data;
  const clips = useMemo(() => vlog?.clips ?? [], [vlog?.clips]);
  const currentClipIndex = clips.length ? Math.min(clipIndex, clips.length - 1) : 0;
  const currentClip = clips[currentClipIndex];

  const contactsQuery = useQuery({ queryKey: queryKeys.contacts, queryFn: listContactNames });
  const memberQuery = useQuery({
    queryKey: queryKeys.member(identity?.pubkey, vlog?.circleId),
    queryFn: () => getCircleMember(vlog!.circleId!, identity!.pubkey),
    enabled: Boolean(identity && vlog?.circleId),
  });
  const commentsQuery = useQuery({
    queryKey: [...queryKeys.comments(identity?.pubkey), vlog?.remoteId, vlog?.circleId],
    queryFn: () => listComments(identity!.pubkey, vlog!.remoteId, vlog!.circleId ?? ''),
    enabled: Boolean(identity && vlog?.remoteId && vlog?.circleId),
  });
  const vlogReactionsQuery = useQuery({
    queryKey: [...queryKeys.reactions(identity?.pubkey), 'vlog', vlog?.remoteId, vlog?.circleId],
    queryFn: () => listReactions(identity!.pubkey, 'vlog', vlog!.remoteId, vlog!.circleId ?? ''),
    enabled: Boolean(identity && vlog?.remoteId && vlog?.circleId),
  });
  const commentReactionsQuery = useQuery({
    queryKey: [...queryKeys.commentReactions(identity?.pubkey), vlog?.remoteId, vlog?.circleId],
    queryFn: () => listCommentReactions(identity!.pubkey, vlog!.remoteId, vlog!.circleId ?? ''),
    enabled: Boolean(identity && vlog?.remoteId && vlog?.circleId),
  });

  const threads = useMemo(() => buildCommentThreads(commentsQuery.data ?? []), [commentsQuery.data]);
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
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!identity || !id) return;
    markVlogRead(id)
      .then(() => syncVlogReadCaches(queryClient, identity.pubkey, id))
      .catch(() => undefined);
  }, [id, identity, queryClient]);

  useEffect(() => {
    if (reducedMotion) entrance.setValue(1);
    else {
      Animated.timing(entrance, {
        toValue: 1,
        duration: theme.motion.enter,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [entrance, reducedMotion, theme.motion.enter]);

  const settleSheet = useCallback(
    (expanded: boolean) => {
      const target = expanded ? 1 : 0;
      sheetProgress.stopAnimation();
      dockProgress.stopAnimation();
      if (reducedMotion) {
        sheetProgress.setValue(target);
        dockProgress.setValue(target);
      } else {
        Animated.parallel([
          Animated.spring(sheetProgress, {
            toValue: target,
            stiffness: 210,
            damping: 25,
            mass: 0.85,
            useNativeDriver: true,
          }),
          Animated.timing(dockProgress, {
            toValue: target,
            duration: theme.motion.sheet,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: false,
          }),
        ]).start();
      }
    },
    [reducedMotion, sheetProgress, dockProgress, theme.motion.sheet]
  );

  useEffect(() => {
    settleSheet(sheetExpanded);
  }, [settleSheet, sheetExpanded]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!sheetExpanded) return false;
      setSheetExpanded(false);
      return true;
    });
    return () => subscription.remove();
  }, [sheetExpanded]);

  useEffect(() => {
    if (!currentClip) return;
    const clip = currentClip;
    if (localUris[clip.id] || errors[clip.id] || inFlight.current.has(clip.id)) return;
    inFlight.current.add(clip.id);
    setProgressByClip((current) => ({ ...current, [clip.id]: { stage: 'downloading', fraction: 0 } }));
    ensureLocalClip(clip, {
      onProgress: (progress) => {
        if (mounted.current) setProgressByClip((current) => ({ ...current, [clip.id]: progress }));
      },
    })
      .then((uri) => {
        if (mounted.current) setLocalUris((current) => ({ ...current, [clip.id]: uri }));
      })
      .catch((error) => {
        if (mounted.current) {
          setErrors((current) => ({
            ...current,
            [clip.id]: error instanceof Error ? error.message : 'The video is not available',
          }));
        }
      })
      .finally(() => {
        inFlight.current.delete(clip.id);
      });
  }, [currentClip, localUris, errors]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          !reducedMotion && Math.abs(gesture.dy) > 7 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderGrant: () => {
          sheetProgress.stopAnimation();
          dockProgress.stopAnimation();
        },
        onPanResponderMove: (_, gesture) => {
          const base = sheetExpanded ? 1 : 0;
          const next = Math.max(0, Math.min(1, base - gesture.dy / sheetTravel));
          // The sheet follows the finger natively; the video lays out once on release.
          sheetProgress.setValue(next);
        },
        onPanResponderRelease: (_, gesture) => {
          const base = sheetExpanded ? 1 : 0;
          const projected = base - gesture.dy / sheetTravel - gesture.vy * 0.08;
          const next = projected > 0.5;
          setSheetExpanded(next);
          settleSheet(next);
        },
        onPanResponderTerminate: () => settleSheet(sheetExpanded),
      }),
    [reducedMotion, sheetExpanded, sheetTravel, sheetProgress, dockProgress, settleSheet]
  );

  if (vlogQuery.isLoading) {
    return <View style={{ flex: 1, backgroundColor: '#000000' }}><LoadingState label="Opening the moment" /></View>;
  }

  if (vlogQuery.isError) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000000', padding: theme.layout.screenMargin, justifyContent: 'center' }}>
        <ErrorState
          title="This moment could not be opened"
          message={vlogQuery.error instanceof Error ? vlogQuery.error.message : undefined}
          onAction={() => vlogQuery.refetch()}
        />
        <Button label="Back" variant="ghost" onPress={() => router.back()} style={{ marginTop: theme.spacing.lg }} />
      </View>
    );
  }

  if (!vlog) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000000', padding: theme.layout.screenMargin, justifyContent: 'center', gap: theme.spacing.lg }}>
        <AppText variant="title">Moment unavailable</AppText>
        {restoring ? <AppText variant="body" color="textSecondary">Restoring…</AppText> : null}
        <Button label="Back" variant="secondary" onPress={() => router.back()} />
      </View>
    );
  }

  const nameFor = (pubkey: string) =>
    pubkey === identity?.pubkey ? (identity?.label ?? 'You') : (contactsQuery.data?.[pubkey] ?? shortNpub(pubkey));
  const canInteract = isParticipatingStatus(memberQuery.data?.status);
  const errorMessage = (error: unknown) => (error instanceof Error ? error.message : 'Unknown error');
  const author =
    vlog.authorPubkey === identity?.pubkey
      ? (identity?.label ?? 'You')
      : (authorNameQuery.data ?? shortNpub(vlog.authorPubkey));
  const currentUri = currentClip ? localUris[currentClip.id] : undefined;
  const playbackError = currentClip ? (errors[currentClip.id] ?? null) : null;
  const playbackProgress = currentClip ? progressByClip[currentClip.id] : undefined;
  const loadingClip = Boolean(currentClip && !currentUri && !playbackError);

  const refreshSocial = () => (identity ? invalidateSocial(queryClient, identity.pubkey) : Promise.resolve());
  const cancelComposer = () => {
    setComposerMode('create');
    setComposerTarget(null);
  };

  const focusComposer = () => {
    setSheetExpanded(true);
    setTimeout(() => sheetScroll.current?.scrollToEnd({ animated: !reducedMotion }), reducedMotion ? 0 : theme.motion.enter);
  };

  const startReply = (comment: ThreadedComment) => {
    if (!canInteract) return;
    setComposerMode('reply');
    setComposerTarget(comment);
    focusComposer();
  };

  const startEdit = (comment: ThreadedComment) => {
    if (!canInteract) return;
    setComposerMode('edit');
    setComposerTarget(comment);
    focusComposer();
  };

  const submitComment = async (body: string): Promise<boolean> => {
    if (!identity || submitting || body.trim().length === 0) return false;
    setSubmitting(true);
    setSocialError(null);
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
      setSocialError(`Comment was not saved · ${errorMessage(error)}`);
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const removeComment = (comment: ThreadedComment) => {
    Alert.alert('Delete comment?', 'A deleted marker remains so replies keep their place.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          if (!identity) return;
          void (async () => {
            try {
              const secretKey = await readSecretKey(identity.id);
              await deleteComment({ secretKey, comment });
              if (composerTarget?.id === comment.id) cancelComposer();
              await refreshSocial();
            } catch (error) {
              setSocialError(`Could not delete comment · ${errorMessage(error)}`);
            }
          })();
        },
      },
    ]);
  };

  const saveReaction = async (
    targetType: 'vlog' | 'comment',
    targetId: string,
    emoji: string,
    active: boolean
  ) => {
    if (!identity || !canInteract) return;
    setSocialError(null);
    try {
      const secretKey = await readSecretKey(identity.id);
      await setReaction({ secretKey, vlog, targetType, targetId, emoji, active, authorName: identity.label });
      await refreshSocial();
    } catch (error) {
      setSocialError(`Could not update reaction · ${errorMessage(error)}`);
    }
  };

  const retryClip = () => {
    if (!currentClip) return;
    setErrors((current) => {
      const next = { ...current };
      delete next[currentClip.id];
      return next;
    });
    setProgressByClip((current) => {
      const next = { ...current };
      delete next[currentClip.id];
      return next;
    });
    setPlayerAttempt((value) => value + 1);
  };

  const closeViewer = () => {
    if (sheetExpanded) setSheetExpanded(false);
    else router.back();
  };

  const playerAnimatedHeight = dockProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [playerHeight, expandedPlayerHeight],
  });

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#000000' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View
        style={{
          height: headerHeight,
          paddingTop: insets.top,
          paddingHorizontal: theme.spacing.md,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#000000',
          zIndex: 3,
        }}
      >
        <IconButton icon="arrow-left" label={sheetExpanded ? 'Collapse details' : 'Close viewer'} onPress={closeViewer} />
        <IconButton
          icon="bookmark"
          label={vlog.isFavourite ? 'Remove from favourites' : 'Add to favourites'}
          selected={vlog.isFavourite}
          loading={savingFavourite}
          onPress={() => {
            void (async () => {
              if (!identity) return;
              setSavingFavourite(true);
              try {
                await setFavourite(vlog.id, !vlog.isFavourite);
                await invalidateVlogs(queryClient, identity.pubkey);
              } catch (error) {
                setSocialError(errorMessage(error));
              } finally {
                setSavingFavourite(false);
              }
            })();
          }}
        />
      </View>

      <Animated.View
        style={{
          position: 'absolute',
          top: headerHeight,
          left: 0,
          right: 0,
          height: playerHeight,
          opacity: entrance,
          transform: [{ scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.985, 1] }) }],
        }}
      >
        <Animated.View
          pointerEvents={sheetExpanded ? 'none' : 'auto'}
          style={{
            height: playerAnimatedHeight,
            overflow: 'hidden',
            backgroundColor: '#000000',
          }}
        >
          {playbackError ? (
            <View style={{ flex: 1, justifyContent: 'center', padding: theme.spacing.xl }}>
              <ErrorState title="Could not open this clip" message={playbackError} onAction={retryClip} />
            </View>
          ) : currentUri ? (
            <CinematicPlayer
              key={`${currentUri}:${playerAttempt}`}
              uri={currentUri}
              onRetry={() => setPlayerAttempt((value) => value + 1)}
              onEnded={() => {
                if (currentClipIndex + 1 < clips.length) setClipIndex((index) => index + 1);
              }}
            />
          ) : !currentClip ? (
            <View style={{ flex: 1, justifyContent: 'center', padding: theme.spacing.xl }}>
              <ErrorState
                title="This entry has no playable clips"
                message="The diary entry and its conversation are still available below. No media will be downloaded."
              />
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              {vlog.coverUri ? <Image source={{ uri: vlog.coverUri }} style={{ position: 'absolute', inset: 0 }} contentFit="cover" /> : null}
              <View style={{ flex: 1, backgroundColor: vlog.coverUri ? 'rgba(0,0,0,0.55)' : '#000000', alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xl }}>
                <View accessibilityLiveRegion="polite" style={{ width: '100%', maxWidth: 340, gap: theme.spacing.md }}>
                  <AppText variant="headline" align="center">{loadingClip ? 'Preparing' : 'Media unavailable'}</AppText>
                  <AppText variant="caption" color="textSecondary" align="center">
                    {playbackProgress?.stage === 'verifying'
                      ? 'Verifying'
                      : playbackProgress?.stage === 'decrypting'
                        ? 'Decrypting'
                        : 'Downloading'}
                  </AppText>
                  <ProgressBar fraction={playbackProgress?.fraction} label="Preparing video" />
                </View>
              </View>
            </View>
          )}

          {clips.length > 1 ? (
            <Animated.View
              style={{
                position: 'absolute',
                left: theme.spacing.md,
                right: theme.spacing.md,
                bottom: theme.spacing.sm,
                opacity: sheetProgress.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 0.4, 0] }),
              }}
            >
              <View style={{ backgroundColor: 'rgba(0,0,0,0.76)', borderRadius: theme.radius.md, padding: theme.spacing.sm }}>
                <AppText variant="meta" style={{ color: '#F5F4F0', marginBottom: theme.spacing.xs }}>{currentClipIndex + 1} / {clips.length}</AppText>
                <View style={{ flexDirection: 'row', gap: theme.spacing.xs }}>
                  {clips.map((clip, index) => (
                    <Pressable
                      key={clip.id}
                      onPress={() => setClipIndex(index)}
                      accessibilityRole="button"
                      accessibilityLabel={`Play clip ${index + 1} of ${clips.length}, ${formatDuration(clip.durationMs)}`}
                      accessibilityState={{ selected: index === currentClipIndex }}
                      style={{ flex: 1, minHeight: 48, justifyContent: 'center' }}
                    >
                      <View style={{ height: 3, borderRadius: 2, backgroundColor: index === currentClipIndex ? '#F5F4F0' : '#5D5B57' }} />
                    </Pressable>
                  ))}
                </View>
              </View>
            </Animated.View>
          ) : null}
        </Animated.View>
      </Animated.View>

      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: sheetMaxHeight,
          backgroundColor: '#151515',
          borderTopLeftRadius: theme.radius.xl,
          borderTopRightRadius: theme.radius.xl,
          borderTopWidth: 1,
          borderColor: '#343431',
          overflow: 'hidden',
          transform: [{ translateY: sheetProgress.interpolate({ inputRange: [0, 1], outputRange: [sheetTravel, 0] }) }],
          zIndex: 2,
        }}
      >
        <View {...panResponder.panHandlers}>
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: '#66635E', alignSelf: 'center', marginTop: theme.spacing.sm }} />
          <Pressable
            onPress={() => setSheetExpanded((value) => !value)}
            accessibilityRole="button"
            accessibilityLabel={sheetExpanded ? 'Collapse details and conversation' : 'Expand details and conversation'}
            accessibilityState={{ expanded: sheetExpanded }}
            accessibilityActions={[{ name: 'expand', label: 'Expand details' }, { name: 'collapse', label: 'Collapse details' }]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'expand') setSheetExpanded(true);
              if (event.nativeEvent.actionName === 'collapse') setSheetExpanded(false);
            }}
            style={{ minHeight: 76, paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}
          >
            <View style={{ flex: 1, gap: theme.spacing.xs }}>
              <AppText variant="vlogTitle" numberOfLines={sheetExpanded ? undefined : 2}>{vlog.title?.trim() || 'Untitled moment'}</AppText>
              <AppText variant="caption" color="textSecondary">
                {author}{vlog.circleName ? ` · ${vlog.circleName}` : ''} · {formatDate(vlog.createdAt * 1000)}
              </AppText>
            </View>
            <Feather name={sheetExpanded ? 'chevron-down' : 'chevron-up'} size={22} color={theme.colors.textSecondary} />
          </Pressable>
        </View>

        <Animated.View
          style={{
            flex: 1,
            opacity: sheetProgress.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 0, 1] }),
          }}
        >
        <ScrollView
          ref={sheetScroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          pointerEvents={sheetExpanded ? 'auto' : 'none'}
          importantForAccessibility={sheetExpanded ? 'auto' : 'no-hide-descendants'}
          contentContainerStyle={{ paddingHorizontal: theme.spacing.xl, paddingBottom: insets.bottom + theme.spacing.giant, gap: theme.spacing.lg }}
        >
          {vlog.description ? <AppText variant="body" color="textSecondary">{vlog.description}</AppText> : null}
          {offline ? <InlineNotice message="Offline · comments send later" tone="warning" /> : null}
          {socialError ? <InlineNotice message={socialError} tone="error" /> : null}

          {memberQuery.isError ? (
            <ErrorState title="Membership could not be checked" onAction={() => memberQuery.refetch()} />
          ) : vlogReactionSummary.length > 0 || canInteract ? (
            <ReactionBar
              reactions={vlogReactionSummary}
              disabled={!canInteract}
              onToggle={(emoji, active) => void saveReaction('vlog', vlog.remoteId, emoji, active)}
            />
          ) : null}
          {vlogReactionsQuery.isError ? <InlineNotice message="Couldn’t load reactions" tone="error" action={<Button label="Retry" variant="ghost" onPress={() => vlogReactionsQuery.refetch()} />} /> : null}

          <Divider />

          {commentsQuery.isLoading ? (
            <LoadingState label="Opening comments" />
          ) : commentsQuery.isError ? (
            <ErrorState title="Couldn’t open comments" onAction={() => commentsQuery.refetch()} />
          ) : threads.length === 0 ? null : (
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
              onToggleReaction={(commentId, emoji, active) => void saveReaction('comment', commentId, emoji, active)}
            />
          )}
          {commentReactionsQuery.isError ? <InlineNotice message="Couldn’t load comment reactions" tone="error" action={<Button label="Retry" variant="ghost" onPress={() => commentReactionsQuery.refetch()} />} /> : null}

          {memberQuery.isLoading ? (
            <LoadingState label="Checking membership" />
          ) : memberQuery.isError ? null : canInteract ? (
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
            <AppText variant="caption" color="textSecondary">Comments closed for you.</AppText>
          )}

          {currentClip ? (
            <View>
              <Button label={showClipDetails ? 'Hide technical details' : 'Technical details'} variant="ghost" accessibilityState={{ expanded: showClipDetails }} onPress={() => setShowClipDetails((value) => !value)} />
              {showClipDetails ? (
                <View style={{ gap: theme.spacing.sm, paddingVertical: theme.spacing.md }}>
                  <AppText variant="caption" color="textSecondary">
                    {formatDuration(currentClip.durationMs)} · {formatBytes(currentClip.plaintextSize ?? currentClip.encryptedSize)}
                    {currentClip.width && currentClip.height ? ` · ${currentClip.width}×${currentClip.height}` : ''}
                  </AppText>
                  <AppText variant="mono" color="textTertiary" selectable>{currentClip.encryptedSha256}</AppText>
                  <AppText variant="caption" color="textSecondary">Encrypted and verified on this device before playback.</AppText>
                </View>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
        </Animated.View>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}
