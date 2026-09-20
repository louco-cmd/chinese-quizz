import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

// Web mobile : à l'ouverture du clavier, la zone visible rétrécit (viewport
// `interactive-widget=resizes-content`) et la TabBar vient se coller juste
// au-dessus du clavier, masquant le bas du contenu (champ de réponse + bouton
// de validation du quiz, par ex.). On détecte l'ouverture via le focus d'un
// champ texte sur écran tactile — plus fiable que de mesurer le viewport, qui
// est justement redimensionné par le navigateur.
//
// Sur natif on renvoie toujours false : Android gère déjà le décalage et on ne
// veut pas changer le comportement existant.
export default function useKeyboardOpen() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    const isTouch = () => !!window.matchMedia?.('(pointer: coarse)')?.matches;
    // Seuls les champs qui ouvrent VRAIMENT le clavier comptent. Un <input> non
    // texte (checkbox/radio/range… — c'est ainsi que react-native-web rend Switch
    // et Toggle) déclenchait à tort l'état « clavier ouvert » et masquait la
    // TabBar à chaque clic sur un toggle. On restreint aux types textuels.
    const TEXT_INPUT = new Set(['text', 'search', 'email', 'password', 'number', 'tel', 'url', '']);
    const isField = (el) =>
      !!el && (
        (el.tagName === 'INPUT' && TEXT_INPUT.has((el.getAttribute('type') || '').toLowerCase()))
        || el.tagName === 'TEXTAREA'
        || el.isContentEditable
      );

    let blurTimer = null;
    const onFocusIn = (e) => {
      if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; }
      if (isTouch() && isField(e.target)) setOpen(true);
    };
    // focusout part AVANT le focusin du champ suivant : on temporise pour éviter
    // que la TabBar clignote quand on passe d'un champ à l'autre.
    const onFocusOut = () => {
      if (blurTimer) clearTimeout(blurTimer);
      blurTimer = setTimeout(() => {
        if (!isField(document.activeElement)) setOpen(false);
      }, 80);
    };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      if (blurTimer) clearTimeout(blurTimer);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  return open;
}
