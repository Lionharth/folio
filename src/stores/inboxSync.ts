import type { QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';

import { acquireSyncLock } from '../lib/database/syncLock';
import { readSecretKey, type StoredIdentity } from '../lib/nostr/identity';
import { invalidateAfterInbox } from '../lib/queryKeys';
import { refreshInbox, type InboxRefreshResult } from '../services/inbox';

interface InboxSyncState {
  identityId: string | null;
  syncing: boolean;
  restoring: boolean;
  lastResult: InboxRefreshResult | null;
  lastAction: 'bootstrap' | 'manual' | 'live' | null;
  error: string | null;
  retryRequired: boolean;
  markRestoring: (identityId: string) => void;
  bootstrap: (identity: StoredIdentity, queryClient: QueryClient) => Promise<void>;
  sync: (
    identity: StoredIdentity,
    queryClient: QueryClient,
    options?: { fast?: boolean }
  ) => Promise<InboxRefreshResult | null>;
  requestFastSync: (identity: StoredIdentity, queryClient: QueryClient) => void;
}

const attempted = new Set<string>();
const restoreRequested = new Set<string>();
let requestSequence = 0;
let pendingFast: { identity: StoredIdentity; queryClient: QueryClient } | null = null;
let pendingBootstrap: { identity: StoredIdentity; queryClient: QueryClient } | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Your relays did not respond';
}

export const useInboxSync = create<InboxSyncState>((set, get) => {
  const run = async (
    identity: StoredIdentity,
    queryClient: QueryClient,
    origin: 'bootstrap' | 'manual' | 'live',
    fast: boolean,
    live: boolean
  ): Promise<InboxRefreshResult | null> => {
    const current = get();
    if (current.syncing && current.identityId === identity.id) {
      if (origin === 'bootstrap') pendingBootstrap = { identity, queryClient };
      return current.lastResult;
    }
    const previous = current.lastResult;

    const request = ++requestSequence;
    if (origin === 'bootstrap') attempted.add(identity.id);
    set({
      identityId: identity.id,
      syncing: true,
      restoring: restoreRequested.has(identity.id),
      lastResult: fast ? previous : null,
      lastAction: origin,
      error: null,
      retryRequired: false,
    });

    const finish = (update: Partial<InboxSyncState>): void => {
      if (request !== requestSequence || get().identityId !== identity.id) return;
      set(update);
      const bootstrap = pendingBootstrap;
      if (bootstrap) {
        pendingBootstrap = null;
        void run(bootstrap.identity, bootstrap.queryClient, 'bootstrap', false, false);
        return;
      }
      const pending = pendingFast;
      if (pending) {
        pendingFast = null;
        void run(pending.identity, pending.queryClient, 'live', true, true);
      }
    };

    try {
      const lock = await acquireSyncLock(20_000);
      if (!lock) {
        attempted.delete(identity.id);
        finish({
          syncing: false,
          restoring: false,
          lastResult: previous,
          error: null,
          retryRequired: false,
        });
        return previous;
      }
      try {
        const secretKey = await readSecretKey(identity.id);
        const result = await refreshInbox(secretKey, undefined, { fast, live });
        if (result.anyRelaySucceeded) restoreRequested.delete(identity.id);
        else attempted.delete(identity.id);
        await invalidateAfterInbox(queryClient, identity.pubkey);
        finish({
          syncing: false,
          restoring: false,
          lastResult: result,
          error: null,
          retryRequired: !result.anyRelaySucceeded,
        });
        return result;
      } finally {
        await lock.release();
      }
    } catch (error) {
      attempted.delete(identity.id);
      finish({
        syncing: false,
        restoring: false,
        error: errorMessage(error),
        retryRequired: true,
      });
      return null;
    }
  };

  return {
    identityId: null,
    syncing: false,
    restoring: false,
    lastResult: null,
    lastAction: null,
    error: null,
    retryRequired: false,
    markRestoring(identityId) {
      requestSequence += 1;
      attempted.delete(identityId);
      restoreRequested.add(identityId);
      set({
        identityId,
        syncing: false,
        restoring: true,
        lastResult: null,
        lastAction: null,
        error: null,
        retryRequired: false,
      });
    },
    async bootstrap(identity, queryClient) {
      if (attempted.has(identity.id)) return;
      await run(identity, queryClient, 'bootstrap', false, false);
    },
    async sync(identity, queryClient, options) {
      return run(identity, queryClient, 'manual', options?.fast === true, false);
    },
    requestFastSync(identity, queryClient) {
      const current = get();
      if (current.syncing && current.identityId === identity.id) {
        pendingFast = { identity, queryClient };
        return;
      }
      void run(identity, queryClient, 'live', true, true);
    },
  };
});

/** Resolves when no inbox run is in flight, or at the timeout. */
export function waitForInboxIdle(timeoutMs = 20_000): Promise<void> {
  if (!useInboxSync.getState().syncing) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      unsubscribe?.();
      resolve();
    };
    timer = setTimeout(finish, timeoutMs);
    unsubscribe = useInboxSync.subscribe((state) => {
      if (!state.syncing) finish();
    });
  });
}
