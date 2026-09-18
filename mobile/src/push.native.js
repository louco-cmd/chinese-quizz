import { Platform } from 'react-native';

// Le module natif expo-notifications est-il présent dans CE build ? On teste avec
// requireOptionalNativeModule (qui ne throw pas) AVANT de faire un require() de la
// lib — sinon, sur un build livré avant le rebuild, charger la lib peut crasher.
function pushNativeAvailable() {
  try {
    const core = require('expo-modules-core');
    const req = core.requireOptionalNativeModule || core.NativeModulesProxy;
    if (typeof core.requireOptionalNativeModule === 'function') {
      return !!core.requireOptionalNativeModule('ExpoPushTokenManager');
    }
    // Fallback : présence dans le proxy natif.
    return !!(core.NativeModulesProxy && core.NativeModulesProxy.ExpoPushTokenManager);
  } catch { return false; }
}

// Charge les modules SEULEMENT si le natif est présent (jamais sur l'ancien build).
function mods() {
  if (!pushNativeAvailable()) return null;
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

// Enregistre un handler appelé quand l'utilisateur TAPE une notification (app au
// premier plan, en arrière-plan, OU lancée depuis un état tué via le "cold start").
// `handler` reçoit le `data` de la notif (ex. { type:'duel_result', duelId:42 }).
// Renvoie une fonction de nettoyage. No-op si le module natif est absent.
export function addNotificationResponseListener(handler) {
  const m = mods();
  if (!m) return () => {};
  const { Notifications } = m;
  let sub = null;
  try {
    // Cold start : l'app a été ouverte EN TAPANT une notif alors qu'elle était tuée.
    Notifications.getLastNotificationResponseAsync?.()
      .then((resp) => {
        const data = resp?.notification?.request?.content?.data;
        if (data) handler(data);
      })
      .catch(() => {});
    // App déjà lancée (premier plan / arrière-plan).
    sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      const data = resp?.notification?.request?.content?.data;
      if (data) handler(data);
    });
  } catch { /* module absent */ }
  return () => { try { sub?.remove?.(); } catch { /* noop */ } };
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
