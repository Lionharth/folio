import * as Notifications from 'expo-notifications';

/**
 * Foreground syncs must stay silent: the Updates feed, tab badge and unread
 * count still update, but no banner, list entry or sound is presented.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});
