/**
 * Entry layout. The polyfill import must stay first so that @noble and
 * nostr-tools see a WebCrypto-compatible getRandomValues global.
 */
import '../lib/crypto/polyfill';
import '../lib/notifications/backgroundTask';
import '../lib/notifications/handler';

import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  CormorantGaramond_300Light,
  CormorantGaramond_400Regular,
  CormorantGaramond_400Regular_Italic,
  CormorantGaramond_500Medium,
  CormorantGaramond_600SemiBold,
} from '@expo-google-fonts/cormorant-garamond';
import {
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
  InstrumentSans_700Bold,
} from '@expo-google-fonts/instrument-sans';
import { useFonts } from 'expo-font';

import { useInboxLiveSubscription } from '../hooks/useInboxLiveSubscription';
import { useNotificationRouting } from '../hooks/useNotificationRouting';
import { usePushRegistration } from '../hooks/usePushRegistration';
import { setPendingCapture } from '../lib/media/pendingCapture';
import { markRemoteNotifiedAsync } from '../lib/notifications/remoteNotified';
import { clearIconBadgeAsync, reconcileNotificationRuntimeAsync } from '../services/notifications';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';
import { useInboxSync } from '../stores/inboxSync';
import { useSession } from '../stores/session';

SplashScreen.preventAutoHideAsync().catch(() => undefined);
SplashScreen.setOptions({ duration: 300, fade: true });

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: false },
  },
});

function RootStack() {
  const theme = useTheme();
  return (
    <>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" options={{ animation: 'none' }} />
        <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
        <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
        <Stack.Screen name="vlog/[id]" options={{ animation: 'fade' }} />
        <Stack.Screen name="create" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="qr" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="scan" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="circle/[id]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="circle/new" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="identity/new" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="inbox" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="notifications" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="lab" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="open" options={{ animation: 'fade' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const refresh = useSession((state) => state.refresh);
  const identity = useSession((state) => state.identity);
  const pendingCaptureChecked = useRef(false);
  const [fontsLoaded, fontError] = useFonts({
    CormorantGaramond_300Light,
    CormorantGaramond_400Regular,
    CormorantGaramond_400Regular_Italic,
    CormorantGaramond_500Medium,
    CormorantGaramond_600SemiBold,
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    InstrumentSans_700Bold,
  });

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const ready = fontsLoaded || fontError;

  useNotificationRouting(Boolean(ready));
  usePushRegistration(Boolean(ready));
  useInboxLiveSubscription(Boolean(ready), queryClient);

  useEffect(() => {
    if (!identity) return;
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data;
      const viewerPubkeys = data?.viewerPubkeys;
      if (Array.isArray(viewerPubkeys)) {
        if (!viewerPubkeys.includes(identity.pubkey)) return;
      } else if (typeof data?.viewerPubkey === 'string' && data.viewerPubkey !== identity.pubkey) {
        return;
      }
      if (data?.category === 'invite') {
        if (typeof data.circleId === 'string') {
          void markRemoteNotifiedAsync(data.circleId, 'invite').catch(() => undefined);
        }
        useInboxSync.getState().requestFastSync(identity, queryClient);
        return;
      }
      if (typeof data?.remoteId !== 'string') return;
      const category = data.category === 'moment' ? 'moment' : 'social';
      void markRemoteNotifiedAsync(data.remoteId, category).catch(() => undefined);
      useInboxSync.getState().requestFastSync(identity, queryClient);
    });
    return () => subscription.remove();
  }, [identity]);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  useEffect(() => {
    // Android destroys the activity while the OS camera is open. The result
    // survives in the picker module, so recover it once the identity is known
    // and hand the clip back to Create.
    if (!ready || !identity || pendingCaptureChecked.current) return;
    pendingCaptureChecked.current = true;
    ImagePicker.getPendingResultAsync()
      .then((result) => {
        if (!result || 'code' in result || result.canceled) return;
        const asset = result.assets.find(
          (candidate) => candidate.type === 'video' || candidate.mimeType?.startsWith('video/')
        );
        if (!asset) return;
        setPendingCapture(asset);
        router.push('/create');
      })
      .catch(() => undefined);
  }, [identity, ready]);

  useEffect(() => {
    void reconcileNotificationRuntimeAsync();
    void clearIconBadgeAsync();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void reconcileNotificationRuntimeAsync();
      void clearIconBadgeAsync();
      void queryClient.invalidateQueries({ queryKey: ['unread'] });
      void queryClient.invalidateQueries({ queryKey: ['activity-unread'] });
      void queryClient.invalidateQueries({ queryKey: ['vlogs'] });
      if (identity) {
        const last = useInboxSync.getState().lastResult;
        if (!last || Date.now() - last.completedAt > 30_000) {
          void useInboxSync
            .getState()
            .sync(identity, queryClient, { fast: true })
            .catch(() => undefined);
        }
      }
    });
    return () => subscription.remove();
  }, [identity]);

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#77746F" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <RootStack />
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8F7F4' },
});
