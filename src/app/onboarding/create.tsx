import React, { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { createPool, DEFAULT_DM_RELAYS } from '../../lib/nostr/relays';
import { publishInboxRelays } from '../../lib/nostr/dm';
import { createIdentity, exportIdentitySecret, readSecretKey } from '../../lib/nostr/identity';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Screen } from '../../components/ui/Screen';
import { TextField } from '../../components/ui/TextField';
import { useTheme } from '../../theme/ThemeProvider';
import { useSession } from '../../stores/session';

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
    // Best-effort: private messages still fall back to the default relay set.
  }
}

export default function CreateIdentityScreen() {
  const theme = useTheme();
  const refresh = useSession((state) => state.refresh);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ id: string; nsec: string; npub: string } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const identity = await createIdentity(name.trim() || 'Me');
      const nsec = await exportIdentitySecret(identity.id);
      setCreated({ id: identity.id, nsec, npub: identity.npub });
      setRevealed(true);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      await refresh();
      announceInbox(identity.id).catch(() => undefined);
    } catch (error) {
      Alert.alert('Could not create your identity', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setCreating(false);
    }
  };

  const copy = async () => {
    if (!created) return;
    await Clipboard.setStringAsync(created.nsec);
    setCopied(true);
    await Haptics.selectionAsync().catch(() => undefined);
  };

  if (!created) {
    return (
      <Screen>
        <View style={{ flex: 1, paddingTop: theme.spacing.huge, gap: theme.spacing.xxl }}>
          <View style={{ gap: theme.spacing.sm }}>
            <AppText variant="title">What should we call you?</AppText>
            <AppText variant="body" color="textSecondary">
              This name is only shared with the people you invite. You can change it later.
            </AppText>
          </View>
          <TextField
            label="Display name"
            placeholder="Your name"
            value={name}
            onChangeText={setName}
            autoFocus
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={create}
            maxLength={40}
          />
          <Button label="Create Folio" size="lg" fullWidth loading={creating} onPress={create} />
          <AppText variant="caption" color="textTertiary">
            A private identity is generated on this device. Nothing about you is published.
          </AppText>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ flex: 1, paddingTop: theme.spacing.huge, gap: theme.spacing.xl }}>
        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="title">Your recovery key</AppText>
          <AppText variant="body" color="textSecondary">
            This key is the only way back into your Folio if you lose this phone. Store it somewhere private. Anyone
            who has it can read everything you share.
          </AppText>
        </View>

        <Card>
          <View style={{ gap: theme.spacing.md }}>
            <AppText variant="label" color="textSecondary">
              RECOVERY KEY
            </AppText>
            <Pressable
              onPress={() => setRevealed((value) => !value)}
              style={{ minHeight: theme.layout.minTouchTarget, justifyContent: 'center' }}
              accessibilityRole="button"
              accessibilityLabel={revealed ? 'Hide recovery key' : 'Reveal recovery key'}
            >
              <AppText variant="mono" color="textPrimary" numberOfLines={2}>
                {revealed ? created.nsec : '•••••••••••••••••••••••••••••••••••••••••••••••••••••••••••'}
              </AppText>
            </Pressable>
            <AppText variant="caption" color="textTertiary">
              Tap the key to {revealed ? 'hide' : 'reveal'} it.
            </AppText>
            <Button label={copied ? 'Copied' : 'Copy recovery key'} variant="secondary" onPress={copy} />
          </View>
        </Card>

        <Card subtle>
          <View style={{ gap: theme.spacing.xs }}>
            <AppText variant="bodyStrong">Folio cannot recover this for you</AppText>
            <AppText variant="caption" color="textSecondary">
              There is no server holding a copy. If you lose the key and this device, your Folio is gone. Write it down
              or put it in a password manager.
            </AppText>
          </View>
        </Card>

        <View style={{ flex: 1 }} />
        <View style={{ paddingBottom: theme.spacing.xxxl, gap: theme.spacing.md }}>
          <Button
            label="I've saved my key"
            size="lg"
            fullWidth
            onPress={() => router.replace('/(tabs)/updates')}
          />
          <Button
            label="Show key again"
            variant="ghost"
            fullWidth
            onPress={() => setRevealed(true)}
          />
        </View>
      </View>
    </Screen>
  );
}
