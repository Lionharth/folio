import { Platform } from 'react-native';
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import { AndroidImportance, IosAuthorizationStatus } from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { countUnreadActivity } from '../lib/database/activity';
import { getContactNames } from '../lib/database/contacts';
import { getSetting, setSetting } from '../lib/database/settings';
import { countUnread, listCircles } from '../lib/database/vlogs';
import { listRemoteNotifiedAsync } from '../lib/notifications/remoteNotified';
import {
  buildInboxNotifications,
  type InboxNotificationEvents,
  type NotificationPreferences,
  type NotificationRequest,
} from '../lib/notifications/copy';
import type { StoredIdentity } from '../lib/nostr/identity';

export const INBOX_BACKGROUND_TASK = 'folio-inbox-notifications';
export const MINIMUM_BACKGROUND_INTERVAL_MINUTES = 15;

const PREFERENCE_KEYS = {
  enabled: 'notifications.enabled',
  posts: 'notifications.posts',
  invites: 'notifications.invites',
  membership: 'notifications.membership',
  activity: 'notifications.activity',
} as const;

const MOMENTS_CHANNEL = 'moments';
const CIRCLES_CHANNEL = 'circles';
const SOCIAL_CHANNEL = 'social';

async function isPermissionGranted(status: Notifications.NotificationPermissionsStatus): Promise<boolean> {
  return status.granted || status.ios?.status === IosAuthorizationStatus.PROVISIONAL;
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const [enabled, posts, invites, membership, activity] = await Promise.all([
    getSetting(PREFERENCE_KEYS.enabled),
    getSetting(PREFERENCE_KEYS.posts),
    getSetting(PREFERENCE_KEYS.invites),
    getSetting(PREFERENCE_KEYS.membership),
    getSetting(PREFERENCE_KEYS.activity),
  ]);
  return {
    enabled: enabled === '1',
    posts: posts !== '0',
    invites: invites !== '0',
    membership: membership !== '0',
    activity: activity !== '0',
  };
}

export async function setNotificationPreference(
  preference: keyof NotificationPreferences,
  value: boolean
): Promise<void> {
  await setSetting(PREFERENCE_KEYS[preference], value ? '1' : '0');
}

export async function ensureAndroidChannelsAsync(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Promise.all([
    Notifications.setNotificationChannelAsync(MOMENTS_CHANNEL, {
      name: 'New moments',
      importance: AndroidImportance.DEFAULT,
    }),
    Notifications.setNotificationChannelAsync(CIRCLES_CHANNEL, {
      name: 'Invitations and circle changes',
      importance: AndroidImportance.DEFAULT,
    }),
    Notifications.setNotificationChannelAsync(SOCIAL_CHANNEL, {
      name: 'Replies and reactions',
      importance: AndroidImportance.DEFAULT,
    }),
  ]);
}

export async function getNotificationPermissionAsync(): Promise<boolean> {
  try {
    return await isPermissionGranted(await Notifications.getPermissionsAsync());
  } catch {
    return false;
  }
}

/**
 * Creates the Android channels first: the Android 13 permission prompt does not
 * appear until at least one channel exists.
 */
export async function requestNotificationPermissionAsync(): Promise<boolean> {
  try {
    await ensureAndroidChannelsAsync();
    const status = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    return await isPermissionGranted(status);
  } catch {
    return false;
  }
}

export async function effectiveNotificationsEnabled(preferences: NotificationPreferences): Promise<boolean> {
  if (!preferences.enabled) return false;
  return getNotificationPermissionAsync();
}

export async function registerInboxBackgroundTaskAsync(): Promise<void> {
  if (!TaskManager.isTaskDefined(INBOX_BACKGROUND_TASK)) return;
  try {
    await BackgroundTask.registerTaskAsync(INBOX_BACKGROUND_TASK, {
      minimumInterval: MINIMUM_BACKGROUND_INTERVAL_MINUTES,
    });
  } catch {
    // The system may refuse registration; the foreground app still works.
  }
}

export async function unregisterInboxBackgroundTaskAsync(): Promise<void> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(INBOX_BACKGROUND_TASK)) {
      await BackgroundTask.unregisterTaskAsync(INBOX_BACKGROUND_TASK);
    }
  } catch {
    // Best-effort: registration is reconciled again on the next foreground.
  }
}

async function scheduleRequestAsync(request: NotificationRequest): Promise<void> {
  const trigger =
    Platform.OS === 'android'
      ? {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: 1,
          channelId: request.channel,
        }
      : null;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: request.title,
      body: request.body,
      data: {
        url: request.data.url,
        ...(request.data.test ? { test: true } : {}),
      },
    },
    trigger,
  });
}

export async function emitInboxNotifications(
  events: InboxNotificationEvents,
  identity: StoredIdentity
): Promise<number> {
  const hasEvents =
    events.moments.length > 0 ||
    events.invites.length > 0 ||
    events.membership.length > 0 ||
    events.social.length > 0;
  if (!hasEvents) return 0;

  const preferences = await getNotificationPreferences();
  if (!(await effectiveNotificationsEnabled(preferences))) return 0;

  const circles = await listCircles();
  const pubkeys = new Set<string>();
  for (const event of events.moments) pubkeys.add(event.authorPubkey);
  for (const event of events.invites) pubkeys.add(event.ownerPubkey);
  for (const event of events.membership) pubkeys.add(event.memberPubkey);
  for (const event of events.social) pubkeys.add(event.actorPubkey);
  const names = await getContactNames([...pubkeys]);
  const mutedCircleIds = circles.filter((circle) => circle.muted).map((circle) => circle.id);
  const remoteNotified = await listRemoteNotifiedAsync();
  const requests = buildInboxNotifications({
    events,
    preferences,
    mutedCircleIds,
    remoteNotifiedMomentIds: remoteNotified.moments,
    remoteNotifiedSocialIds: remoteNotified.social,
    remoteNotifiedInviteCircleIds: remoteNotified.invites,
    names,
    viewerPubkey: identity.pubkey,
  });
  if (requests.length === 0) return 0;

  await ensureAndroidChannelsAsync();
  let scheduled = 0;
  for (const request of requests) {
    try {
      await scheduleRequestAsync(request);
      scheduled += 1;
    } catch {
      // The moment remains in Updates even if the OS refuses the notification.
    }
  }
  return scheduled;
}

export async function sendTestNotificationAsync(): Promise<boolean> {
  try {
    await ensureAndroidChannelsAsync();
    await scheduleRequestAsync({
      channel: 'moments',
      title: 'Folio test notification',
      body: 'Background checks are ready.',
      data: { url: '/updates', test: true },
    });
    return true;
  } catch {
    return false;
  }
}

export async function setIconBadgeFromUnreadsAsync(pubkey: string): Promise<void> {
  try {
    const preferences = await getNotificationPreferences();
    if (!(await effectiveNotificationsEnabled(preferences))) return;
    const [moments, activity] = await Promise.all([
      countUnread(pubkey),
      countUnreadActivity(pubkey),
    ]);
    await Notifications.setBadgeCountAsync(moments + activity);
  } catch {
    // Launchers may not support icon badges.
  }
}

export async function clearIconBadgeAsync(): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(0);
  } catch {
    // Best-effort only.
  }
}

export async function getInboxBackgroundTaskStateAsync(): Promise<{
  status: BackgroundTask.BackgroundTaskStatus | null;
  registered: boolean;
}> {
  try {
    const [status, registered] = await Promise.all([
      BackgroundTask.getStatusAsync(),
      TaskManager.isTaskRegisteredAsync(INBOX_BACKGROUND_TASK),
    ]);
    return { status, registered };
  } catch {
    return { status: null, registered: false };
  }
}

/** Registers the background task only while notifications are truly enabled. */
export async function reconcileNotificationRuntimeAsync(): Promise<boolean> {
  try {
    await ensureAndroidChannelsAsync();
    const effective = await effectiveNotificationsEnabled(await getNotificationPreferences());
    if (effective) {
      await registerInboxBackgroundTaskAsync();
    } else {
      await unregisterInboxBackgroundTaskAsync();
      await clearIconBadgeAsync();
    }
    return effective;
  } catch {
    return false;
  }
}
