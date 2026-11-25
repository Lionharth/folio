import React from 'react';
import { Pressable, View } from 'react-native';

import { useTheme } from '../../theme/ThemeProvider';
import { AppText } from './AppText';
import { Avatar } from './Avatar';
import { Divider } from './Card';

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'accent' | 'danger' }) {
  const theme = useTheme();
  const background =
    tone === 'danger' ? theme.colors.dangerSurface : tone === 'accent' ? theme.colors.ink : theme.colors.surfaceSubtle;
  const color = tone === 'accent' ? 'onInk' : tone === 'danger' ? 'danger' : 'textSecondary';
  return (
    <View style={{ paddingHorizontal: theme.spacing.sm, paddingVertical: 2, borderRadius: theme.radius.xs, backgroundColor: background }}>
      <AppText variant="meta" color={color}>
        {label}
      </AppText>
    </View>
  );
}

export function ListRow({
  title,
  subtitle,
  avatarName,
  right,
  onPress,
  showDivider = true,
  destructive = false,
}: {
  title: string;
  subtitle?: string;
  avatarName?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  showDivider?: boolean;
  destructive?: boolean;
}) {
  const theme = useTheme();
  const content = (
    <View style={{ paddingVertical: theme.spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        {avatarName ? <Avatar name={avatarName} /> : null}
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="bodyStrong" color={destructive ? 'danger' : 'textPrimary'}>
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="caption" color="textSecondary" numberOfLines={2}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {right}
      </View>
      {showDivider ? (
        <View style={{ marginTop: theme.spacing.lg }}>
          <Divider />
        </View>
      ) : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, minHeight: theme.layout.minTouchTarget })}
    >
      {content}
    </Pressable>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: theme.spacing.sm,
        marginTop: theme.spacing.xxl,
      }}
    >
      <AppText variant="label" color="textSecondary">
        {title.toUpperCase()}
      </AppText>
      {action}
    </View>
  );
}

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingTop: theme.spacing.xl,
        paddingBottom: theme.spacing.lg,
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: theme.spacing.md,
      }}
    >
      <View style={{ flex: 1, gap: theme.spacing.xxs }}>
        <AppText variant="display">{title}</AppText>
        {subtitle ? (
          <AppText variant="caption" color="textSecondary">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {right}
    </View>
  );
}
