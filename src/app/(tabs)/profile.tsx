import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useQuery } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';

import { AppText } from '../../components/ui/AppText';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Card, Divider } from '../../components/ui/Card';
import { ScreenScroll } from '../../components/ui/Screen';
import { SectionHeader } from '../../components/ui/Layout';
import { DEFAULT_RELAY_LIST, PROVIDER_PRESETS } from '../../constants/providers';
import { listCirclesForViewer } from '../../lib/database/vlogs';
import { exportIdentitySecret } from '../../lib/nostr/identity';
import { shortNpub } from '../../lib/nostr/format';
import { useSession } from '../../stores/session';
import { useTheme, useThemePreference, type ThemePreference } from '../../theme/ThemeProvider';

export default function ProfileScreen() {
  const theme = useTheme();
  const { preference, setPreference } = useThemePreference();
  const identity = useSession((state) => state.identity);
  const identities = useSession((state) => state.identities);
  const switchTo = useSession((state) => state.switchTo);
  const forget = useSession((state) => state.forget);
  const [revealed, setRevealed] = useState<{ identityId: string; nsec: string } | null>(null);
  const revealedKey = revealed && revealed.identityId === identity?.id ? revealed.nsec : null;

  const circlesQuery = useQuery({
    queryKey: ['circles', identity?.pubkey],
    queryFn: () => listCirclesForViewer(identity!.pubkey),
    enabled: Boolean(identity),
  });

  if (!identity) return null;

  const reveal = async () => {
    if (revealedKey) {
      setRevealed(null);
      return;
    }
    const nsec = await exportIdentitySecret(identity.id);
    setRevealed({ identityId: identity.id, nsec });
  };

  return (
    <ScreenScroll>
      <View style={{ paddingTop: theme.spacing.xl, gap: theme.spacing.xxs }}>
        <AppText variant="display">Profile</AppText>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg, marginTop: theme.spacing.xl }}>
        <Avatar name={identity.label} size={56} />
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="headline">{identity.label}</AppText>
          <AppText variant="caption" color="textSecondary" numberOfLines={1}>
            {shortNpub(identity.pubkey)}
          </AppText>
        </View>
      </View>

      <Button
        label="Copy Folio ID"
        variant="secondary"
        style={{ marginTop: theme.spacing.lg }}
        onPress={async () => {
          await Clipboard.setStringAsync(identity.npub);
          Alert.alert('Copied', 'Send this to a friend so they can add you to a circle.');
        }}
      />

      <SectionHeader title="On this device" />
      <Card padded={false}>
        {identities.map((item, index) => (
          <View key={item.id}>
            <Pressable
              onPress={() => switchTo(item.id)}
              style={({ pressed }) => ({
                padding: theme.spacing.lg,
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.md,
                opacity: pressed ? 0.7 : 1,
                backgroundColor: item.id === identity.id ? theme.colors.surfaceSubtle : 'transparent',
              })}
            >
              <Avatar name={item.label} size={32} />
              <View style={{ flex: 1 }}>
                <AppText variant="bodyStrong">{item.label}</AppText>
                <AppText variant="caption" color="textSecondary">
                  {shortNpub(item.pubkey)}
                </AppText>
              </View>
              {item.id === identity.id ? <Feather name="check" size={18} color={theme.colors.textPrimary} /> : null}
            </Pressable>
            {index < identities.length - 1 ? <Divider inset={theme.spacing.lg} /> : null}
          </View>
        ))}
      </Card>
      <View style={{ flexDirection: 'row', gap: theme.spacing.md, marginTop: theme.spacing.md }}>
        <Button label="Add identity" variant="secondary" style={{ flexShrink: 0 }} onPress={() => router.push('/identity/new')} />
        <Button
          label="Remove this identity"
          style={{ flexShrink: 0 }}
          variant="ghost"
          onPress={() => {
            Alert.alert(
              'Remove identity from this device?',
              'Your recovery key still works. Without it, this identity cannot be restored.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove', style: 'destructive', onPress: () => forget(identity.id) },
              ]
            );
          }}
        />
      </View>
      <AppText variant="caption" color="textTertiary" style={{ marginTop: theme.spacing.sm }}>
        Multiple identities on one device are useful for testing the two-device flow. A normal Folio has one.
      </AppText>

      <SectionHeader title="Appearance" />
      <Card padded={false}>
        {(['system', 'light', 'dark'] as ThemePreference[]).map((option, index) => (
          <View key={option}>
            <Pressable
              onPress={() => setPreference(option)}
              style={{ padding: theme.spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <AppText variant="body">{option === 'system' ? 'Match system' : option === 'light' ? 'Light' : 'Dark'}</AppText>
              {preference === option ? <Feather name="check" size={18} color={theme.colors.textPrimary} /> : null}
            </Pressable>
            {index < 2 ? <Divider inset={theme.spacing.lg} /> : null}
          </View>
        ))}
      </Card>

      <SectionHeader title="Storage providers" />
      <Card>
        <View style={{ gap: theme.spacing.md }}>
          {PROVIDER_PRESETS.map((provider) => (
            <View key={provider.url} style={{ gap: 2 }}>
              <AppText variant="bodyStrong">{provider.name}</AppText>
              <AppText variant="caption" color="textSecondary">
                {provider.note}
              </AppText>
            </View>
          ))}
          <AppText variant="caption" color="textTertiary">
            Folio does not run its own storage. If a provider disappears, a clip may become unavailable even though your
            archive entry remains.
          </AppText>
        </View>
      </Card>

      <SectionHeader title="Relays" />
      <Card>
        <View style={{ gap: theme.spacing.sm }}>
          {DEFAULT_RELAY_LIST.map((relay) => (
            <AppText key={relay} variant="mono" color="textSecondary">
              {relay}
            </AppText>
          ))}
          <AppText variant="caption" color="textTertiary">
            Relay subscriptions only run while the app is open. Notifications in this build are best-effort and not
            guaranteed after Android terminates the app.
          </AppText>
        </View>
      </Card>

      <SectionHeader title="Recovery" />
      <Card>
        <View style={{ gap: theme.spacing.md }}>
          <AppText variant="body" color="textSecondary">
            Your recovery key is the only backup of your identity. Folio cannot reset it or recover your account for
            you.
          </AppText>
          {revealedKey ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <AppText variant="mono">{revealedKey}</AppText>
            </ScrollView>
          ) : null}
          <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
            <Button label={revealedKey ? 'Hide key' : 'Reveal key'} variant="secondary" onPress={reveal} />
            {revealedKey ? (
              <Button label="Copy" variant="ghost" onPress={() => Clipboard.setStringAsync(revealedKey)} />
            ) : null}
          </View>
        </View>
      </Card>

      <SectionHeader title="Protocol lab" />
      <Card>
        <View style={{ gap: theme.spacing.md }}>
          <AppText variant="caption" color="textSecondary">
            Inspect relay and provider health, and run an on-device cryptography self-test.
          </AppText>
          <Button label="Open protocol lab" variant="secondary" onPress={() => router.push('/lab')} />
        </View>
      </Card>

      <View style={{ marginTop: theme.spacing.xxxl, alignItems: 'center', gap: theme.spacing.xs }}>
        <AppText variant="caption" color="textTertiary">
          Folio 0.1.0 · {circlesQuery.data?.length ?? 0} circles
        </AppText>
        <AppText variant="caption" color="textTertiary">
          Life, as it happens.
        </AppText>
      </View>
    </ScreenScroll>
  );
}
