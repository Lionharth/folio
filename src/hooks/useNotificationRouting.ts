import { useCallback, useEffect, useRef } from 'react';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';

import { resolveNotificationRoute } from '../lib/notifications/routes';
import { useSession } from '../stores/session';

/**
 * Routes notification taps after the session has settled. Cold-start responses
 * are deferred until fonts, the navigator and the active identity are ready.
 */
export function useNotificationRouting(ready: boolean): void {
  const identity = useSession((state) => state.identity);
  const loading = useSession((state) => state.loading);
  const identityRef = useRef(identity);
  const readyRef = useRef(ready);
  const loadingRef = useRef(loading);
  const pending = useRef<Notifications.NotificationResponse | null>(null);
  const handled = useRef(new Set<string>());

  useEffect(() => {
    identityRef.current = identity;
  }, [identity]);

  useEffect(() => {
    readyRef.current = ready;
    loadingRef.current = loading;
  }, [ready, loading]);

  const consume = useCallback(async () => {
    if (!pending.current || !readyRef.current || loadingRef.current) return;
    const response = pending.current;
    pending.current = null;

    const data = response.notification.request.content.data;
    const url = data?.url;
    const viewerPubkey = data?.viewerPubkey;
    const viewerPubkeys = data?.viewerPubkeys;
    const active = identityRef.current;
    const viewerMatches = Array.isArray(viewerPubkeys)
      ? Boolean(active && viewerPubkeys.includes(active.pubkey))
      : typeof viewerPubkey === 'string'
        ? Boolean(active && viewerPubkey === active.pubkey)
        : true;
    if (!viewerMatches) {
      await Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
      return;
    }
    if (typeof url === 'string' && active) {
      const route = resolveNotificationRoute(url, active.pubkey);
      if (route) {
        if (route.kind === 'vlog') {
          router.push({
            pathname: '/vlog/[id]',
            params: {
              id: route.vlogId,
              ...(route.comments ? { comments: '1' } : {}),
            },
          });
        } else if (route.kind === 'remote-vlog') {
          router.push({
            pathname: '/open',
            params: {
              remoteId: route.remoteId,
              ...(route.comments ? { comments: '1' } : {}),
            },
          });
        } else if (route.kind === 'updates') {
          router.navigate({
            pathname: '/(tabs)/updates',
            params: route.circleId ? { circleId: route.circleId } : {},
          });
        } else {
          router.navigate('/(tabs)/circles');
        }
      }
    }

    await Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
  }, []);

  const handleResponse = useCallback(
    (response: Notifications.NotificationResponse) => {
      const identifier = response.notification.request.identifier;
      if (handled.current.has(identifier)) return;
      handled.current.add(identifier);
      pending.current = response;
      void consume();
    },
    [consume]
  );

  useEffect(() => {
    let cancelled = false;
    const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!cancelled && response) handleResponse(response);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [handleResponse]);

  useEffect(() => {
    void consume();
  }, [consume, ready, loading, identity]);
}
