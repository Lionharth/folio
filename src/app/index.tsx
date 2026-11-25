import React from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { AppText } from '../components/ui/AppText';
import { Screen } from '../components/ui/Screen';
import { ErrorState, LoadingState } from '../components/ui/States';
import { shouldResumeRecovery } from '../lib/security/recoveryCheckpoint';
import { useSession } from '../stores/session';
import { useTheme } from '../theme/ThemeProvider';

export default function Index() {
  const theme = useTheme();
  const identity = useSession((state) => state.identity);
  const loading = useSession((state) => state.loading);
  const error = useSession((state) => state.error);
  const refresh = useSession((state) => state.refresh);
  const recoveryQuery = useQuery({
    queryKey: ['onboarding-recovery-checkpoint', identity?.id],
    queryFn: () => shouldResumeRecovery(identity!.id),
    enabled: Boolean(identity),
  });

  if (!loading && (error || (identity && recoveryQuery.isError))) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <AppText style={{ fontFamily: theme.font.serifMedium, fontSize: 58, lineHeight: 64, marginBottom: theme.spacing.xxl }}>folio</AppText>
          <ErrorState
            title="Folio could not open securely"
            message={
              error ??
              (recoveryQuery.error instanceof Error
                ? recoveryQuery.error.message
                : 'The recovery-key checkpoint could not be verified')
            }
            actionLabel="Try opening again"
            onAction={() => {
              if (error) void refresh().catch(() => undefined);
              else void recoveryQuery.refetch();
            }}
          />
        </View>
      </Screen>
    );
  }

  if (loading || (identity && recoveryQuery.isPending)) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <AppText style={{ fontFamily: theme.font.serifMedium, fontSize: 58, lineHeight: 64 }}>folio</AppText>
          <LoadingState label="Life, as it happens" />
        </View>
      </Screen>
    );
  }

  if (!identity) return <Redirect href="/onboarding/welcome" />;
  if (recoveryQuery.data) return <Redirect href="/onboarding/create" />;
  return <Redirect href="/(tabs)/updates" />;
}
