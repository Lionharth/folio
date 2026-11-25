import React, { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Screen } from '../../components/ui/Screen';
import { TextField } from '../../components/ui/TextField';
import { importIdentity, readSecretKey } from '../../lib/nostr/identity';
import { createPool, DEFAULT_DM_RELAYS } from '../../lib/nostr/relays';
import { publishInboxRelays } from '../../lib/nostr/dm';
import { useTheme } from '../../theme/ThemeProvider';
import { useSession } from '../../stores/session';

export default function ImportIdentityScreen() {
  const theme = useTheme();
  const refresh = useSession((state) => state.refresh);
  const [secret, setSecret] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const restore = async () => {
    setBusy(true);
    setError(null);
    try {
      const identity = await importIdentity(secret, name.trim() || 'Me');
      await refresh();
      announceInbox(identity.id).catch(() => undefined);
      router.replace('/(tabs)/updates');
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'That key could not be read');
      await HapticsFailure();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ flex: 1, paddingTop: theme.spacing.huge, gap: theme.spacing.xl }}>
        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="title">Restore your Folio</AppText>
          <AppText variant="body" color="textSecondary">
            Paste the recovery key you saved when you first created your Folio. It stays on this device and is stored
            in the system keystore.
          </AppText>
        </View>
        <TextField
          label="Recovery key"
          placeholder="nsec1…"
          value={secret}
          onChangeText={setSecret}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          error={error}
        />
        <TextField
          label="Display name (optional)"
          placeholder="Your name"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
        />
        <Button
          label="Restore"
          size="lg"
          fullWidth
          loading={busy}
          disabled={secret.trim().length === 0}
          onPress={restore}
        />
      </View>
    </Screen>
  );
}

async function announceInbox(identityId: string) {
  try {
    const secretKey = await readSecretKey(identityId);
    const pool = createPool({ secretKey });
    try {
      await publishInboxRelays(pool, secretKey, DEFAULT_DM_RELAYS);
    } finally {
      pool.destroy();
    }
  } catch {
    // Best-effort; messaging falls back to the bootstrap relays.
  }
}

async function HapticsFailure() {
  try {
    const Haptics = await import('expo-haptics');
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  } catch {
    // haptics are optional
  }
}
