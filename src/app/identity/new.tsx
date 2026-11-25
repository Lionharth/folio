import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { router, usePreventRemove } from 'expo-router';

import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { InlineNotice } from '../../components/ui/Notice';
import { RecoveryKeyPanel } from '../../components/ui/RecoveryKeyPanel';
import { ScreenScroll } from '../../components/ui/Screen';
import { TextField } from '../../components/ui/TextField';
import { createIdentity, deleteIdentity, exportIdentitySecret, type StoredIdentity } from '../../lib/nostr/identity';
import { announceInboxRelays } from '../../services/identitySetup';
import {
  abortRecoveryCheckpoint,
  beginRecoveryCheckpoint,
  clearRecoveryCheckpointForIdentity,
  markRecoveryCheckpointIdentity,
} from '../../lib/security/recoveryCheckpoint';
import { useSession } from '../../stores/session';
import { useTheme } from '../../theme/ThemeProvider';

interface CreatedIdentity extends StoredIdentity {
  nsec?: string;
}

export default function NewIdentityScreen() {
  const theme = useTheme();
  const sessionError = useSession((state) => state.error);
  const refresh = useSession((state) => state.refresh);
  const [label, setLabel] = useState('');
  const [created, setCreated] = useState<CreatedIdentity | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  const disableRemovalPrevention = usePreventRemove(Boolean(created) && !completed, () => {
    Alert.alert('Save this identity’s recovery key first', 'Copy the key and confirm it before leaving. Folio cannot recover it for you later.');
  });

  const create = async () => {
    if (!label.trim()) {
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
      newIdentity = await createIdentity(label.trim());
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

  return (
    <ScreenScroll>
      <View style={{ paddingVertical: theme.spacing.xxl, gap: theme.spacing.xxxl }}>
        <AppText variant="meta" color="textSecondary">IDENTITIES ON THIS DEVICE</AppText>
        {created ? (
          <View style={{ gap: theme.spacing.lg }}>
            {sessionError ? (
              <InlineNotice
                message="This identity was created, but secure storage could not be reopened. Your key remains available below; saving it retries opening the session."
                tone="error"
              />
            ) : null}
            <RecoveryKeyPanel
              identityId={created.id}
              recoveryKey={created.nsec}
              acknowledgeLabel="Save key and use this identity"
              onAcknowledge={async () => {
                await refresh();
                await clearRecoveryCheckpointForIdentity(created.id);
                setCompleted(true);
                disableRemovalPrevention();
                router.replace('/(tabs)/updates');
              }}
            />
          </View>
        ) : (
          <View style={{ gap: theme.spacing.xl }}>
            <View style={{ gap: theme.spacing.sm }}>
              <AppText variant="title">Add another identity</AppText>
              <AppText variant="body" color="textSecondary">A separate identity with its own circles and key.</AppText>
            </View>
            <TextField
              label="Display name"
              placeholder="Alex"
              value={label}
              onChangeText={(value) => { setLabel(value); setError(null); }}
              maxLength={48}
              autoCapitalize="words"
              error={!label.trim() && error ? error : undefined}
              editable={!busy}
            />
            {label.trim() && error ? <InlineNotice message={error} tone="error" /> : null}
            <Button label="Create identity" size="lg" fullWidth loading={busy} onPress={() => void create()} />
            <Button label="Import an existing identity instead" variant="ghost" fullWidth disabled={busy} onPress={() => router.push('/onboarding/import')} />
            <Button label="Cancel" variant="ghost" fullWidth disabled={busy} onPress={() => router.back()} />
          </View>
        )}
      </View>
    </ScreenScroll>
  );
}
