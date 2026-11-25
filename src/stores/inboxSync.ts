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
  lastAction: 'bootstrap' | 'manual' | null;
  error: string | null;
  retryRequired: boolean;
  markRestoring: (identityId: string) => void;
  bootstrap: (identity: StoredIdentity, queryClient: QueryClient) => Promise<void>;
  sync: (identity: StoredIdentity, queryClient: QueryClient) => Promise<InboxRefreshResult | null>;
}

const attempted = new Set<string>();
const restoreRequested = new Set<string>();
let requestSequence = 0;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Your relays did not respond';
}

export const useInboxSync = create<InboxSyncState>((set, get) => {
  const run = async (
    identity: StoredIdentity,
    queryClient: QueryClient,
    origin: 'bootstrap' | 'manual'
  ): Promise<InboxRefreshResult | null> => {
    const current = get();
    if (current.syncing && current.identityId === identity.id) return current.lastResult;
    const previous = current.lastResult;

    const request = ++requestSequence;
    attempted.add(identity.id);
    set({
      identityId: identity.id,
      syncing: true,
      restoring: restoreRequested.has(identity.id),
      lastResult: null,
      lastAction: origin,
      error: null,
      retryRequired: false,
    });

    try {
      const lock = await acquireSyncLock(20_000);
      if (!lock) {
        attempted.delete(identity.id);
        if (request === requestSequence && get().identityId === identity.id) {
          set({
            syncing: false,
            restoring: false,
            lastResult: previous,
            error: null,
            retryRequired: false,
          });
        }
        return previous;
      }
      try {
        const secretKey = await readSecretKey(identity.id);
        const result = await refreshInbox(secretKey);
        if (result.anyRelaySucceeded) restoreRequested.delete(identity.id);
        else attempted.delete(identity.id);
        await invalidateAfterInbox(queryClient, identity.pubkey);
        if (request === requestSequence && get().identityId === identity.id) {
          set({
            syncing: false,
            restoring: false,
            lastResult: result,
            error: null,
            retryRequired: !result.anyRelaySucceeded,
          });
        }
        return result;
      } finally {
        await lock.release();
      }
    } catch (error) {
      attempted.delete(identity.id);
      if (request === requestSequence && get().identityId === identity.id) {
        set({
          syncing: false,
          restoring: false,
          error: errorMessage(error),
          retryRequired: true,
        });
      }
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
      await run(identity, queryClient, 'bootstrap');
    },
    async sync(identity, queryClient) {
      return run(identity, queryClient, 'manual');
    },
  };
});
