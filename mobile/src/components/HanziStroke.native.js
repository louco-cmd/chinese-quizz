import { useRef, useState } from 'react';
import { View, Pressable, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme';
import { API_BASE } from '../api';
import HANZI_LIB from './hanziWriterLib';

// Import paresseux + protégé de la WebView (cf. HanziQuiz.native.js) : un OTA livré
// avant le rebuild n'a pas le module natif → l'import top-level crasherait.
let _WebView = undefined;
function getWebView() {
  if (_WebView !== undefined) return _WebView;
  try { _WebView = require('react-native-webview').WebView; } catch { _WebView = null; }
  return _WebView;
}

// Viewer LECTURE SEULE de l'ordre des traits (pas de quiz) : anime le caractère en
// boucle douce ; un tap relance l'animation. Données de tracés via NOTRE proxy
// (/api/m/hanzi/:char → hanzi-writer-data), lib injectée depuis le bundle (pas de CDN).
const html = (size) => `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
  html,body{margin:0;padding:0;background:transparent;overflow:hidden;-webkit-user-select:none;user-select:none;}
  #wrap{display:flex;align-items:center;justify-content:center;height:100vh;}
  #target{background:transparent;}
</style></head><body>
<div id="wrap"><div id="target"></div></div>
<script>${HANZI_LIB}</script>
<script>
  var SIZE=${size}, API=${JSON.stringify(API_BASE)}, writer=null;
  function post(m){ if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  function loadChar(char, onLoad, onErr){
    fetch(API + '/api/m/hanzi/' + encodeURIComponent(char))
      .then(function(r){ if(!r.ok) throw new Error('http'); return r.json(); })
      .then(onLoad).catch(function(){ onErr && onErr(); });
  }
  function animate(){ if(writer) writer.animateCharacter(); }
  function start(ch){
    document.getElementById('target').innerHTML='';
    if(!window.HanziWriter){ post({type:'error'}); return; }
    writer=HanziWriter.create('target', ch, {
      width:SIZE, height:SIZE, padding:8,
      charDataLoader:loadChar,
      showCharacter:false, showOutline:true, strokeAnimationSpeed:1, delayBetweenStrokes:120,
      strokeColor:'#1a1a2e', outlineColor:'#e2e6ee',
      onLoadCharDataError:function(){ post({type:'error'}); },
      onLoadCharDataSuccess:function(){ post({type:'loaded'}); animate(); }
    });
  }
  function onMsg(e){ try{ var d=JSON.parse(e.data);
    if(d.cmd==='start') start(d.char);
    else if(d.cmd==='replay') animate();
  }catch(err){} }
  window.addEventListener('message', onMsg); document.addEventListener('message', onMsg);
  post({type:'ready'});
</script></body></html>`;

export default function HanziStroke({ char, size = 150 }) {
  const ref = useRef(null);
  const ready = useRef(false);
  const [failed, setFailed] = useState(false);
  const WebView = getWebView();

  const send = (obj) => ref.current?.injectJavaScript(`onMsg({data:${JSON.stringify(JSON.stringify(obj))}});true;`);

  function onMessage(e) {
    let d; try { d = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (d.type === 'ready') { ready.current = true; if (char) send({ cmd: 'start', char }); }
    else if (d.type === 'loaded') setFailed(false);
    else if (d.type === 'error') setFailed(true);
  }

  // Ancien build sans WebView → on masque simplement le viewer (la décompo reste).
  if (!WebView) return null;

  return (
    <Pressable onPress={() => ready.current && send({ cmd: 'replay' })} style={{ width: size, height: size }}>
      <WebView
        ref={ref}
        originWhitelist={['*']}
        source={{ html: html(size), baseUrl: API_BASE }}
        onMessage={onMessage}
        scrollEnabled={false}
        javaScriptEnabled
        domStorageEnabled
        androidLayerType="hardware"
        pointerEvents="none"
        style={{ width: size, height: size, backgroundColor: 'transparent' }}
      />
      {failed ? (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="brush-outline" size={26} color={COLORS.mutedLight} />
        </View>
      ) : null}
    </Pressable>
  );
}
