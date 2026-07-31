import { useRef, useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme';
import { API_BASE } from '../api';
import HANZI_LIB from './hanziWriterLib';

// Import PARESSEUX + protégé de la WebView : un build livré AVANT le rebuild n'a
// pas le module natif → l'import top-level crasherait au démarrage via l'OTA.
let _WebView = undefined;
function getWebView() {
  if (_WebView !== undefined) return _WebView;
  try { _WebView = require('react-native-webview').WebView; } catch { _WebView = null; }
  return _WebView;
}

// Page HTML : HanziWriter en mode "quiz" (tracé guidé, validé trait par trait).
// La lib est INJECTÉE depuis le bundle et les données de tracés viennent de NOTRE
// API — aucun appel à un CDN. jsDelivr est bloqué/instable en Chine, ce qui
// figeait totalement l'écran : le <script src> distant bloquait l'analyse du
// document, donc le script inline (et le message 'ready') ne s'exécutaient jamais.
const html = (size, apiBase) => `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
  html,body{margin:0;padding:0;background:transparent;overflow:hidden;-webkit-user-select:none;user-select:none;}
  #wrap{display:flex;align-items:center;justify-content:center;height:100vh;}
  #target{background:#f8f9fa;border-radius:20px;}
</style></head><body>
<div id="wrap"><div id="target"></div></div>
<script>${HANZI_LIB}</script>
<script>
  var SIZE=${size}, API=${JSON.stringify(apiBase)}, CURRENT='', writer=null, OUTLINE=false;
  function post(m){ if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m)); }

  // Les tracés passent par notre backend (joignable partout), pas par un CDN.
  // Cache local : un caractère déjà tracé se réaffiche instantanément, et le
  // préchargement du suivant supprime l'attente perçue entre deux mots.
  var CACHE = {};
  function fetchChar(char){
    if(CACHE[char]) return CACHE[char];
    CACHE[char] = fetch(API + '/api/m/hanzi/' + encodeURIComponent(char))
      .then(function(r){ if(!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .catch(function(e){ delete CACHE[char]; throw e; });
    return CACHE[char];
  }
  function loadChar(char, onLoad, onErr){
    fetchChar(char).then(onLoad).catch(function(){ onErr && onErr(); });
  }
  function prefetch(char){ if(char) fetchChar(char).catch(function(){}); }

  function start(ch){
    CURRENT=ch;
    document.getElementById('target').innerHTML='';
    if(!window.HanziWriter){ post({type:'error', reason:'lib'}); return; }
    writer=HanziWriter.create('target', ch, {
      width:SIZE, height:SIZE, padding:10,
      charDataLoader:loadChar,
      showCharacter:false, showOutline:OUTLINE, showHintAfterMisses:3,
      strokeColor:'#1a1a2e', outlineColor:'#e2e6ee', drawingColor:'${COLORS.jiayou}',
      drawingWidth:26, highlightColor:'#a5c8ff', highlightOnComplete:true,
      onLoadCharDataError:function(){ post({type:'error', reason:'data'}); },
      onLoadCharDataSuccess:function(){ post({type:'loaded'}); }
    });
    writer.quiz({
      leniency:1.1,
      onMistake:function(s){ post({type:'mistake', strokeNum:s.strokeNum}); },
      onCorrectStroke:function(s){ post({type:'stroke', remaining:s.strokesRemaining}); },
      onComplete:function(s){ post({type:'complete', mistakes:s.totalMistakes}); }
    });
  }
  function hint(){ if(writer){ writer.animateCharacter({ onComplete:function(){ start(CURRENT); } }); } }
  // Révèle le caractère en EXEMPLE : on réaffiche le contour (OUTLINE) et on anime
  // l'ordre des traits, puis on relance le quiz par-dessus pour le recopier.
  function reveal(){ OUTLINE=true; start(CURRENT); hint(); }
  function onMsg(e){ try{ var d=JSON.parse(e.data);
    if(d.cmd==='start'){ OUTLINE=false; start(d.char); }
    else if(d.cmd==='hint') hint();
    else if(d.cmd==='reveal') reveal();
    else if(d.cmd==='prefetch') prefetch(d.char);
  }catch(err){} }
  window.addEventListener('message', onMsg); document.addEventListener('message', onMsg);
  post({type:'ready'});
</script></body></html>`;

// `char` = caractère à écrire ; `onComplete(mistakes)` quand le tracé est fini.
// `hintNonce` : incrémenter pour déclencher une démo de l'ordre des traits.
// `nextChar` (optionnel) est préchargé pendant que l'utilisateur trace le courant.
export default function HanziQuiz({ char, nextChar, size = 260, onComplete, onProgress, hintNonce = 0, revealNonce = 0 }) {
  const ref = useRef(null);
  const ready = useRef(false);
  const [failed, setFailed] = useState(null); // 'lib' | 'data' | null

  const send = (obj) => ref.current?.injectJavaScript(`onMsg({data:${JSON.stringify(JSON.stringify(obj))}});true;`);

  useEffect(() => { setFailed(null); if (ready.current && char) send({ cmd: 'start', char }); }, [char]);
  useEffect(() => { if (ready.current && nextChar) send({ cmd: 'prefetch', char: nextChar }); }, [nextChar]);
  useEffect(() => { if (ready.current && hintNonce) send({ cmd: 'hint' }); }, [hintNonce]);
  useEffect(() => { if (ready.current && revealNonce) send({ cmd: 'reveal' }); }, [revealNonce]);

  function onMessage(e) {
    let d; try { d = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (d.type === 'ready') { ready.current = true; if (char) send({ cmd: 'start', char }); }
    else if (d.type === 'loaded') setFailed(null);
    else if (d.type === 'error') setFailed(d.reason || 'data');
    else if (d.type === 'complete') onComplete?.(d.mistakes || 0);
    else if (d.type === 'stroke' || d.type === 'mistake') onProgress?.(d);
  }

  const WebView = getWebView();
  if (!WebView) {
    // Ancien build (sans le module natif) : invite à mettre à jour l'app.
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8f9fa', borderRadius: 20, padding: 16 }}>
        <Ionicons name="cloud-download-outline" size={34} color={COLORS.mutedLight} />
        <Text style={{ color: COLORS.muted, textAlign: 'center', marginTop: 10, fontSize: 13 }}>
          Update the app to unlock writing practice.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ width: size, height: size }}>
      <WebView
        ref={ref}
        originWhitelist={['*']}
        source={{ html: html(size, API_BASE), baseUrl: API_BASE }}
        onMessage={onMessage}
        scrollEnabled={false}
        javaScriptEnabled
        domStorageEnabled
        androidLayerType="hardware"
        style={{ width: size, height: size, backgroundColor: 'transparent' }}
      />
      {/* Échec de chargement : on le DIT, au lieu de laisser un cadre vide et figé. */}
      {failed ? (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8f9fa', borderRadius: 20, padding: 18 }}>
          <Ionicons name="cloud-offline-outline" size={32} color={COLORS.mutedLight} />
          <Text style={{ color: COLORS.muted, textAlign: 'center', marginTop: 10, fontSize: 13 }}>
            {failed === 'lib' ? "Couldn't start the writing engine." : "Couldn't load this character. Check your connection."}
          </Text>
          <Pressable onPress={() => { setFailed(null); if (char) send({ cmd: 'start', char }); }} style={{ marginTop: 12, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 18, backgroundColor: COLORS.jiayou }}>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
