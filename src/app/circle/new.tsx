import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { router, usePreventRemove } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useQueryClient } from '@tanstack/react-query';

import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { IconButton } from '../../components/ui/IconButton';
import { ScreenScroll } from '../../components/ui/Screen';
import { TextField } from '../../components/ui/TextField';
import { createCircle } from '../../lib/database/vlogs';
import { pubkeyFromInput } from '../../lib/nostr/format';
import { readSecretKey } from '../../lib/nostr/identity';
import { invalidateCircles } from '../../lib/queryKeys';
import { inviteMember } from '../../services/circles';
import { useSession } from '../../stores/session';
import { useTheme } from '../../theme/ThemeProvider';

export default function NewCircleScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const identity = useSession((state) => state.identity);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [memberInput, setMemberInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);
  const disableRemovalPrevention = usePreventRemove(busy, () => {
    Alert.alert('Creating this circle', 'Wait for the circle and invitation request to finish before leaving.');
  });

  const create = async () => {
    if (!identity || busy) return;
    const trimmedName = name.trim();
    setNameError(trimmedName ? null : 'Give this circle a name.');
    const memberPubkey = memberInput.trim() ? pubkeyFromInput(memberInput) : null;
    setMemberError(memberInput.trim() && !memberPubkey ? 'Use an npub or a 64-character public key.' : null);
    if (!trimmedName || (memberInput.trim() && !memberPubkey)) return;

    setBusy(true);
    try {
      const circle = await createCircle({
        id: randomUUID(),
        ownerPubkey: identity.pubkey,
        name: trimmedName,
        description: description.trim() || undefined,
        members: [],
      });
      await invalidateCircles(queryClient, identity.pubkey);
      if (memberPubkey) {
        try {
          const secretKey = await readSecretKey(identity.id);
          await inviteMember({ secretKey, circleId: circle.id, memberPubkey, ownerName: identity.label });
        } catch (inviteError) {
          await new Promise<void>((resolve) => {
            Alert.alert(
              'Circle created, invitation not sent',
              inviteError instanceof Error
                ? `${inviteError.message}\n\nOpen the circle to resend the invitation.`
                : 'Open the circle to resend the invitation.',
              [{ text: 'Continue to circle', onPress: () => resolve() }],
              { cancelable: false }
            );
          });
        }
      }
      disableRemovalPrevention();
      router.replace({ pathname: '/circle/[id]', params: { id: circle.id } });
    } catch (error) {
      Alert.alert('Could not create the circle', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenScroll>
      <View style={{ paddingTop: theme.spacing.sm }}>
        <IconButton icon="arrow-left" label="Cancel new circle" onPress={() => router.back()} disabled={busy} />
      </View>
      <View style={{ paddingTop: theme.spacing.xxl, gap: theme.spacing.xl }}>
        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="title">New circle</AppText>
          <AppText variant="body" color="textSecondary">Only invited people can join.</AppText>
        </View>
        <TextField
          label="Circle name"
          placeholder="Close friends"
          value={name}
          onChangeText={(value) => { setName(value); setNameError(null); }}
          maxLength={48}
          error={nameError}
          editable={!busy}
        />
        <TextField
          label="Description (optional)"
          placeholder="Sunday walks, coffee, the small stuff."
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={200}
          editable={!busy}
        />
        <TextField
          label="Invite a friend (optional)"
          placeholder="npub1…"
          value={memberInput}
          onChangeText={(value) => { setMemberInput(value); setMemberError(null); }}
          autoCapitalize="none"
          autoCorrect={false}
          error={memberError}
          editable={!busy}
        />
        <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.md }}>
          <Button label="Create circle" size="lg" fullWidth loading={busy} onPress={() => void create()} />
          <Button label="Cancel" variant="ghost" fullWidth disabled={busy} onPress={() => router.back()} />
        </View>
      </View>
    </ScreenScroll>
  );
}
