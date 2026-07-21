import { useRef, useEffect } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme';

// Import PARESSEUX + protégé de la WebView : un build livré AVANT le rebuild n'a
// pas le module natif → l'import top-level crasherait au démarrage via l'OTA.
let _WebView = undefined;
function getWebView() {
  if (_WebView !== undefined) return _WebView;
  try { _WebView = require('react-native-webview').WebView; } catch { _WebView = null; }
  return _WebView;
}

// Page HTML : HanziWriter en mode "quiz" (tracé guidé, validé trait par trait).
// Charge la lib + les données de traits depuis le CDN jsDelivr (une WebView peut,
// contrairement à un Artifact). Communique avec RN via postMessage.
const html = (size) => `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
  html,body{margin:0;padding:0;background:transparent;overflow:hidden;-webkit-user-select:none;user-select:none;}
  #wrap{display:flex;align-items:center;justify-content:center;height:100vh;}
  #target{background:#f8f9fa;border-radius:20px;}
</style></head><body>
<div id="wrap"><div id="target"></div></div>
<script src="https://cdn.jsdelivr.net/npm/hanzi-writer@3.7.0/dist/hanzi-writer.min.js"></script>
<script>
  var SIZE=${size}, CURRENT='', writer=null;
  function post(m){ if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  function start(ch){
    CURRENT=ch;
    document.getElementById('target').innerHTML='';
    if(!window.HanziWriter){ post({type:'error'}); return; }
    writer=HanziWriter.create('target', ch, {
      width:SIZE, height:SIZE, padding:10,
      showCharacter:false, showOutline:true, showHintAfterMisses:3,
      strokeColor:'#1a1a2e', outlineColor:'#e2e6ee', drawingColor:'${COLORS.jiayou}',
      drawingWidth:26, highlightColor:'#a5c8ff', highlightOnComplete:true
    });
    writer.quiz({
      leniency:1.1,
      onMistake:function(s){ post({type:'mistake', strokeNum:s.strokeNum}); },
      onCorrectStroke:function(s){ post({type:'stroke', remaining:s.strokesRemaining}); },
      onComplete:function(s){ post({type:'complete', mistakes:s.totalMistakes}); }
    });
  }
  function hint(){ if(writer){ writer.animateCharacter({ onComplete:function(){ start(CURRENT); } }); } }
  function onMsg(e){ try{ var d=JSON.parse(e.data);
    if(d.cmd==='start') start(d.char);
    else if(d.cmd==='hint') hint();
  }catch(err){} }
  window.addEventListener('message', onMsg); document.addEventListener('message', onMsg);
  post({type:'ready'});
</script></body></html>`;

// `char` = caractère à écrire ; `onComplete(mistakes)` quand le tracé est fini.
// `hintNonce` : incrémenter pour déclencher une démo de l'ordre des traits.
export default function HanziQuiz({ char, size = 260, onComplete, onProgress, hintNonce = 0 }) {
  const ref = useRef(null);
  const ready = useRef(false);

  const send = (obj) => ref.current?.injectJavaScript(`onMsg({data:${JSON.stringify(JSON.stringify(obj))}});true;`);

  useEffect(() => { if (ready.current && char) send({ cmd: 'start', char }); }, [char]);
  useEffect(() => { if (ready.current && hintNonce) send({ cmd: 'hint' }); }, [hintNonce]);

  function onMessage(e) {
    let d; try { d = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (d.type === 'ready') { ready.current = true; if (char) send({ cmd: 'start', char }); }
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
        source={{ html: html(size) }}
        onMessage={onMessage}
        scrollEnabled={false}
        javaScriptEnabled
        domStorageEnabled
        androidLayerType="hardware"
        style={{ width: size, height: size, backgroundColor: 'transparent' }}
      />
    </View>
  );
}
