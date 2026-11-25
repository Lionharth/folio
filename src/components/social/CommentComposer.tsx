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
}

export function CommentComposer({
  initialValue = '',
  mode,
  contextLabel,
  submitting = false,
  disabled = false,
  onSubmit,
  onCancel,
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
        placeholder={mode === 'reply' ? 'Write a reply' : mode === 'edit' ? 'Edit your comment' : 'Add a comment'}
        multiline
        maxLength={MAX_COMMENT_LENGTH}
        editable={!disabled && !submitting}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <AppText variant="caption" color="textTertiary">
          {value.length}/{MAX_COMMENT_LENGTH}
        </AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          {onCancel ? <Button label="Cancel" variant="ghost" onPress={onCancel} /> : null}
          <Button label={label} loading={submitting} disabled={!canSubmit} onPress={() => void submit()} />
        </View>
      </View>
    </View>
  );
}
