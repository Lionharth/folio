import React, { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import Feather from '@expo/vector-icons/Feather';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { AppText } from '../../components/ui/AppText';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Card, Divider } from '../../components/ui/Card';
import { IconButton } from '../../components/ui/IconButton';
import { InlineNotice } from '../../components/ui/Notice';
import { ListRow, PageHeader, SectionHeader } from '../../components/ui/Layout';
import { ScreenScroll } from '../../components/ui/Screen';
import { LoadingState } from '../../components/ui/States';
import { shortNpub } from '../../lib/nostr/format';
import { exportIdentitySecret } from '../../lib/nostr/identity';
import { clearRecoveryCheckpointForIdentity } from '../../lib/security/recoveryCheckpoint';
import { DEFAULT_RELAY_LIST } from '../../constants/providers';
import { useSession } from '../../stores/session';
import { useTheme, useThemePreference, type ThemePreference } from '../../theme/ThemeProvider';

export default function ProfileScreen() {
  const theme = useTheme();
  const { preference, setPreference } = useThemePreference();
  const identity = useSession((state) => state.identity);
  const identities = useSession((state) => state.identities);
  const switchTo = useSession((state) => state.switchTo);
  const forget = useSession((state) => state.forget);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; tone: 'neutral' | 'success' | 'error' } | null>(null);

  if (!identity) return <LoadingState label="Opening profile" />;
  const npub = identity.npub;

  const copy = async (value: string, label: string) => {
    try {
      await Clipboard.setStringAsync(value);
      setNotice({ message: `${label} copied`, tone: 'neutral' });
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : `Could not copy ${label.toLowerCase()}`, tone: 'error' });
    }
  };

  const reveal = async () => {
    if (busyAction) return;
    setBusyAction('recovery');
    setNotice(null);
    try {
      setRecoveryKey(await exportIdentitySecret(identity.id));
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : 'Could not reveal the recovery key', tone: 'error' });
    } finally {
      setBusyAction(null);
    }
  };

  const remove = (id: string, label: string) => {
    Alert.alert(
      `Remove ${label} from this device?`,
      'Folio will delete this identity’s secret key and remove it from the identity list. Local diary rows and local media—including decrypted/private playback caches—are not automatically erased. Keep the recovery key to restore the identity elsewhere.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove identity',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusyAction(`remove:${id}`);
              try {
                await forget(id);
                await clearRecoveryCheckpointForIdentity(id);
                if (id === identity.id) setRecoveryKey(null);
                setNotice({ message: `${label}’s key was removed from this device; previously saved local media remains`, tone: 'neutral' });
              } catch (error) {
                setNotice({ message: error instanceof Error ? error.message : 'Could not remove identity', tone: 'error' });
              } finally {
                setBusyAction(null);
              }
            })();
          },
        },
      ]
    );
  };

  return (
    <ScreenScroll>
      <PageHeader eyebrow="folio" title="Profile" />
      {notice ? <View style={{ marginBottom: theme.spacing.lg }}><InlineNotice message={notice.message} tone={notice.tone} /></View> : null}

      <Card style={{ padding: theme.spacing.xl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg }}>
          <Avatar name={identity.label} size={60} />
          <View style={{ flex: 1, gap: 3 }}>
            <AppText variant="headline">{identity.label}</AppText>
            <AppText variant="mono" color="textTertiary" numberOfLines={1}>{shortNpub(identity.pubkey)}</AppText>
          </View>
        </View>
        <Button label="Copy Folio ID" variant="secondary" fullWidth style={{ marginTop: theme.spacing.lg }} onPress={() => void copy(npub, 'Folio ID')} />
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: theme.spacing.sm, marginTop: theme.spacing.md }}>
          <IconButton
            shape="square"
            glyph={<MaterialCommunityIcons name="qrcode" size={21} color={theme.colors.textSecondary} />}
            label="Show Folio ID QR code"
            onPress={() => router.push('/qr')}
          />
          <IconButton
            shape="square"
            icon="camera"
            label="Scan a Folio ID"
            onPress={() => router.push('/scan')}
          />
        </View>
      </Card>

      <SectionHeader title="Identities" />
      <Card>
        <View style={{ gap: theme.spacing.xs }}>
          {identities.map((item) => {
            const active = item.id === identity.id;
            return (
              <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Pressable
                  onPress={() => {
                    if (active || busyAction) return;
                    setBusyAction(`switch:${item.id}`);
                    switchTo(item.id)
                      .then(() => {
                        setRecoveryKey(null);
                        setNotice({ message: `Switched to ${item.label}`, tone: 'success' });
                      })
                      .catch((error) => setNotice({ message: error instanceof Error ? error.message : 'Could not switch identity', tone: 'error' }))
                      .finally(() => setBusyAction(null));
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Use identity ${item.label}`}
                  accessibilityState={{ selected: active, busy: busyAction === `switch:${item.id}`, disabled: Boolean(busyAction) }}
                  disabled={Boolean(busyAction)}
                  style={{ flex: 1, minHeight: 64, paddingVertical: theme.spacing.sm, paddingLeft: theme.spacing.sm, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}
                >
                  <Avatar name={item.label} size={36} />
                  <View style={{ flex: 1 }}>
                    <AppText variant="bodyStrong">{item.label}</AppText>
                    <AppText variant="caption" color="textSecondary">{active ? 'Current' : 'Switch'}</AppText>
                  </View>
                  {active ? <Feather name="check" size={18} color={theme.colors.textPrimary} /> : null}
                </Pressable>
                <IconButton
                  icon="trash-2"
                  tone="danger"
                  label={`Remove identity ${item.label} from this device`}
                  loading={busyAction === `remove:${item.id}`}
                  disabled={Boolean(busyAction)}
                  onPress={() => remove(item.id, item.label)}
                />
              </View>
            );
          })}
        </View>
        <Divider />
        <Button label="Add another identity" variant="ghost" fullWidth disabled={Boolean(busyAction)} onPress={() => router.push('/identity/new')} />
      </Card>

      <SectionHeader title="Appearance" />
      <Card>
        <View style={{ gap: theme.spacing.sm }}>
          {(['system', 'light', 'dark'] as ThemePreference[]).map((option) => {
            const selected = preference === option;
            const label = option.charAt(0).toUpperCase() + option.slice(1);
            return (
              <Pressable
                key={option}
                onPress={() => setPreference(option)}
                accessibilityRole="button"
                accessibilityLabel={`${label} theme`}
                accessibilityState={{ selected }}
                style={({ pressed }) => ({
                  minHeight: 64,
                  borderRadius: theme.radius.md,
                  paddingHorizontal: theme.spacing.md,
                  paddingVertical: theme.spacing.sm,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.md,
                  backgroundColor: selected ? theme.colors.surfaceSubtle : pressed ? theme.colors.surfaceSubtle : 'transparent',
                })}
              >
                <ThemePreview option={option} />
                <AppText variant="bodyStrong" style={{ flex: 1 }}>{label}</AppText>
                {selected ? <Feather name="check" size={18} color={theme.colors.textPrimary} /> : null}
              </Pressable>
            );
          })}
        </View>
        <Divider />
        <AppText variant="caption" color="textSecondary">The video viewer always uses a separate near-black cinema surface for clear playback.</AppText>
      </Card>

      <SectionHeader title="Privacy & recovery" />
      <Card>
        <View style={{ gap: theme.spacing.md }}>
          <AppText variant="bodyStrong">Your recovery key is irreplaceable</AppText>
          <AppText variant="caption" color="textSecondary">Folio cannot reset it. Keep a private offline copy; anyone with it controls your identity.</AppText>
          <Button label={recoveryKey ? 'Hide recovery key' : 'Reveal recovery key'} variant="secondary" fullWidth loading={busyAction === 'recovery'} onPress={() => (recoveryKey ? setRecoveryKey(null) : void reveal())} />
          {recoveryKey ? (
            <View style={{ gap: theme.spacing.md }}>
              <View style={{ padding: theme.spacing.md, backgroundColor: theme.colors.background, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border }}>
                <AppText variant="mono" selectable>{recoveryKey}</AppText>
              </View>
              <Button label="Copy recovery key" variant="ghost" fullWidth onPress={() => void copy(recoveryKey, 'Recovery key')} />
            </View>
          ) : null}
          <Divider />
          <AppText variant="caption" color="textSecondary">Keep your originals: external media hosting can disappear. Removed members may keep media they already saved.</AppText>
        </View>
      </Card>

      <SectionHeader title="Notifications" />
      <Card padded={false}>
        <View style={{ paddingHorizontal: theme.spacing.lg }}>
          <ListRow
            title="Notifications"
            subtitle="New moments, invitations, muted circles"
            right={<Feather name="chevron-right" size={18} color={theme.colors.textTertiary} />}
            onPress={() => router.push('/notifications')}
            showDivider={false}
          />
        </View>
      </Card>

      <SectionHeader title="Advanced" />
      <Card padded={false}>
        <View style={{ paddingHorizontal: theme.spacing.lg }}>
          <ListRow
            title="Protocol lab"
            subtitle="Cryptography, relays, and storage"
            right={<Feather name="chevron-right" size={18} color={theme.colors.textTertiary} />}
            onPress={() => router.push('/lab')}
            showDivider
          />
        </View>
        <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md, paddingBottom: theme.spacing.lg, gap: theme.spacing.md }}>
          <AppText variant="bodyStrong">Sync</AppText>
          <AppText variant="caption" color="textSecondary">Checks on open and refresh, plus best-effort background checks when notifications are enabled. Remote push and background uploads are not available.</AppText>
          <Divider />
          <AppText variant="bodyStrong">Relays</AppText>
          <AppText variant="mono" color="textTertiary" selectable>{DEFAULT_RELAY_LIST.join('\n')}</AppText>
        </View>
      </Card>

      <View style={{ paddingVertical: theme.spacing.xxxl, alignItems: 'center', gap: theme.spacing.xs }}>
        <AppText style={{ fontFamily: theme.font.serifMedium, fontSize: 30 }}>folio</AppText>
        <AppText variant="caption" color="textSecondary" italic>Life, as it happens.</AppText>
      </View>
    </ScreenScroll>
  );
}

function ThemePreview({ option }: { option: ThemePreference }) {
  const theme = useTheme();
  return (
    <View style={{ width: 42, height: 42, borderRadius: theme.radius.md, overflow: 'hidden', borderWidth: 1, borderColor: theme.colors.borderStrong, flexDirection: 'row' }}>
      <View style={{ flex: 1, backgroundColor: option === 'dark' ? '#111111' : '#F8F7F4' }} />
      <View style={{ flex: 1, backgroundColor: option === 'light' ? '#F8F7F4' : '#111111' }} />
      {option === 'system' ? <View style={{ position: 'absolute', top: 0, bottom: 0, left: 20, width: 1, backgroundColor: theme.colors.borderStrong }} /> : null}
    </View>
  );
}
