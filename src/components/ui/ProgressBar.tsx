import React from 'react';
import { View } from 'react-native';

import { useTheme } from '../../theme/ThemeProvider';

export function ProgressBar({ fraction, label }: { fraction?: number; label: string }) {
  const theme = useTheme();
  const normalized = fraction === undefined ? 0.12 : Math.max(0.03, Math.min(1, fraction));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: fraction === undefined ? undefined : Math.round(normalized * 100) }}
      style={{ height: 3, backgroundColor: theme.colors.surfaceSubtle, borderRadius: 2, overflow: 'hidden' }}
    >
      <View
        style={{
          height: 3,
          width: `${Math.round(normalized * 100)}%`,
          backgroundColor: theme.colors.textPrimary,
          borderRadius: 2,
        }}
      />
    </View>
  );
}
