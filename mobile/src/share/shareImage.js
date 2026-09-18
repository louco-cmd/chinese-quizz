// Capture d'une vue en PNG + partage via la feuille native. OTA-SAFE / DORMANT :
// `react-native-view-shot` et `expo-sharing` ne sont présents que sur un build qui
// les embarque. On les charge en LAZY dans un try/catch → sur le binaire actuel
// (sans les modules) `imageShareAvailable()` renvoie false et l'UI de partage est
// simplement masquée. Aucun crash. La feature s'active au prochain build natif.
import { Platform } from 'react-native';

let _mods; // cache : undefined = pas encore résolu, null = indisponible
function mods() {
  if (_mods !== undefined) return _mods;
  if (Platform.OS === 'web') { _mods = null; return _mods; } // capture image = natif
  try {
    // `expo-sharing` fait requireNativeModule('ExpoSharing') au chargement → throw
    // sur un build sans le natif → on retombe en indisponible (dormant).
    _mods = {
      captureRef: require('react-native-view-shot').captureRef,
      Sharing: require('expo-sharing'),
    };
  } catch {
    _mods = null;
  }
  return _mods;
}

// Le partage image est-il disponible sur CE build ? (sert à afficher/masquer l'entrée)
export function imageShareAvailable() {
  return !!mods();
}

// Capture la vue référencée puis ouvre la feuille de partage native.
// Renvoie true si le partage s'est ouvert, false sinon (jamais throw).
export async function captureAndShare(ref, { dialogTitle = 'Jiayou' } = {}) {
  const m = mods();
  if (!m || !ref?.current) return false;
  try {
    const uri = await m.captureRef(ref, { format: 'png', quality: 1, result: 'tmpfile' });
    const canShare = typeof m.Sharing.isAvailableAsync === 'function'
      ? await m.Sharing.isAvailableAsync()
      : true;
    if (!canShare) return false;
    await m.Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle, UTI: 'public.png' });
    return true;
  } catch {
    return false;
  }
}
