/**
 * Headless background task. The crypto polyfill must load before nostr-tools,
 * exactly like the root layout does on a normal launch.
 */
import '../crypto/polyfill';

import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { getInboxState, listRelayStates } from '../database/inboxState';
import { acquireSyncLock } from '../database/syncLock';
import { getActiveIdentity, readSecretKey } from '../nostr/identity';
import { DEFAULT_DM_RELAYS } from '../nostr/relays';
import { refreshInbox } from '../../services/inbox';
import {
  effectiveNotificationsEnabled,
  emitInboxNotifications,
  getNotificationPreferences,
  INBOX_BACKGROUND_TASK,
  setIconBadgeFromUnreadsAsync,
} from '../../services/notifications';

export async function runInboxNotificationCheckAsync(): Promise<BackgroundTask.BackgroundTaskResult> {
  try {
    const preferences = await getNotificationPreferences();
    if (!(await effectiveNotificationsEnabled(preferences))) {
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    const identity = await getActiveIdentity();
    if (!identity) return BackgroundTask.BackgroundTaskResult.Success;

    const [inboxState, relayStates] = await Promise.all([
      getInboxState(identity.pubkey),
      listRelayStates(identity.pubkey, DEFAULT_DM_RELAYS),
    ]);
    const allRelaysBackfilled = [...relayStates.values()].every((relay) => relay.backfillComplete);
    if (!inboxState?.lastSyncAt && (!inboxState?.backfillComplete || !allRelaysBackfilled)) {
      // A fresh restore can page in hundreds of moments. Once an incremental
      // cursor exists, one bad relay must not block notifications forever.
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    const lock = await acquireSyncLock(0);
    if (!lock) return BackgroundTask.BackgroundTaskResult.Success;

    try {
      let secretKey: Uint8Array;
      try {
        secretKey = await readSecretKey(identity.id);
      } catch {
        // iOS may keep the keychain locked while the device is locked.
        return BackgroundTask.BackgroundTaskResult.Success;
      }

      const result = await refreshInbox(secretKey, DEFAULT_DM_RELAYS, { collectEvents: true });
      if (result.anyRelaySucceeded) {
        await emitInboxNotifications(result.events, identity);
        await setIconBadgeFromUnreadsAsync(identity.pubkey);
      }
      return BackgroundTask.BackgroundTaskResult.Success;
    } finally {
      await lock.release();
    }
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
}

if (!TaskManager.isTaskDefined(INBOX_BACKGROUND_TASK)) {
  TaskManager.defineTask(INBOX_BACKGROUND_TASK, async () => runInboxNotificationCheckAsync());
}
