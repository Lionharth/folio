import React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useTheme } from '../../theme/ThemeProvider';
import { AppText } from './AppText';
import { Button } from './Button';

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  const theme = useTheme();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        flex: 1,
        minHeight: 160,
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.huge,
      }}
    >
      <ActivityIndicator color={theme.colors.textSecondary} />
      <AppText variant="caption" color="textSecondary">
        {label}
      </AppText>
    </View>
  );
}

export function EmptyState({
  eyebrow,
  title,
  description,
  actionLabel,
  onAction,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingVertical: theme.spacing.giant,
        paddingHorizontal: theme.spacing.sm,
        alignItems: 'flex-start',
        gap: theme.spacing.md,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
      }}
    >
      {eyebrow ? <AppText variant="meta" color="textSecondary">{eyebrow}</AppText> : null}
      <AppText variant="headline">{title}</AppText>
      {description ? <AppText variant="body" color="textSecondary">{description}</AppText> : null}
      {actionLabel && onAction ? (
        <View style={{ marginTop: theme.spacing.sm }}>
          <Button label={actionLabel} variant="secondary" onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  actionLabel = 'Try again',
  onAction,
}: {
  title?: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        padding: theme.spacing.xl,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.dangerSurface,
        gap: theme.spacing.sm,
      }}
    >
      <AppText variant="bodyStrong" color="danger">{title}</AppText>
      {message ? <AppText variant="caption" color="textSecondary">{message}</AppText> : null}
      {onAction ? (
        <View style={{ marginTop: theme.spacing.sm }}>
          <Button label={actionLabel} variant="secondary" onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

export function SkeletonBlock({ height, width = '100%' }: { height: number; width?: number | `${number}%` }) {
  const theme = useTheme();
  return <View style={{ height, width, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceSubtle }} />;
}

export function VlogListSkeleton() {
  const theme = useTheme();
  return (
    <View accessibilityLabel="Loading moments" style={{ gap: theme.spacing.lg, paddingVertical: theme.spacing.md }}>
      <SkeletonBlock height={320} />
      <SkeletonBlock height={30} width="72%" />
      <SkeletonBlock height={16} width="48%" />
    </View>
  );
}
