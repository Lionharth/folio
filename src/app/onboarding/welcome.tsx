import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { ScreenScroll } from '../../components/ui/Screen';
import { useTheme } from '../../theme/ThemeProvider';

export default function WelcomeScreen() {
  const theme = useTheme();
  return (
    <ScreenScroll contentContainerStyle={{ flexGrow: 1 }}>
      <View style={{ flex: 1, minHeight: 640, paddingVertical: theme.spacing.xxl, justifyContent: 'space-between' }}>
        <View style={{ gap: theme.spacing.xxxl }}>
          <AppText style={{ fontFamily: theme.font.serifMedium, fontSize: 58, lineHeight: 62 }}>folio</AppText>
          <View style={{ maxWidth: 440, gap: theme.spacing.lg }}>
            <AppText variant="display" style={{ fontSize: 54, lineHeight: 56 }}>Life, as it happens.</AppText>
            <AppText variant="body" color="textSecondary">A private video diary for your circles.</AppText>
          </View>
        </View>

        <View style={{ gap: theme.spacing.md }}>
          <Button label="Create Folio" size="lg" fullWidth onPress={() => router.push('/onboarding/create')} />
          <Button label="Restore" variant="ghost" fullWidth onPress={() => router.push('/onboarding/import')} />
        </View>
      </View>
    </ScreenScroll>
  );
}
