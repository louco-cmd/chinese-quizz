import { useEffect } from 'react';
import { BackHandler, Platform } from 'react-native';

// Enregistre un handler de retour matériel Android pour un écran à état interne
// (quiz/duel en cours, vue liste de la collection…). RN invoque les handlers en
// ordre LIFO : celui monté ici passe AVANT le handler global d'App.js. Le handler
// doit renvoyer `true` s'il a consommé le retour (a fait un pas en arrière interne),
// `false` pour laisser App.js gérer (remonter au parent / quitter).
//
// `active` permet de n'activer le handler que dans certains états (ex : uniquement
// en vue liste). `deps` = dépendances du handler (comme pour useEffect).
export default function useAndroidBack(handler, active = true, deps = []) {
  useEffect(() => {
    if (Platform.OS === 'web' || !active) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', handler);
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ...deps]);
}
