import React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useTheme } from '../../theme/ThemeProvider';
import { AppText } from './AppText';
import { Button } from './Button';

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  const theme = useTheme();
  return (
    <View
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
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingVertical: theme.spacing.huge,
        paddingHorizontal: theme.spacing.lg,
        alignItems: 'flex-start',
        gap: theme.spacing.sm,
      }}
    >
      <AppText variant="headline">{title}</AppText>
      {description ? (
        <AppText variant="body" color="textSecondary">
          {description}
        </AppText>
      ) : null}
      {actionLabel && onAction ? (
        <View style={{ marginTop: theme.spacing.md }}>
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
      style={{
        padding: theme.spacing.xl,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.dangerSurface,
        gap: theme.spacing.sm,
      }}
    >
      <AppText variant="bodyStrong" color="danger">
        {title}
      </AppText>
      {message ? (
        <AppText variant="caption" color="textSecondary">
          {message}
        </AppText>
      ) : null}
      {onAction ? (
        <View style={{ marginTop: theme.spacing.sm }}>
          <Button label={actionLabel} variant="secondary" onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}
