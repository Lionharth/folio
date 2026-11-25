import React from 'react';
import { Redirect, Tabs } from 'expo-router';

import { FolioTabBar } from '../../components/ui/FolioTabBar';
import { LoadingState } from '../../components/ui/States';
import { useInboxBootstrap } from '../../hooks/useInboxBootstrap';
import { useSession } from '../../stores/session';
import { useTheme } from '../../theme/ThemeProvider';

export default function TabsLayout() {
  const theme = useTheme();
  const identity = useSession((state) => state.identity);
  const loading = useSession((state) => state.loading);
  useInboxBootstrap();

  if (!identity) {
    if (loading) return <LoadingState label="Opening Folio" />;
    return <Redirect href="/onboarding/welcome" />;
  }

  return (
    <Tabs
      tabBar={(props) => <FolioTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        sceneStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Tabs.Screen name="updates" options={{ title: 'Updates' }} />
      <Tabs.Screen name="circles" options={{ title: 'Circles' }} />
      <Tabs.Screen name="archive" options={{ title: 'Archive' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
