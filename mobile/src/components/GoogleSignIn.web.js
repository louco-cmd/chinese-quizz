import { useEffect, useRef, useState } from 'react';
import { View, Text } from 'react-native';
import { GOOGLE_CLIENT_ID } from '../api';

// Google Sign-In web via Google Identity Services (GIS).
// Le bouton officiel renvoie un `credential` (= id_token JWT Google) qu'on
// remonte via onSuccess pour l'échanger contre notre JWT (POST /api/auth/google-token,
// le MÊME endpoint que le natif). `onSuccess(idToken)` / `onError(message)`.
//
// ⚠️ Prérequis Google Cloud : le GOOGLE_CLIENT_ID doit être un client OAuth de
// type "Web", et l'origine du site (http://localhost:8081 en dev, https://jiayou.fr
// en prod) doit figurer dans « Authorized JavaScript origins ».

const GIS_SRC = 'https://accounts.google.com/gsi/client';

// Charge le script GIS une seule fois (idempotent).
function loadGis() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('no window'));
    if (window.google?.accounts?.id) return resolve(window.google);

    const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.google));
      existing.addEventListener('error', () => reject(new Error('gis load error')));
      return;
    }
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve(window.google);
    s.onerror = () => reject(new Error('gis load error'));
    document.head.appendChild(s);
  });
}

export default function GoogleSignIn({ onSuccess, onError }) {
  const containerRef = useRef(null);
  const [failed, setFailed] = useState('');

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) { setFailed('unset'); return; }
    let cancelled = false;

    loadGis()
      .then((google) => {
        if (cancelled) return;
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (resp) => {
            if (resp?.credential) onSuccess?.(resp.credential);
            else onError?.('Google sign-in failed');
          },
        });
        // Sous react-native-web, le ref d'une View pointe vers le div DOM.
        const node = containerRef.current;
        if (node && node.appendChild) {
          google.accounts.id.renderButton(node, {
            type: 'standard',
            theme: 'outline',
            size: 'large',
            shape: 'pill',
            text: 'continue_with',
            logo_alignment: 'center',
            width: 320,
          });
        } else {
          setFailed('nodomnode');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setFailed('load');
        onError?.('Could not load Google Sign-In.');
      });

    return () => { cancelled = true; };
  }, []);

  if (!GOOGLE_CLIENT_ID) {
    return (
      <Text style={{ color: '#dc3545', fontSize: 13, textAlign: 'center' }}>
        Set EXPO_PUBLIC_GOOGLE_CLIENT_ID to enable Google sign-in.
      </Text>
    );
  }

  // La View sert de conteneur DOM où GIS injecte son bouton officiel.
  return <View ref={containerRef} style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }} />;
}
