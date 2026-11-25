import React from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';

import { AppText } from '../ui/AppText';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Layout';
import { VlogThumbnail } from './VlogThumbnail';
import { useTheme } from '../../theme/ThemeProvider';
import { formatDate, formatRelativeTime } from '../../utils/time';
import { shortNpub } from '../../lib/nostr/format';
import type { Vlog } from '../../types/models';

export function VlogRow({
  vlog,
  authorLabel,
  variant = 'standard',
}: {
  vlog: Vlog;
  authorLabel?: string;
  variant?: 'hero' | 'standard';
}) {
  const theme = useTheme();
  const label = authorLabel ?? shortNpub(vlog.authorPubkey);
  const title = vlog.title?.trim() || 'Untitled moment';
  const clips = vlog.clips?.length ?? 1;
  const accessibilityLabel = `${vlog.unread ? 'New. ' : ''}${title}. By ${label}${vlog.circleName ? `, in ${vlog.circleName}` : ''}. ${formatRelativeTime(vlog.createdAt)}. ${clips} ${clips === 1 ? 'clip' : 'clips'}`;

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/vlog/[id]', params: { id: vlog.id } })}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({
        paddingBottom: theme.spacing.xxl,
        marginBottom: theme.spacing.xxl,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        opacity: pressed ? 0.88 : 1,
        transform: [{ scale: pressed ? 0.992 : 1 }],
      })}
    >
      <View style={{ gap: theme.spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, minHeight: 32 }}>
          <Avatar name={label} size={variant === 'hero' ? 32 : 28} />
          <AppText variant="caption" color="textSecondary" numberOfLines={2} style={{ flex: 1 }}>
            {label}
            {vlog.circleName ? ` · ${vlog.circleName}` : ''}
          </AppText>
          {vlog.unread ? <Badge label="New" tone="accent" /> : null}
          <AppText variant="meta" color="textTertiary">{formatRelativeTime(vlog.createdAt)}</AppText>
        </View>

        <VlogThumbnail vlog={vlog} variant={variant} />

        <View style={{ gap: theme.spacing.xs }}>
          <AppText variant={variant === 'hero' ? 'title' : 'vlogTitle'}>{title}</AppText>
          {vlog.description ? (
            <AppText variant={variant === 'hero' ? 'body' : 'caption'} color="textSecondary" numberOfLines={2}>
              {vlog.description}
            </AppText>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export function VlogGridCard({ vlog, authorLabel }: { vlog: Vlog; authorLabel?: string }) {
  const theme = useTheme();
  const label = authorLabel ?? shortNpub(vlog.authorPubkey);
  const title = vlog.title?.trim() || 'Untitled moment';
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/vlog/[id]', params: { id: vlog.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${title}. By ${label}. ${formatDate(vlog.createdAt * 1000)}${vlog.isFavourite ? '. Favourite' : ''}`}
      style={({ pressed }) => ({ flex: 1, gap: theme.spacing.sm, opacity: pressed ? 0.82 : 1 })}
    >
      <VlogThumbnail vlog={vlog} variant="grid" />
      <View style={{ gap: 3, paddingHorizontal: 2 }}>
        <AppText variant="meta" color="textTertiary" numberOfLines={1}>
          {formatDate(vlog.createdAt * 1000)}{vlog.isFavourite ? ' · ★' : ''}
        </AppText>
        <AppText variant="callout">{title}</AppText>
        <AppText variant="caption" color="textSecondary" numberOfLines={2}>{label}{vlog.circleName ? ` · ${vlog.circleName}` : ''}</AppText>
      </View>
    </Pressable>
  );
}
