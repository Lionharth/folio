import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { randomUUID } from 'expo-crypto';

import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Screen } from '../../components/ui/Screen';
import { TextField } from '../../components/ui/TextField';
import { createCircle } from '../../lib/database/vlogs';
import { pubkeyFromInput } from '../../lib/nostr/format';
import { readSecretKey } from '../../lib/nostr/identity';
import { inviteMember } from '../../services/circles';
import { useSession } from '../../stores/session';
import { useTheme } from '../../theme/ThemeProvider';

export default function NewCircleScreen() {
  const theme = useTheme();
  const identity = useSession((state) => state.identity);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [memberInput, setMemberInput] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!identity) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert('Name your circle', 'A circle needs a name, even a private one.');
      return;
    }
    let memberPubkey: string | null = null;
    if (memberInput.trim()) {
      memberPubkey = pubkeyFromInput(memberInput);
      if (!memberPubkey) {
        Alert.alert('That invite key looks wrong', 'Use an npub or a 64-character public key.');
        return;
      }
    }
    setBusy(true);
    try {
      const circle = await createCircle({
        id: randomUUID(),
        ownerPubkey: identity.pubkey,
        name: trimmedName,
        description: description.trim() || undefined,
        members: [],
      });
      if (memberPubkey) {
        try {
          const secretKey = await readSecretKey(identity.id);
          await inviteMember({ secretKey, circleId: circle.id, memberPubkey, ownerName: identity.label });
        } catch (inviteError) {
          Alert.alert(
            'Circle created, invitation not sent',
            inviteError instanceof Error
              ? `${inviteError.message}\n\nOpen the circle to resend the invitation.`
              : 'Open the circle to resend the invitation.'
          );
        }
      }
      router.replace({ pathname: '/circle/[id]', params: { id: circle.id } });
    } catch (error) {
      Alert.alert('Could not create the circle', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ flex: 1, paddingTop: theme.spacing.xxl, gap: theme.spacing.xl }}>
        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="title">New circle</AppText>
          <AppText variant="body" color="textSecondary">
            Circles are private by default. You choose exactly who is inside.
          </AppText>
        </View>
        <TextField label="Name" placeholder="Close friends" value={name} onChangeText={setName} maxLength={48} autoFocus />
        <TextField
          label="Description (optional)"
          placeholder="Sunday walks, coffee, the small stuff."
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={200}
        />
        <TextField
          label="Invite a friend (optional)"
          placeholder="npub1…"
          value={memberInput}
          onChangeText={setMemberInput}
          autoCapitalize="none"
          autoCorrect={false}
          hint="They can also be added later from the circle screen."
        />
        <Button label="Create circle" size="lg" fullWidth loading={busy} onPress={create} />
        <Button label="Cancel" variant="ghost" fullWidth onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
