import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, Pressable, Linking, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import CatLoader from '../components/CatLoader';
import { ErrorRetry } from '../components/ErrorRetry';
import { getLessonRoom } from '../api';
import { COLORS } from '../theme';
// Écran d'appel visio (Jitsi). Web → iframe embarquée. Natif → ouverture de la
// room dans le navigateur / l'app Jitsi (Linking) — l'embed natif viendra avec le
// SDK au prochain build.
export default function VideoCallScreen({ lessonId, displayName, onBack }) {
  const [state, setState] = useState(null); // { available, url, reason, starts_at }
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setState(await getLessonRoom(lessonId)); }
    catch (e) { setError(e.message); }
  }, [lessonId]);
  useEffect(() => { load(); }, [load]);

  const Back = (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.jiayou, paddingHorizontal: 12, paddingVertical: 10 }}>
      <Pressable onPress={onBack} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Ionicons name="chevron-back" size={22} color="#fff" />
        <Text style={{ color: '#fff', fontWeight: '700' }}>Back</Text>
      </Pressable>
      <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: 0.5 }}>加油</Text>
    </View>
  );

  if (!state && !error) {
    return <View style={{ flex: 1, backgroundColor: '#0b0e12', alignItems: 'center', justifyContent: 'center' }}><CatLoader size={110} /></View>;
  }
  if (error) {
    return <View style={{ flex: 1, backgroundColor: '#0b0e12' }}>{Back}<ErrorRetry onRetry={load} /></View>;
  }

  // Hors fenêtre horaire.
  if (!state.available) {
    const msg = state.reason === 'ended'
      ? 'This lesson has ended.'
      : state.starts_at ? `The call opens 15 minutes before the lesson (starts ${new Date(state.starts_at).toLocaleString()}).` : 'The call is not available yet.';
    return (
      <View style={{ flex: 1, backgroundColor: '#0b0e12' }}>
        {Back}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
          <Ionicons name={state.reason === 'ended' ? 'time-outline' : 'hourglass-outline'} size={48} color="#5a6b8a" />
          <Text style={{ color: '#cfd6e4', fontSize: 15, textAlign: 'center', marginTop: 14, lineHeight: 22 }}>{msg}</Text>
        </View>
      </View>
    );
  }

  const isDaily = state.url.includes('daily.co');
  const jitsiExtra = displayName ? '&userInfo.displayName=' + encodeURIComponent('"' + displayName + '"') : '';
  const src = isDaily
    ? state.url
    : state.url + '#config.lobby.enabled=false&config.prejoinPageEnabled=false' + jitsiExtra;

  // Web : iframe plein écran.
  if (Platform.OS === 'web') {
    return (
      <View style={{ flex: 1, backgroundColor: '#0b0e12' }}>
        {Back}
        <View style={{ flex: 1, position: 'relative' }}>
          {React.createElement('iframe', {
            src, title: 'Lesson call', allow: 'camera; microphone; fullscreen; display-capture; autoplay',
            style: { width: '100%', height: '100%', border: 'none', flex: 1, minHeight: 400 },
          })}
        </View>
      </View>
    );
  }

  // Natif : ouverture dans le navigateur / app Jitsi.
  return (
    <View style={{ flex: 1, backgroundColor: '#0b0e12' }}>
      {Back}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
        <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: COLORS.jiayou, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="videocam" size={42} color="#fff" />
        </View>
        <Text style={{ color: '#fff', fontSize: 19, fontWeight: '800', marginTop: 18, textAlign: 'center' }}>Your lesson call is ready</Text>
        <Text style={{ color: '#9aa7bd', fontSize: 13.5, marginTop: 8, textAlign: 'center', lineHeight: 20 }}>
          The call opens in your browser.
        </Text>
        <Pressable onPress={() => Linking.openURL(state.url)} style={{ marginTop: 24, backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 15, paddingHorizontal: 40, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="videocam" size={18} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>Join the call</Text>
        </Pressable>
      </View>
    </View>
  );
}
