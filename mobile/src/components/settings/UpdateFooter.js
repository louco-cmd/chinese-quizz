import { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Platform } from 'react-native';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';
import { COLORS } from '../../theme';

// Pied de page des Réglages : version de l'app + état de l'OTA en cours, et un
// bouton qui télécharge/applique immédiatement une mise à jour (évite le rituel
// "tuer l'app puis relancer deux fois"). Sur le web / Expo Go, expo-updates est
// inactif → on masque le bouton.
export default function UpdateFooter() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const version = Constants.expoConfig?.version || '?';
  const running = Updates.isEmbeddedLaunch
    ? 'bundled (build)'
    : (Updates.createdAt ? new Date(Updates.createdAt).toLocaleString() : 'OTA');
  const canUpdate = Updates.isEnabled && Platform.OS !== 'web';

  async function check() {
    setBusy(true); setMsg('Checking…');
    try {
      const r = await Updates.checkForUpdateAsync();
      if (!r.isAvailable) { setMsg('You’re up to date ✓'); setBusy(false); return; }
      setMsg('Downloading…');
      await Updates.fetchUpdateAsync();
      setMsg('Restarting…');
      await Updates.reloadAsync(); // relance sur le nouveau bundle
    } catch (e) {
      setMsg(`Update failed: ${e?.message || e}`);
      setBusy(false);
    }
  }

  return (
    <View style={{ alignItems: 'center', paddingVertical: 18, gap: 8 }}>
      <Text style={{ fontSize: 12, color: '#b0b4bb' }}>
        Jiayou v{version} · {running}
      </Text>
      {canUpdate ? (
        <Pressable
          onPress={check}
          disabled={busy}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 7 }}
        >
          {busy ? <ActivityIndicator size="small" color={COLORS.jiayou} /> : null}
          <Text style={{ color: COLORS.jiayou, fontSize: 13, fontWeight: '600' }}>
            {busy ? (msg || 'Working…') : 'Check for updates'}
          </Text>
        </Pressable>
      ) : null}
      {!busy && msg ? <Text style={{ fontSize: 12, color: '#9aa0a8' }}>{msg}</Text> : null}
    </View>
  );
}
