import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { QueryClient } from '@tanstack/react-query';

import { startInboxLiveSubscription, type InboxLiveHandle } from '../services/inboxLive';
import { useInboxSync } from '../stores/inboxSync';
import { useSession } from '../stores/session';
import { useNetworkStatus } from './useNetworkStatus';

const DEBOUNCE_MS = 300;

export function useInboxLiveSubscription(ready: boolean, queryClient: QueryClient): void {
  const identity = useSession((state) => state.identity);
  const requestFastSync = useInboxSync((state) => state.requestFastSync);
  const { offline } = useNetworkStatus();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!ready || !identity || offline || !appActive) return;

    let cancelled = false;
    let handle: InboxLiveHandle | null = null;
    const onWrap = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        requestFastSync(identity, queryClient);
      }, DEBOUNCE_MS);
    };

    void startInboxLiveSubscription({ identity, onWrap })
      .then((created) => {
        if (cancelled) created.close();
        else handle = created;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      handle?.close();
      handle = null;
    };
  }, [appActive, identity, offline, queryClient, ready, requestFastSync]);
}
