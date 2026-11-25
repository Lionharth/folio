import React from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';

import { AppText } from '../../components/ui/AppText';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { PageHeader } from '../../components/ui/Layout';
import { Screen } from '../../components/ui/Screen';
import { listCircleMembers, listCircles } from '../../lib/database/vlogs';
import { useTheme } from '../../theme/ThemeProvider';

export default function CirclesScreen() {
  const theme = useTheme();
  const circlesQuery = useQuery({
    queryKey: ['circles-with-members'],
    queryFn: async () => {
      const circles = await listCircles();
      return Promise.all(
        circles.map(async (circle) => ({
          ...circle,
          members: await listCircleMembers(circle.id),
        }))
      );
    },
  });

  const circles = circlesQuery.data ?? [];

  return (
    <Screen padded={false}>
      <FlatList
        data={circles}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={{ paddingHorizontal: theme.layout.screenMargin }}>
            <PageHeader
              title="Circles"
              subtitle="Private groups of friends"
              right={
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
              }
            />
          </View>
        }
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
