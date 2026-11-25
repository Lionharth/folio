import React from 'react';
import { Tabs } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useInboxBootstrap } from '../../hooks/useInboxBootstrap';
import { useTheme } from '../../theme/ThemeProvider';

export default function TabsLayout() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  useInboxBootstrap();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.textPrimary,
        tabBarInactiveTintColor: theme.colors.textTertiary,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          borderTopWidth: 1,
          height: 60 + insets.bottom,
          paddingTop: 6,
          paddingBottom: Math.max(insets.bottom, 6),
        },
        tabBarLabelStyle: {
          fontFamily: theme.font.sansMedium,
          fontSize: 10.5,
          letterSpacing: 0.2,
          marginTop: 2,
        },
        tabBarItemStyle: { paddingVertical: 2, minHeight: 48 },
        sceneStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Tabs.Screen
        name="updates"
        options={{
          title: 'Updates',
          tabBarIcon: ({ color, focused }) => (
            <Feather name="inbox" size={22} color={color as string} style={{ opacity: focused ? 1 : 0.85 }} />
          ),
        }}
      />
      <Tabs.Screen
        name="circles"
        options={{
          title: 'Circles',
          tabBarIcon: ({ color }) => <Feather name="users" size={22} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: 'Create',
          tabBarIcon: ({ color }) => <Feather name="plus-circle" size={24} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="archive"
        options={{
          title: 'Archive',
          tabBarIcon: ({ color }) => <Feather name="archive" size={21} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <Feather name="user" size={22} color={color as string} />,
        }}
      />
    </Tabs>
  );
}
