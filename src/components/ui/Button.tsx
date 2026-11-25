import React from 'react';
import { ActivityIndicator, Pressable, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '../../theme/ThemeProvider';
import { AppText } from './AppText';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = false,
  icon,
  style,
  accessibilityLabel,
  ...rest
}: ButtonProps) {
  const theme = useTheme();
  const height = size === 'lg' ? 56 : theme.layout.minTouchTarget;
  const isDisabled = disabled || loading;

  const background =
    variant === 'primary' ? theme.colors.ink : variant === 'danger' ? theme.colors.dangerSurface : 'transparent';
  const borderColor =
    variant === 'secondary'
      ? theme.colors.borderStrong
      : variant === 'primary'
        ? theme.colors.ink
        : variant === 'danger'
          ? theme.colors.danger
          : 'transparent';
  const labelColor =
    variant === 'primary'
      ? 'onInk'
      : variant === 'danger'
        ? 'danger'
        : variant === 'secondary'
          ? 'textPrimary'
          : 'textSecondary';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      style={({ pressed }) => [
        {
          minHeight: height,
          minWidth: theme.layout.minTouchTarget,
          paddingHorizontal: theme.spacing.xl,
          paddingVertical: theme.spacing.sm,
          borderRadius: theme.radius.sm,
          borderWidth: variant === 'secondary' || variant === 'danger' ? 1 : 0,
          backgroundColor: background,
          borderColor,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: theme.spacing.sm,
          opacity: isDisabled ? 0.45 : pressed ? 0.82 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variant === 'primary' ? theme.colors.onInk : theme.colors.textPrimary} />
      ) : icon ? (
        <View>{icon}</View>
      ) : null}
      <AppText variant="button" color={labelColor} align="center" style={{ flexShrink: 1 }}>
        {label}
      </AppText>
    </Pressable>
  );
}
