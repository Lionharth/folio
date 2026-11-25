import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import Feather from '@expo/vector-icons/Feather';

import { ensureClipThumbnail } from '../../services/thumbnails';
import { useTheme } from '../../theme/ThemeProvider';
import type { Vlog } from '../../types/models';

export function VlogThumbnail({ vlog }: { vlog: Vlog }) {
  const theme = useTheme();
  const [loaded, setLoaded] = useState<{ vlogId: string; uri: string } | null>(null);
  const clip = vlog.clips?.[0];
  const uri = vlog.coverUri ?? (loaded?.vlogId === vlog.id ? loaded.uri : null);

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
      style={{
        width: 108,
        height: 72,
        borderRadius: theme.radius.md,
        backgroundColor: theme.colors.surfaceSubtle,
        borderWidth: 1,
        borderColor: theme.colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {uri ? (
        <>
          <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={120} />
          <View
            style={{
              position: 'absolute',
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: 'rgba(0,0,0,0.45)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Feather name="play" size={14} color="#fff" />
          </View>
        </>
      ) : (
        <Feather name="play" size={20} color={theme.colors.textSecondary} />
      )}
    </View>
  );
}
