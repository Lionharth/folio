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
import { invalidateActivity, invalidateCircles, queryKeys } from '../lib/queryKeys';
import {
  getInboxBackgroundTaskStateAsync,
  getNotificationPermissionAsync,
  getNotificationPreferences,
  reconcileNotificationRuntimeAsync,
  requestNotificationPermissionAsync,
  sendTestNotificationAsync,
  setNotificationPreference,
} from '../services/notifications';
import { runInboxNotificationCheckAsync } from '../lib/notifications/backgroundTask';
import {
  getPushDebugStateAsync,
  sendRemoteTestPushAsync,
  syncPushRegistrationAsync,
  announcePushTokenToCircleAsync,
} from '../services/push';
import { readSecretKey } from '../lib/nostr/identity';
import { useSession } from '../stores/session';
import { useTheme } from '../theme/ThemeProvider';

type Notice = { message: string; tone: 'neutral' | 'success' | 'warning' | 'error' };
type EventPreference = 'posts' | 'invites' | 'membership' | 'activity';

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
  const [pushState, setPushState] = useState<Awaited<
    ReturnType<typeof getPushDebugStateAsync>
  > | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const circlesQuery = useQuery({
    queryKey: queryKeys.circles(identity?.pubkey),
    queryFn: () => listCirclesForViewer(identity!.pubkey),
    enabled: Boolean(identity),
  });

  const refreshStatus = useCallback(async () => {
    try {
      const [stored, granted, background, push] = await Promise.all([
        getNotificationPreferences(),
        getNotificationPermissionAsync(),
        getInboxBackgroundTaskStateAsync(),
        getPushDebugStateAsync(identity),
      ]);
      setPreferences(stored);
      setPermission(granted);
      setTaskState(background);
      setPushState(push);
    } catch {
      // Keep the last known state; the settings screen remains usable.
    }
  }, [identity]);

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
      if (identity) {
        void syncPushRegistrationAsync(identity, { force: true }).catch(() => undefined);
      }
      void refreshStatus();
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
      if (identity) {
        void syncPushRegistrationAsync(identity, { force: true }).catch(() => undefined);
      }
    } catch (error) {
      setNotice({
        message: error instanceof Error ? error.message : 'Notification settings could not be saved',
        tone: 'error',
      });
    } finally {
      setBusy(null);
    }
  };

  const runNotificationTest = async () => {
    if (busy) return;
    setBusy('test');
    setNotice(null);
    try {
      if (!permission) {
        setNotice({ message: 'Grant notification permission first.', tone: 'warning' });
        return;
      }
      const scheduled = await sendTestNotificationAsync();
      setNotice({
        message: scheduled
          ? 'Test notification sent.'
          : 'The system refused to schedule the test notification.',
        tone: scheduled ? 'success' : 'error',
      });
    } finally {
      setBusy(null);
    }
  };

  const runInboxCheck = async () => {
    if (busy) return;
    setBusy('check');
    setNotice(null);
    try {
      if (!preferences?.enabled || !permission) {
        setNotice({ message: 'Enable notifications and grant permission first.', tone: 'warning' });
        return;
      }
      await runInboxNotificationCheckAsync();
      setNotice({
        message: 'Inbox check finished. New events should have notified.',
        tone: 'success',
      });
      void refreshStatus();
    } finally {
      setBusy(null);
    }
  };

  const runRemoteTest = async () => {
    if (busy) return;
    setBusy('remote');
    setNotice(null);
    try {
      if (!permission || !preferences?.enabled) {
        setNotice({ message: 'Enable notifications and grant permission first.', tone: 'warning' });
        return;
      }
      const result = await sendRemoteTestPushAsync(identity);
      setNotice({ message: result, tone: 'neutral' });
      void refreshStatus();
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
      if (identity) {
        void readSecretKey(identity.id)
          .then((secretKey) => announcePushTokenToCircleAsync(secretKey, circleId))
          .catch(() => undefined);
      }
      if (identity) {
        await Promise.all([
          invalidateCircles(queryClient, identity.pubkey),
          invalidateActivity(queryClient, identity.pubkey),
        ]);
      }
      setNotice({
        message: muted ? `${name} alerts are muted.` : `${name} alerts will notify again.`,
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
        subtitle="Quiet alerts from this device’s active identity, with best-effort remote delivery."
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

          {preferences.enabled && permission && pushState && !pushState.projectConfigured ? (
            <InlineNotice
              message="Remote push needs an EAS project ID and push credentials. Local background checks still work."
              tone="warning"
            />
          ) : null}

          {pushState?.lastError ? (
            <InlineNotice message={`Remote push: ${pushState.lastError}`} tone="warning" />
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
              title="Replies and reactions"
              subtitle="Comments and reactions on your moments and comments."
              value={preferences.activity}
              disabled={!effectiveEnabled || Boolean(busy)}
              onValueChange={(value) => void setEventPreference('activity', value)}
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
                Remote moments and replies can arrive through Expo push while Folio is closed. Invitations wait for the next background check.
              </AppText>
              <AppText variant="caption" color="textSecondary">
                Delivery is not guaranteed. Force-stopping Folio stops checks, and iOS decides when checks run.
              </AppText>
              <Divider />
              <AppText variant="caption" color="textSecondary">
                Remote push copy is generic. Local notifications may show circle and author names on the lock screen.
              </AppText>
            </View>
          </Card>

          <SectionHeader title="Test notifications" />
          <Card>
            <View style={{ gap: theme.spacing.md }}>
              <AppText variant="caption" color="textSecondary">
                Permission: {permission ? 'granted' : 'not granted'} · Background task:{' '}
                {taskState.registered ? 'registered' : 'not registered'} · Remote push:{' '}
                {pushState
                  ? pushState.projectConfigured
                    ? pushState.token
                      ? 'token ready'
                      : 'no token'
                    : 'no EAS project'
                  : 'checking'}
              </AppText>
              <Button
                label="Send test notification"
                variant="secondary"
                fullWidth
                loading={busy === 'test'}
                disabled={Boolean(busy)}
                onPress={() => void runNotificationTest()}
              />
              <Button
                label="Run inbox check now"
                variant="secondary"
                fullWidth
                loading={busy === 'check'}
                disabled={Boolean(busy)}
                onPress={() => void runInboxCheck()}
              />
              <Button
                label="Send remote test push"
                variant="secondary"
                fullWidth
                loading={busy === 'remote'}
                disabled={Boolean(busy)}
                onPress={() => void runRemoteTest()}
              />
              <AppText variant="caption" color="textTertiary">
                The test notification is allowed in the foreground. The inbox check only notifies
                if another identity produced a new event.
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
                    subtitle={circle.muted ? 'All alerts muted' : 'All alerts on'}
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
