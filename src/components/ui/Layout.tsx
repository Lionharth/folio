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
    <View style={{ paddingHorizontal: theme.spacing.sm, paddingVertical: 3, borderRadius: theme.radius.xs, backgroundColor: background }}>
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
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      style={({ pressed }) => ({ backgroundColor: pressed ? theme.colors.surfaceSubtle : 'transparent', minHeight: theme.layout.minTouchTarget })}
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
        gap: theme.spacing.md,
      }}
    >
      <AppText variant="label" color="textSecondary" style={{ flexShrink: 1 }}>
        {title}
      </AppText>
      {action}
    </View>
  );
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  right,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={{ paddingTop: theme.spacing.lg, paddingBottom: theme.spacing.xl, gap: theme.spacing.md }}>
      {eyebrow ? (
        <AppText variant="headline" color="textSecondary" style={{ fontFamily: theme.font.serifMedium }}>
          {eyebrow}
        </AppText>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.spacing.sm }}>
        <View style={{ flex: 1, gap: theme.spacing.xs }}>
          <AppText variant="display">{title}</AppText>
          {subtitle ? (
            <AppText variant="caption" color="textSecondary">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {right}
      </View>
    </View>
  );
}
