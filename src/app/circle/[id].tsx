import React, { useState } from 'react';
import { Alert, FlatList, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';

import { AppText } from '../../components/ui/AppText';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Card, Divider } from '../../components/ui/Card';
import { IconButton } from '../../components/ui/IconButton';
import { SectionHeader } from '../../components/ui/Layout';
import { InlineNotice } from '../../components/ui/Notice';
import { Screen } from '../../components/ui/Screen';
import { TextField } from '../../components/ui/TextField';
import { EmptyState, ErrorState, LoadingState, VlogListSkeleton } from '../../components/ui/States';
import { VlogRow } from '../../components/vlog/VlogRow';
import { listContactNames } from '../../lib/database/contacts';
import { getCircle, listCircleMembers, listVlogs } from '../../lib/database/vlogs';
import { pubkeyFromInput, shortNpub } from '../../lib/nostr/format';
import { readSecretKey } from '../../lib/nostr/identity';
import { invalidateCircles, invalidateVlogs, queryKeys } from '../../lib/queryKeys';
import { inviteMember, removeMember, resendInvite } from '../../services/circles';
import { useSession } from '../../stores/session';
import { useTheme } from '../../theme/ThemeProvider';

const PAGE_SIZE = 12;

export default function CircleDetailScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const identity = useSession((state) => state.identity);
  const { id } = useLocalSearchParams<{ id: string }>();
  const [memberInput, setMemberInput] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; tone: 'neutral' | 'success' | 'warning' | 'error' } | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const contactsQuery = useQuery({ queryKey: queryKeys.contacts, queryFn: listContactNames });
  const detailQuery = useQuery({
    queryKey: queryKeys.circle(identity?.pubkey, id),
    queryFn: async () => {
      const circle = await getCircle(id);
      const members = circle ? await listCircleMembers(id) : [];
      return { circle, members };
    },
    enabled: Boolean(identity && id),
  });
  const vlogsQuery = useInfiniteQuery({
    queryKey: [...queryKeys.vlogs(identity?.pubkey), 'circle', id],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listVlogs(identity!.pubkey, { circleId: id, limit: PAGE_SIZE, offset: pageParam }),
    getNextPageParam: (lastPage, pages) =>
      lastPage.length === PAGE_SIZE ? pages.reduce((total, page) => total + page.length, 0) : undefined,
    enabled: Boolean(identity && id && detailQuery.data?.circle),
  });

  const circle = detailQuery.data?.circle ?? null;
  const members = detailQuery.data?.members ?? [];
  const isOwner = circle?.ownerPubkey === identity?.pubkey;
  const nameFor = (pubkey: string) =>
    pubkey === identity?.pubkey ? (identity?.label ?? 'You') : (contactsQuery.data?.[pubkey] ?? shortNpub(pubkey));
  const vlogs = vlogsQuery.data?.pages.flat() ?? [];

  const invalidate = async () => {
    if (!identity) return;
    await Promise.all([
      invalidateCircles(queryClient, identity.pubkey),
      invalidateVlogs(queryClient, identity.pubkey),
    ]);
  };

  const runAction = async (key: string, action: () => Promise<{ message: string; tone?: 'success' | 'warning' }>) => {
    if (busyAction) return;
    setBusyAction(key);
    setNotice(null);
    try {
      const result = await action();
      await invalidate();
      setNotice({ message: result.message, tone: result.tone ?? 'success' });
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : 'The action could not be completed', tone: 'error' });
    } finally {
      setBusyAction(null);
    }
  };

  const addMember = async () => {
    const pubkey = pubkeyFromInput(memberInput);
    if (!pubkey) {
      setNotice({ message: 'Use an npub or a 64-character public key.', tone: 'error' });
      return;
    }
    if (pubkey === identity?.pubkey) {
      setNotice({ message: 'That Folio ID belongs to you.', tone: 'error' });
      return;
    }
    if (!identity) return;
    await runAction('invite', async () => {
      const secretKey = await readSecretKey(identity.id);
      await inviteMember({ secretKey, circleId: id, memberPubkey: pubkey, ownerName: identity.label });
      setMemberInput('');
      return { message: 'Invitation sent. They will see it after their next sync.' };
    });
  };

  const resend = async (pubkey: string) => {
    if (!identity) return;
    await runAction(`resend:${pubkey}`, async () => {
      const secretKey = await readSecretKey(identity.id);
      await resendInvite({ secretKey, circleId: id, memberPubkey: pubkey, ownerName: identity.label });
      return { message: `Invitation resent to ${nameFor(pubkey)}.` };
    });
  };

  const confirmRemove = (pubkey: string) => {
    Alert.alert(
      `Remove ${nameFor(pubkey)}?`,
      'They will not receive keys for future posts. Media they already saved stays on their device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            if (!identity) return;
            void runAction(`remove:${pubkey}`, async () => {
              const secretKey = await readSecretKey(identity.id);
              const result = await removeMember({ secretKey, circleId: id, memberPubkey: pubkey });
              return result.delivered
                ? { message: `${nameFor(pubkey)} was removed.` }
                : {
                    message: `${nameFor(pubkey)} was removed here. Their device could not be reached yet; removal retries on the next sync.`,
                    tone: 'warning' as const,
                  };
            });
          },
        },
      ]
    );
  };

  if (detailQuery.isLoading) {
    return <Screen><LoadingState label="Opening circle" /></Screen>;
  }

  if (detailQuery.isError) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <ErrorState title="Couldn’t open circle" onAction={() => detailQuery.refetch()} />
          <Button label="Back to Circles" variant="ghost" onPress={() => router.back()} style={{ marginTop: theme.spacing.lg }} />
        </View>
      </Screen>
    );
  }

  if (!circle) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center', gap: theme.spacing.lg }}>
          <AppText variant="title">Circle not found</AppText>
          <Button label="Back to Circles" variant="secondary" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false} edges={['top', 'left', 'right', 'bottom']}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: theme.spacing.sm,
          paddingHorizontal: theme.layout.screenMargin,
          backgroundColor: theme.colors.background,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
        }}
      >
        <IconButton icon="arrow-left" label="Back to circles" onPress={() => router.back()} />
        <Button
          label="Create"
          icon={<AppText style={{ color: theme.colors.onInk, fontSize: 22, lineHeight: 22 }}>+</AppText>}
          onPress={() => router.push({ pathname: '/create', params: { circleId: id } })}
        />
      </View>
      <FlatList
        style={{ flex: 1 }}
        data={vlogs}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        onEndReachedThreshold={0.35}
        onEndReached={() => {
          if (vlogsQuery.hasNextPage && !vlogsQuery.isFetching) vlogsQuery.fetchNextPage().catch(() => undefined);
        }}
        ListHeaderComponent={
          <View>
            <View
              style={{
                height: 230,
                borderRadius: theme.radius.xl,
                overflow: 'hidden',
                backgroundColor: theme.colors.surfaceSubtle,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1,
                borderColor: theme.colors.border,
                marginTop: theme.spacing.sm,
              }}
            >
              {circle.coverUri ? (
                <Image source={{ uri: circle.coverUri }} contentFit="cover" transition={180} style={{ width: '100%', height: '100%' }} />
              ) : (
                <AppText style={{ fontFamily: theme.font.serifLight, fontSize: 112, lineHeight: 118, color: theme.colors.textSecondary }}>
                  {circle.name.trim().charAt(0).toLowerCase() || 'f'}
                </AppText>
              )}
            </View>

            <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.xl }}>
              <AppText variant="display">{circle.name}</AppText>
              <AppText variant="caption" color="textSecondary">
                {members.length} {members.length === 1 ? 'member' : 'members'}
              </AppText>
              {circle.description ? <AppText variant="body" color="textSecondary">{circle.description}</AppText> : null}
            </View>

            {notice ? <View style={{ marginTop: theme.spacing.lg }}><InlineNotice message={notice.message} tone={notice.tone} /></View> : null}

            <SectionHeader title="People" />
            <Card padded={false}>
              {members.map((member, index) => (
                <View key={member.pubkey}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, padding: theme.spacing.md }}>
                    <Avatar name={nameFor(member.pubkey)} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <AppText variant="bodyStrong">{member.pubkey === identity?.pubkey ? 'You' : nameFor(member.pubkey)}</AppText>
                      <AppText variant="caption" color="textSecondary">
                        {member.status === 'invited' ? 'Invitation pending' : member.role}
                      </AppText>
                    </View>
                    {isOwner && member.pubkey !== identity?.pubkey && member.status === 'invited' ? (
                      <IconButton
                        icon="send"
                        label={`Resend invitation to ${nameFor(member.pubkey)}`}
                        loading={busyAction === `resend:${member.pubkey}`}
                        disabled={Boolean(busyAction)}
                        onPress={() => void resend(member.pubkey)}
                      />
                    ) : null}
                    {isOwner && member.pubkey !== identity?.pubkey ? (
                      <IconButton
                        icon="user-minus"
                        label={`Remove ${nameFor(member.pubkey)}`}
                        tone="danger"
                        disabled={Boolean(busyAction)}
                        onPress={() => confirmRemove(member.pubkey)}
                      />
                    ) : null}
                  </View>
                  {index < members.length - 1 ? <Divider inset={theme.spacing.md} /> : null}
                </View>
              ))}
            </Card>

            {isOwner ? (
              <Card style={{ marginTop: theme.spacing.lg }}>
                <View style={{ gap: theme.spacing.md }}>
                  <AppText variant="headline">Invite someone</AppText>
                  <TextField
                    label="Folio ID"
                    placeholder="npub1…"
                    value={memberInput}
                    onChangeText={setMemberInput}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!busyAction}
                  />
                  <Button label="Invite" variant="secondary" loading={busyAction === 'invite'} disabled={Boolean(busyAction)} onPress={() => void addMember()} />
                </View>
              </Card>
            ) : null}

            <View style={{ marginTop: theme.spacing.lg }}>
              <Button label={showAdvanced ? 'Hide advanced' : 'Advanced'} variant="ghost" accessibilityState={{ expanded: showAdvanced }} onPress={() => setShowAdvanced((value) => !value)} />
            </View>

            {showAdvanced ? (
              <Card subtle style={{ marginTop: theme.spacing.lg }}>
                <View style={{ gap: theme.spacing.md }}>
                  <AppText variant="caption" color="textSecondary">Membership version {circle.membershipVersion}</AppText>
                  <AppText variant="mono" color="textSecondary" selectable>{circle.id}</AppText>
                  <Button
                    label="Copy internal circle ID"
                    variant="secondary"
                    onPress={() => {
                      void Clipboard.setStringAsync(circle.id).then(() => setNotice({ message: 'Internal circle ID copied', tone: 'neutral' }));
                    }}
                  />
                  <AppText variant="caption" color="textTertiary">Removing a member stops future keys. Saved media stays on their device.</AppText>
                </View>
              </Card>
            ) : null}

            <SectionHeader title="Moments" />
          </View>
        }
        renderItem={({ item, index }) => (
          <VlogRow vlog={item} authorLabel={nameFor(item.authorPubkey)} variant={index === 0 ? 'hero' : 'standard'} />
        )}
        ListEmptyComponent={
          vlogsQuery.isLoading ? (
            <VlogListSkeleton />
          ) : vlogsQuery.isError ? (
            <ErrorState title="Couldn’t open moments" onAction={() => vlogsQuery.refetch()} />
          ) : (
            <EmptyState
              title="No moments yet"
              actionLabel="Create"
              onAction={() => router.push({ pathname: '/create', params: { circleId: id } })}
            />
          )
        }
        ListFooterComponent={
          vlogsQuery.isFetchingNextPage ? (
            <LoadingState label="Opening more moments" />
          ) : vlogsQuery.isError && vlogs.length > 0 ? (
            <ErrorState
              title="Couldn’t load more"
              onAction={() => {
                if (vlogsQuery.hasNextPage) void vlogsQuery.fetchNextPage();
                else void vlogsQuery.refetch();
              }}
            />
          ) : undefined
        }
        contentContainerStyle={{ paddingHorizontal: theme.layout.screenMargin, paddingBottom: theme.spacing.huge, flexGrow: 1 }}
      />
    </Screen>
  );
}
