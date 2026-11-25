import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Feather from '@expo/vector-icons/Feather';

import { exportIdentitySecret } from '../../lib/nostr/identity';
import { useTheme } from '../../theme/ThemeProvider';
import { AppText } from './AppText';
import { Button } from './Button';
import { InlineNotice } from './Notice';
import { LoadingState } from './States';

export function RecoveryKeyPanel({
  identityId,
  recoveryKey,
  onAcknowledge,
  acknowledgeLabel = "I’ve saved my recovery key",
}: {
  identityId: string;
  recoveryKey?: string;
  onAcknowledge?: () => Promise<void> | void;
  acknowledgeLabel?: string;
}) {
  const theme = useTheme();
  const [loaded, setLoaded] = useState<{ identityId: string; value: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (recoveryKey) return;
    let cancelled = false;
    exportIdentitySecret(identityId)
      .then((value) => {
        if (!cancelled) setLoaded({ identityId, value });
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'The recovery key could not be opened');
      });
    return () => {
      cancelled = true;
    };
  }, [identityId, recoveryKey, attempt]);

  const acknowledge = async () => {
    if (!onAcknowledge) return;
    setAcknowledging(true);
    setError(null);
    try {
      await onAcknowledge();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The acknowledgment could not be saved');
    } finally {
      setAcknowledging(false);
    }
  };

  const revealed = recoveryKey ?? (loaded?.identityId === identityId ? loaded.value : null);

  if (!revealed && !error) return <LoadingState label="Opening your recovery key from secure storage" />;

  return (
    <View style={{ gap: theme.spacing.lg }}>
      <AppText variant="title">Save your recovery key</AppText>
      <AppText variant="body" color="textSecondary">Only this key can restore your identity. Folio cannot reset it.</AppText>
      {error ? <InlineNotice message={error} tone="error" /> : null}
      {error && !revealed ? (
        <Button
          label="Try opening the key again"
          variant="secondary"
          onPress={() => {
            setError(null);
            setAttempt((value) => value + 1);
          }}
        />
      ) : null}
      {revealed ? (
        <View
          accessibilityLabel={`Recovery key: ${revealed}`}
          style={{ padding: theme.spacing.xl, backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border }}
        >
          <AppText variant="mono" selectable>{revealed}</AppText>
        </View>
      ) : null}
      <Button
        label={copied ? 'Recovery key copied' : 'Copy recovery key'}
        variant="secondary"
        fullWidth
        disabled={!revealed}
        icon={<Feather name={copied ? 'check' : 'copy'} size={17} color={theme.colors.textPrimary} />}
        onPress={() => {
          if (!revealed) return;
          Clipboard.setStringAsync(revealed)
            .then(() => setCopied(true))
            .catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not copy the recovery key'));
        }}
      />
      <AppText variant="caption" color="textSecondary">
        Keep it private and offline. Anyone with it controls your identity.
      </AppText>
      {onAcknowledge ? (
        <Button
          label={acknowledgeLabel}
          size="lg"
          fullWidth
          loading={acknowledging}
          disabled={!revealed}
          onPress={() => void acknowledge()}
        />
      ) : null}
    </View>
  );
}
