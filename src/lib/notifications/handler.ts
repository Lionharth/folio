import * as Notifications from 'expo-notifications';

/**
 * Foreground syncs must stay silent: the Updates feed, tab badge and unread
 * count still update, but no banner, list entry or sound is presented.
 */
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const isTest = notification.request.content.data?.test === true;
    return {
      shouldShowBanner: isTest,
      shouldShowList: isTest,
      shouldPlaySound: isTest,
      shouldSetBadge: false,
    };
  },
});
