import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import Feather from '@expo/vector-icons/Feather';

import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ScreenScroll } from '../../components/ui/Screen';
import { TextField } from '../../components/ui/TextField';
import { MAX_VIDEO_BYTES } from '../../constants/media';
import { DEFAULT_PROVIDER_URL, PROVIDER_PRESETS } from '../../constants/providers';
import { listCirclesForViewer } from '../../lib/database/vlogs';
import { readSecretKey } from '../../lib/nostr/identity';
import { generateVideoThumbnail } from '../../services/media';
import { publishVlog, type PublishProgress } from '../../services/publish';
import { useCaptureStore } from '../../stores/capture';
import { useSession } from '../../stores/session';
import { useTheme } from '../../theme/ThemeProvider';
import { formatBytes, formatDuration } from '../../utils/time';

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
  preparing: 'Preparing the clip',
  compressing: 'Compressing to 1080p and under 25 MB',
  encrypting: 'Encrypting on this device',
  'checking-provider': 'Checking the storage provider',
  uploading: 'Uploading encrypted video',
  verifying: 'Verifying the upload',
  thumbnail: 'Uploading the thumbnail',
  distributing: 'Sending keys to your circle',
  saving: 'Saving to your archive',
};

export default function CreateScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const identity = useSession((state) => state.identity);
  const captured = useCaptureStore((state) => state.captured);
  const setCaptured = useCaptureStore((state) => state.setCaptured);

  const [video, setVideo] = useState<SelectedVideo | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [circleId, setCircleId] = useState<string | null>(null);
  const [providerUrl, setProviderUrl] = useState(DEFAULT_PROVIDER_URL);
  const [publishing, setPublishing] = useState(false);
  const [progress, setProgress] = useState<PublishProgress | null>(null);

  const circlesQuery = useQuery({
    queryKey: ['circles', identity?.pubkey],
    queryFn: () => listCirclesForViewer(identity!.pubkey),
    enabled: Boolean(identity),
  });
  const circles = circlesQuery.data ?? [];

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
      if (captured) {
        const selected: SelectedVideo = {
          uri: captured.uri,
          durationMs: captured.durationMs,
          width: captured.width,
          height: captured.height,
          mimeType: captured.mimeType,
        };
        setVideo(selected);
        attachThumbnail(selected);
        setCaptured(null);
      }
    }, [attachThumbnail, captured, setCaptured])
  );

  const selectedProvider = useMemo(
    () => PROVIDER_PRESETS.find((provider) => provider.url === providerUrl) ?? PROVIDER_PRESETS[0],
    [providerUrl]
  );

  const pickVideo = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Library access needed', 'Allow photo library access to choose a video.');
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
  };

  const publish = async () => {
    if (!identity || !video || !circleId || publishing) return;
    const circle = circles.find((candidate) => candidate.id === circleId);
    if (!circle) return;
    setPublishing(true);
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
        onProgress: setProgress,
      });
      await queryClient.invalidateQueries({ queryKey: ['vlogs'] });
      setVideo(null);
      setTitle('');
      setDescription('');
      setProgress(null);
      router.push({ pathname: '/vlog/[id]', params: { id: result.vlogId } });
    } catch (error) {
      Alert.alert('Could not publish', error instanceof Error ? error.message : 'Unknown error');
      setProgress(null);
    } finally {
      setPublishing(false);
    }
  };

  if (circlesQuery.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.colors.textSecondary} />
      </View>
    );
  }

  if (circles.length === 0) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.background,
          paddingHorizontal: theme.layout.screenMargin,
          justifyContent: 'center',
          gap: theme.spacing.lg,
        }}
      >
        <AppText variant="title">Make a circle first</AppText>
        <AppText variant="body" color="textSecondary">
          Folio shares videos into small private groups. Create one for the people you want to share with, then come
          back here.
        </AppText>
        <Button label="Go to Circles" onPress={() => router.push('/(tabs)/circles')} />
      </View>
    );
  }

  return (
    <ScreenScroll>
      <View style={{ paddingTop: theme.spacing.xl, gap: theme.spacing.xxs }}>
        <AppText variant="display">Create</AppText>
        <AppText variant="caption" color="textSecondary">
          A clip, a few clips, a small moment.
        </AppText>
      </View>

      <Card style={{ marginTop: theme.spacing.xl }} padded={false}>
        {video ? (
          <View style={{ gap: theme.spacing.md }}>
            <View style={{ height: 200, backgroundColor: theme.colors.surfaceSubtle, overflow: 'hidden' }}>
              {video.thumbnailUri ? (
                <Image
                  source={{ uri: video.thumbnailUri }}
                  style={{ width: '100%', height: '100%' }}
                  contentFit="cover"
                  transition={120}
                />
              ) : (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="film" size={32} color={theme.colors.textSecondary} />
                </View>
              )}
              <View
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  paddingHorizontal: theme.spacing.md,
                  paddingVertical: theme.spacing.sm,
                  backgroundColor: 'rgba(0,0,0,0.5)',
                }}
              >
                <AppText variant="meta" style={{ color: '#fff' }} numberOfLines={1}>
                  {formatDuration(video.durationMs)} · {video.mimeType}
                  {video.sizeBytes ? ` · ${formatBytes(video.sizeBytes)}` : ''}
                </AppText>
              </View>
            </View>
            <View style={{ paddingHorizontal: theme.spacing.xl, paddingBottom: theme.spacing.xl, gap: theme.spacing.md }}>
              <Button label="Choose a different clip" variant="secondary" onPress={pickVideo} />
            </View>
          </View>
        ) : (
          <View style={{ padding: theme.spacing.xl, gap: theme.spacing.md }}>
            <AppText variant="bodyStrong">Add a clip</AppText>
            <AppText variant="caption" color="textSecondary">
              Record something now or choose a video already on your phone. Clips are compressed to 1080p and capped at
              25 MB, then encrypted on this device before upload.
            </AppText>
            <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
              <Button label="Record" icon={<Feather name="video" size={16} color={theme.colors.onInk} />} onPress={() => router.push('/capture')} />
              <Button label="Import" variant="secondary" onPress={pickVideo} />
            </View>
          </View>
        )}
      </Card>

      <View style={{ marginTop: theme.spacing.xxl, gap: theme.spacing.md }}>
        <AppText variant="label" color="textSecondary">
          SHARE WITH
        </AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          {circles.map((circle) => {
            const active = circleId === circle.id;
            return (
              <Pressable
                key={circle.id}
                onPress={() => setCircleId(circle.id)}
                style={{
                  paddingHorizontal: theme.spacing.lg,
                  minHeight: 40,
                  borderRadius: theme.radius.pill,
                  borderWidth: 1,
                  borderColor: active ? theme.colors.ink : theme.colors.border,
                  backgroundColor: active ? theme.colors.ink : 'transparent',
                  justifyContent: 'center',
                }}
              >
                <AppText variant="label" color={active ? 'onInk' : 'textSecondary'}>
                  {circle.name}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ marginTop: theme.spacing.xxl, gap: theme.spacing.lg }}>
        <TextField label="Title (optional)" placeholder="Sunday morning" value={title} onChangeText={setTitle} maxLength={80} />
        <TextField
          label="Caption (optional)"
          placeholder="What's happening?"
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={400}
        />
      </View>

      <View style={{ marginTop: theme.spacing.xxl, gap: theme.spacing.md }}>
        <AppText variant="label" color="textSecondary">
          STORAGE
        </AppText>
        {PROVIDER_PRESETS.map((provider) => {
          const active = provider.url === providerUrl;
          return (
            <Pressable
              key={provider.url}
              onPress={() => setProviderUrl(provider.url)}
              style={{
                borderWidth: 1,
                borderColor: active ? theme.colors.textPrimary : theme.colors.border,
                borderRadius: theme.radius.md,
                padding: theme.spacing.lg,
                gap: 2,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <AppText variant="bodyStrong">{provider.name}</AppText>
                {active ? <Feather name="check" size={16} color={theme.colors.textPrimary} /> : null}
              </View>
              <AppText variant="caption" color="textSecondary">
                {provider.note}
              </AppText>
            </Pressable>
          );
        })}
        <AppText variant="caption" color="textTertiary">
          Clips are compressed to 1080p and capped at {formatBytes(MAX_VIDEO_BYTES)} before upload.{' '}
          {selectedProvider.observedMaxBytes
            ? `This provider has accepted files up to ${formatBytes(selectedProvider.observedMaxBytes)}.`
            : 'No permanent storage guarantee: keep your original clips.'}
        </AppText>
      </View>

      <View style={{ marginTop: theme.spacing.xxl, gap: theme.spacing.md }}>
        {progress ? (
          <View style={{ gap: theme.spacing.sm }}>
            <AppText variant="caption" color="textSecondary">
              {STAGE_LABELS[progress.stage]}
              {progress.fraction !== undefined ? ` · ${Math.round(progress.fraction * 100)}%` : ''}
            </AppText>
            <View style={{ height: 3, backgroundColor: theme.colors.surfaceSubtle, borderRadius: 2 }}>
              <View
                style={{
                  height: 3,
                  width: `${Math.round((progress.fraction ?? 0.15) * 100)}%`,
                  backgroundColor: theme.colors.textPrimary,
                  borderRadius: 2,
                }}
              />
            </View>
          </View>
        ) : null}
        <Button
          label="Publish to circle"
          size="lg"
          fullWidth
          loading={publishing}
          disabled={!video || !circleId}
          onPress={publish}
        />
        <AppText variant="caption" color="textTertiary">
          The encrypted video is uploaded first, then the key is sent privately to each member. Folio never uploads a
          readable copy.
        </AppText>
      </View>
    </ScreenScroll>
  );
}
