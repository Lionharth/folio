import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import { AppText } from '../ui/AppText';
import { useTheme } from '../../theme/ThemeProvider';
import type { ReactionSummary } from '../../lib/social/rules';
import { EmojiPicker } from './EmojiPicker';

export interface ReactionBarProps {
  reactions: ReactionSummary[];
  onToggle: (emoji: string, active: boolean) => void;
  disabled?: boolean;
  compact?: boolean;
}

export function ReactionBar({ reactions, onToggle, disabled = false, compact = false }: ReactionBarProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const size = compact ? 30 : 38;

  const toggle = (emoji: string, active: boolean) => {
    onToggle(emoji, active);
    setOpen(false);
  };

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing.xs }}>
        {reactions.map((reaction) => (
          <Pressable
            key={reaction.emoji}
            accessibilityRole="button"
            accessibilityLabel={`${reaction.emoji} ${reaction.count}`}
            accessibilityState={{ selected: reaction.mine }}
            disabled={disabled}
            hitSlop={compact ? 8 : undefined}
            onPress={() => toggle(reaction.emoji, !reaction.mine)}
            style={({ pressed }) => ({
              minHeight: compact ? 32 : theme.layout.minTouchTarget,
              paddingHorizontal: compact ? theme.spacing.sm : theme.spacing.md,
              borderRadius: theme.radius.pill,
              borderWidth: 1,
              borderColor: reaction.mine ? theme.colors.textPrimary : theme.colors.border,
              backgroundColor: reaction.mine ? theme.colors.surfaceSubtle : 'transparent',
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.xs,
              opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
            })}
          >
            <AppText style={{ fontSize: compact ? 16 : 18 }}>{reaction.emoji}</AppText>
            <AppText variant="caption" color={reaction.mine ? 'textPrimary' : 'textSecondary'}>
              {reaction.count}
            </AppText>
          </Pressable>
        ))}
        {!disabled ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a reaction"
            onPress={() => setOpen((value) => !value)}
            style={({ pressed }) => ({
              width: size,
              height: size,
              minWidth: theme.layout.minTouchTarget,
              minHeight: theme.layout.minTouchTarget,
              borderRadius: theme.radius.pill,
              borderWidth: 1,
              borderColor: theme.colors.border,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Feather name="plus" size={compact ? 14 : 16} color={theme.colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
      {open && !disabled ? <EmojiPicker onPick={(emoji) => {
        const existing = reactions.find((reaction) => reaction.emoji === emoji);
        toggle(emoji, !existing?.mine);
      }} /> : null}
    </View>
  );
}
