import React from 'react';
import { Pressable, View } from 'react-native';
import { router, Tabs } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Feather from '@expo/vector-icons/Feather';

import { countUnread } from '../../lib/database/vlogs';
import { queryKeys } from '../../lib/queryKeys';
import { useSession } from '../../stores/session';
import { useTheme } from '../../theme/ThemeProvider';
import { AppText } from './AppText';

type FolioTabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>>[0];

const icons: Record<string, React.ComponentProps<typeof Feather>['name']> = {
  updates: 'inbox',
  circles: 'users',
  archive: 'archive',
  profile: 'user',
};

export function FolioTabBar({ state, descriptors, emitter, navigateToTab, insets }: FolioTabBarProps) {
  const theme = useTheme();
  const identity = useSession((session) => session.identity);
  const unreadQuery = useQuery({
    queryKey: queryKeys.unread(identity?.pubkey),
    queryFn: () => countUnread(identity!.pubkey),
    enabled: Boolean(identity),
  });
  const unreadCount = identity ? (unreadQuery.data ?? 0) : 0;

  return (
    <View
      style={{
        height: theme.layout.tabBarHeight + insets.bottom,
        paddingBottom: Math.max(insets.bottom, theme.spacing.sm),
        paddingTop: theme.spacing.xs,
        paddingHorizontal: theme.spacing.sm,
        flexDirection: 'row',
        alignItems: 'flex-start',
        backgroundColor: theme.colors.surface,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
      }}
    >
      {state.routes.map((route, index) => {
        const item = (
          <TabButton
            key={route.key}
            routeName={route.name}
            routeKey={route.key}
            label={descriptors[route.key]?.options.title ?? route.name}
            badgeCount={route.name === 'updates' ? unreadCount : 0}
            focused={state.index === index}
            onPress={() => {
              const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true, data: undefined });
              if (state.index !== index && !event.defaultPrevented) navigateToTab(route.key);
            }}
            onLongPress={() => emitter.emit({ type: 'tabLongPress', target: route.key, data: undefined })}
          />
        );
        return (
          <React.Fragment key={route.key}>
            {index === 2 ? <CreateButton /> : null}
            {item}
          </React.Fragment>
        );
      })}
    </View>
  );
}

function TabButton({
  routeName,
  label,
  badgeCount,
  focused,
  onPress,
  onLongPress,
}: {
  routeName: string;
  routeKey: string;
  label: string;
  badgeCount: number;
  focused: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const theme = useTheme();
  const color = focused ? theme.colors.textPrimary : theme.colors.textTertiary;
  const badgeLabel = badgeCount > 99 ? 'more than 99' : String(badgeCount);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="tab"
      accessibilityLabel={badgeCount > 0 ? `${label}, ${badgeLabel} unread` : label}
      accessibilityState={{ selected: focused }}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 48,
        minHeight: 60,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
        opacity: pressed ? 0.65 : 1,
      })}
    >
      <View style={{ position: 'relative' }}>
        <Feather name={icons[routeName] ?? 'circle'} size={21} color={color} />
        {badgeCount > 0 ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: -7,
              right: -12,
              minWidth: 16,
              height: 16,
              paddingHorizontal: 4,
              borderRadius: 8,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.colors.ink,
            }}
          >
            <AppText variant="meta" style={{ color: theme.colors.onInk, fontSize: 9.5, lineHeight: 11 }}>
              {badgeCount > 99 ? '99+' : badgeCount}
            </AppText>
          </View>
        ) : null}
      </View>
      <AppText variant="meta" style={{ color, fontSize: 10.5, lineHeight: 14 }}>{label}</AppText>
      <View style={{ width: 16, height: 2, borderRadius: 1, backgroundColor: focused ? color : 'transparent' }} />
    </Pressable>
  );
}

function CreateButton() {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, minWidth: 64, minHeight: 60, alignItems: 'center', justifyContent: 'center' }}>
      <Pressable
        onPress={() => router.push('/create')}
        accessibilityRole="button"
        accessibilityLabel="Create a moment"
        style={({ pressed }) => ({
          width: 52,
          height: 48,
          borderRadius: theme.radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.ink,
          opacity: pressed ? 0.82 : 1,
          transform: [{ scale: pressed ? 0.96 : 1 }],
        })}
      >
        <Feather name="plus" size={25} color={theme.colors.onInk} />
      </Pressable>
    </View>
  );
}
