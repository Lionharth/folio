import React from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';

import { useTheme } from '../../theme/ThemeProvider';
import type { Palette, TypeVariant } from '../../theme/tokens';

type ColorKey = keyof Palette;

export interface AppTextProps extends TextProps {
  variant?: TypeVariant;
  color?: ColorKey | (string & {});
  align?: TextStyle['textAlign'];
  italic?: boolean;
}

export function AppText({
  variant = 'body',
  color = 'textPrimary',
  align,
  italic,
  style,
  accessibilityRole,
  ...rest
}: AppTextProps) {
  const theme = useTheme();
  const resolvedColor = (theme.colors as unknown as Record<string, string>)[color] ?? color;
  const heading = variant === 'display' || variant === 'title' || variant === 'headline';
  return (
    <Text
      {...rest}
      accessibilityRole={accessibilityRole ?? (heading ? 'header' : undefined)}
      style={[
        theme.type[variant],
        { color: resolvedColor },
        align ? { textAlign: align } : null,
        italic ? { fontFamily: theme.font.serifItalic } : null,
        style,
      ]}
    />
  );
}
