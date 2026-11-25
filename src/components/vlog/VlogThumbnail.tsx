import React, { useEffect, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import Feather from '@expo/vector-icons/Feather';

import { ensureClipThumbnail } from '../../services/thumbnails';
import { useTheme } from '../../theme/ThemeProvider';
import type { Vlog } from '../../types/models';
import { AppText } from '../ui/AppText';

export type VlogThumbnailVariant = 'hero' | 'standard' | 'grid';

export function VlogThumbnail({
  vlog,
  variant = 'standard',
  style,
}: {
  vlog: Vlog;
  variant?: VlogThumbnailVariant;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const [loaded, setLoaded] = useState<{ vlogId: string; uri: string } | null>(null);
  const clip = vlog.clips?.[0];
  const uri = vlog.coverUri ?? (loaded?.vlogId === vlog.id ? loaded.uri : null);
  const aspectRatio =
    variant === 'hero' ? theme.media.heroAspect : variant === 'grid' ? theme.media.gridAspect : theme.media.standardAspect;
  const clipCount = vlog.clips?.length ?? 1;

  useEffect(() => {
    if (uri || !clip) return;
    let cancelled = false;
    ensureClipThumbnail(vlog, clip)
      .then((next) => {
        if (!cancelled && next) setLoaded({ vlogId: vlog.id, uri: next });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [uri, clip, vlog]);

  return (
    <View
      style={[
        {
          width: '100%',
          aspectRatio,
          borderRadius: variant === 'hero' ? theme.radius.xl : theme.radius.lg,
          backgroundColor: theme.colors.surfaceSubtle,
          borderWidth: 1,
          borderColor: theme.colors.border,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {uri ? (
        <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={180} />
      ) : (
        <View style={{ alignItems: 'center', gap: theme.spacing.sm, padding: theme.spacing.lg }}>
          <Feather name="film" size={variant === 'grid' ? 22 : 28} color={theme.colors.textSecondary} />
          {variant !== 'grid' ? <AppText variant="headline" color="textSecondary">A moment worth keeping</AppText> : null}
        </View>
      )}
      <View
        style={{
          position: 'absolute',
          left: theme.spacing.md,
          bottom: theme.spacing.md,
          minWidth: variant === 'grid' ? 34 : 44,
          height: variant === 'grid' ? 34 : 44,
          borderRadius: theme.radius.pill,
          backgroundColor: 'rgba(0,0,0,0.68)',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: variant === 'grid' ? 0 : theme.spacing.md,
          flexDirection: 'row',
          gap: theme.spacing.xs,
        }}
      >
        <Feather name="play" size={variant === 'grid' ? 13 : 16} color="#FFFFFF" />
        {variant === 'hero' ? <AppText variant="label" style={{ color: '#FFFFFF' }}>Watch</AppText> : null}
      </View>
      {clipCount > 1 ? (
        <View
          style={{
            position: 'absolute',
            right: theme.spacing.sm,
            top: theme.spacing.sm,
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: theme.spacing.xs,
            borderRadius: theme.radius.pill,
            backgroundColor: 'rgba(0,0,0,0.68)',
          }}
        >
          <AppText variant="meta" style={{ color: '#FFFFFF' }}>{clipCount} clips</AppText>
        </View>
      ) : null}
    </View>
  );
}
