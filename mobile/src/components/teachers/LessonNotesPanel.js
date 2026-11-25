import { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, TextInput, Pressable, Modal, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getLessonNote, saveLessonNote } from '../../api';
import { COLORS } from '../../theme';

// Bloc de notes PRIVÉES du prof pendant la visio. Un document par cours (slot).
// Autosave debouncé (900 ms) + sauvegarde au blur. `mode` :
//   'side'     → colonne fixe (desktop/tablette large), toujours visible.
//   'floating' → bouton flottant « Notes » + overlay plein écran (mobile).
export default function LessonNotesPanel({ lessonId, mode = 'side' }) {
  const [body, setBody] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | saving | saved | error
  const [open, setOpen] = useState(false);       // overlay (mode floating)
  const timer = useRef(null);
  const lastSaved = useRef('');

  useEffect(() => {
    let alive = true;
    getLessonNote(lessonId)
      .then((r) => { if (!alive) return; setBody(r.body || ''); lastSaved.current = r.body || ''; setLoaded(true); })
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; if (timer.current) clearTimeout(timer.current); };
  }, [lessonId]);

  const persist = useCallback((text) => {
    if (text === lastSaved.current) return;
    setStatus('saving');
    saveLessonNote(lessonId, text)
      .then(() => { lastSaved.current = text; setStatus('saved'); })
      .catch(() => setStatus('error'));
  }, [lessonId]);

  const onChange = (text) => {
    setBody(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => persist(text), 900);
  };
  const flush = () => { if (timer.current) clearTimeout(timer.current); persist(body); };

  const statusLabel = status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : status === 'error' ? 'Not saved' : '';

  const panel = (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: '#eceef2' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Ionicons name="create-outline" size={17} color={COLORS.jiayou} />
          <Text style={{ fontSize: 15, fontWeight: '800', color: '#1a1a2e' }}>Notes</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {statusLabel ? (
            <Text style={{ fontSize: 11.5, color: status === 'error' ? COLORS.danger : COLORS.mutedLight }}>{statusLabel}</Text>
          ) : null}
          {mode === 'floating' ? (
            <Pressable onPress={() => { flush(); setOpen(false); }} hitSlop={8}>
              <Ionicons name="close" size={22} color={COLORS.muted} />
            </Pressable>
          ) : null}
        </View>
      </View>
      {!loaded ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={COLORS.jiayou} /></View>
      ) : (
        <TextInput
          value={body}
          onChangeText={onChange}
          onBlur={flush}
          multiline
          placeholder="Private notes for this lesson — vocabulary, mistakes, homework…"
          placeholderTextColor={COLORS.mutedLight}
          textAlignVertical="top"
          style={{ flex: 1, padding: 16, fontSize: 14.5, lineHeight: 21, color: '#1a1a2e' }}
        />
      )}
      <View style={{ paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: 1, borderColor: '#eceef2' }}>
        <Text style={{ fontSize: 11, color: COLORS.mutedLight }}>Only you can see these notes.</Text>
      </View>
    </View>
  );

  // ── Colonne fixe (desktop/tablette) ──────────────────────────────────────
  if (mode === 'side') {
    return <View style={{ width: 320, borderRightWidth: 1, borderColor: '#0b0e12' }}>{panel}</View>;
  }

  // ── Bouton flottant + overlay (mobile) ───────────────────────────────────
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={{ position: 'absolute', right: 14, bottom: 22, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 15, paddingVertical: 11, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 10, elevation: 6 }}
      >
        <Ionicons name="create-outline" size={17} color={COLORS.jiayou} />
        <Text style={{ fontSize: 13.5, fontWeight: '800', color: COLORS.jiayou }}>Notes</Text>
      </Pressable>
      <Modal visible={open} animationType="slide" transparent={false} statusBarTranslucent onRequestClose={() => { flush(); setOpen(false); }}>
        <View style={{ flex: 1, backgroundColor: '#fff', paddingTop: Platform.OS === 'ios' ? 44 : 0 }}>{panel}</View>
      </Modal>
    </>
  );
}
