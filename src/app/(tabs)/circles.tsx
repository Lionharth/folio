import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import Feather from '@expo/vector-icons/Feather';

import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Card, Divider } from '../../components/ui/Card';
import { IconButton } from '../../components/ui/IconButton';
import { PageHeader, SectionHeader } from '../../components/ui/Layout';
import { InlineNotice } from '../../components/ui/Notice';
import { Screen } from '../../components/ui/Screen';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { listPendingInvites, type CircleInvite } from '../../lib/database/invites';
import { listCircleMembers, listCirclesForViewer, listVlogs } from '../../lib/database/vlogs';
import { readSecretKey } from '../../lib/nostr/identity';
import { shortNpub } from '../../lib/nostr/format';
import { invalidateCircles, invalidateSocial, invalidateVlogs, queryKeys } from '../../lib/queryKeys';
import { acceptInvite, declineInvite } from '../../services/circles';
import { presentInboxSync, type SyncTone } from '../../services/syncPresentation';
import { useInboxSync } from '../../stores/inboxSync';
import { useSession } from '../../stores/session';
import { useTheme } from '../../theme/ThemeProvider';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import type { Vlog } from '../../types/models';

type CircleWithDetails = Awaited<ReturnType<typeof listCirclesForViewer>>[number] & {
  members: Awaited<ReturnType<typeof listCircleMembers>>;
  recent: Vlog | null;
};

export default function CirclesScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const identity = useSession((state) => state.identity);
  const [handlingInviteId, setHandlingInviteId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; tone: SyncTone } | null>(null);
  const syncInbox = useInboxSync((state) => state.sync);
  const syncing = useInboxSync((state) => state.syncing && state.identityId === identity?.id);
  const restoring = useInboxSync((state) => state.restoring && state.identityId === identity?.id);
  const syncIdentityId = useInboxSync((state) => state.identityId);
  const lastResult = useInboxSync((state) => state.lastResult);
  const lastAction = useInboxSync((state) => state.lastAction);
  const syncError = useInboxSync((state) => state.error);
  const { offline } = useNetworkStatus();

  const circlesQuery = useQuery({
    queryKey: queryKeys.circlesWithMembers(identity?.pubkey),
    queryFn: async () => {
      const circles = await listCirclesForViewer(identity!.pubkey);
      return Promise.all(
        circles.map(async (circle) => {
          const [members, recent] = await Promise.all([
            listCircleMembers(circle.id),
            listVlogs(identity!.pubkey, { circleId: circle.id, limit: 1 }),
          ]);
          return { ...circle, members, recent: recent[0] ?? null };
        })
      );
    },
    enabled: Boolean(identity),
  });

  const invitesQuery = useQuery({
    queryKey: queryKeys.invites(identity?.pubkey),
    queryFn: () => listPendingInvites(identity!.pubkey),
    enabled: Boolean(identity),
  });

  const circles = circlesQuery.data ?? [];
  const invites = invitesQuery.data ?? [];

  const invalidateAll = useCallback(async () => {
    if (!identity) return;
    await Promise.all([
      invalidateCircles(queryClient, identity.pubkey),
      invalidateVlogs(queryClient, identity.pubkey),
      invalidateSocial(queryClient, identity.pubkey),
    ]);
  }, [queryClient, identity]);

  const sync = useCallback(async () => {
    if (identity) await syncInbox(identity, queryClient, { fast: true });
  }, [identity, syncInbox, queryClient]);

  useFocusEffect(
    useCallback(() => {
      if (!identity) return;
      const last = useInboxSync.getState().lastResult;
      if (!last || Date.now() - last.completedAt > 30_000) {
        void useInboxSync
          .getState()
          .sync(identity, queryClient, { fast: true })
          .catch(() => undefined);
      }
    }, [identity, queryClient])
  );

  const accept = async (invite: CircleInvite) => {
    if (!identity) return;
    setHandlingInviteId(invite.id);
    setNotice(null);
    try {
      const secretKey = await readSecretKey(identity.id);
      const result = await acceptInvite({ secretKey, inviteId: invite.id, memberName: identity.label });
      await invalidateAll();
      setNotice({
        message: result.ownerNotified ? `Joined ${result.circleName}` : `Joined ${result.circleName} · owner not notified`,
        tone: result.ownerNotified ? 'success' : 'warning',
      });
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : 'Could not accept the invitation', tone: 'error' });
    } finally {
      setHandlingInviteId(null);
    }
  };

  const decline = (invite: CircleInvite) => {
    Alert.alert('Decline invitation?', `You will not join ${invite.name}.`, [
      { text: 'Keep invitation', style: 'cancel' },
      {
        text: 'Decline',
        style: 'destructive',
        onPress: async () => {
          if (!identity) return;
          setHandlingInviteId(invite.id);
          try {
            const secretKey = await readSecretKey(identity.id);
            await declineInvite({ secretKey, inviteId: invite.id });
            await invalidateAll();
            setNotice({ message: `Declined ${invite.name}`, tone: 'neutral' });
          } catch (error) {
            setNotice({ message: error instanceof Error ? error.message : 'Could not decline', tone: 'error' });
          } finally {
            setHandlingInviteId(null);
          }
        },
      },
    ]);
  };

  const syncPresentation =
    syncIdentityId === identity?.id &&
    lastResult &&
    lastAction !== 'live' &&
    (lastAction === 'manual' || !lastResult.allRelaysComplete)
      ? presentInboxSync(lastResult, 'circles')
      : null;
  const currentSyncError = syncIdentityId === identity?.id ? syncError : null;

  return (
    <Screen padded={false} edges={['top', 'left', 'right']}>
      <FlatList<CircleWithDetails>
        data={circles}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={syncing}
            onRefresh={() => void sync()}
            tintColor={theme.colors.textSecondary}
            colors={[theme.colors.textPrimary]}
            progressBackgroundColor={theme.colors.surface}
          />
        }
        ListHeaderComponent={
          <View>
            <PageHeader
              title="Circles"
              right={
                <View style={{ flexDirection: 'row' }}>
                  <IconButton icon="plus" label="Create a circle" onPress={() => router.push('/circle/new')} />
                  <IconButton icon="refresh-cw" label="Check for invitations" loading={syncing} onPress={() => void sync()} />
                </View>
              }
            />
            {offline ? <InlineNotice message="Offline · changes wait for a connection" tone="warning" /> : null}
            {currentSyncError ? <InlineNotice message="Couldn’t refresh" tone="error" /> : null}
            {notice ? <InlineNotice message={notice.message} tone={notice.tone} /> : null}
            {!notice && !currentSyncError && syncPresentation ? (
              <InlineNotice message={syncPresentation.message} tone={syncPresentation.tone} />
            ) : null}
            {invitesQuery.isLoading ? <LoadingState label="Checking invitations" /> : null}
            {invitesQuery.isError ? <ErrorState title="Couldn’t open invitations" onAction={() => invitesQuery.refetch()} /> : null}
            {invites.length > 0 ? (
              <View style={{ marginBottom: theme.spacing.xl }}>
                <SectionHeader title="Invitations" />
                <View style={{ gap: theme.spacing.md }}>
                  {invites.map((invite) => (
                    <Card key={invite.id} style={{ borderColor: theme.colors.borderStrong }}>
                      <View style={{ gap: theme.spacing.sm }}>
                        <AppText variant="headline">{invite.name}</AppText>
                        <AppText variant="caption" color="textSecondary">
                          From {invite.ownerName ?? shortNpub(invite.ownerPubkey)} · {invite.members.length}{' '}
                          {invite.members.length === 1 ? 'member' : 'members'}
                        </AppText>
                        {invite.description ? <AppText variant="body" color="textSecondary">{invite.description}</AppText> : null}
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.md, marginTop: theme.spacing.sm }}>
                          <Button
                            label="Join"
                            accessibilityLabel={`Accept invitation to ${invite.name}`}
                            loading={handlingInviteId === invite.id}
                            disabled={Boolean(handlingInviteId)}
                            onPress={() => void accept(invite)}
                          />
                          <Button
                            label="Decline"
                            variant="ghost"
                            disabled={Boolean(handlingInviteId)}
                            onPress={() => decline(invite)}
                          />
                        </View>
                      </View>
                    </Card>
                  ))}
                </View>
              </View>
            ) : null}
            {circles.length > 0 && invites.length > 0 ? <SectionHeader title="Your circles" /> : null}
          </View>
        }
        renderItem={({ item }) => (
          <CircleCard circle={item} onPress={() => router.push({ pathname: '/circle/[id]', params: { id: item.id } })} />
        )}
        ListEmptyComponent={
          circlesQuery.isLoading ? (
            <LoadingState label="Opening circles" />
          ) : circlesQuery.isError ? (
            <ErrorState title="Couldn’t open circles" onAction={() => circlesQuery.refetch()} />
          ) : restoring ? (
            <LoadingState label="Restoring circles" />
          ) : invites.length > 0 || invitesQuery.isLoading || invitesQuery.isError ? undefined : (
            <EmptyState
              title="Start a circle"
              description="Only invited people can see it."
              actionLabel="Create circle"
              onAction={() => router.push('/circle/new')}
            />
          )
        }
        contentContainerStyle={{
          paddingHorizontal: theme.layout.screenMargin,
          paddingBottom: theme.spacing.huge,
          flexGrow: 1,
        }}
      />
    </Screen>
  );
}

function CircleCard({ circle, onPress }: { circle: CircleWithDetails; onPress: () => void }) {
  const theme = useTheme();
  const artwork = circle.coverUri ?? circle.recent?.coverUri ?? null;
  const avatarSize = 52;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${circle.name}. ${circle.members.length} ${circle.members.length === 1 ? 'member' : 'members'}${circle.muted ? '. Notification preference muted' : ''}`}
      style={({ pressed }) => ({
        backgroundColor: pressed ? theme.colors.surfaceSubtle : 'transparent',
      })}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
          minHeight: theme.layout.minTouchTarget + theme.spacing.md,
        }}
      >
        <View
          style={{
            width: avatarSize,
            height: avatarSize,
            borderRadius: avatarSize / 2,
            overflow: 'hidden',
            backgroundColor: theme.colors.surfaceSubtle,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          {artwork ? (
            <Image source={{ uri: artwork }} contentFit="cover" transition={180} style={{ width: '100%', height: '100%' }} />
          ) : (
            <AppText style={{ fontFamily: theme.font.serifLight, fontSize: 24, lineHeight: 28, color: theme.colors.textSecondary }}>
              {circle.name.trim().charAt(0).toLowerCase() || 'f'}
            </AppText>
          )}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {circle.name}
          </AppText>
          <AppText variant="caption" color="textSecondary" numberOfLines={1}>
            {circle.members.length} {circle.members.length === 1 ? 'member' : 'members'}
          </AppText>
        </View>
        {circle.muted ? <Feather name="bell-off" size={16} color={theme.colors.textTertiary} /> : null}
        <Feather name="chevron-right" size={18} color={theme.colors.textTertiary} />
      </View>
      <Divider inset={avatarSize + theme.spacing.md} />
    </Pressable>
  );
}
