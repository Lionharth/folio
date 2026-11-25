import React from 'react';
import { View } from 'react-native';

import { useTheme } from '../../theme/ThemeProvider';
import { AppText } from './AppText';

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: theme.colors.surfaceSubtle,
        borderWidth: 1,
        borderColor: theme.colors.border,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <AppText variant="label" color="textSecondary" style={{ fontSize: Math.max(10, size / 3) }}>
        {initialsOf(name)}
      </AppText>
    </View>
  );
}
