import { Platform } from 'react-native';
import { getAppVersion } from './api';

// Numéro de build natif RÉELLEMENT installé (versionCode Android / build iOS).
// Lu via expo-application → reflète le binaire, insensible aux OTA. Sur un vieux
// build sans le module (ou sur web), on renvoie null → aucun prompt (pas de crash).
export function installedBuild() {
  if (Platform.OS === 'web') return null;
  try {
    const App = require('expo-application');
    const n = parseInt(App.nativeBuildVersion, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// Renvoie l'URL du store si une mise à jour est disponible (build installé <
// dernier build publié), sinon null. Tout échec (réseau, module absent) → null,
// jamais d'erreur remontée : la popup est un bonus, elle ne doit rien bloquer.
export async function checkStoreUpdate() {
  try {
    const mine = installedBuild();
    if (mine == null) return null;
    const info = await getAppVersion();
    const p = info?.[Platform.OS];
    if (p && p.url && Number.isFinite(p.latestBuild) && mine < p.latestBuild) {
      return p.url;
    }
    return null;
  } catch {
    return null;
  }
}
