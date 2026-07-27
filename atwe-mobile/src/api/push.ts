import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { api } from './client';

/**
 * Native push, wired to the notification engine the backend already has.
 *
 * The server speaks Web Push (VAPID) for the browser. A native device has an
 * APNs/FCM token instead, so it registers through Expo's push service, which
 * holds the certificates and does the delivery. Either way the server is told
 * "this member has a device that can be reached", and the SAME notify() call
 * that lights the bell reaches the phone.
 *
 * Everything here degrades: a simulator has no push hardware, a member may say
 * no, and the whole thing is optional. None of that is an error — it just means
 * notifications arrive while the app is open and not when it is closed.
 */

// How a notification behaves while the app is in the foreground. Showing the
// banner even when the app is open matches iOS convention and means somebody
// reading one chat still sees a message from another.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export interface PushState {
  supported: boolean;
  granted: boolean;
  token: string | null;
  reason?: string;
}

/** Ask for permission and register the device. Safe to call more than once. */
export async function registerForPush(): Promise<PushState> {
  if (!Device.isDevice) {
    return { supported: false, granted: false, token: null, reason: 'Push only works on a real device.' };
  }
  try {
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    // Only ask if we have not already been told. Asking again after a "no" does
    // nothing on iOS anyway, and asking repeatedly is how apps get deleted.
    if (status !== 'granted') {
      const asked = await Notifications.requestPermissionsAsync();
      status = asked.status;
    }
    if (status !== 'granted') {
      return { supported: true, granted: false, token: null, reason: 'Notifications are turned off for Atwe.' };
    }
    if (Platform.OS === 'android') {
      // Android needs a channel or nothing shows at all.
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Atwe',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 100, 200],
        lightColor: '#0088FF',
      });
    }
    const projectId = getProjectId();
    const tok = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await api.post('/api/push/subscribe', {
      // The server stores whatever endpoint it is given; a native token is just
      // another endpoint, sent in the same shape its Web Push rows use.
      endpoint: tok.data,
      native: true,
      platform: Platform.OS,
      keys: {},
    });
    return { supported: true, granted: true, token: tok.data };
  } catch (e) {
    return { supported: true, granted: false, token: null, reason: (e as Error).message };
  }
}

export async function unregisterPush(token: string | null) {
  if (!token) return;
  try { await api.post('/api/push/unsubscribe', { endpoint: token }); } catch { /* leaving a stale row is harmless */ }
}

/** The number on the app icon. */
export async function setBadge(n: number) {
  try { await Notifications.setBadgeCountAsync(Math.max(0, n | 0)); } catch { /* not fatal */ }
}

function getProjectId(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Constants = require('expo-constants').default;
    return (
      Constants?.expoConfig?.extra?.eas?.projectId ??
      Constants?.easConfig?.projectId ??
      undefined
    );
  } catch { return undefined; }
}
