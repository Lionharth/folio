import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';

import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { PageHeader } from '../../components/ui/Layout';
import { Screen } from '../../components/ui/Screen';
import { listPendingInvites, type CircleInvite } from '../../lib/database/invites';
import { listCircleMembers, listCirclesForViewer } from '../../lib/database/vlogs';
import { readSecretKey } from '../../lib/nostr/identity';
import { shortNpub } from '../../lib/nostr/format';
import { acceptInvite, declineInvite } from '../../services/circles';
import { refreshInbox } from '../../services/inbox';
import { useSession } from '../../stores/session';
import { useTheme } from '../../theme/ThemeProvider';

export default function CirclesScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const identity = useSession((state) => state.identity);
  const [syncing, setSyncing] = useState(false);
  const [handlingInviteId, setHandlingInviteId] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const circlesQuery = useQuery({
    queryKey: ['circles-with-members', identity?.pubkey],
    queryFn: async () => {
      const circles = await listCirclesForViewer(identity!.pubkey);
      return Promise.all(
        circles.map(async (circle) => ({
          ...circle,
          members: await listCircleMembers(circle.id),
        }))
      );
    },
    enabled: Boolean(identity),
  });

  const invitesQuery = useQuery({ queryKey: ['circle-invites'], queryFn: listPendingInvites });

  const circles = circlesQuery.data ?? [];
  const invites = invitesQuery.data ?? [];

  const invalidateAll = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['circle-invites'] }),
      queryClient.invalidateQueries({ queryKey: ['circles-with-members'] }),
      queryClient.invalidateQueries({ queryKey: ['circles'] }),
      queryClient.invalidateQueries({ queryKey: ['circle'] }),
    ]);
  }, [queryClient]);

  const sync = useCallback(async () => {
    if (!identity || syncing) return;
    setSyncing(true);
    setSyncMessage(null);
    try {
      const secretKey = await readSecretKey(identity.id);
      const result = await refreshInbox(secretKey);
      await invalidateAll();
      if (result.invites > 0) setSyncMessage(`${result.invites} invitation${result.invites === 1 ? '' : 's'} found`);
      else if (result.accepted > 0) setSyncMessage('Membership updated');
      else setSyncMessage('No new invitations');
    } catch (error) {
      setSyncMessage(null);
      Alert.alert('Could not sync', error instanceof Error ? error.message : 'Your relays did not respond');
    } finally {
      setSyncing(false);
    }
  }, [identity, syncing, invalidateAll]);

  const accept = async (invite: CircleInvite) => {
    if (!identity) return;
    setHandlingInviteId(invite.id);
    try {
      const secretKey = await readSecretKey(identity.id);
      const result = await acceptInvite({ secretKey, inviteId: invite.id, memberName: identity.label });
      await invalidateAll();
      Alert.alert(
        `Joined ${result.circleName}`,
        result.ownerNotified
          ? 'The owner has been notified. New posts will arrive in Updates.'
          : 'The circle was added on this device. The owner will see you after their next sync.'
      );
    } catch (error) {
      Alert.alert('Could not accept', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setHandlingInviteId(null);
    }
  };

  const decline = (invite: CircleInvite) => {
    Alert.alert('Decline invitation?', `You will not join ${invite.name}.`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Decline',
        style: 'destructive',
        onPress: async () => {
          await declineInvite(invite);
          await invalidateAll();
        },
      },
    ]);
  };

  const header = (
    <View style={{ paddingHorizontal: theme.layout.screenMargin }}>
      <PageHeader
        title="Circles"
        subtitle={syncMessage ?? 'Private groups of friends'}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Pressable
              onPress={() => router.push('/circle/new')}
              accessibilityRole="button"
              accessibilityLabel="Create a circle"
              style={{
                width: theme.layout.minTouchTarget,
                height: theme.layout.minTouchTarget,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Feather name="plus" size={22} color={theme.colors.textPrimary} />
            </Pressable>
            <Pressable
              onPress={() => {
                sync().catch(() => undefined);
              }}
              accessibilityRole="button"
              accessibilityLabel="Check for invitations"
              style={{
                width: theme.layout.minTouchTarget,
                height: theme.layout.minTouchTarget,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Feather name={syncing ? 'loader' : 'refresh-cw'} size={20} color={theme.colors.textSecondary} />
            </Pressable>
          </View>
        }
      />

      {invites.length > 0 ? (
        <View style={{ marginBottom: theme.spacing.lg, gap: theme.spacing.sm }}>
          <AppText variant="label" color="textSecondary">
            INVITATIONS
          </AppText>
          {invites.map((invite) => (
            <Card key={invite.id}>
              <View style={{ gap: theme.spacing.sm }}>
                <AppText variant="vlogTitle">{invite.name}</AppText>
                <AppText variant="caption" color="textSecondary">
                  From {invite.ownerName ?? shortNpub(invite.ownerPubkey)} · {invite.members.length}{' '}
                  {invite.members.length === 1 ? 'member' : 'members'}
                </AppText>
                {invite.description ? (
                  <AppText variant="caption" color="textTertiary">
                    {invite.description}
                  </AppText>
                ) : null}
                <View style={{ flexDirection: 'row', gap: theme.spacing.md, marginTop: theme.spacing.xs }}>
                  <Button
                    label="Accept"
                    loading={handlingInviteId === invite.id}
                    onPress={() => {
                      accept(invite).catch(() => undefined);
                    }}
                  />
                  <Button label="Decline" variant="ghost" onPress={() => decline(invite)} />
                </View>
              </View>
            </Card>
          ))}
        </View>
      ) : null}
    </View>
  );

  return (
    <Screen padded={false} edges={['top', 'left', 'right']}>
      <FlatList
        data={circles}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={syncing}
            onRefresh={() => {
              sync().catch(() => undefined);
            }}
            tintColor={theme.colors.textSecondary}
            colors={[theme.colors.textPrimary]}
            progressBackgroundColor={theme.colors.surface}
          />
        }
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: theme.layout.screenMargin }}>
            <Pressable
              onPress={() => router.push({ pathname: '/circle/[id]', params: { id: item.id } })}
              accessibilityRole="button"
              style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
            >
              <View
                style={{
                  paddingVertical: theme.spacing.xl,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.colors.border,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.md,
                }}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.surfaceSubtle,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Feather name="users" size={18} color={theme.colors.textSecondary} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="vlogTitle">{item.name}</AppText>
                  <AppText variant="caption" color="textSecondary">
                    {item.members.length} {item.members.length === 1 ? 'member' : 'members'}
                    {item.description ? `  ·  ${item.description}` : ''}
                  </AppText>
                </View>
                {item.muted ? <Feather name="bell-off" size={16} color={theme.colors.textTertiary} /> : null}
                <Feather name="chevron-right" size={18} color={theme.colors.textTertiary} />
              </View>
            </Pressable>
          </View>
        )}
        ListEmptyComponent={
          circlesQuery.isLoading ? (
            <LoadingState label="Gathering your circles" />
          ) : circlesQuery.isError ? (
            <View style={{ paddingHorizontal: theme.layout.screenMargin }}>
              <ErrorState
                message={circlesQuery.error instanceof Error ? circlesQuery.error.message : undefined}
                onAction={() => circlesQuery.refetch()}
              />
            </View>
          ) : invites.length > 0 ? (
            <View />
          ) : (
            <View style={{ paddingHorizontal: theme.layout.screenMargin }}>
              <EmptyState
                title="A circle is a small, private room"
                description="Invite the people you actually want to share everyday life with. Videos stay encrypted and only members can open them."
                actionLabel="Create your first circle"
                onAction={() => router.push('/circle/new')}
              />
            </View>
          )
        }
        contentContainerStyle={{ paddingBottom: theme.spacing.huge }}
      />
    </Screen>
  );
}
