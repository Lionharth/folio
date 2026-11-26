import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { Redirect, router, useFocusEffect, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { Image } from 'expo-image';
import Feather from '@expo/vector-icons/Feather';

import { AppText } from '../components/ui/AppText';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { FilterChip } from '../components/ui/FilterChip';
import { IconButton } from '../components/ui/IconButton';
import { InlineNotice } from '../components/ui/Notice';
import { ProgressBar } from '../components/ui/ProgressBar';
import { ScreenScroll } from '../components/ui/Screen';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States';
import { TextField } from '../components/ui/TextField';
import { DEFAULT_PROVIDER_URL, PROVIDER_PRESETS } from '../constants/providers';
import { getSetting, setSetting } from '../lib/database/settings';
import { listCirclesForViewer } from '../lib/database/vlogs';
import { readSecretKey } from '../lib/nostr/identity';
import { invalidateVlogs, queryKeys } from '../lib/queryKeys';
import { generateVideoThumbnail } from '../services/media';
import { publishVlog, type PublishProgress } from '../services/publish';
import { useCaptureStore } from '../stores/capture';
import { useSession } from '../stores/session';
import { useTheme } from '../theme/ThemeProvider';
import { formatBytes, formatDuration } from '../utils/time';

interface SelectedVideo {
  uri: string;
  durationMs: number;
  width?: number;
  height?: number;
  mimeType: string;
  sizeBytes?: number;
  thumbnailUri?: string | null;
}

const STAGE_LABELS: Record<PublishProgress['stage'], string> = {
  preparing: 'Preparing your moment',
  compressing: 'Preparing a 1080p copy under 25 MB',
  encrypting: 'Encrypting on this device',
  'checking-provider': 'Checking encrypted storage',
  uploading: 'Uploading the encrypted video',
  verifying: 'Verifying the upload',
  mirroring: 'Storing a backup copy',
  thumbnail: 'Protecting the cover',
  distributing: 'Sharing the key privately with your circle',
  saving: 'Saving the entry to Archive',
};

export default function CreateScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const identity = useSession((state) => state.identity);
  const sessionLoading = useSession((state) => state.loading);
  const params = useLocalSearchParams<{ circleId?: string }>();
  const captured = useCaptureStore((state) => state.captured);
  const setCaptured = useCaptureStore((state) => state.setCaptured);

  const [video, setVideo] = useState<SelectedVideo | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [chosenCircleId, setCircleId] = useState<string | null>(null);
  const [providerUrl, setProviderUrl] = useState(DEFAULT_PROVIDER_URL);
  const [mirrorCopies, setMirrorCopies] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [progress, setProgress] = useState<PublishProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permissionBlocked, setPermissionBlocked] = useState(false);
  const [showDelivery, setShowDelivery] = useState(false);
  const [allowLeave, setAllowLeave] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSetting('media.mirrorCopies')
      .then((value) => {
        if (!cancelled) setMirrorCopies(value !== '0');
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleMirrorCopies = useCallback(() => {
    setMirrorCopies((current) => {
      const next = !current;
      setSetting('media.mirrorCopies', next ? '1' : '0').catch(() => undefined);
      return next;
    });
  }, []);

  const circlesQuery = useQuery({
    queryKey: queryKeys.circles(identity?.pubkey),
    queryFn: () => listCirclesForViewer(identity!.pubkey),
    enabled: Boolean(identity),
  });
  const circles = useMemo(() => circlesQuery.data ?? [], [circlesQuery.data]);
  const circleId = chosenCircleId ?? (params.circleId && circles.some((circle) => circle.id === params.circleId) ? params.circleId : null);

  const disableRemovalPrevention = usePreventRemove(!allowLeave && (publishing || Boolean(video || title.trim() || description.trim())), ({ repeat }) => {
    if (publishing) {
      Alert.alert('Your moment is publishing', 'Keep Folio open until encryption, upload, and private key sharing finish.');
      return;
    }
    Alert.alert('Discard this moment?', 'This entry has not been saved as a durable draft. Your original clip stays on your phone.', [
      { text: 'Keep editing', style: 'cancel' },
      {
        text: 'Discard entry',
        style: 'destructive',
        onPress: () => {
          setAllowLeave(true);
          repeat();
        },
      },
    ]);
  });

  const attachThumbnail = useCallback((selected: SelectedVideo) => {
    generateVideoThumbnail(selected.uri)
      .then((thumbnail) => {
        if (!thumbnail) return;
        setVideo((current) =>
          current && current.uri === selected.uri ? { ...current, thumbnailUri: thumbnail.uri } : current
        );
      })
      .catch(() => undefined);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!captured) return;
      const selected: SelectedVideo = {
        uri: captured.uri,
        durationMs: captured.durationMs,
        width: captured.width,
        height: captured.height,
        mimeType: captured.mimeType,
      };
      setVideo(selected);
      setError(null);
      attachThumbnail(selected);
      setCaptured(null);
    }, [attachThumbnail, captured, setCaptured])
  );

  const pickVideo = async () => {
    if (publishing) return;
    setError(null);
    setPermissionBlocked(false);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setPermissionBlocked(!permission.canAskAgain);
        setError(
          permission.canAskAgain
            ? 'Allow library access to choose a video, or record a new moment instead.'
            : 'Library access is disabled. Allow it in system Settings, or record a new moment instead.'
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsMultipleSelection: false,
        quality: 1,
        videoQuality: 1,
      });
      if (result.canceled || result.assets.length === 0) return;
      const asset = result.assets[0];
      const selected: SelectedVideo = {
        uri: asset.uri,
        durationMs: asset.duration ?? 0,
        width: asset.width ?? undefined,
        height: asset.height ?? undefined,
        mimeType: asset.mimeType ?? 'video/mp4',
        sizeBytes: asset.fileSize ?? undefined,
      };
      setVideo(selected);
      attachThumbnail(selected);
    } catch (pickerError) {
      setError(pickerError instanceof Error ? pickerError.message : 'The video picker could not be opened. Try again.');
    }
  };

  const publish = async () => {
    if (!identity || !video || !circleId || publishing) return;
    const circle = circles.find((candidate) => candidate.id === circleId);
    if (!circle) {
      setError('Choose a circle before publishing.');
      return;
    }
    setPublishing(true);
    setError(null);
    setProgress({ stage: 'preparing' });
    try {
      const secretKey = await readSecretKey(identity.id);
      const result = await publishVlog({
        identityId: identity.id,
        secretKey,
        circle,
        sourceUri: video.uri,
        mimeType: video.mimeType,
        durationMs: video.durationMs,
        width: video.width,
        height: video.height,
        authorName: identity.label,
        title,
        description,
        providerUrl,
        mirrorCopies: mirrorCopies ? 1 : 0,
        onProgress: setProgress,
      });
      await Promise.all([
        invalidateVlogs(queryClient, identity.pubkey),
        queryClient.invalidateQueries({ queryKey: queryKeys.circlesWithMembers(identity.pubkey) }),
      ]);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      setAllowLeave(true);
      setVideo(null);
      setTitle('');
      setDescription('');
      setProgress(null);
      disableRemovalPrevention();
      router.replace({ pathname: '/vlog/[id]', params: { id: result.vlogId } });
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'Publishing failed. Your entry is still here; try again.');
      setProgress(null);
    } finally {
      setPublishing(false);
    }
  };

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/updates');
  };

  if (sessionLoading) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.background }}><LoadingState label="Opening Create" /></View>;
  }

  if (!identity) return <Redirect href="/onboarding/welcome" />;

  if (circlesQuery.isLoading) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.background }}><LoadingState label="Preparing your circles" /></View>;
  }

  if (circlesQuery.isError) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: theme.layout.screenMargin, justifyContent: 'center' }}>
        <ErrorState
          title="Create could not open your circles"
          message={circlesQuery.error instanceof Error ? circlesQuery.error.message : undefined}
          onAction={() => circlesQuery.refetch()}
        />
        <Button label="Close" variant="ghost" onPress={close} style={{ marginTop: theme.spacing.lg }} />
      </View>
    );
  }

  if (circles.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: theme.layout.screenMargin }}>
        <View style={{ paddingVertical: theme.spacing.sm }}><IconButton icon="x" label="Close create" onPress={close} /></View>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState
            eyebrow="ONE PRIVATE CIRCLE FIRST"
            title="Choose who this moment is for"
            description="Create a circle for close friends, family, or another trusted group. Then come back and share your first clip."
            actionLabel="Create a circle"
            onAction={() => router.push('/circle/new')}
          />
        </View>
      </View>
    );
  }

  const aspectRatio = video?.width && video.height ? Math.max(0.72, Math.min(16 / 9, video.width / video.height)) : 16 / 10;

  return (
    <ScreenScroll>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: theme.spacing.sm }}>
        <IconButton icon="x" label="Close create" onPress={close} disabled={publishing} />
      </View>

      <View style={{ paddingTop: theme.spacing.lg }}>
        <AppText variant="display">Create</AppText>
      </View>

      <View style={{ marginTop: theme.spacing.xxl }}>
        <Card padded={false}>
          {video ? (
            <View>
              <View style={{ aspectRatio, backgroundColor: '#0B0B0B', overflow: 'hidden' }}>
                {video.thumbnailUri ? (
                  <Image source={{ uri: video.thumbnailUri }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={180} />
                ) : (
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm }}>
                    <Feather name="film" size={32} color="#B8B3AA" />
                    <AppText variant="caption" style={{ color: '#B8B3AA' }}>Preparing cover</AppText>
                  </View>
                )}
                <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: theme.spacing.md, backgroundColor: 'rgba(0,0,0,0.68)' }}>
                  <AppText variant="meta" style={{ color: '#FFFFFF' }}>
                    {formatDuration(video.durationMs)}{video.sizeBytes ? ` · ${formatBytes(video.sizeBytes)}` : ''}
                  </AppText>
                </View>
              </View>
              <View style={{ padding: theme.spacing.lg, flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                <Button label="Replace clip" variant="secondary" disabled={publishing} onPress={() => void pickVideo()} />
                <Button label="Remove" variant="ghost" disabled={publishing} onPress={() => setVideo(null)} />
              </View>
            </View>
          ) : (
            <View style={{ padding: theme.spacing.xl, gap: theme.spacing.lg }}>
              <View style={{ gap: theme.spacing.sm }}>
                <Button
                  label="Record"
                  size="lg"
                  fullWidth
                  icon={<Feather name="video" size={18} color={theme.colors.onInk} />}
                  disabled={publishing}
                  onPress={() => router.push('/capture')}
                />
                <Button label="Import clip" size="lg" variant="secondary" fullWidth disabled={publishing} onPress={() => void pickVideo()} />
              </View>
              <AppText variant="caption" color="textTertiary" align="center">Up to 10:00 · 1080p · 25 MB</AppText>
            </View>
          )}
        </Card>
      </View>

      <View style={{ marginTop: theme.spacing.xxxl, gap: theme.spacing.lg }}>
        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="label">Share with</AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {circles.map((circle) => (
              <FilterChip key={circle.id} label={circle.name} active={circleId === circle.id} disabled={publishing} onPress={() => setCircleId(circle.id)} />
            ))}
          </View>
        </View>
        <TextField label="Title (optional)" placeholder="Sunday morning" value={title} onChangeText={setTitle} maxLength={80} editable={!publishing} />
        <TextField label="Caption (optional)" placeholder="What made this ordinary moment worth keeping?" value={description} onChangeText={setDescription} multiline maxLength={400} editable={!publishing} />
        <Button label={showDelivery ? 'Hide advanced' : 'Advanced'} variant="ghost" accessibilityState={{ expanded: showDelivery }} onPress={() => setShowDelivery((value) => !value)} />
        {showDelivery ? (
          <View style={{ gap: theme.spacing.sm }}>
            {PROVIDER_PRESETS.map((provider) => {
              const active = provider.url === providerUrl;
              return (
                <Pressable
                  key={provider.url}
                  onPress={() => setProviderUrl(provider.url)}
                  disabled={publishing}
                  accessibilityRole="button"
                  accessibilityLabel={`Store encrypted media with ${provider.name}`}
                  accessibilityState={{ selected: active, disabled: publishing }}
                  style={{ borderWidth: 1, borderColor: active ? theme.colors.textPrimary : theme.colors.border, borderRadius: theme.radius.md, padding: theme.spacing.lg, minHeight: 64, gap: theme.spacing.xs }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <AppText variant="bodyStrong">{provider.name}</AppText>
                    {active ? <Feather name="check" size={18} color={theme.colors.textPrimary} /> : null}
                  </View>
                </Pressable>
              );
            })}
            <Pressable
              onPress={toggleMirrorCopies}
              disabled={publishing}
              accessibilityRole="switch"
              accessibilityLabel="Keep a backup copy on another server"
              accessibilityState={{ checked: mirrorCopies, disabled: publishing }}
              style={{
                borderWidth: 1,
                borderColor: mirrorCopies ? theme.colors.textPrimary : theme.colors.border,
                borderRadius: theme.radius.md,
                padding: theme.spacing.lg,
                minHeight: 64,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                <View style={{ flex: 1, gap: theme.spacing.xs }}>
                  <AppText variant="bodyStrong">Backup copy</AppText>
                  <AppText variant="caption" color="textSecondary">
                    Stores the encrypted video on a second server. Uses extra data.
                  </AppText>
                </View>
                <Feather
                  name={mirrorCopies ? 'check-square' : 'square'}
                  size={18}
                  color={mirrorCopies ? theme.colors.textPrimary : theme.colors.textTertiary}
                />
              </View>
            </Pressable>
            <AppText variant="caption" color="textTertiary">
              Storage can change. Keep your originals.
            </AppText>
          </View>
        ) : null}
      </View>

      <View style={{ marginTop: theme.spacing.xxxl, gap: theme.spacing.md }}>
        {error ? <InlineNotice message={error} tone="error" /> : null}
        {permissionBlocked ? <Button label="Open system Settings" variant="secondary" onPress={() => void Linking.openSettings()} /> : null}
        {progress ? (
          <View accessibilityLiveRegion="polite" style={{ gap: theme.spacing.sm }}>
            <AppText variant="bodyStrong">{STAGE_LABELS[progress.stage]}</AppText>
            {progress.detail ? <AppText variant="caption" color="textSecondary">{progress.detail}</AppText> : null}
            <ProgressBar fraction={progress.fraction} label={STAGE_LABELS[progress.stage]} />
            <AppText variant="caption" color="textSecondary">Keep Folio open.</AppText>
          </View>
        ) : null}
        <Button label={publishing ? 'Publishing privately' : 'Publish privately'} size="lg" fullWidth loading={publishing} disabled={!video || !circleId} onPress={() => void publish()} />
        <AppText variant="caption" color="textTertiary">Encrypted before upload. Only this circle gets the key.</AppText>
      </View>
    </ScreenScroll>
  );
}
