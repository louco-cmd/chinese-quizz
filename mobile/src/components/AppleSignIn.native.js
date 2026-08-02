import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

// Sign in with Apple natif (iOS uniquement). Obligatoire dès qu'on propose un
// login tiers (Google) — règle App Store 4.8.
//
// Require PARESSEUX + protégé : sur un build sans le module natif (Android, ou
// iOS avant le build qui l'embarque), `require` peut échouer → on retombe sur
// null, aucun crash. On n'affiche RIEN hors iOS ou si l'API n'est pas dispo.
// `onSuccess(identityToken, name)` / `onError(message)`.
let Apple = null;
function getApple() {
  if (Apple !== null) return Apple || null;
  try { Apple = require('expo-apple-authentication'); } catch { Apple = false; }
  return Apple || null;
}

export default function AppleSignIn({ onSuccess, onError }) {
  const [available, setAvailable] = useState(false);
  const AA = getApple();

  useEffect(() => {
    if (Platform.OS !== 'ios' || !AA) return undefined;
    let mounted = true;
    AA.isAvailableAsync()
      .then((ok) => { if (mounted) setAvailable(ok); })
      .catch(() => { /* module absent : on laisse masqué */ });
    return () => { mounted = false; };
  }, [AA]);

  if (Platform.OS !== 'ios' || !AA || !available) return null;

  async function onPress() {
    try {
      const cred = await AA.signInAsync({
        requestedScopes: [
          AA.AppleAuthenticationScope.FULL_NAME,
          AA.AppleAuthenticationScope.EMAIL,
        ],
      });
      // Apple ne renvoie le nom qu'au TOUT PREMIER login → on le remonte ici.
      const name = cred.fullName
        ? [cred.fullName.givenName, cred.fullName.familyName].filter(Boolean).join(' ').trim()
        : '';
      if (cred.identityToken) onSuccess?.(cred.identityToken, name);
      else onError?.('Apple sign-in failed (no token).');
    } catch (e) {
      if (e?.code === 'ERR_REQUEST_CANCELED') return; // annulé → silencieux
      onError?.(`Apple sign-in failed${e?.message ? `: ${e.message}` : ''}`);
    }
  }

  return (
    <AA.AppleAuthenticationButton
      buttonType={AA.AppleAuthenticationButtonType.CONTINUE}
      buttonStyle={AA.AppleAuthenticationButtonStyle.BLACK}
      cornerRadius={999}
      style={{ width: '100%', height: 48 }}
      onPress={onPress}
    />
  );
}
