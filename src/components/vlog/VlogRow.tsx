import React from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';

import { AppText } from '../ui/AppText';
import { Avatar } from '../ui/Avatar';
import { VlogThumbnail } from './VlogThumbnail';
import { useTheme } from '../../theme/ThemeProvider';
import { formatRelativeTime } from '../../utils/time';
import { shortNpub } from '../../lib/nostr/format';
import type { Vlog } from '../../types/models';

export function VlogRow({ vlog, authorLabel }: { vlog: Vlog; authorLabel?: string }) {
  const theme = useTheme();
  const label = authorLabel ?? shortNpub(vlog.authorPubkey);
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/vlog/[id]', params: { id: vlog.id } })}
      accessibilityRole="button"
      style={{ opacity: 1 }}
    >
      {({ pressed }) => (
        <View
          style={{
            paddingVertical: theme.spacing.xl,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
            gap: theme.spacing.md,
            opacity: pressed ? 0.65 : 1,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <Avatar name={label} size={28} />
            <AppText variant="caption" color="textSecondary" numberOfLines={1} style={{ flex: 1 }}>
              {label}
              {vlog.circleName ? `  ·  ${vlog.circleName}` : ''}
            </AppText>
            <AppText variant="meta" color="textTertiary">
              {formatRelativeTime(vlog.createdAt)}
            </AppText>
            {vlog.unread ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.textPrimary }} /> : null}
          </View>

          <View style={{ flexDirection: 'row', gap: theme.spacing.lg }}>
            <VlogThumbnail vlog={vlog} />
            <View style={{ flex: 1, gap: theme.spacing.xs, justifyContent: 'center' }}>
              <AppText variant="vlogTitle" numberOfLines={2}>
                {vlog.title?.trim() || 'Untitled moment'}
              </AppText>
              {vlog.description ? (
                <AppText variant="caption" color="textSecondary" numberOfLines={2}>
                  {vlog.description}
                </AppText>
              ) : null}
              <AppText variant="meta" color="textTertiary">
                {(vlog.clips?.length ?? 1) > 1 ? `${vlog.clips?.length} clips` : '1 clip'}
              </AppText>
            </View>
          </View>
        </View>
      )}
    </Pressable>
  );
}
