import React, { useEffect } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { useTheme } from '../theme/ThemeProvider';
import { useSession } from '../stores/session';
import { LoadingState } from '../components/ui/States';

export default function Index() {
  const theme = useTheme();
  const { identity, loading } = useSession();

  useEffect(() => {
    if (loading) return;
    if (identity) {
      router.replace('/(tabs)/updates');
    } else {
      router.replace('/onboarding/welcome');
    }
  }, [identity, loading]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <LoadingState label="Opening Folio" />
    </View>
  );
}
