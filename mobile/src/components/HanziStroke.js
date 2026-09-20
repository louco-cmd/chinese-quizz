import { useRef, useEffect } from 'react';
import { View, Pressable } from 'react-native';
import { API_BASE } from '../api';
import HANZI_LIB from './hanziWriterLib';

// Web : hanzi-writer tourne directement dans le DOM. On injecte la lib embarquée
// (même source que la WebView native) une seule fois, puis on anime le caractère
// en lecture seule dans le <div> de la View (ref RN-web = nœud DOM). Tap = rejoue.
let libReady = false;
function ensureLib() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (window.HanziWriter) return true;
  if (!libReady) {
    try {
      const s = document.createElement('script');
      // `var HanziWriter=…` au niveau d'un <script> classique devient global.
      s.text = HANZI_LIB + '\n;try{window.HanziWriter=HanziWriter;}catch(e){}';
      document.head.appendChild(s);
      libReady = true;
    } catch { /* noop */ }
  }
  return !!window.HanziWriter;
}

const loader = (c, onLoad, onErr) =>
  fetch(`${API_BASE}/api/m/hanzi/${encodeURIComponent(c)}`)
    .then((r) => { if (!r.ok) throw new Error('http'); return r.json(); })
    .then(onLoad).catch(() => onErr && onErr());

export default function HanziStroke({ char, size = 150 }) {
  const ref = useRef(null);
  const writerRef = useRef(null);

  useEffect(() => {
    if (!char || !ensureLib()) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    try { el.innerHTML = ''; } catch { /* noop */ }
    let cancelled = false;
    const writer = window.HanziWriter.create(el, char, {
      width: size, height: size, padding: 8,
      charDataLoader: loader,
      showCharacter: false, showOutline: true, delayBetweenStrokes: 120,
      strokeColor: '#1a1a2e', outlineColor: '#e2e6ee',
      onLoadCharDataSuccess: () => { if (!cancelled) writer.animateCharacter(); },
    });
    writerRef.current = writer;
    return () => { cancelled = true; writerRef.current = null; };
  }, [char, size]);

  const replay = () => { try { writerRef.current?.animateCharacter?.(); } catch { /* noop */ } };

  return (
    <Pressable onPress={replay}>
      <View ref={ref} style={{ width: size, height: size }} />
    </Pressable>
  );
}
