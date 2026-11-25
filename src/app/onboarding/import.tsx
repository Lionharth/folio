import React, { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { InlineNotice } from '../../components/ui/Notice';
import { ScreenScroll } from '../../components/ui/Screen';
import { TextField } from '../../components/ui/TextField';
import { importIdentity } from '../../lib/nostr/identity';
import { announceInboxRelays } from '../../services/identitySetup';
import { completeRecoveryCheckpoint } from '../../lib/security/recoveryCheckpoint';
import { useInboxSync } from '../../stores/inboxSync';
import { useSession } from '../../stores/session';
import { useTheme } from '../../theme/ThemeProvider';

export default function ImportIdentityScreen() {
  const theme = useTheme();
  const refresh = useSession((state) => state.refresh);
  const markRestoring = useInboxSync((state) => state.markRestoring);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const importKey = async () => {
    const trimmed = recoveryKey.trim();
    if (!trimmed) {
      setError('Enter your nsec recovery key.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const imported = await importIdentity(trimmed, label.trim());
      await completeRecoveryCheckpoint().catch(() => undefined);
      markRestoring(imported.id);
      await refresh();
      if (useSession.getState().identity?.id !== imported.id) {
        throw new Error('The identity was imported, but secure storage could not be opened. Retry from the startup screen.');
      }
      void announceInboxRelays(imported.id);
      router.replace('/(tabs)/updates');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Import failed. Check the recovery key and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenScroll>
      <View style={{ paddingVertical: theme.spacing.xxl, gap: theme.spacing.xxxl }}>
        <AppText style={{ fontFamily: theme.font.serifMedium, fontSize: 44, lineHeight: 48 }}>folio</AppText>
        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="meta" color="textSecondary">WELCOME BACK</AppText>
          <AppText variant="title">Restore your Folio</AppText>
          <AppText variant="body" color="textSecondary">Restores your identity and circles on this device.</AppText>
        </View>
        <TextField
          label="Recovery key"
          placeholder="nsec1…"
          value={recoveryKey}
          onChangeText={(value) => { setRecoveryKey(value); setError(null); }}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          autoFocus
          error={error}
          editable={!busy}
        />
        <TextField
          label="Display name (optional)"
          placeholder="Alex"
          value={label}
          onChangeText={setLabel}
          maxLength={48}
          autoCapitalize="words"
          editable={!busy}
        />
        {busy ? <InlineNotice message="Opening your identity from secure storage…" /> : null}
        <View style={{ gap: theme.spacing.sm }}>
          <Button label="Restore" size="lg" fullWidth loading={busy} onPress={() => void importKey()} />
          <Button label="Back" variant="ghost" fullWidth disabled={busy} onPress={() => router.back()} />
        </View>
      </View>
    </ScreenScroll>
  );
}
