import { Platform } from 'react-native';

// Import PARESSEUX + protégé : un build livré AVANT le rebuild n'a pas les modules
// natifs (expo-notifications/expo-device) → l'import top-level crasherait via l'OTA.
function mods() {
  try {
    return {
      Notifications: require('expo-notifications'),
      Device: require('expo-device'),
      Constants: require('expo-constants').default,
    };
  } catch { return null; }
}

// Affiche les notifications reçues quand l'app est au premier plan.
export function configureNotificationHandler() {
  const m = mods();
  if (!m) return;
  try {
    m.Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true }),
    });
  } catch { /* module absent */ }
}

// Demande la permission et renvoie le token Expo Push (ou null). À envoyer au backend.
export async function registerForPush() {
  const m = mods();
  if (!m) return null;
  const { Notifications, Device, Constants } = m;
  try {
    if (!Device.isDevice) return null; // émulateur sans services push
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const projectId = Constants?.expoConfig?.extra?.eas?.projectId || Constants?.easConfig?.projectId;
    const res = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    return res?.data || null;
  } catch { return null; }
}
