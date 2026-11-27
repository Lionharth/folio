import React from 'react';
import { FlatList, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { AppText } from '../../../components/ui/AppText';
import { Button } from '../../../components/ui/Button';
import { IconButton } from '../../../components/ui/IconButton';
import { Screen } from '../../../components/ui/Screen';
import { EmptyState, ErrorState, LoadingState, VlogListSkeleton } from '../../../components/ui/States';
import { VlogRow } from '../../../components/vlog/VlogRow';
import { listContactNames } from '../../../lib/database/contacts';
import { getCircle, listCircleMembers, listVlogs } from '../../../lib/database/vlogs';
import { shortNpub } from '../../../lib/nostr/format';
import { queryKeys } from '../../../lib/queryKeys';
import { useSession } from '../../../stores/session';
import { useTheme } from '../../../theme/ThemeProvider';

const PAGE_SIZE = 12;

export default function CircleMomentsScreen() {
  const theme = useTheme();
  const identity = useSession((state) => state.identity);
  const { id } = useLocalSearchParams<{ id: string }>();

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
  const nameFor = (pubkey: string) =>
    pubkey === identity?.pubkey ? (identity?.label ?? 'You') : (contactsQuery.data?.[pubkey] ?? shortNpub(pubkey));
  const vlogs = vlogsQuery.data?.pages.flat() ?? [];

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
          gap: theme.spacing.xs,
          paddingVertical: theme.spacing.sm,
          paddingHorizontal: theme.layout.screenMargin,
          backgroundColor: theme.colors.background,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
        }}
      >
        <IconButton icon="arrow-left" label="Back to circles" onPress={() => router.back()} />
        <View style={{ flex: 1, paddingHorizontal: theme.spacing.xs }}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {circle.name}
          </AppText>
          <AppText variant="caption" color="textSecondary" numberOfLines={1}>
            {members.length} {members.length === 1 ? 'member' : 'members'}
          </AppText>
        </View>
        <IconButton
          icon="settings"
          label="Circle details and members"
          onPress={() => router.push({ pathname: '/circle/[id]/settings', params: { id } })}
        />
        <IconButton
          icon="plus"
          label="Create a moment"
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
        renderItem={({ item, index }) => (
          <VlogRow vlog={item} authorLabel={nameFor(item.authorPubkey)} variant={index === 0 ? 'hero' : 'standard'} />
        )}
        ListEmptyComponent={
          vlogsQuery.isLoading ? (
            <View style={{ paddingTop: theme.spacing.md }}>
              <VlogListSkeleton />
            </View>
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
        contentContainerStyle={{
          paddingHorizontal: theme.layout.screenMargin,
          paddingTop: theme.spacing.md,
          paddingBottom: theme.spacing.huge,
          flexGrow: 1,
        }}
      />
    </Screen>
  );
}
