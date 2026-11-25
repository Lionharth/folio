import React from 'react';
import { Pressable } from 'react-native';

import { useTheme } from '../../theme/ThemeProvider';
import { AppText } from './AppText';

export function FilterChip({
  label,
  active,
  onPress,
  disabled = false,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
      style={({ pressed }) => ({
        minHeight: theme.layout.minTouchTarget,
        minWidth: theme.layout.minTouchTarget,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.sm,
        borderRadius: theme.radius.pill,
        borderWidth: 1,
        borderColor: active ? theme.colors.ink : theme.colors.border,
        backgroundColor: active ? theme.colors.ink : pressed ? theme.colors.surfaceSubtle : 'transparent',
        justifyContent: 'center',
        alignItems: 'center',
        opacity: disabled ? 0.45 : 1,
      })}
    >
      <AppText variant="label" color={active ? 'onInk' : 'textSecondary'}>
        {label}
      </AppText>
    </Pressable>
  );
}
