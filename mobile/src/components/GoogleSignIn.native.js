import { useEffect, useState } from 'react';
import { Pressable, View, Text, ActivityIndicator } from 'react-native';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { GOOGLE_CLIENT_ID } from '../api';

// Google Sign-In natif (Android/iOS) via @react-native-google-signin.
// On configure avec le CLIENT WEB (GOOGLE_CLIENT_ID) : l'idToken renvoyé a pour
// audience ce client web → le backend le vérifie déjà (/api/auth/google-token).
// Côté Android, Google fait le lien via le package + l'empreinte SHA-1 déclarés
// dans un client OAuth "Android" sur Google Cloud (pas d'ID Android à passer ici).
if (GOOGLE_CLIENT_ID) {
  GoogleSignin.configure({ webClientId: GOOGLE_CLIENT_ID });
}

// `onSuccess(idToken)` / `onError(message)`.
export default function GoogleSignIn({ onSuccess, onError }) {
  const [busy, setBusy] = useState(false);

  useEffect(() => () => setBusy(false), []);

  async function onPress() {
    if (!GOOGLE_CLIENT_ID) {
      onError?.('Set EXPO_PUBLIC_GOOGLE_CLIENT_ID to enable Google sign-in.');
      return;
    }
    setBusy(true);
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const res = await GoogleSignin.signIn();
      // v13+ : { type: 'success', data: { idToken, ... } } | { type: 'cancelled' }
      const idToken = res?.data?.idToken ?? res?.idToken ?? null;
      if (res?.type === 'cancelled') { setBusy(false); return; }
      if (idToken) onSuccess?.(idToken);
      else onError?.('Google sign-in failed (no token).');
    } catch (e) {
      if (e?.code === statusCodes.SIGN_IN_CANCELLED) { /* annulé, silencieux */ }
      else if (e?.code === statusCodes.IN_PROGRESS) { /* déjà en cours */ }
      else if (e?.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) onError?.('Google Play Services unavailable.');
      else onError?.('Google sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      className="flex-row items-center justify-center border border-gray-300 rounded-full py-3 active:opacity-70"
    >
      {busy ? (
        <ActivityIndicator color="#0d6efd" />
      ) : (
        <>
          <View className="w-5 h-5 rounded-full bg-white items-center justify-center mr-2 border border-gray-200">
            <Text style={{ color: '#4285F4', fontWeight: '900', fontSize: 13 }}>G</Text>
          </View>
          <Text className="text-gray-700 font-semibold">Continue with Google</Text>
        </>
      )}
    </Pressable>
  );
}
