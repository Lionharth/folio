import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { readSecretKey } from '../lib/nostr/identity';
import { refreshInbox } from '../services/inbox';
import { useSession } from '../stores/session';

const attempted = new Set<string>();

/**
 * Syncs the active identity once per app session as soon as the tabs mount.
 * This is what silently restores previously joined circles after a reinstall
 * or a recovery-key import; manual pull-to-refresh still reports errors.
 */
export function useInboxBootstrap(): void {
  const identity = useSession((state) => state.identity);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!identity || attempted.has(identity.id)) return;
    attempted.add(identity.id);
    let cancelled = false;

    (async () => {
      try {
        const secretKey = await readSecretKey(identity.id);
        await refreshInbox(secretKey);
        if (cancelled) return;
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['circles'] }),
          queryClient.invalidateQueries({ queryKey: ['circles-with-members'] }),
          queryClient.invalidateQueries({ queryKey: ['circle'] }),
          queryClient.invalidateQueries({ queryKey: ['circle-invites'] }),
          queryClient.invalidateQueries({ queryKey: ['circle-member'] }),
          queryClient.invalidateQueries({ queryKey: ['vlogs'] }),
          queryClient.invalidateQueries({ queryKey: ['contact-names'] }),
          queryClient.invalidateQueries({ queryKey: ['comments'] }),
          queryClient.invalidateQueries({ queryKey: ['reactions'] }),
          queryClient.invalidateQueries({ queryKey: ['comment-reactions'] }),
        ]);
      } catch {
        // Offline is normal here; the next manual sync retries everything.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [identity, queryClient]);
}
