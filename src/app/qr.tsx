import React, { useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';

import { AppText } from '../components/ui/AppText';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { IconButton } from '../components/ui/IconButton';
import { InlineNotice } from '../components/ui/Notice';
import { ScreenScroll } from '../components/ui/Screen';
import { LoadingState } from '../components/ui/States';
import { useSession } from '../stores/session';
import { useTheme } from '../theme/ThemeProvider';

export default function QrScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const identity = useSession((state) => state.identity);
  const [notice, setNotice] = useState<{ message: string; tone: 'neutral' | 'error' } | null>(null);

  if (!identity) return <LoadingState label="Opening QR code" />;

  const contentWidth = Math.min(width - 2 * theme.layout.screenMargin, theme.layout.maxContentWidth);
  const qrSize = Math.max(200, Math.min(contentWidth - 2 * theme.spacing.xl - 2 * theme.spacing.lg, 280));

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(identity.npub);
      setNotice({ message: 'Folio ID copied', tone: 'neutral' });
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : 'Could not copy Folio ID', tone: 'error' });
    }
  };

  return (
    <ScreenScroll>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingTop: theme.spacing.sm, marginBottom: theme.spacing.xl }}>
        <IconButton icon="x" label="Close QR code" onPress={() => router.back()} />
        <AppText variant="headline" style={{ flex: 1 }}>Folio ID</AppText>
      </View>

      {notice ? <View style={{ marginBottom: theme.spacing.lg }}><InlineNotice message={notice.message} tone={notice.tone} /></View> : null}

      <Card style={{ alignItems: 'center', gap: theme.spacing.xl }}>
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel="Folio ID QR code"
          style={{
            backgroundColor: '#FFFFFF',
            padding: theme.spacing.lg,
            borderRadius: theme.radius.md,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <QRCode value={identity.npub} size={qrSize} ecl="M" color="#171717" backgroundColor="#FFFFFF" />
        </View>
        <AppText variant="caption" color="textSecondary" align="center">
          Lets someone invite this identity to a circle.
        </AppText>
        <AppText variant="mono" selectable align="center">
          {identity.npub}
        </AppText>
        <Button label="Copy Folio ID" variant="secondary" fullWidth onPress={() => void copy()} />
      </Card>
    </ScreenScroll>
  );
}
