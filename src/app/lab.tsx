import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AppText } from '../components/ui/AppText';
import { Button } from '../components/ui/Button';
import { Card, Divider } from '../components/ui/Card';
import { ScreenScroll } from '../components/ui/Screen';
import { SectionHeader } from '../components/ui/Layout';
import { DEFAULT_RELAY_LIST, PROVIDER_PRESETS } from '../constants/providers';
import { BlossomClient } from '../lib/blossom/client';
import { expoAesGcm, expoRandom } from '../lib/crypto/expoAes';
import { bytesEqual } from '../lib/crypto/bytes';
import { useTheme } from '../theme/ThemeProvider';
import { formatBytes } from '../utils/time';

interface CheckResult {
  label: string;
  ok: boolean | null;
  detail: string;
}

function relayHttpUrl(relay: string): string {
  return relay.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
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
    return {
      label: 'AES-256-GCM round trip',
      ok: false,
      detail: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function computeRelayResults(): Promise<CheckResult[]> {
  return Promise.all(
    DEFAULT_RELAY_LIST.map(async (relay): Promise<CheckResult> => {
      const started = Date.now();
      try {
        const response = await fetch(relayHttpUrl(relay), {
          headers: { Accept: 'application/nostr+json' },
        });
        const latency = Date.now() - started;
        if (!response.ok) {
          return { label: relay, ok: false, detail: `HTTP ${response.status} · ${latency} ms` };
        }
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
      const client = new BlossomClient(preset.url);
      const health = await client.health();
      const discovery = await client.discover();
      return {
        label: `${preset.name} (${preset.url})`,
        ok: health.ok,
        detail: health.ok
          ? `UP · ${health.latencyMs ?? '?'} ms · PUT ${discovery.put ? 'yes' : 'no'} · HEAD ${discovery.head ? 'yes' : 'no'}`
          : 'Unreachable',
      };
    })
  );
}

export default function LabScreen() {
  const theme = useTheme();
  const [cryptoResult, setCryptoResult] = useState<CheckResult | null>(null);
  const [relayResults, setRelayResults] = useState<CheckResult[] | null>(null);
  const [providerResults, setProviderResults] = useState<CheckResult[] | null>(null);
  const [busy, setBusy] = useState(true);

  const runAll = useCallback(async () => {
    setBusy(true);
    const [crypto, relays, providers] = await Promise.all([
      computeCryptoResult(),
      computeRelayResults(),
      computeProviderResults(),
    ]);
    setCryptoResult(crypto);
    setRelayResults(relays);
    setProviderResults(providers);
    setBusy(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([computeCryptoResult(), computeRelayResults(), computeProviderResults()])
      .then(([crypto, relays, providers]) => {
        if (cancelled) return;
        setCryptoResult(crypto);
        setRelayResults(relays);
        setProviderResults(providers);
        setBusy(false);
      })
      .catch(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ScreenScroll>
      <View style={{ paddingTop: theme.spacing.xl, gap: theme.spacing.xs }}>
        <AppText variant="title">Protocol lab</AppText>
        <AppText variant="caption" color="textSecondary">
          Honest diagnostics: what works on this device and network right now.
        </AppText>
      </View>

      <SectionHeader
        title="Cryptography"
        action={
          busy ? <ActivityIndicator size="small" color={theme.colors.textSecondary} /> : <Button label="Run again" variant="ghost" onPress={() => { runAll().catch(() => undefined); }} />
        }
      />
      <Card>
        {cryptoResult ? (
          <ResultRow result={cryptoResult} />
        ) : (
          <AppText variant="caption" color="textSecondary">
            Running…
          </AppText>
        )}
        <View style={{ marginTop: theme.spacing.md }}>
          <AppText variant="caption" color="textTertiary">
            Uses the platform AES implementation through expo-crypto with a fresh random key and nonce. This checks the
            primitive, not the full media pipeline.
          </AppText>
        </View>
      </Card>

      <SectionHeader title="Relays (NIP-11)" />
      <Card>
        {relayResults ? relayResults.map((result) => <ResultRow key={result.label} result={result} />) : <AppText variant="caption" color="textSecondary">Checking…</AppText>}
        <View style={{ marginTop: theme.spacing.md }}>
          <AppText variant="caption" color="textTertiary">
            Reachability here does not guarantee relay policy accepts gift wraps or serves them after NIP-42 auth.
          </AppText>
        </View>
      </Card>

      <SectionHeader title="Blossom providers" />
      <Card>
        {providerResults ? (
          providerResults.map((result) => <ResultRow key={result.label} result={result} />)
        ) : (
          <AppText variant="caption" color="textSecondary">
            Checking…
          </AppText>
        )}
        <View style={{ marginTop: theme.spacing.md, gap: theme.spacing.xs }}>
          <AppText variant="caption" color="textTertiary">
            Observed limits from the Phase 1 probe. Free tiers change without notice.
          </AppText>
          {PROVIDER_PRESETS.map((preset) => (
            <AppText key={preset.url} variant="caption" color="textTertiary">
              {preset.name}: {preset.observedMaxBytes ? `${formatBytes(preset.observedMaxBytes)} advertised` : 'no advertised limit seen'}
            </AppText>
          ))}
        </View>
      </Card>
    </ScreenScroll>
  );
}

function ResultRow({ result }: { result: CheckResult }) {
  const theme = useTheme();
  return (
    <View style={{ paddingVertical: theme.spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <View
          style={{
            width: 7,
            height: 7,
            borderRadius: 4,
            backgroundColor: result.ok ? theme.colors.success : result.ok === false ? theme.colors.danger : theme.colors.textTertiary,
          }}
        />
        <AppText variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
          {result.label}
        </AppText>
      </View>
      <AppText variant="caption" color="textSecondary" style={{ marginLeft: theme.spacing.lg }}>
        {result.detail}
      </AppText>
      <Divider inset={theme.spacing.lg} />
    </View>
  );
}
