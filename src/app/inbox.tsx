import React, { useCallback, useMemo } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';

import { AppText } from '../components/ui/AppText';
import { IconButton } from '../components/ui/IconButton';
import { ListRow, PageHeader } from '../components/ui/Layout';
import { InlineNotice } from '../components/ui/Notice';
import { Screen } from '../components/ui/Screen';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { markAllActivityRead, listActivity } from '../lib/database/activity';
import { listContactNames } from '../lib/database/contacts';
import { activityCopy } from '../lib/inbox/format';
import { shortNpub } from '../lib/nostr/format';
import { invalidateActivity, queryKeys } from '../lib/queryKeys';
import { useInboxSync } from '../stores/inboxSync';
import { useSession } from '../stores/session';
import { useTheme } from '../theme/ThemeProvider';
import type { Activity } from '../types/models';
import { formatRelativeTime } from '../utils/time';

const PAGE_SIZE = 30;

function showsUnreadDot(activity: Activity): boolean {
  return activity.readAt == null;
}

export default function InboxScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const identity = useSession((state) => state.identity);
  const syncInbox = useInboxSync((state) => state.sync);
  const syncing = useInboxSync((state) => state.syncing && state.identityId === identity?.id);
  const syncError = useInboxSync((state) =>
    state.identityId === identity?.id ? state.error : null
  );
  const { offline } = useNetworkStatus();

  const activityQuery = useInfiniteQuery({
    queryKey: queryKeys.activity(identity?.pubkey),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listActivity(identity!.pubkey, { limit: PAGE_SIZE, offset: pageParam }),
    getNextPageParam: (lastPage, pages) =>
      lastPage.length === PAGE_SIZE
        ? pages.reduce((total, page) => total + page.length, 0)
        : undefined,
    enabled: Boolean(identity),
  });
  const contactsQuery = useQuery({ queryKey: queryKeys.contacts, queryFn: listContactNames });

  const markRead = useCallback(async () => {
    if (!identity) return;
    await markAllActivityRead(identity.pubkey);
    await invalidateActivity(queryClient, identity.pubkey);
  }, [identity, queryClient]);

  useFocusEffect(
    useCallback(() => {
      void markRead();
    }, [markRead])
  );

  const refresh = useCallback(async () => {
    if (!identity) return;
    await syncInbox(identity, queryClient);
    await markRead();
  }, [identity, queryClient, syncInbox, markRead]);

  const activities = useMemo(
    () => activityQuery.data?.pages.flat() ?? [],
    [activityQuery.data]
  );

  const nameFor = (pubkey: string) =>
    contactsQuery.data?.[pubkey] ?? shortNpub(pubkey);

  const openActivity = (activity: Activity) => {
    if (
      activity.kind === 'invite' ||
      activity.kind === 'member-joined' ||
      activity.kind === 'member-removed'
    ) {
      router.navigate('/(tabs)/circles');
      return;
    }
    if (!activity.localVlogId) return;
    router.push({
      pathname: '/vlog/[id]',
      params: { id: activity.localVlogId, comments: '1' },
    });
  };

  const canOpen = (activity: Activity) =>
    activity.kind === 'invite' ||
    activity.kind === 'member-joined' ||
    activity.kind === 'member-removed' ||
    Boolean(activity.localVlogId);

  const emptyState = () => {
    if (activityQuery.isLoading) return <LoadingState label="Opening activity" />;
    if (activityQuery.isError) {
      return <ErrorState title="Couldn’t open activity" onAction={() => activityQuery.refetch()} />;
    }
    if (syncing) return <LoadingState label="Checking for activity" />;
    return (
      <EmptyState
        title="No activity yet"
        description="Replies, comments, and reactions will show up here."
        actionLabel="Check for activity"
        onAction={() => void refresh()}
      />
    );
  };

  return (
    <Screen padded={false} edges={['top', 'left', 'right']}>
      <FlatList
        data={activities}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        onEndReachedThreshold={0.35}
        onEndReached={() => {
          if (activityQuery.hasNextPage && !activityQuery.isFetching) {
            activityQuery.fetchNextPage().catch(() => undefined);
          }
        }}
        refreshControl={
          <RefreshControl
            refreshing={syncing}
            onRefresh={() => void refresh()}
            tintColor={theme.colors.textSecondary}
            colors={[theme.colors.textPrimary]}
            progressBackgroundColor={theme.colors.surface}
          />
        }
        ListHeaderComponent={
          <View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: theme.spacing.sm,
              }}
            >
              <IconButton icon="arrow-left" label="Back" onPress={() => router.back()} />
              <AppText variant="meta" color="textSecondary">
                ACTIVITY
              </AppText>
              <View style={{ width: theme.layout.minTouchTarget }} />
            </View>
            <PageHeader
              title="Inbox"
              subtitle="Replies, reactions, and circle activity."
            />
            {offline ? <InlineNotice message="Offline · showing saved activity" tone="warning" /> : null}
            {!offline && syncError ? <InlineNotice message="Couldn’t refresh" tone="error" /> : null}
          </View>
        }
        ListEmptyComponent={<View>{emptyState()}</View>}
        renderItem={({ item, index }) => {
          const copy = activityCopy(item, {
            actorName: nameFor(item.actorPubkey),
            circleName: item.circleName,
            vlogTitle: item.vlogTitle,
          });
          return (
            <ListRow
              title={copy.title}
              subtitle={copy.subtitle}
              avatarName={nameFor(item.actorPubkey)}
              onPress={canOpen(item) ? () => openActivity(item) : undefined}
              showDivider={index < activities.length - 1}
              right={
                <View style={{ alignItems: 'flex-end', gap: theme.spacing.xs }}>
                  <AppText variant="caption" color="textSecondary">
                    {formatRelativeTime(item.createdAt)}
                  </AppText>
                  {showsUnreadDot(item) ? (
                    <View
                      accessibilityLabel="Unread"
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: theme.colors.ink,
                      }}
                    />
                  ) : null}
                </View>
              }
            />
          );
        }}
        ListFooterComponent={
          activityQuery.isFetchingNextPage ? (
            <LoadingState label="Loading" />
          ) : activityQuery.isError && activities.length > 0 ? (
            <ErrorState
              title="Couldn’t load more"
              onAction={() => {
                if (activityQuery.hasNextPage) void activityQuery.fetchNextPage();
                else void activityQuery.refetch();
              }}
            />
          ) : undefined
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
