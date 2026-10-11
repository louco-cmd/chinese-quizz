// Capture d'une vue en PNG + partage via la feuille native. OTA-SAFE / DORMANT.
//
// ⚠️ Détection SANS charger les modules natifs : `require('react-native-view-shot')`
// au render peut CRASHER EN DUR sur un build qui n'embarque pas le module (New
// Architecture) — un simple try/catch ne suffit pas. On teste donc la présence du
// module natif via `requireOptionalNativeModule` (qui NE throw PAS et NE charge PAS
// view-shot). Les vrais `require(...)` n'ont lieu que dans captureAndShare, sur
// action utilisateur — jamais atteinte sur un build sans le natif (bouton masqué).
import { Platform } from 'react-native';

// 🔒 MASTER-SWITCH. La share card part DORMANTE dans ce build : son visuel est encore
// un placeholder. On l'activera plus tard, par simple OTA (passer à true), une fois le
// design définitif prêt — aucun rebuild requis. Tant que false, le bouton Share reste
// masqué PARTOUT, même si le module natif est bien embarqué dans le binaire.
const SHARE_CARD_ENABLED = false;

// Le partage image est-il disponible sur CE build ? (affiche/masque l'entrée UI)
export function imageShareAvailable() {
  if (!SHARE_CARD_ENABLED) return false; // kill-switch tant que le design n'est pas prêt
  if (Platform.OS === 'web') return false; // capture image = natif pour l'instant
  try {
    const core = require('expo-modules-core');
    if (typeof core.requireOptionalNativeModule === 'function') {
      // expo-sharing + react-native-view-shot sont livrés ensemble → la présence
      // du natif d'expo-sharing suffit à savoir si le build les embarque.
      return !!core.requireOptionalNativeModule('ExpoSharing');
    }
    return !!(core.NativeModulesProxy && core.NativeModulesProxy.ExpoSharing);
  } catch {
    return false;
  }
}

// Capture la vue référencée puis ouvre la feuille de partage native.
// Renvoie true si le partage s'est ouvert, false sinon (jamais throw).
export async function captureAndShare(ref, { dialogTitle = 'Jiayou' } = {}) {
  if (!imageShareAvailable() || !ref?.current) return false;
  try {
    const { captureRef } = require('react-native-view-shot');
    const Sharing = require('expo-sharing');
    const uri = await captureRef(ref, { format: 'png', quality: 1, result: 'tmpfile' });
    const canShare = typeof Sharing.isAvailableAsync === 'function'
      ? await Sharing.isAvailableAsync()
      : true;
    if (!canShare) return false;
    await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle, UTI: 'public.png' });
    return true;
  } catch {
    return false;
  }
}
