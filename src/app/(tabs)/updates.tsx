import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';

import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { FilterChip } from '../../components/ui/FilterChip';
import { IconButton } from '../../components/ui/IconButton';
import { PageHeader } from '../../components/ui/Layout';
import { InlineNotice } from '../../components/ui/Notice';
import { Screen } from '../../components/ui/Screen';
import { EmptyState, ErrorState, LoadingState, VlogListSkeleton } from '../../components/ui/States';
import { VlogRow } from '../../components/vlog/VlogRow';
import { countUnreadActivity } from '../../lib/database/activity';
import { listContactNames } from '../../lib/database/contacts';
import { listCirclesForViewer, listVlogs } from '../../lib/database/vlogs';
import { shortNpub } from '../../lib/nostr/format';
import { queryKeys } from '../../lib/queryKeys';
import { presentInboxSync } from '../../services/syncPresentation';
import { useInboxSync } from '../../stores/inboxSync';
import { useSession } from '../../stores/session';
import { useTheme } from '../../theme/ThemeProvider';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import type { Vlog } from '../../types/models';

const PAGE_SIZE = 12;

type UpdateRow =
  | { kind: 'filters'; key: string }
  | { kind: 'vlog'; key: string; vlog: Vlog }
  | { kind: 'empty'; key: string };

export default function UpdatesScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const identity = useSession((state) => state.identity);
  const params = useLocalSearchParams<{ circleId?: string | string[] }>();
  const paramCircleId =
    typeof params.circleId === 'string' && params.circleId.length > 0 ? params.circleId : null;
  const [circleFilter, setCircleFilter] = React.useState<string | null>(paramCircleId);
  const appliedParam = useRef<string | null>(paramCircleId);
  const syncInbox = useInboxSync((state) => state.sync);
  const syncing = useInboxSync((state) => state.syncing && state.identityId === identity?.id);
  const restoring = useInboxSync((state) => state.restoring && state.identityId === identity?.id);
  const syncIdentityId = useInboxSync((state) => state.identityId);
  const lastResult = useInboxSync((state) => state.lastResult);
  const lastAction = useInboxSync((state) => state.lastAction);
  const syncError = useInboxSync((state) => state.error);
  const { offline } = useNetworkStatus();

  const circlesQuery = useQuery({
    queryKey: queryKeys.circles(identity?.pubkey),
    queryFn: () => listCirclesForViewer(identity!.pubkey),
    enabled: Boolean(identity),
  });
  const contactsQuery = useQuery({ queryKey: queryKeys.contacts, queryFn: listContactNames });
  const vlogsQuery = useInfiniteQuery({
    queryKey: [...queryKeys.vlogs(identity?.pubkey), 'updates', circleFilter],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listVlogs(identity!.pubkey, {
        circleId: circleFilter,
        unreadOnly: true,
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    getNextPageParam: (lastPage, pages) =>
      lastPage.length === PAGE_SIZE ? pages.reduce((total, page) => total + page.length, 0) : undefined,
    enabled: Boolean(identity),
  });
  const hasAnyQuery = useQuery({
    queryKey: [...queryKeys.vlogs(identity?.pubkey), 'has-any', circleFilter],
    queryFn: () => listVlogs(identity!.pubkey, { circleId: circleFilter, limit: 1 }),
    enabled: Boolean(identity),
  });
  const activityUnreadQuery = useQuery({
    queryKey: queryKeys.activityUnread(identity?.pubkey),
    queryFn: () => countUnreadActivity(identity!.pubkey),
    enabled: Boolean(identity),
  });
  const activityUnread = identity ? (activityUnreadQuery.data ?? 0) : 0;

  const circlesById = useMemo(() => {
    const map = new Map<string, string>();
    for (const circle of circlesQuery.data ?? []) map.set(circle.id, circle.name);
    return map;
  }, [circlesQuery.data]);

  useEffect(() => {
    if (!paramCircleId || paramCircleId === appliedParam.current) return;
    appliedParam.current = paramCircleId;
    setCircleFilter(paramCircleId);
  }, [paramCircleId]);

  const selectCircle = (id: string | null) => {
    setCircleFilter(id);
    appliedParam.current = id;
    if (paramCircleId && paramCircleId !== id) {
      router.setParams({ circleId: id ?? undefined });
    }
  };

  const sync = useCallback(async () => {
    if (identity) await syncInbox(identity, queryClient, { fast: true });
  }, [identity, syncInbox, queryClient]);

  const vlogs = useMemo(() => vlogsQuery.data?.pages.flat() ?? [], [vlogsQuery.data]);
  const rows = useMemo<UpdateRow[]>(
    () => [
      { kind: 'filters', key: 'filters' },
      ...(vlogs.length > 0
        ? vlogs.map((vlog) => ({ kind: 'vlog' as const, key: vlog.id, vlog }))
        : [{ kind: 'empty' as const, key: 'empty' }]),
    ],
    [vlogs]
  );
  const nameFor = (pubkey: string) =>
    pubkey === identity?.pubkey ? (identity?.label ?? 'You') : (contactsQuery.data?.[pubkey] ?? shortNpub(pubkey));
  const syncPresentation =
    syncIdentityId === identity?.id &&
    lastResult &&
    lastAction !== 'live' &&
    (lastAction === 'manual' || !lastResult.allRelaysComplete)
      ? presentInboxSync(lastResult, 'updates')
      : null;
  const currentSyncError = syncIdentityId === identity?.id ? syncError : null;
  const showSyncNotice = syncPresentation && syncPresentation.message !== "You're up to date";

  const emptyState = () => {
    if (vlogsQuery.isLoading) return <VlogListSkeleton />;
    if (vlogsQuery.isError) {
      return (
        <ErrorState title="Couldn’t open moments" onAction={() => vlogsQuery.refetch()} />
      );
    }
    if (restoring) return <LoadingState label="Restoring your Folio" />;
    if (circlesQuery.isError) {
      return <ErrorState title="Couldn’t open circles" onAction={() => circlesQuery.refetch()} />;
    }
    if (circlesQuery.isLoading) return <LoadingState label="Opening circles" />;
    if (!circleFilter && (circlesQuery.data?.length ?? 0) === 0) {
      return (
        <EmptyState
          title="Start a private circle"
          description="Only the people you invite can see it."
          actionLabel="Create circle"
          onAction={() => router.push('/circle/new')}
        />
      );
    }
    if (hasAnyQuery.isLoading) return <LoadingState label="Checking earlier moments" />;
    if (hasAnyQuery.isError) {
      return <ErrorState title="Couldn’t check earlier moments" onAction={() => hasAnyQuery.refetch()} />;
    }
    if (offline && !hasAnyQuery.data?.length) {
      return (
        <EmptyState
          title="Nothing saved yet"
          description="Reconnect to check for moments."
          actionLabel="Open Archive"
          onAction={() => router.push('/(tabs)/archive')}
        />
      );
    }
    if (hasAnyQuery.data?.length) {
      return (
        <View
          accessibilityLiveRegion="polite"
          style={{
            alignItems: 'center',
            gap: theme.spacing.lg,
            paddingVertical: theme.spacing.giant,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
          }}
        >
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.colors.surfaceSubtle,
            }}
          >
            <Feather name="check" size={22} color={theme.colors.textSecondary} />
          </View>
          <AppText variant="headline">{circleFilter ? 'Nothing new here' : "You're caught up"}</AppText>
          <Button label="Open Archive" variant="secondary" style={{ alignSelf: 'center' }} onPress={() => router.push('/(tabs)/archive')} />
        </View>
      );
    }
    return (
      <EmptyState
        title={circleFilter ? 'Nothing new here' : 'No moments yet'}
        actionLabel={circleFilter ? 'Show all' : 'Create a moment'}
        onAction={() => (circleFilter ? selectCircle(null) : router.push('/create'))}
      />
    );
  };

  return (
    <Screen padded={false} edges={['top', 'left', 'right']}>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.key}
        stickyHeaderIndices={[1]}
        showsVerticalScrollIndicator={false}
        onEndReachedThreshold={0.35}
        onEndReached={() => {
          if (vlogsQuery.hasNextPage && !vlogsQuery.isFetching) vlogsQuery.fetchNextPage().catch(() => undefined);
        }}
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
              eyebrow="folio"
              title="New moments"
              right={
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}>
                  <View>
                    <IconButton
                      icon="bell"
                      label={activityUnread > 0 ? `Inbox, ${activityUnread} unread` : 'Inbox'}
                      onPress={() => router.push('/inbox')}
                    />
                    {activityUnread > 0 ? (
                      <View
                        pointerEvents="none"
                        style={{
                          position: 'absolute',
                          top: 4,
                          right: 4,
                          minWidth: 16,
                          height: 16,
                          paddingHorizontal: 4,
                          borderRadius: 8,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: theme.colors.ink,
                        }}
                      >
                        <AppText
                          variant="meta"
                          style={{ color: theme.colors.onInk, fontSize: 9.5, lineHeight: 11 }}
                        >
                          {activityUnread > 99 ? '99+' : activityUnread}
                        </AppText>
                      </View>
                    ) : null}
                  </View>
                  <IconButton icon="refresh-cw" label="Check for updates" loading={syncing} onPress={() => void sync()} />
                </View>
              }
            />
            {offline ? <InlineNotice message="Offline · showing saved moments" tone="warning" /> : null}
            {currentSyncError ? <InlineNotice message="Couldn’t refresh" tone="error" /> : null}
            {!currentSyncError && showSyncNotice && syncPresentation ? (
              <View style={{ marginTop: theme.spacing.sm }}>
                <InlineNotice message={syncPresentation.message} tone={syncPresentation.tone} />
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item, index }) => {
          if (item.kind === 'filters') {
            const circles = circlesQuery.data ?? [];
            if (circles.length === 0) return null;
            return (
              <View
                style={{
                  backgroundColor: theme.colors.background,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.colors.border,
                  paddingBottom: theme.spacing.md,
                }}
              >
                <FlatList
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: theme.spacing.sm, paddingTop: theme.spacing.sm }}
                  data={[{ id: null as string | null, name: 'All circles' }, ...circles]}
                  keyExtractor={(circle) => circle.id ?? 'all'}
                  renderItem={({ item: circle }) => (
                    <FilterChip label={circle.name} active={circleFilter === circle.id} onPress={() => selectCircle(circle.id)} />
                  )}
                />
              </View>
            );
          }
          if (item.kind === 'empty') return <View>{emptyState()}</View>;
          return (
            <VlogRow
              vlog={{
                ...item.vlog,
                circleName: item.vlog.circleName ?? circlesById.get(item.vlog.circleId ?? '') ?? null,
              }}
              authorLabel={nameFor(item.vlog.authorPubkey)}
              variant={index === 1 ? 'hero' : 'standard'}
            />
          );
        }}
        ListFooterComponent={
          vlogsQuery.isFetchingNextPage ? (
            <LoadingState label="Loading" />
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
        contentContainerStyle={{
          paddingHorizontal: theme.layout.screenMargin,
          paddingBottom: theme.spacing.huge,
          flexGrow: 1,
        }}
      />
    </Screen>
  );
}
