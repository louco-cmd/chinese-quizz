import { useEffect, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// Sign in with Apple sur WEB via « Sign in with Apple JS » (mode popup).
// Le popup renvoie directement un id_token (audience = Services ID) qu'on échange
// contre notre JWT via le MÊME endpoint que le natif (/api/auth/apple-token).
// Pas de clé .p8 ni de callback serveur nécessaires pour ce flux.
// `onSuccess(idToken, name)` / `onError(message)`.
//
// Prérequis Apple : un Services ID (EXPO_PUBLIC_APPLE_SERVICES_ID) configuré avec
// le domaine app.jiayou.fr vérifié + la Return URL = https://app.jiayou.fr.
const APPLE_SERVICES_ID = process.env.EXPO_PUBLIC_APPLE_SERVICES_ID || 'fr.jiayou.web';
const SDK_SRC = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';

function loadAppleSdk() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return reject(new Error('no window'));
    if (window.AppleID) return resolve(window.AppleID);
    const existing = document.getElementById('apple-signin-sdk');
    if (existing) { existing.addEventListener('load', () => resolve(window.AppleID)); existing.addEventListener('error', reject); return; }
    const s = document.createElement('script');
    s.id = 'apple-signin-sdk';
    s.src = SDK_SRC; s.async = true;
    s.onload = () => resolve(window.AppleID);
    s.onerror = () => reject(new Error('Apple SDK failed to load'));
    document.head.appendChild(s);
  });
}

export default function AppleSignIn({ onSuccess, onError }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!APPLE_SERVICES_ID || typeof window === 'undefined') return;
    loadAppleSdk().then((AppleID) => {
      AppleID.auth.init({
        clientId: APPLE_SERVICES_ID,
        scope: 'name email',
        redirectURI: window.location.origin, // doit matcher une Return URL du Services ID
        usePopup: true,
      });
      setReady(true);
    }).catch(() => { /* SDK indispo : bouton masqué */ });
  }, []);

  if (!APPLE_SERVICES_ID) return null; // pas configuré → on n'affiche rien

  async function onPress() {
    try {
      const res = await window.AppleID.auth.signIn();
      const idToken = res?.authorization?.id_token;
      // Le nom n'est fourni qu'au 1er login (comme sur natif).
      const n = res?.user?.name;
      const name = n ? [n.firstName, n.lastName].filter(Boolean).join(' ').trim() : '';
      if (idToken) onSuccess?.(idToken, name);
      else onError?.('Apple sign-in failed (no token).');
    } catch (e) {
      const code = e?.error;
      if (code === 'popup_closed_by_user' || code === 'user_cancelled_authorize') return; // annulé
      onError?.('Apple sign-in failed.');
    }
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={!ready}
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#000', borderRadius: 999, height: 48, opacity: ready ? 1 : 0.6 }}
    >
      <Ionicons name="logo-apple" size={18} color="#fff" style={{ marginRight: 8 }} />
      <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>Continue with Apple</Text>
    </Pressable>
  );
}
