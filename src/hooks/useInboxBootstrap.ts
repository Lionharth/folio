import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useInboxSync } from '../stores/inboxSync';
import { useSession } from '../stores/session';
import { useNetworkStatus } from './useNetworkStatus';

/** Runs once per identity, then retries a failed bootstrap only when connectivity returns. */
export function useInboxBootstrap(): void {
  const identity = useSession((state) => state.identity);
  const queryClient = useQueryClient();
  const bootstrap = useInboxSync((state) => state.bootstrap);
  const retryRequired = useInboxSync((state) => state.retryRequired);
  const syncIdentityId = useInboxSync((state) => state.identityId);
  const { offline, known } = useNetworkStatus();
  const previousOffline = useRef<boolean | null>(null);

  useEffect(() => {
    if (identity) bootstrap(identity, queryClient).catch(() => undefined);
  }, [identity, queryClient, bootstrap]);

  useEffect(() => {
    const regainedConnectivity = previousOffline.current === true && known && !offline;
    previousOffline.current = offline;
    if (identity && regainedConnectivity && retryRequired && syncIdentityId === identity.id) {
      bootstrap(identity, queryClient).catch(() => undefined);
    }
  }, [identity, queryClient, bootstrap, known, offline, retryRequired, syncIdentityId]);
}
