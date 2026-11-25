import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { Redirect, router, usePreventRemove } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { InlineNotice } from '../../components/ui/Notice';
import { RecoveryKeyPanel } from '../../components/ui/RecoveryKeyPanel';
import { ScreenScroll } from '../../components/ui/Screen';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { TextField } from '../../components/ui/TextField';
import { createIdentity, deleteIdentity, exportIdentitySecret, type StoredIdentity } from '../../lib/nostr/identity';
import { announceInboxRelays } from '../../services/identitySetup';
import {
  abortRecoveryCheckpoint,
  beginRecoveryCheckpoint,
  clearRecoveryCheckpointForIdentity,
  markRecoveryCheckpointIdentity,
  shouldResumeRecovery,
} from '../../lib/security/recoveryCheckpoint';
import { useSession } from '../../stores/session';
import { useTheme } from '../../theme/ThemeProvider';

interface CreatedIdentity extends StoredIdentity {
  nsec?: string;
}

export default function CreateIdentityScreen() {
  const theme = useTheme();
  const identity = useSession((state) => state.identity);
  const sessionLoading = useSession((state) => state.loading);
  const sessionError = useSession((state) => state.error);
  const refresh = useSession((state) => state.refresh);
  const [label, setLabel] = useState('');
  const [created, setCreated] = useState<CreatedIdentity | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const recoveryQuery = useQuery({
    queryKey: ['onboarding-recovery-checkpoint', identity?.id],
    queryFn: () => shouldResumeRecovery(identity!.id),
    enabled: Boolean(identity),
  });
  const resumingIdentity = identity && recoveryQuery.data ? identity : null;
  const recoveryIdentity = created ?? resumingIdentity;

  const disableRemovalPrevention = usePreventRemove(Boolean(recoveryIdentity) && !completed, () => {
    Alert.alert('Save your recovery key first', 'Copy the key and confirm that you have stored it somewhere private before leaving this step.');
  });

  const create = async () => {
    const trimmed = label.trim();
    if (!trimmed) {
      setError('Choose a display name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await beginRecoveryCheckpoint();
    } catch {
      setError('Folio could not prepare a safe recovery checkpoint. No identity was created; try again.');
      setBusy(false);
      return;
    }
    let newIdentity: Awaited<ReturnType<typeof createIdentity>>;
    try {
      newIdentity = await createIdentity(trimmed);
    } catch (reason) {
      await abortRecoveryCheckpoint().catch(() => undefined);
      setError(reason instanceof Error ? reason.message : 'Identity creation failed');
      setBusy(false);
      return;
    }

    let nsec: string;
    try {
      nsec = await exportIdentitySecret(newIdentity.id);
    } catch {
      await deleteIdentity(newIdentity.id).catch(() => undefined);
      await abortRecoveryCheckpoint().catch(() => undefined);
      await refresh().catch(() => undefined);
      setError('Folio could not read the new recovery key, so the identity was discarded. Try again.');
      setBusy(false);
      return;
    }
    await markRecoveryCheckpointIdentity(newIdentity.id).catch(() => undefined);
    setCreated({ ...newIdentity, nsec });
    void announceInboxRelays(newIdentity.id);
    await refresh().catch(() => undefined);
    setBusy(false);
  };

  const acknowledge = async () => {
    // Retry opening the session before allowing navigation to the tabs.
    await refresh();
    if (recoveryIdentity) await clearRecoveryCheckpointForIdentity(recoveryIdentity.id);
    setCompleted(true);
    disableRemovalPrevention();
    router.replace('/(tabs)/updates');
  };

  if (sessionLoading || (identity && !created && recoveryQuery.isPending)) {
    return (
      <ScreenScroll>
        <View style={{ paddingVertical: theme.spacing.xxl, gap: theme.spacing.xxxl }}>
          <AppText style={{ fontFamily: theme.font.serifMedium, fontSize: 44, lineHeight: 48 }}>folio</AppText>
          <LoadingState label="Opening Folio" />
        </View>
      </ScreenScroll>
    );
  }

  if (identity && !created && recoveryQuery.isError) {
    return (
      <ScreenScroll>
        <View style={{ paddingVertical: theme.spacing.xxl, gap: theme.spacing.xxxl }}>
          <AppText style={{ fontFamily: theme.font.serifMedium, fontSize: 44, lineHeight: 48 }}>folio</AppText>
          <ErrorState title="Couldn’t verify recovery setup" onAction={() => recoveryQuery.refetch()} />
        </View>
      </ScreenScroll>
    );
  }

  if (identity && !created && recoveryQuery.data === false) {
    return <Redirect href="/(tabs)/updates" />;
  }

  return (
    <ScreenScroll>
      <View style={{ paddingVertical: theme.spacing.xxl, gap: theme.spacing.xxxl }}>
        <AppText style={{ fontFamily: theme.font.serifMedium, fontSize: 44, lineHeight: 48 }}>folio</AppText>
        {recoveryIdentity ? (
          <View style={{ gap: theme.spacing.lg }}>
            {sessionError ? (
              <InlineNotice
                message="Your identity and checkpoint were created, but secure storage could not be reopened. Your key is still available below; saving it retries opening the session."
                tone="error"
              />
            ) : null}
            <RecoveryKeyPanel
              key={recoveryIdentity.id}
              identityId={recoveryIdentity.id}
              recoveryKey={created?.id === recoveryIdentity.id ? created.nsec : undefined}
              onAcknowledge={acknowledge}
            />
          </View>
        ) : (
          <View style={{ gap: theme.spacing.xl }}>
            <View style={{ gap: theme.spacing.sm }}>
              <AppText variant="meta" color="textSecondary">YOUR PRIVATE IDENTITY</AppText>
              <AppText variant="title">What should your circle call you?</AppText>
              <AppText variant="body" color="textSecondary">Only people in your circles see this name.</AppText>
            </View>
            <TextField
              label="Display name"
              placeholder="Alex"
              value={label}
              onChangeText={(value) => { setLabel(value); setError(null); }}
              maxLength={48}
              autoFocus
              autoCapitalize="words"
              error={!label.trim() && error ? error : undefined}
              editable={!busy}
            />
            {label.trim() && error ? <InlineNotice message={error} tone="error" /> : null}
            <View style={{ gap: theme.spacing.sm }}>
              <Button label="Create identity" size="lg" fullWidth loading={busy} onPress={() => void create()} />
              <Button label="Back" variant="ghost" fullWidth disabled={busy} onPress={() => router.back()} />
            </View>
          </View>
        )}
      </View>
    </ScreenScroll>
  );
}
