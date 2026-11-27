import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { AppText } from '../components/ui/AppText';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { PageHeader } from '../components/ui/Layout';
import { ScreenScroll } from '../components/ui/Screen';
import { LoadingState } from '../components/ui/States';
import { getVlogCircleByRemoteId } from '../lib/database/vlogs';
import { useInboxSync, waitForInboxIdle } from '../stores/inboxSync';
import { useSession } from '../stores/session';
import { useTheme } from '../theme/ThemeProvider';

type OpenState = 'loading' | 'missing' | 'error';

/**
 * Remote pushes carry the author's remote id because each device assigns its own
 * local id. Sync first, then resolve the remote id to the local row.
 */
export default function OpenRemoteMomentScreen() {
  const theme = useTheme();
  const { remoteId, comments } = useLocalSearchParams<{
    remoteId?: string;
    comments?: string;
  }>();
  const identity = useSession((state) => state.identity);
  const loading = useSession((state) => state.loading);
  const queryClient = useQueryClient();
  const [result, setResult] = useState<{ key: string; state: OpenState } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const commentsOpen = comments === '1';
  const requestKey = identity && remoteId ? `${identity.id}:${remoteId}:${attempt}` : '';
  const state: OpenState = loading
    ? 'loading'
    : !identity || !remoteId
      ? 'error'
      : result?.key === requestKey
        ? result.state
        : 'loading';

  const openLocalVlog = useCallback(
    (id: string) => {
      router.replace({
        pathname: '/vlog/[id]',
        params: { id, ...(commentsOpen ? { comments: '1' } : {}) },
      });
    },
    [commentsOpen]
  );

  useEffect(() => {
    if (loading || !identity || !remoteId) return;

    let cancelled = false;
    void (async () => {
      const existing = await getVlogCircleByRemoteId(identity.pubkey, remoteId);
      if (cancelled) return;
      if (existing) {
        openLocalVlog(existing.id);
        return;
      }

      const sync = useInboxSync.getState().sync(identity, queryClient, { fast: true });
      await waitForInboxIdle(8_000);
      await sync.catch(() => null);

      const found = await getVlogCircleByRemoteId(identity.pubkey, remoteId);
      if (cancelled) return;
      if (found) openLocalVlog(found.id);
      else setResult({ key: requestKey, state: 'missing' });
    })().catch(() => {
      if (!cancelled) setResult({ key: requestKey, state: 'error' });
    });

    return () => {
      cancelled = true;
    };
  }, [identity, loading, remoteId, queryClient, openLocalVlog, requestKey, attempt]);

  return (
    <ScreenScroll>
      <PageHeader title="Opening moment" />
      {state === 'loading' ? (
        <LoadingState label="Checking this device and your relays" />
      ) : (
        <Card>
          <View style={{ gap: theme.spacing.md }}>
            <AppText variant="bodyStrong">
              {state === 'missing' ? 'This moment is not here yet' : 'This moment could not be opened'}
            </AppText>
            <AppText variant="caption" color="textSecondary">
              {state === 'missing'
                ? 'The notification arrived before the encrypted moment. Check Updates, or try again when your relays are reachable.'
                : 'Folio could not read the notification target. Open Updates to continue.'}
            </AppText>
            <Button
              label="Try again"
              variant="secondary"
              fullWidth
              onPress={() => setAttempt((value) => value + 1)}
            />
            <Button label="Open Updates" variant="ghost" fullWidth onPress={() => router.replace('/(tabs)/updates')} />
          </View>
        </Card>
      )}
    </ScreenScroll>
  );
}
