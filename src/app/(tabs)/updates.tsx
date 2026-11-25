import React, { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';

import { AppText } from '../../components/ui/AppText';
import { EmptyState, ErrorState } from '../../components/ui/States';
import { PageHeader } from '../../components/ui/Layout';
import { Screen } from '../../components/ui/Screen';
import { VlogRow } from '../../components/vlog/VlogRow';
import { listCircles, listVlogs } from '../../lib/database/vlogs';
import { readSecretKey } from '../../lib/nostr/identity';
import { refreshInbox } from '../../services/inbox';
import { useSession } from '../../stores/session';
import { useTheme } from '../../theme/ThemeProvider';

export default function UpdatesScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const identity = useSession((state) => state.identity);
  const [circleFilter, setCircleFilter] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const circlesQuery = useQuery({ queryKey: ['circles'], queryFn: listCircles });
  const vlogsQuery = useQuery({
    queryKey: ['vlogs', identity?.pubkey, circleFilter],
    queryFn: () => listVlogs(identity!.pubkey, { circleId: circleFilter, limit: 60 }),
    enabled: Boolean(identity),
  });

  const circlesById = useMemo(() => {
    const map = new Map<string, string>();
    for (const circle of circlesQuery.data ?? []) map.set(circle.id, circle.name);
    return map;
  }, [circlesQuery.data]);

  const sync = useCallback(async () => {
    if (!identity || syncing) return;
    setSyncing(true);
    setSyncMessage(null);
    try {
      const secretKey = await readSecretKey(identity.id);
      const result = await refreshInbox(secretKey);
      setSyncMessage(
        result.added > 0
          ? `${result.added} new ${result.added === 1 ? 'update' : 'updates'}`
          : 'You are up to date'
      );
      await queryClient.invalidateQueries({ queryKey: ['vlogs'] });
    } catch (error) {
      setSyncMessage('Could not reach your relays');
      Alert.alert('Sync failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setSyncing(false);
    }
  }, [identity, syncing, queryClient]);

  const vlogs = vlogsQuery.data ?? [];

  return (
    <Screen padded={false}>
      <FlatList
        data={vlogs}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={syncing}
            onRefresh={sync}
            tintColor={theme.colors.textSecondary}
            colors={[theme.colors.textPrimary]}
            progressBackgroundColor={theme.colors.surface}
          />
        }
        ListHeaderComponent={
          <View style={{ paddingHorizontal: theme.layout.screenMargin }}>
            <PageHeader
              title="Updates"
              subtitle={syncMessage ?? 'Life, as it happens.'}
              right={
                <Pressable
                  onPress={sync}
                  accessibilityRole="button"
                  accessibilityLabel="Check for updates"
                  style={{
                    width: theme.layout.minTouchTarget,
                    height: theme.layout.minTouchTarget,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Feather name={syncing ? 'loader' : 'refresh-cw'} size={20} color={theme.colors.textSecondary} />
                </Pressable>
              }
            />
            {(circlesQuery.data ?? []).length > 0 ? (
              <View style={{ marginBottom: theme.spacing.md }}>
                <FlatList
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  data={[{ id: null as string | null, name: 'Everything' }, ...(circlesQuery.data ?? [])]}
                  keyExtractor={(item) => item.id ?? 'all'}
                  renderItem={({ item }) => {
                    const active = circleFilter === item.id;
                    return (
                      <Pressable
                        onPress={() => setCircleFilter(item.id)}
                        style={{
                          paddingHorizontal: theme.spacing.lg,
                          minHeight: 36,
                          borderRadius: theme.radius.pill,
                          borderWidth: 1,
                          borderColor: active ? theme.colors.ink : theme.colors.border,
                          backgroundColor: active ? theme.colors.ink : 'transparent',
                          justifyContent: 'center',
                          marginRight: theme.spacing.sm,
                        }}
                      >
                        <AppText variant="label" color={active ? 'onInk' : 'textSecondary'}>
                          {item.name}
                        </AppText>
                      </Pressable>
                    );
                  }}
                />
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: theme.layout.screenMargin }}>
            <VlogRow
              vlog={{ ...item, circleName: item.circleName ?? circlesById.get(item.circleId ?? '') ?? null }}
            />
          </View>
        )}
        ListEmptyComponent={
          vlogsQuery.isLoading ? (
            <View />
          ) : vlogsQuery.isError ? (
            <View style={{ paddingHorizontal: theme.layout.screenMargin }}>
              <ErrorState
                message={vlogsQuery.error instanceof Error ? vlogsQuery.error.message : undefined}
                onAction={() => vlogsQuery.refetch()}
              />
            </View>
          ) : (
            <View style={{ paddingHorizontal: theme.layout.screenMargin }}>
              <EmptyState
                title="Nothing here yet"
                description="When someone in your circles shares a video, it arrives here in the order it was posted."
                actionLabel={circleFilter ? 'Show everything' : 'Create a circle'}
                onAction={() => (circleFilter ? setCircleFilter(null) : router.push('/(tabs)/circles'))}
              />
            </View>
          )
        }
        contentContainerStyle={{ paddingBottom: theme.spacing.huge }}
      />
    </Screen>
  );
}
