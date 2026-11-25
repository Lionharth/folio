import React from 'react';
import { View, type ViewProps } from 'react-native';

import { useTheme } from '../../theme/ThemeProvider';

export interface CardProps extends ViewProps {
  children: React.ReactNode;
  padded?: boolean;
  subtle?: boolean;
}

export function Card({ children, padded = true, subtle = false, style, ...rest }: CardProps) {
  const theme = useTheme();
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: subtle ? theme.colors.surfaceSubtle : theme.colors.surface,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: theme.colors.border,
          padding: padded ? theme.spacing.xl : 0,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const theme = useTheme();
  return <View style={{ height: 1, backgroundColor: theme.colors.border, marginLeft: inset }} />;
}
