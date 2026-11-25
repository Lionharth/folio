import React from 'react';
import { Stack } from 'expo-router';

import { useTheme } from '../../theme/ThemeProvider';

export default function OnboardingLayout() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.background },
        animation: 'slide_from_right',
        headerStyle: { backgroundColor: theme.colors.background },
        headerTintColor: theme.colors.textPrimary,
        headerShadowVisible: false,
      }}
    />
  );
}
