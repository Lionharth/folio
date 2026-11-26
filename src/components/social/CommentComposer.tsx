import React, { useState } from 'react';
import { View } from 'react-native';

import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';
import { MAX_COMMENT_LENGTH } from '../../lib/social/rules';
import { useTheme } from '../../theme/ThemeProvider';

export type ComposerMode = 'create' | 'reply' | 'edit';

export interface CommentComposerProps {
  initialValue?: string;
  mode: ComposerMode;
  contextLabel?: string | null;
  submitting?: boolean;
  disabled?: boolean;
  onSubmit: (value: string) => Promise<boolean> | boolean;
  onCancel?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

export function CommentComposer({
  initialValue = '',
  mode,
  contextLabel,
  submitting = false,
  disabled = false,
  onSubmit,
  onCancel,
  onFocus,
  onBlur,
}: CommentComposerProps) {
  const theme = useTheme();
  const [value, setValue] = useState(initialValue);
  const canSubmit = value.trim().length > 0 && !disabled && !submitting;
  const label = mode === 'edit' ? 'Save' : 'Send';
  const submit = async () => {
    if (!canSubmit) return;
    const accepted = await onSubmit(value);
    if (accepted) setValue('');
  };

  return (
    <View style={{ gap: theme.spacing.sm }}>
      {contextLabel ? (
        <View
          style={{
            alignSelf: 'flex-start',
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: theme.spacing.xs,
            borderRadius: theme.radius.pill,
            backgroundColor: theme.colors.surfaceSubtle,
          }}
        >
          <AppText variant="caption" color="textSecondary">
            {contextLabel}
          </AppText>
        </View>
      ) : null}
      <TextField
        value={value}
        onChangeText={setValue}
        accessibilityLabel={mode === 'reply' ? 'Write a reply' : mode === 'edit' ? 'Edit your comment' : 'Add a comment'}
        autoFocus={mode !== 'create'}
        placeholder={mode === 'reply' ? 'Write a reply' : mode === 'edit' ? 'Edit your comment' : 'Add a comment'}
        multiline
        maxLength={MAX_COMMENT_LENGTH}
        editable={!disabled && !submitting}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          {value.length >= MAX_COMMENT_LENGTH * 0.85 ? (
            <AppText variant="caption" color="textTertiary">
              {MAX_COMMENT_LENGTH - value.length} left
            </AppText>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          {onCancel ? <Button label="Cancel" variant="ghost" onPress={onCancel} /> : null}
          <Button label={label} loading={submitting} disabled={!canSubmit} onPress={() => void submit()} />
        </View>
      </View>
    </View>
  );
}
