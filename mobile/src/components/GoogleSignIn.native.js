import { useEffect, useState } from 'react';
import { Pressable, View, Text, ActivityIndicator } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { GOOGLE_CLIENT_ID } from '../api';

WebBrowser.maybeCompleteAuthSession();

// Google Sign-In natif (iOS/Android) : expo-auth-session récupère un id_token,
// qu'on remonte via onSuccess pour l'échanger contre un JWT côté backend.
// `onSuccess(idToken)` / `onError(message)`.
export default function GoogleSignIn({ onSuccess, onError }) {
  const [busy, setBusy] = useState(false);

  // Un repli 'unset' évite que le hook plante quand la clé n'est pas encore
  // définie ; le bouton reste garde-fou dans onPress.
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    webClientId: GOOGLE_CLIENT_ID || 'unset',
    iosClientId: GOOGLE_CLIENT_ID || 'unset',
    androidClientId: GOOGLE_CLIENT_ID || 'unset',
  });

  useEffect(() => {
    if (response?.type === 'success') {
      const idToken = response.params?.id_token;
      setBusy(false);
      if (idToken) onSuccess?.(idToken);
      else onError?.('Google sign-in failed');
    } else if (response?.type === 'error') {
      setBusy(false);
      onError?.('Google sign-in failed');
    } else if (response?.type === 'dismiss' || response?.type === 'cancel') {
      setBusy(false);
    }
  }, [response]);

  async function onPress() {
    if (!GOOGLE_CLIENT_ID) {
      onError?.('Set EXPO_PUBLIC_GOOGLE_CLIENT_ID to enable Google sign-in.');
      return;
    }
    setBusy(true);
    try {
      await promptAsync();
    } catch {
      setBusy(false);
    }
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={busy || !request}
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
