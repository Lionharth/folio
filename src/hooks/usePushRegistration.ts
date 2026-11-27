import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { syncPushRegistrationAsync } from '../services/push';
import { useSession } from '../stores/session';

const lastAutoSyncAt = new Map<string, number>();
const AUTO_SYNC_INTERVAL_MS = 30_000;

function syncInBackground(identity: Parameters<typeof syncPushRegistrationAsync>[0]): void {
  const now = Date.now();
  const last = lastAutoSyncAt.get(identity.id) ?? 0;
  if (now - last < AUTO_SYNC_INTERVAL_MS) return;
  lastAutoSyncAt.set(identity.id, now);
  void syncPushRegistrationAsync(identity).catch(() => undefined);
}

/**
 * Keeps the device's Expo push token registered and announced to circle
 * members. Token and permission checks are best-effort; failures stay local.
 */
export function usePushRegistration(ready: boolean): void {
  const identity = useSession((state) => state.identity);

  useEffect(() => {
    if (!ready || !identity) return;
    syncInBackground(identity);

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') syncInBackground(identity);
    });
    return () => subscription.remove();
  }, [identity, ready]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = Notifications.addPushTokenListener(() => {
      // The native token rolled: fetch a fresh Expo token and re-announce it.
      if (identity) {
        lastAutoSyncAt.set(identity.id, Date.now());
        void syncPushRegistrationAsync(identity, { force: true }).catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [identity]);
}
