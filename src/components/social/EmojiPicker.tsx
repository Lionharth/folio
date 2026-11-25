import React, { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';
import { normalizeEmoji } from '../../lib/social/rules';
import { useTheme } from '../../theme/ThemeProvider';

const COMMON = ['\u2764\ufe0f', '\ud83d\ude02', '\ud83d\ude2e', '\ud83d\ude22', '\ud83d\udd25', '\ud83d\udc4f', '\ud83c\udf89', '\ud83d\ude0d', '\ud83e\udd1d', '\ud83d\udcaf', '\ud83d\ude4c', '\ud83d\ude05'];

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const theme = useTheme();
  const [custom, setCustom] = useState('');
  const [error, setError] = useState<string | null>(null);

  const addCustom = () => {
    const emoji = normalizeEmoji(custom);
    if (!emoji) {
      setError('Use an emoji');
      return;
    }
    setError(null);
    setCustom('');
    onPick(emoji);
  };

  return (
    <View
      style={{
        gap: theme.spacing.md,
        padding: theme.spacing.lg,
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface,
      }}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
        {COMMON.map((emoji) => (
          <Pressable
            key={emoji}
            accessibilityRole="button"
            accessibilityLabel={`React with ${emoji}`}
            onPress={() => onPick(emoji)}
            style={({ pressed }) => ({
              width: theme.layout.minTouchTarget,
              height: theme.layout.minTouchTarget,
              borderRadius: theme.radius.sm,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed ? theme.colors.surfaceSubtle : 'transparent',
            })}
          >
            <AppText style={{ fontSize: 22 }}>{emoji}</AppText>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.spacing.sm }}>
        <View style={{ flex: 1 }}>
          <TextField
            value={custom}
            onChangeText={(value) => {
              setCustom(value);
              setError(null);
            }}
            onSubmitEditing={addCustom}
            placeholder="Type or paste an emoji"
            maxLength={32}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            error={error}
          />
        </View>
        <Button label="Add" variant="secondary" onPress={addCustom} />
      </View>
    </View>
  );
}
