import React from 'react';
import { Pressable, View } from 'react-native';
import { router, Tabs } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';

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
  focused,
  onPress,
  onLongPress,
}: {
  routeName: string;
  routeKey: string;
  label: string;
  focused: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const theme = useTheme();
  const color = focused ? theme.colors.textPrimary : theme.colors.textTertiary;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="tab"
      accessibilityLabel={label}
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
      <Feather name={icons[routeName] ?? 'circle'} size={21} color={color} />
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
