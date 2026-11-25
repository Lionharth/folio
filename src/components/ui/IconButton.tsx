import React from 'react';
import { ActivityIndicator, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import { useTheme } from '../../theme/ThemeProvider';

type FeatherIcon = React.ComponentProps<typeof Feather>['name'];

export function IconButton({
  icon,
  label,
  loading = false,
  disabled = false,
  selected = false,
  tone = 'default',
  style,
  accessibilityState,
  ...props
}: Omit<PressableProps, 'children' | 'style'> & {
  icon: FeatherIcon;
  label: string;
  loading?: boolean;
  selected?: boolean;
  tone?: 'default' | 'strong' | 'danger';
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const isDisabled = disabled || loading;
  const color = tone === 'danger' ? theme.colors.danger : tone === 'strong' ? theme.colors.textPrimary : theme.colors.textSecondary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ ...accessibilityState, disabled: isDisabled, busy: loading, selected }}
      disabled={isDisabled}
      hitSlop={4}
      style={({ pressed }) => [
        {
          width: theme.layout.minTouchTarget,
          height: theme.layout.minTouchTarget,
          borderRadius: theme.radius.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: selected ? theme.colors.surfaceSubtle : pressed ? theme.colors.surfaceSubtle : 'transparent',
          opacity: isDisabled ? 0.45 : 1,
        },
        style,
      ]}
      {...props}
    >
      {loading ? <ActivityIndicator size="small" color={color} /> : <Feather name={icon} size={21} color={color} />}
    </Pressable>
  );
}
