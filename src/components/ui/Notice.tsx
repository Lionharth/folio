import React from 'react';
import { View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import { useTheme } from '../../theme/ThemeProvider';
import { AppText } from './AppText';

export function InlineNotice({
  message,
  tone = 'neutral',
  action,
}: {
  message: string;
  tone?: 'neutral' | 'success' | 'warning' | 'error';
  action?: React.ReactNode;
}) {
  const theme = useTheme();
  const color = tone === 'error' ? theme.colors.danger : tone === 'success' ? theme.colors.success : theme.colors.textSecondary;
  const icon = tone === 'error' ? 'alert-circle' : tone === 'success' ? 'check-circle' : tone === 'warning' ? 'cloud-off' : 'info';
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radius.md,
        backgroundColor: tone === 'error' ? theme.colors.dangerSurface : theme.colors.surfaceSubtle,
      }}
    >
      <Feather name={icon} size={16} color={color} />
      <AppText variant="caption" color={tone === 'error' ? 'danger' : 'textSecondary'} style={{ flex: 1 }}>
        {message}
      </AppText>
      {action}
    </View>
  );
}
