import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
  type ScrollViewProps,
  type ViewProps,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../../theme/ThemeProvider';

export interface ScreenProps extends ViewProps {
  children: React.ReactNode;
  padded?: boolean;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
}

export function Screen({
  children,
  padded = true,
  edges = ['top', 'bottom', 'left', 'right'],
  style,
  ...rest
}: ScreenProps) {
  const theme = useTheme();
  return (
    <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: theme.colors.background }, style]} {...rest}>
      <View style={{ flex: 1, paddingHorizontal: padded ? theme.layout.screenMargin : 0 }}>{children}</View>
    </SafeAreaView>
  );
}

export interface ScreenScrollProps extends ScrollViewProps {
  children: React.ReactNode;
  padded?: boolean;
  bottomInset?: boolean;
}

export function ScreenScroll({
  children,
  padded = true,
  bottomInset = true,
  contentContainerStyle,
  ...rest
}: ScreenScrollProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1 }}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            {
              paddingHorizontal: padded ? theme.layout.screenMargin : 0,
              paddingBottom: bottomInset ? insets.bottom + theme.spacing.xxxl : 0,
              flexGrow: 1,
            },
            contentContainerStyle,
          ]}
          {...rest}
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}
