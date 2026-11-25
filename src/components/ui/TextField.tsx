import React from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';

import { useTheme } from '../../theme/ThemeProvider';
import { AppText } from './AppText';

export interface TextFieldProps extends TextInputProps {
  label?: string;
  hint?: string;
  error?: string | null;
  suffix?: React.ReactNode;
}

export function TextField({ label, hint, error, suffix, style, multiline, ...rest }: TextFieldProps) {
  const theme = useTheme();
  const [focused, setFocused] = React.useState(false);
  const borderColor = error ? theme.colors.danger : focused ? theme.colors.textSecondary : theme.colors.border;

  return (
    <View style={{ gap: theme.spacing.xs }}>
      {label ? (
        <AppText variant="label" color="textSecondary">
          {label}
        </AppText>
      ) : null}
      <View
        style={{
          borderWidth: 1,
          borderColor,
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.surface,
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: multiline ? theme.spacing.md : 0,
          minHeight: theme.layout.minTouchTarget,
          flexDirection: 'row',
          alignItems: multiline ? 'flex-start' : 'center',
          gap: theme.spacing.sm,
        }}
      >
        <TextInput
          {...rest}
          multiline={multiline}
          onFocus={(event) => {
            setFocused(true);
            rest.onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            rest.onBlur?.(event);
          }}
          placeholderTextColor={theme.colors.textTertiary}
          selectionColor={theme.colors.textPrimary}
          style={[
            theme.type.body,
            {
              flex: 1,
              color: theme.colors.textPrimary,
              paddingVertical: multiline ? 0 : theme.spacing.md,
              minHeight: multiline ? 88 : undefined,
              textAlignVertical: multiline ? 'top' : 'center',
            },
            style,
          ]}
        />
        {suffix}
      </View>
      {error ? (
        <AppText variant="caption" color="danger">
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" color="textTertiary">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}
