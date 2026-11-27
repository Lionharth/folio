import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import * as BackgroundTask from 'expo-background-task';

import { AppText } from '../components/ui/AppText';
import { Button } from '../components/ui/Button';
import { Card, Divider } from '../components/ui/Card';
import { IconButton } from '../components/ui/IconButton';
import { PageHeader } from '../components/ui/Layout';
import { ScreenScroll } from '../components/ui/Screen';
import { DEFAULT_RELAY_LIST, PROVIDER_PRESETS } from '../constants/providers';
import { BlossomClient } from '../lib/blossom/client';
import { expoAesGcm, expoRandom } from '../lib/crypto/expoAes';
import { bytesEqual } from '../lib/crypto/bytes';
import {
  clearIconBadgeAsync,
  getInboxBackgroundTaskStateAsync,
  getNotificationPermissionAsync,
  sendTestNotificationAsync,
} from '../services/notifications';
import { useTheme } from '../theme/ThemeProvider';
import { formatBytes } from '../utils/time';

interface CheckResult {
  label: string;
  ok: boolean | null;
  detail: string;
}

type Section = 'crypto' | 'nostr' | 'blossom';
type CheckState = 'idle' | 'running' | 'ok' | 'error';
type Status = Record<Section, CheckState>;
type Errors = Partial<Record<Section, string>>;

function relayHttpUrl(relay: string): string {
  return relay.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
}

async function withTimeout<T>(promise: Promise<T>, label: string, milliseconds = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds / 1000} seconds`)), milliseconds);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function computeCryptoResult(): Promise<CheckResult> {
  const started = Date.now();
  try {
    const key = expoRandom.randomBytes(32);
    const nonce = expoRandom.randomBytes(12);
    const aad = new Uint8Array([1, 2, 3, 4]);
    const plaintext = expoRandom.randomBytes(1024 * 1024);
    const sealed = await expoAesGcm.encrypt(key, nonce, plaintext, aad);
    const opened = await expoAesGcm.decrypt(key, nonce, sealed, aad);
    const ok = bytesEqual(plaintext, opened);
    return {
      label: 'AES-256-GCM round trip (1 MiB)',
      ok,
      detail: ok ? `Verified in ${Date.now() - started} ms` : 'Decrypted bytes differ from plaintext',
    };
  } catch (error) {
    return { label: 'AES-256-GCM round trip', ok: false, detail: error instanceof Error ? error.message : 'Unknown error' };
  }
}

async function computeRelayResults(): Promise<CheckResult[]> {
  return Promise.all(
    DEFAULT_RELAY_LIST.map(async (relay): Promise<CheckResult> => {
      const started = Date.now();
      try {
        const response = await withTimeout(
          fetch(relayHttpUrl(relay), { headers: { Accept: 'application/nostr+json' } }),
          `${relay} NIP-11`,
          8_000
        );
        const latency = Date.now() - started;
        if (!response.ok) return { label: relay, ok: false, detail: `HTTP ${response.status} · ${latency} ms` };
        const info = (await response.json().catch(() => ({}))) as { name?: string; software?: string };
        return {
          label: relay,
          ok: true,
          detail: `${info.name ?? 'relay'}${info.software ? ` · ${info.software}` : ''} · ${latency} ms`,
        };
      } catch (error) {
        return { label: relay, ok: false, detail: error instanceof Error ? error.message : 'Unreachable' };
      }
    })
  );
}

async function computeProviderResults(): Promise<CheckResult[]> {
  return Promise.all(
    PROVIDER_PRESETS.map(async (preset): Promise<CheckResult> => {
      const label = `${preset.name} (${preset.url})`;
      try {
        const client = new BlossomClient(preset.url);
        const probe = await withTimeout(client.probe(), `${preset.name} probe`, 8_000);
        const discovery = await withTimeout(client.discover(), `${preset.name} discovery`, 8_000);
        const mirror = await withTimeout(client.mirrorSupport(), `${preset.name} mirror`, 8_000).catch(
          () => null
        );
        const reason = probe.detail ? probe.detail.slice(0, 80) : undefined;
        return {
          label,
          ok: probe.ok,
          detail: probe.ok
            ? `UP · ${probe.latencyMs} ms · PUT ${discovery.put ? 'yes' : 'no'} · HEAD ${discovery.head ? 'yes' : 'no'} · MIRROR ${mirror ?? 'no'}`
            : `${probe.kind ?? 'unreachable'}${probe.status ? ` ${probe.status}` : ''}${reason ? ` · ${reason}` : ''}`,
        };
      } catch (error) {
        return { label, ok: false, detail: error instanceof Error ? error.message : 'Unreachable' };
      }
    })
  );
}

export default function LabScreen() {
  const theme = useTheme();
  const [cryptoResult, setCryptoResult] = useState<CheckResult | null>(null);
  const [relayResults, setRelayResults] = useState<CheckResult[] | null>(null);
  const [providerResults, setProviderResults] = useState<CheckResult[] | null>(null);
  const [status, setStatus] = useState<Status>({ crypto: 'idle', nostr: 'idle', blossom: 'idle' });
  const [errors, setErrors] = useState<Errors>({});
  const [notificationInfo, setNotificationInfo] = useState<{
    permission: boolean;
    status: string;
    registered: boolean;
  } | null>(null);
  const [notificationBusy, setNotificationBusy] = useState<string | null>(null);
  const [notificationNotice, setNotificationNotice] = useState<string | null>(null);
  const running = useRef(false);

  const runAll = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setStatus({ crypto: 'running', nostr: 'running', blossom: 'running' });
    setErrors({});

    const runSection = async (section: Section, check: () => Promise<void>) => {
      try {
        await withTimeout(check(), section);
        setStatus((current) => ({ ...current, [section]: 'ok' }));
      } catch (error) {
        setStatus((current) => ({ ...current, [section]: 'error' }));
        setErrors((current) => ({ ...current, [section]: error instanceof Error ? error.message : 'Check failed' }));
      }
    };

    await Promise.all([
      runSection('crypto', async () => {
        const result = await computeCryptoResult();
        setCryptoResult(result);
        if (!result.ok) throw new Error(result.detail);
      }),
      runSection('nostr', async () => setRelayResults(await computeRelayResults())),
      runSection('blossom', async () => setProviderResults(await computeProviderResults())),
    ]);
    running.current = false;
  }, []);

  useEffect(() => {
    void runAll();
  }, [runAll]);

  const refreshNotificationInfo = useCallback(async () => {
    const [permission, background] = await Promise.all([
      getNotificationPermissionAsync(),
      getInboxBackgroundTaskStateAsync(),
    ]);
    const statusLabel =
      background.status === BackgroundTask.BackgroundTaskStatus.Restricted
        ? 'Restricted'
        : background.status === BackgroundTask.BackgroundTaskStatus.Available
          ? 'Available'
          : 'Unknown';
    setNotificationInfo({ permission, status: statusLabel, registered: background.registered });
  }, []);

  useEffect(() => {
    void refreshNotificationInfo();
  }, [refreshNotificationInfo]);

  const runNotificationAction = async (key: string, action: () => Promise<string>) => {
    if (notificationBusy) return;
    setNotificationBusy(key);
    setNotificationNotice(null);
    try {
      setNotificationNotice(await action());
    } catch (error) {
      setNotificationNotice(error instanceof Error ? error.message : 'The action failed');
    } finally {
      setNotificationBusy(null);
      void refreshNotificationInfo();
    }
  };

  const busy = Object.values(status).some((value) => value === 'running');

  return (
    <ScreenScroll>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: theme.spacing.sm }}>
        <IconButton icon="arrow-left" label="Back to Profile" onPress={() => router.back()} />
        <AppText variant="meta" color="textSecondary">DEVELOPER TOOL</AppText>
        <View style={{ width: theme.layout.minTouchTarget }} />
      </View>
      <PageHeader title="Protocol lab" />
      <View style={{ gap: theme.spacing.md, paddingBottom: theme.spacing.xxxl }}>
        <CheckCard title="Cryptography" state={status.crypto} error={errors.crypto}>
          {cryptoResult ? <ResultRow result={cryptoResult} /> : null}
          <AppText variant="caption" color="textTertiary">Uses the platform AES implementation with a fresh random key and nonce. This checks the primitive, not the full media pipeline.</AppText>
        </CheckCard>
        <CheckCard title="Relays · NIP-11" state={status.nostr} error={errors.nostr}>
          {relayResults?.map((result) => <ResultRow key={result.label} result={result} />)}
          <AppText variant="caption" color="textTertiary">Reachability does not guarantee relay policy accepts gift wraps or serves them after NIP-42 auth.</AppText>
        </CheckCard>
        <CheckCard title="Encrypted storage · Blossom" state={status.blossom} error={errors.blossom}>
          {providerResults?.map((result) => <ResultRow key={result.label} result={result} />)}
          <AppText variant="caption" color="textTertiary">Observed limits come from earlier probes. Free tiers can change without notice.</AppText>
          {PROVIDER_PRESETS.map((preset) => (
            <AppText key={preset.url} variant="caption" color="textTertiary">
              {preset.name}: {preset.observedMaxBytes ? `${formatBytes(preset.observedMaxBytes)} advertised` : 'no advertised limit seen'}
            </AppText>
          ))}
        </CheckCard>
        {__DEV__ ? (
          <Card>
            <View style={{ gap: theme.spacing.md }}>
              <AppText variant="bodyStrong">Notifications</AppText>
              <AppText variant="caption" color="textSecondary">
                Permission: {notificationInfo ? (notificationInfo.permission ? 'granted' : 'not granted') : 'checking'}
                {' · '}Background: {notificationInfo?.status ?? 'checking'}
                {' · '}Task: {notificationInfo ? (notificationInfo.registered ? 'registered' : 'not registered') : 'checking'}
              </AppText>
              {notificationNotice ? (
                <AppText variant="caption" color="textSecondary" accessibilityLiveRegion="polite">
                  {notificationNotice}
                </AppText>
              ) : null}
              <Button
                label="Run background check now"
                variant="secondary"
                fullWidth
                loading={notificationBusy === 'worker'}
                disabled={Boolean(notificationBusy)}
                onPress={() =>
                  void runNotificationAction('worker', async () => {
                    await BackgroundTask.triggerTaskWorkerForTestingAsync();
                    return 'Background worker triggered.';
                  })
                }
              />
              <Button
                label="Send test notification"
                variant="secondary"
                fullWidth
                loading={notificationBusy === 'test'}
                disabled={Boolean(notificationBusy)}
                onPress={() =>
                  void runNotificationAction('test', async () => {
                    const scheduled = await sendTestNotificationAsync();
                    return scheduled ? 'Test notification scheduled.' : 'Notification could not be scheduled.';
                  })
                }
              />
              <Button
                label="Clear badge"
                variant="ghost"
                fullWidth
                loading={notificationBusy === 'badge'}
                disabled={Boolean(notificationBusy)}
                onPress={() =>
                  void runNotificationAction('badge', async () => {
                    await clearIconBadgeAsync();
                    return 'Icon badge cleared.';
                  })
                }
              />
            </View>
          </Card>
        ) : null}
        <Button label={busy ? 'Running all checks' : 'Run all checks again'} loading={busy} fullWidth onPress={() => void runAll()} />
      </View>
    </ScreenScroll>
  );
}

function CheckCard({
  title,
  state,
  error,
  children,
}: {
  title: string;
  state: CheckState;
  error?: string;
  children?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <Card>
      <View style={{ gap: theme.spacing.md }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.spacing.md }}>
          <AppText variant="bodyStrong" style={{ flex: 1 }}>{title}</AppText>
          <AppText variant="caption" color={state === 'error' ? 'danger' : state === 'ok' ? 'success' : 'textSecondary'} accessibilityLiveRegion="polite">
            {state === 'running' ? 'Checking…' : state === 'ok' ? 'Complete' : state === 'error' ? 'Timed out / failed' : 'Waiting'}
          </AppText>
        </View>
        {error ? <AppText variant="caption" color="danger">{error}</AppText> : null}
        {children}
      </View>
    </Card>
  );
}

function ResultRow({ result }: { result: CheckResult }) {
  const theme = useTheme();
  return (
    <View style={{ paddingVertical: theme.spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: result.ok ? theme.colors.success : result.ok === false ? theme.colors.danger : theme.colors.textTertiary }} />
        <AppText variant="bodyStrong" style={{ flex: 1 }}>{result.label}</AppText>
      </View>
      <AppText variant="caption" color="textSecondary" style={{ marginLeft: theme.spacing.lg }}>{result.detail}</AppText>
      <Divider inset={theme.spacing.lg} />
    </View>
  );
}
