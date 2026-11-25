import type { QueryClient } from '@tanstack/react-query';

import type { Vlog } from '../types/models';
import { queryKeys } from './queryKeys';

interface PagedCache {
  pages: unknown[];
}

function isVlog(value: unknown): value is Vlog {
  return typeof value === 'object' && value !== null && 'id' in value && 'unread' in value;
}

function isPagedCache(value: unknown): value is PagedCache {
  return typeof value === 'object' && value !== null && 'pages' in value && Array.isArray(value.pages);
}

function markRead(value: Vlog, vlogId: string): Vlog {
  return value.id === vlogId ? { ...value, unread: false } : value;
}

function patchCacheValue(value: unknown, vlogId: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => (isVlog(item) ? markRead(item, vlogId) : item));
  }
  if (isPagedCache(value)) {
    return {
      ...value,
      pages: value.pages.map((page) =>
        Array.isArray(page) ? page.map((item) => (isVlog(item) ? markRead(item, vlogId) : item)) : page
      ),
    };
  }
  return isVlog(value) ? markRead(value, vlogId) : value;
}

/**
 * Updates the active detail and already-loaded feeds without refetching every
 * cached page. Only unread-only Updates queries must refetch so the read row
 * disappears while preserving their server-side pagination offsets.
 */
export function syncVlogReadCaches(queryClient: QueryClient, viewerPubkey: string, vlogId: string): void {
  const root = queryKeys.vlogs(viewerPubkey);
  queryClient.setQueriesData<unknown>({ queryKey: root }, (value: unknown) => patchCacheValue(value, vlogId));
  void queryClient.invalidateQueries({ queryKey: queryKeys.unread(viewerPubkey) });
  for (const query of queryClient.getQueryCache().findAll({ queryKey: root })) {
    if (query.queryKey.includes('updates')) {
      void queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true });
    }
  }
}
