import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';

import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ScreenScroll } from '../../components/ui/Screen';
import { TextField } from '../../components/ui/TextField';
import { createIdentity, exportIdentitySecret } from '../../lib/nostr/identity';
import { useSession } from '../../stores/session';
import { useTheme } from '../../theme/ThemeProvider';

export default function NewIdentityScreen() {
  const theme = useTheme();
  const refresh = useSession((state) => state.refresh);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ nsec: string } | null>(null);

  const create = async () => {
    setBusy(true);
    try {
      const identity = await createIdentity(name.trim() || 'Friend');
      const nsec = await exportIdentitySecret(identity.id);
      setCreated({ nsec });
      await refresh();
    } catch (error) {
      Alert.alert('Could not create identity', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <ScreenScroll>
        <View style={{ paddingTop: theme.spacing.xl, gap: theme.spacing.lg }}>
          <AppText variant="title">Identity created</AppText>
          <AppText variant="body" color="textSecondary">
            Copy the recovery key below if you want to restore this test identity elsewhere.
          </AppText>
          <Card>
            <AppText variant="mono">{created.nsec}</AppText>
          </Card>
          <Button label="Done" onPress={() => router.back()} />
        </View>
      </ScreenScroll>
    );
  }

  return (
    <ScreenScroll>
      <View style={{ paddingTop: theme.spacing.xl, gap: theme.spacing.lg }}>
        <AppText variant="title">Another identity</AppText>
        <AppText variant="body" color="textSecondary">
          This creates a completely separate Folio identity on this device. Useful for walking through the flow as two
          people.
        </AppText>
        <TextField label="Name" placeholder="Friend" value={name} onChangeText={setName} autoFocus maxLength={40} />
        <Button label="Create identity" loading={busy} onPress={create} />
        <Button label="Import a recovery key instead" variant="ghost" onPress={() => router.push('/onboarding/import')} />
        <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
      </View>
    </ScreenScroll>
  );
}
