import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Switch, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as BackgroundTask from 'expo-background-task';

import { AppText } from '../components/ui/AppText';
import { Button } from '../components/ui/Button';
import { Card, Divider } from '../components/ui/Card';
import { IconButton } from '../components/ui/IconButton';
import { PageHeader, SectionHeader } from '../components/ui/Layout';
import { InlineNotice } from '../components/ui/Notice';
import { ScreenScroll } from '../components/ui/Screen';
import { LoadingState } from '../components/ui/States';
import type { NotificationPreferences } from '../lib/notifications/copy';
import { listCirclesForViewer, setCircleMuted } from '../lib/database/vlogs';
import { invalidateCircles, queryKeys } from '../lib/queryKeys';
import {
  getInboxBackgroundTaskStateAsync,
  getNotificationPermissionAsync,
  getNotificationPreferences,
  reconcileNotificationRuntimeAsync,
  requestNotificationPermissionAsync,
  setNotificationPreference,
} from '../services/notifications';
import { useSession } from '../stores/session';
import { useTheme } from '../theme/ThemeProvider';

type Notice = { message: string; tone: 'neutral' | 'success' | 'warning' | 'error' };
type EventPreference = 'posts' | 'invites' | 'membership';

export default function NotificationsScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const identity = useSession((state) => state.identity);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [permission, setPermission] = useState(false);
  const [taskState, setTaskState] = useState<{
    status: BackgroundTask.BackgroundTaskStatus | null;
    registered: boolean;
  }>({ status: null, registered: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const circlesQuery = useQuery({
    queryKey: queryKeys.circles(identity?.pubkey),
    queryFn: () => listCirclesForViewer(identity!.pubkey),
    enabled: Boolean(identity),
  });

  const refreshStatus = useCallback(async () => {
    try {
      const [stored, granted, background] = await Promise.all([
        getNotificationPreferences(),
        getNotificationPermissionAsync(),
        getInboxBackgroundTaskStateAsync(),
      ]);
      setPreferences(stored);
      setPermission(granted);
      setTaskState(background);
    } catch {
      // Keep the last known state; the settings screen remains usable.
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshStatus();
    }, [refreshStatus])
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshStatus();
    });
    return () => subscription.remove();
  }, [refreshStatus]);

  const effectiveEnabled = Boolean(preferences?.enabled && permission);
  const restricted = taskState.status === BackgroundTask.BackgroundTaskStatus.Restricted;

  const setEnabled = async (value: boolean) => {
    if (busy) return;
    setBusy('enabled');
    setNotice(null);
    try {
      await setNotificationPreference('enabled', value);
      if (value) await requestNotificationPermissionAsync();
      await reconcileNotificationRuntimeAsync();
      await refreshStatus();
    } catch (error) {
      setNotice({
        message: error instanceof Error ? error.message : 'Notification settings could not be saved',
        tone: 'error',
      });
    } finally {
      setBusy(null);
    }
  };

  const setEventPreference = async (preference: EventPreference, value: boolean) => {
    if (busy) return;
    setBusy(preference);
    setNotice(null);
    try {
      await setNotificationPreference(preference, value);
      setPreferences((current) => (current ? { ...current, [preference]: value } : current));
    } catch (error) {
      setNotice({
        message: error instanceof Error ? error.message : 'Notification settings could not be saved',
        tone: 'error',
      });
    } finally {
      setBusy(null);
    }
  };

  const toggleCircleMute = async (circleId: string, name: string, muted: boolean) => {
    if (busy) return;
    setBusy(`circle:${circleId}`);
    setNotice(null);
    try {
      await setCircleMuted(circleId, muted);
      if (identity) await invalidateCircles(queryClient, identity.pubkey);
      setNotice({
        message: muted ? `${name} moments are muted.` : `${name} moments will notify again.`,
        tone: 'success',
      });
    } catch (error) {
      setNotice({
        message: error instanceof Error ? error.message : 'The circle could not be updated',
        tone: 'error',
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScreenScroll>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: theme.spacing.sm }}>
        <IconButton icon="arrow-left" label="Back to Profile" onPress={() => router.back()} />
        <AppText variant="meta" color="textSecondary">DEVICE SETTINGS</AppText>
        <View style={{ width: theme.layout.minTouchTarget }} />
      </View>

      <PageHeader
        title="Notifications"
        subtitle="Quiet, local alerts from this device’s active identity."
      />

      {!preferences ? (
        <LoadingState label="Opening notification settings" />
      ) : (
        <View style={{ gap: theme.spacing.md, paddingBottom: theme.spacing.xxxl }}>
          <Card>
            <SettingRow
              title="Notifications"
              subtitle="Allow Folio to show alerts on this device."
              value={effectiveEnabled}
              disabled={Boolean(busy)}
              onValueChange={(value) => void setEnabled(value)}
            />
          </Card>

          {preferences.enabled && !permission ? (
            <InlineNotice
              message="System permission is off. Folio cannot show notifications until you allow them."
              tone="error"
              action={
                <Button
                  label="Open settings"
                  variant="ghost"
                  onPress={() => {
                    void Linking.openSettings().catch(() => undefined);
                  }}
                />
              }
            />
          ) : null}

          {notice ? <InlineNotice message={notice.message} tone={notice.tone} /> : null}

          <SectionHeader title="Alerts" />
          <Card>
            <SettingRow
              title="New moments"
              subtitle="Posts shared in your circles."
              value={preferences.posts}
              disabled={!effectiveEnabled || Boolean(busy)}
              onValueChange={(value) => void setEventPreference('posts', value)}
            />
            <Divider />
            <SettingRow
              title="Invitations"
              subtitle="When someone invites you to a circle."
              value={preferences.invites}
              disabled={!effectiveEnabled || Boolean(busy)}
              onValueChange={(value) => void setEventPreference('invites', value)}
            />
            <Divider />
            <SettingRow
              title="Membership changes"
              subtitle="When someone joins or you are removed."
              value={preferences.membership}
              disabled={!effectiveEnabled || Boolean(busy)}
              onValueChange={(value) => void setEventPreference('membership', value)}
            />
          </Card>

          <SectionHeader title="Background checks" />
          <Card>
            <View style={{ gap: theme.spacing.md }}>
              {restricted ? (
                <InlineNotice
                  message="Background checks are unavailable on this device. Notifications cannot be delivered here."
                  tone="warning"
                />
              ) : (
                <AppText variant="caption" color="textSecondary">
                  {taskState.registered ? 'Scheduled about every 15 minutes when the system allows.' : 'Scheduled after notifications are enabled.'}
                </AppText>
              )}
              <AppText variant="caption" color="textSecondary">
                Delivery is not guaranteed. Force-stopping Folio stops checks, and iOS decides when checks run.
              </AppText>
              <Divider />
              <AppText variant="caption" color="textSecondary">
                Circle and author names may appear on the lock screen and in notification history.
              </AppText>
            </View>
          </Card>

          <SectionHeader title="Muted circles" />
          <Card>
            {circlesQuery.isLoading ? (
              <LoadingState label="Opening circles" />
            ) : circlesQuery.isError ? (
              <InlineNotice message="Couldn’t open circles" tone="error" />
            ) : (circlesQuery.data?.length ?? 0) === 0 ? (
              <AppText variant="caption" color="textSecondary">
                Join a circle to choose per-circle alerts.
              </AppText>
            ) : (
              circlesQuery.data!.map((circle, index) => (
                <View key={circle.id}>
                  <SettingRow
                    title={circle.name}
                    subtitle={circle.muted ? 'Posts are muted' : 'Posts notify'}
                    value={circle.muted}
                    disabled={Boolean(busy)}
                    onValueChange={(value) => void toggleCircleMute(circle.id, circle.name, value)}
                  />
                  {index < circlesQuery.data!.length - 1 ? <Divider /> : null}
                </View>
              ))
            )}
          </Card>
        </View>
      )}
    </ScreenScroll>
  );
}

function SettingRow({
  title,
  subtitle,
  value,
  disabled,
  onValueChange,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        minHeight: theme.layout.minTouchTarget,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="bodyStrong">{title}</AppText>
        {subtitle ? (
          <AppText variant="caption" color="textSecondary">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
        trackColor={{ false: theme.colors.borderStrong, true: theme.colors.ink }}
        thumbColor={theme.colors.surface}
        ios_backgroundColor={theme.colors.borderStrong}
      />
    </View>
  );
}
