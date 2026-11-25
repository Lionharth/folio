import React, { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';
import * as Clipboard from 'expo-clipboard';

import { AppText } from '../../components/ui/AppText';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Card, Divider } from '../../components/ui/Card';
import { ScreenScroll } from '../../components/ui/Screen';
import { TextField } from '../../components/ui/TextField';
import { LoadingState } from '../../components/ui/States';
import {
  getCircle,
  listCircleMembers,
  removeCircleMember,
  setCircleMuted,
} from '../../lib/database/vlogs';
import { listContactNames } from '../../lib/database/contacts';
import { pubkeyFromInput, shortNpub } from '../../lib/nostr/format';
import { readSecretKey } from '../../lib/nostr/identity';
import { inviteMember, resendInvite } from '../../services/circles';
import { useSession } from '../../stores/session';
import { useTheme } from '../../theme/ThemeProvider';

export default function CircleDetailScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const identity = useSession((state) => state.identity);
  const { id } = useLocalSearchParams<{ id: string }>();
  const [memberInput, setMemberInput] = useState('');
  const [busy, setBusy] = useState(false);

  const contactsQuery = useQuery({ queryKey: ['contact-names'], queryFn: listContactNames });

  const detailQuery = useQuery({
    queryKey: ['circle', id],
    queryFn: async () => {
      const circle = await getCircle(id);
      const members = await listCircleMembers(id);
      return { circle, members };
    },
  });

  const circle = detailQuery.data?.circle ?? null;
  const members = detailQuery.data?.members ?? [];
  const isOwner = circle?.ownerPubkey === identity?.pubkey;
  const nameFor = (pubkey: string) =>
    pubkey === identity?.pubkey ? (identity?.label ?? 'You') : (contactsQuery.data?.[pubkey] ?? shortNpub(pubkey));

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['circle', id] }),
      queryClient.invalidateQueries({ queryKey: ['circles-with-members'] }),
      queryClient.invalidateQueries({ queryKey: ['circles'] }),
    ]);
  };

  const addMember = async () => {
    const pubkey = pubkeyFromInput(memberInput);
    if (!pubkey) {
      Alert.alert('That invite key looks wrong', 'Use an npub or a 64-character public key.');
      return;
    }
    if (pubkey === identity?.pubkey) {
      Alert.alert('That is you', 'You are already in every circle you own.');
      return;
    }
    if (!identity) return;
    setBusy(true);
    try {
      const secretKey = await readSecretKey(identity.id);
      await inviteMember({ secretKey, circleId: id, memberPubkey: pubkey, ownerName: identity.label });
      setMemberInput('');
      await invalidate();
      Alert.alert('Invitation sent', 'They will see the circle on their device after their next sync.');
    } catch (error) {
      Alert.alert(
        'Could not send the invitation',
        error instanceof Error
          ? `${error.message}\n\nNo member was added. Check your connection and try again.`
          : 'Unknown error'
      );
    } finally {
      setBusy(false);
    }
  };

  const resend = async (pubkey: string) => {
    if (!identity) return;
    setBusy(true);
    try {
      const secretKey = await readSecretKey(identity.id);
      await resendInvite({ secretKey, circleId: id, memberPubkey: pubkey, ownerName: identity.label });
      await invalidate();
      Alert.alert('Invitation resent', 'They will see it after their next sync.');
    } catch (error) {
      Alert.alert('Could not resend', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const removeMember = (pubkey: string) => {
    Alert.alert('Remove from circle?', 'They will not receive keys for future posts. Media they already saved stays on their device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await removeCircleMember(id, pubkey);
          await invalidate();
        },
      },
    ]);
  };

  if (detailQuery.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <LoadingState label="Opening circle" />
      </View>
    );
  }

  if (!circle) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: theme.layout.screenMargin }}>
        <AppText variant="title">Circle not found</AppText>
        <View style={{ marginTop: theme.spacing.lg }}>
          <Button label="Back" variant="secondary" onPress={() => router.back()} />
        </View>
      </View>
    );
  }

  return (
    <ScreenScroll>
      <View style={{ paddingTop: theme.spacing.md }}>
        <Button label="Back" variant="ghost" onPress={() => router.back()} />
      </View>
      <View style={{ gap: theme.spacing.xs, marginTop: theme.spacing.sm }}>
        <AppText variant="display">{circle.name}</AppText>
        {circle.description ? (
          <AppText variant="body" color="textSecondary">
            {circle.description}
          </AppText>
        ) : null}
        <AppText variant="meta" color="textTertiary">
          MEMBERSHIP V{circle.membershipVersion} · {members.length} {members.length === 1 ? 'MEMBER' : 'MEMBERS'}
        </AppText>
      </View>

      <View style={{ flexDirection: 'row', gap: theme.spacing.md, marginTop: theme.spacing.xl }}>
        <Button
          label={circle.muted ? 'Unmute circle' : 'Mute circle'}
          variant="secondary"
          onPress={async () => {
            await setCircleMuted(id, !circle.muted);
            await invalidate();
          }}
        />
        <Button
          label="Copy circle ID"
          variant="ghost"
          onPress={async () => {
            await Clipboard.setStringAsync(circle.id);
          }}
        />
      </View>

      <View style={{ marginTop: theme.spacing.xxxl }}>
        <AppText variant="label" color="textSecondary">
          MEMBERS
        </AppText>
        <View style={{ marginTop: theme.spacing.sm }}>
          {members.map((member, index) => (
            <View key={member.pubkey}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: theme.spacing.lg }}>
                <Avatar name={nameFor(member.pubkey)} />
                <View style={{ flex: 1 }}>
                  <AppText variant="bodyStrong">
                    {member.pubkey === identity?.pubkey ? 'You' : nameFor(member.pubkey)}
                  </AppText>
                  <AppText variant="caption" color="textSecondary">
                    {member.role} · {member.status === 'invited' ? 'invitation pending' : member.status}
                  </AppText>
                </View>
                {isOwner && member.pubkey !== identity?.pubkey && member.status === 'invited' ? (
                  <Pressable
                    onPress={() => resend(member.pubkey)}
                    accessibilityLabel="Resend invitation"
                    style={{ width: theme.layout.minTouchTarget, height: theme.layout.minTouchTarget, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Feather name="send" size={18} color={theme.colors.textSecondary} />
                  </Pressable>
                ) : null}
                {isOwner && member.pubkey !== identity?.pubkey ? (
                  <Pressable
                    onPress={() => removeMember(member.pubkey)}
                    accessibilityLabel="Remove member"
                    style={{ width: theme.layout.minTouchTarget, height: theme.layout.minTouchTarget, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Feather name="user-minus" size={18} color={theme.colors.textTertiary} />
                  </Pressable>
                ) : null}
              </View>
              {index < members.length - 1 ? <Divider /> : null}
            </View>
          ))}
        </View>
      </View>

      {isOwner ? (
        <Card style={{ marginTop: theme.spacing.xxl }}>
          <View style={{ gap: theme.spacing.md }}>
            <AppText variant="bodyStrong">Invite a friend</AppText>
            <AppText variant="caption" color="textSecondary">
              Ask them for their Folio ID from Profile, then add it here. The invitation is sent privately; the circle
              appears on their device after they sync and accept. Media shared before they joined is not resent.
            </AppText>
            <TextField
              label="Folio ID"
              placeholder="npub1…"
              value={memberInput}
              onChangeText={setMemberInput}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Button label="Send invitation" variant="secondary" loading={busy} onPress={addMember} />
          </View>
        </Card>
      ) : null}

      <View style={{ marginTop: theme.spacing.xxl, gap: theme.spacing.sm }}>
        <AppText variant="label" color="textSecondary">
          A NOTE ON REMOVAL
        </AppText>
        <AppText variant="caption" color="textTertiary">
          Removing someone stops future keys from reaching them. It cannot erase videos they already downloaded, and
          Folio does not pretend otherwise.
        </AppText>
      </View>
    </ScreenScroll>
  );
}
