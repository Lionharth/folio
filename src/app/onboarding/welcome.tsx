import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Screen } from '../../components/ui/Screen';
import { useTheme } from '../../theme/ThemeProvider';

export default function Welcome() {
  const theme = useTheme();
  return (
    <Screen padded={false}>
      <View style={{ flex: 1, paddingHorizontal: theme.layout.screenMargin, justifyContent: 'space-between' }}>
        <View style={{ flex: 1, justifyContent: 'center', gap: theme.spacing.xl }}>
          <View style={{ gap: theme.spacing.xs }}>
            <AppText variant="display" style={{ fontSize: 64, lineHeight: 66, letterSpacing: -1.5 }}>
              folio
            </AppText>
            <AppText variant="headline" color="textSecondary" italic>
              Life, as it happens.
            </AppText>
          </View>
          <View style={{ gap: theme.spacing.md, maxWidth: 420 }}>
            <AppText variant="body" color="textSecondary">
              A quiet place to share everyday videos with the people who matter. No followers, no algorithms, no
              pressure.
            </AppText>
            <AppText variant="caption" color="textTertiary">
              Your videos are encrypted on this device before they leave it. Only members of your circles hold the
              keys.
            </AppText>
          </View>
        </View>

        <View style={{ paddingBottom: theme.spacing.xxxl, gap: theme.spacing.md }}>
          <Button label="Create my Folio" size="lg" fullWidth onPress={() => router.push('/onboarding/create')} />
          <Button
            label="I already have a recovery key"
            variant="ghost"
            fullWidth
            onPress={() => router.push('/onboarding/import')}
          />
        </View>
      </View>
    </Screen>
  );
}
