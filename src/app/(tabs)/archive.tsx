import React, { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';

import { AppText } from '../../components/ui/AppText';
import { FilterChip } from '../../components/ui/FilterChip';
import { PageHeader } from '../../components/ui/Layout';
import { InlineNotice } from '../../components/ui/Notice';
import { Screen } from '../../components/ui/Screen';
import { TextField } from '../../components/ui/TextField';
import { EmptyState, ErrorState, LoadingState, VlogListSkeleton } from '../../components/ui/States';
import { VlogGridCard } from '../../components/vlog/VlogRow';
import { listContactNames } from '../../lib/database/contacts';
import { listCirclesForViewer, listVlogs } from '../../lib/database/vlogs';
import { shortNpub } from '../../lib/nostr/format';
import { queryKeys } from '../../lib/queryKeys';
import { useInboxSync } from '../../stores/inboxSync';
import { useSession } from '../../stores/session';
import { useTheme } from '../../theme/ThemeProvider';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import type { Vlog } from '../../types/models';

const PAGE_SIZE = 24;

type ArchiveEntry =
  | { type: 'month'; id: string; title: string }
  | { type: 'pair'; id: string; items: Vlog[] };

function monthTitle(timestampSeconds: number): string {
  return new Date(timestampSeconds * 1000).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function archiveEntries(vlogs: Vlog[]): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  let month = '';
  let pair: Vlog[] = [];
  const flushPair = () => {
    if (pair.length) {
      entries.push({ type: 'pair', id: pair.map((item) => item.id).join(':'), items: pair });
      pair = [];
    }
  };

  for (const vlog of vlogs) {
    const nextMonth = monthTitle(vlog.createdAt);
    if (nextMonth !== month) {
      flushPair();
      month = nextMonth;
      entries.push({ type: 'month', id: `month-${nextMonth}`, title: nextMonth });
    }
    pair.push(vlog);
    if (pair.length === 2) flushPair();
  }
  flushPair();
  return entries;
}

export default function ArchiveScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const identity = useSession((state) => state.identity);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [circleId, setCircleId] = useState<string | null>(null);
  const syncing = useInboxSync((state) => state.syncing && state.identityId === identity?.id);
  const restoring = useInboxSync((state) => state.restoring && state.identityId === identity?.id);
  const syncInbox = useInboxSync((state) => state.sync);
  const { offline } = useNetworkStatus();

  const contactsQuery = useQuery({ queryKey: queryKeys.contacts, queryFn: listContactNames });
  const circlesQuery = useQuery({
    queryKey: queryKeys.circles(identity?.pubkey),
    queryFn: () => listCirclesForViewer(identity!.pubkey),
    enabled: Boolean(identity),
  });
  const vlogsQuery = useInfiniteQuery({
    queryKey: [...queryKeys.vlogs(identity?.pubkey), 'archive', deferredSearch.trim(), favouritesOnly, circleId],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listVlogs(identity!.pubkey, {
        authorPubkey: identity!.pubkey,
        search: deferredSearch,
        favouritesOnly,
        circleId,
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    getNextPageParam: (lastPage, pages) =>
      lastPage.length === PAGE_SIZE ? pages.reduce((total, page) => total + page.length, 0) : undefined,
    enabled: Boolean(identity),
  });

  const sync = useCallback(async () => {
    if (identity) await syncInbox(identity, queryClient);
  }, [identity, syncInbox, queryClient]);

  const refetchVlogs = vlogsQuery.refetch;
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      if (identity) void refetchVlogs().catch(() => undefined);
    }, [identity, refetchVlogs])
  );

  const vlogs = useMemo(() => vlogsQuery.data?.pages.flat() ?? [], [vlogsQuery.data]);
  const entries = useMemo(() => archiveEntries(vlogs), [vlogs]);
  const stickyMonthIndices = useMemo(() => {
    const indices: number[] = [];
    entries.forEach((entry, index) => {
      if (entry.type === 'month') indices.push(index + 1);
    });
    return indices;
  }, [entries]);
  const nameFor = (pubkey: string) =>
    pubkey === identity?.pubkey ? (identity?.label ?? 'You') : (contactsQuery.data?.[pubkey] ?? shortNpub(pubkey));
  const filtered = Boolean(search.trim() || favouritesOnly || circleId);
  const clearFilters = () => {
    setSearch('');
    setFavouritesOnly(false);
    setCircleId(null);
  };

  return (
    <Screen padded={false} edges={['top', 'left', 'right']}>
      <FlatList<ArchiveEntry>
        data={entries}
        keyExtractor={(item) => item.id}
        stickyHeaderIndices={stickyMonthIndices}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.4}
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
            <PageHeader title="Archive" />
            <TextField
              accessibilityLabel="Search archive"
              placeholder="Search memories"
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
              returnKeyType="search"
              suffix={<Feather name="search" size={18} color={theme.colors.textTertiary} />}
            />
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.lg, flexWrap: 'wrap' }}>
              <FilterChip label="All" active={!favouritesOnly && !circleId} onPress={clearFilters} />
              <FilterChip label="Favourites" active={favouritesOnly} onPress={() => setFavouritesOnly((value) => !value)} />
              {(circlesQuery.data ?? []).map((circle) => (
                <FilterChip
                  key={circle.id}
                  label={circle.name}
                  active={circleId === circle.id}
                  onPress={() => setCircleId((current) => (current === circle.id ? null : circle.id))}
                />
              ))}
            </View>
            {offline ? (
              <View style={{ marginTop: theme.spacing.lg }}>
                <InlineNotice message="Offline · some media may not play" tone="warning" />
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => {
          if (item.type === 'month') {
            return (
              <View
                style={{
                  backgroundColor: theme.colors.background,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.colors.border,
                  paddingTop: theme.spacing.md,
                  paddingBottom: theme.spacing.md,
                }}
              >
                <AppText variant="headline">{item.title}</AppText>
              </View>
            );
          }
          return (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.lg, marginBottom: theme.spacing.xxl }}>
              {item.items.map((vlog) => (
                <VlogGridCard key={vlog.id} vlog={vlog} authorLabel={nameFor(vlog.authorPubkey)} />
              ))}
              {item.items.length === 1 ? <View style={{ flex: 1 }} /> : null}
            </View>
          );
        }}
        ListEmptyComponent={
          !identity || vlogsQuery.isPending ? (
            <VlogListSkeleton />
          ) : vlogsQuery.isError ? (
            <ErrorState title="Couldn’t open Archive" onAction={() => vlogsQuery.refetch()} />
          ) : filtered ? (
            <EmptyState
              title="No matches"
              actionLabel="Clear filters"
              onAction={clearFilters}
            />
          ) : restoring ? (
            <LoadingState label="Restoring Archive" />
          ) : syncing ? (
            <LoadingState label="Checking for moments" />
          ) : (
            <EmptyState
              title="Nothing posted yet"
              actionLabel="Create a moment"
              onAction={() => router.push('/create')}
            />
          )
        }
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
