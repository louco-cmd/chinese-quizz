import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, Pressable, Linking, Platform, PermissionsAndroid, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Android : caméra/micro sont des permissions runtime. react-native-webview ne les
// demande pas lui-même → on les requête avant d'afficher la WebView. No-op si le
// manifeste ne les déclare pas encore (ancien binaire) : la visio tombe alors sur
// le fallback navigateur.
async function ensureMediaPermissions() {
  if (Platform.OS !== 'android') return;
  try {
    await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.CAMERA,
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    ]);
  } catch (e) { /* noop */ }
}
import { Ionicons } from '@expo/vector-icons';
import CatLoader from '../components/CatLoader';
import { ErrorRetry } from '../components/ErrorRetry';
import LessonNotesPanel from '../components/teachers/LessonNotesPanel';
import { getLessonRoom } from '../api';
import { COLORS } from '../theme';

let _WebView;
function getWebView() {
  if (_WebView !== undefined) return _WebView;
  try { _WebView = require('react-native-webview').WebView; } catch (e) { _WebView = null; }
  return _WebView;
}

// Script injecté : détecte la fin d'appel côté fournisseur (Daily poste un
// message window `left-meeting` ; Jitsi expose `videoConferenceLeft`) → on remonte
// `left` à React Native pour enchaîner automatiquement sur la fin de cours, sans
// laisser le prof sur la page « vous avez quitté » du fournisseur.
const LEAVE_DETECT_JS = `(function(){
  function leave(){ try { window.ReactNativeWebView.postMessage('left'); } catch(e){} }
  try {
    window.addEventListener('message', function(e){
      try { var d = e.data || {}; var a = d.action || d.event;
        if (a === 'left-meeting' || a === 'videoConferenceLeft') leave();
      } catch(_){}
    });
  } catch(_){}
  true;
})();`;

export default function VideoCallScreen({ lessonId, displayName, onBack }) {
  var insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  // Évite de déclencher la sortie deux fois (message + Back).
  const leftRef = useRef(false);
  const handleLeave = useCallback(() => { if (leftRef.current) return; leftRef.current = true; onBack?.(); }, [onBack]);

  const load = useCallback(async () => {
    setError('');
    try { setState(await getLessonRoom(lessonId)); }
    catch (e) { setError(e.message); }
  }, [lessonId]);
  useEffect(() => { load(); }, [load]);

  // Demande caméra/micro dès que l'appel est jouable (Android runtime perms).
  useEffect(() => {
    if (state && state.available) ensureMediaPermissions();
  }, [state]);

  const Back = (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.jiayou, paddingHorizontal: 12, paddingVertical: 10, paddingTop: 10 + insets.top }}>
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

  if (!state.available) {
    const msg = state.reason === 'ended'
      ? 'This lesson has ended.'
      : state.starts_at ? 'The call opens 15 minutes before the lesson (starts ' + new Date(state.starts_at).toLocaleString() + ').' : 'The call is not available yet.';
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

  var isDaily = state.url.includes('daily.co');
  var jitsiExtra = displayName ? '&userInfo.displayName=' + encodeURIComponent('"' + displayName + '"') : '';
  var src = isDaily
    ? state.url
    : state.url + '#config.lobby.enabled=false&config.prejoinPageEnabled=false' + jitsiExtra;

  // Notes du prof (host) pendant la visio : colonne latérale si écran large,
  // sinon bouton flottant + overlay. Côté élève : rien.
  const showNotes = !!state.isHost;
  const wide = width >= 900;

  // Enveloppe commune : Back + (notes latérales | média) + notes flottantes.
  const shell = (media) => (
    <View style={{ flex: 1, backgroundColor: '#0b0e12' }}>
      {Back}
      <View style={{ flex: 1, flexDirection: 'row' }}>
        {showNotes && wide ? <LessonNotesPanel lessonId={lessonId} mode="side" /> : null}
        <View style={{ flex: 1, position: 'relative' }}>{media}</View>
      </View>
      {showNotes && !wide ? <LessonNotesPanel lessonId={lessonId} mode="floating" /> : null}
    </View>
  );

  // Web : iframe plein écran.
  if (Platform.OS === 'web') {
    return shell(React.createElement('iframe', {
      src: src, title: 'Lesson call', allow: 'camera; microphone; fullscreen; display-capture; autoplay',
      style: { width: '100%', height: '100%', border: 'none', flex: 1, minHeight: 400 },
    }));
  }

  // Natif : WebView embarquée (caméra + micro autorisés).
  var WebView = getWebView();
  if (WebView) {
    return shell(
      <WebView
        source={{ uri: src }}
        style={{ flex: 1, backgroundColor: '#0b0e12' }}
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback={true}
        mediaCapturePermissionGrantType="grant"
        javaScriptEnabled={true}
        domStorageEnabled={true}
        injectedJavaScript={LEAVE_DETECT_JS}
        onMessage={(e) => { if (e.nativeEvent.data === 'left') handleLeave(); }}
        startInLoadingState={true}
        renderLoading={() => (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b0e12' }}>
            <CatLoader size={90} />
          </View>
        )}
      />
    );
  }

  // Fallback : pas de WebView dans ce binaire → ouverture navigateur externe.
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
        <Pressable onPress={function() { Linking.openURL(state.url); }} style={{ marginTop: 24, backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 15, paddingHorizontal: 40, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="videocam" size={18} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>Join the call</Text>
        </Pressable>
      </View>
    </View>
  );
}
