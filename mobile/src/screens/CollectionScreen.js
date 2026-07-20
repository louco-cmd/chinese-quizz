import { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, Animated, PanResponder, FlatList,
  useWindowDimensions, Platform, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import { Loading, ErrorRetry } from '../components/ErrorRetry';
import Popup from '../components/Popup';
import { COLORS, SHADOW_CARD_FLAT } from '../theme';
import { getCollection, updateWord, deleteWord, getCharacter, getMe } from '../api';

const speak = (t, lang = 'zh-CN') => { if (t) Speech.speak(t, { language: lang }); };

function scorePicto(s) {
  if (s >= 90) return '🏆';
  if (s >= 75) return '😎';
  if (s >= 50) return '🙂';
  if (s >= 25) return '😐';
  return '🌱';
}

const circleBtn = {
  width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff',
  borderWidth: 1, borderColor: COLORS.line, alignItems: 'center', justifyContent: 'center',
  // ombre iOS uniquement (pas d'elevation) : ces boutons vivent dans la carte
  // animée en opacity → l'elevation Android donnerait un halo gris pendant le fondu.
  shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 12,
};

export default function CollectionScreen() {
  const { width, height } = useWindowDimensions();
  const cardW = Math.min(width * 0.86, 340);
  const cardH = Math.min(height * 0.62, 500);

  const [words, setWords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [idx, setIdx] = useState(0);
  const [hideTranslation, setHideTranslation] = useState(false);
  const [view, setView] = useState('card');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const [ef, setEf] = useState({ chinese: '', pinyin: '', english: '', description: '' });
  const [confirmDel, setConfirmDel] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [charInfo, setCharInfo] = useState(null); // { char, loading, data }
  const [busy, setBusy] = useState(false);
  const [direction, setDirection] = useState('en→zh'); // sens d'apprentissage

  const fade = useRef(new Animated.Value(1)).current;        // change de carte
  const screenFade = useRef(new Animated.Value(1)).current;  // change de vue
  const viewRef = useRef('card');
  viewRef.current = view;
  const switchingRef = useRef(false);
  const lenRef = useRef(0);
  lenRef.current = words.length;

  const load = useCallback(async () => {
    setError('');
    try {
      const d = await getCollection();
      setWords(d.words || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Sens d'apprentissage : zh→en → on inverse l'affichage de la carte.
  useEffect(() => {
    getMe().then((u) => { if (u?.quiz_direction) setDirection(u.quiz_direction); }).catch(() => {});
  }, []);

  // Bascule carte ↔ liste avec fondu (disparition puis apparition)
  const switchView = useCallback((next) => {
    if (switchingRef.current || next === viewRef.current) return;
    switchingRef.current = true;
    Animated.timing(screenFade, { toValue: 0, duration: 130, useNativeDriver: true }).start(() => {
      setView(next);
      screenFade.setValue(0);
      Animated.timing(screenFade, { toValue: 1, duration: 180, useNativeDriver: true })
        .start(() => { switchingRef.current = false; });
    });
  }, [screenFade]);

  // Web : molette vers le bas depuis la carte → vue liste.
  // (Le scroll vers le haut dans la liste ne repasse PAS en vue carte : on laisse
  // la liste défiler librement ; le bouton grille sert à revenir aux cartes.)
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onWheel = (e) => {
      if (e.deltaY > 30 && viewRef.current === 'card') switchView('list');
    };
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => window.removeEventListener('wheel', onWheel);
  }, [switchView]);

  const go = (dir) => {
    const len = lenRef.current;
    if (!len) return;
    setIdx((i) => (dir === 'next' ? (i + 1) % len : (i - 1 + len) % len));
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  };

  async function openChar(ch) {
    setCharInfo({ char: ch, loading: true, data: null });
    try {
      const { character } = await getCharacter(ch);
      setCharInfo({ char: ch, loading: false, data: character });
    } catch {
      setCharInfo({ char: ch, loading: false, data: null });
    }
  }

  function openEdit(word) {
    setEf({ chinese: word.chinese || '', pinyin: word.pinyin || '', english: word.english || '', description: word.description || '' });
    setEditing(word);
  }
  async function saveEdit() {
    if (!editing) return;
    setBusy(true);
    try {
      const { word } = await updateWord(editing.id, ef);
      setWords((ws) => ws.map((x) => (x.id === editing.id ? { ...x, ...word } : x)));
      setEditing(null);
    } catch { /* garde la popup */ } finally { setBusy(false); }
  }
  async function doDelete() {
    if (!confirmDel) return;
    const id = confirmDel.id;
    setBusy(true);
    try {
      await deleteWord(id);
      setWords((ws) => ws.filter((x) => x.id !== id));
      setIdx((i) => { const nl = Math.max(words.length - 1, 1); return i >= nl ? nl - 1 : i; });
      setConfirmDel(null);
    } catch { /* garde la popup */ } finally { setBusy(false); }
  }

  const cardPan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 14 || Math.abs(g.dy) > 14,
      onPanResponderRelease: (_, g) => {
        if (Math.abs(g.dx) > Math.abs(g.dy) && Math.abs(g.dx) > 40) go(g.dx < 0 ? 'next' : 'prev');
        else if (g.dy < -40 && Math.abs(g.dy) > Math.abs(g.dx)) switchView('list');
      },
    })
  ).current;

  const listPan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 16 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderRelease: (_, g) => { if (g.dy > 50) switchView('card'); },
    })
  ).current;

  if (loading) return <Loading />;
  if (error) return <ErrorRetry error={error} onRetry={load} />;
  if (!words.length) {
    return (
      <View className="flex-1 items-center justify-center px-8 bg-surface-page">
        <Ionicons name="documents-outline" size={40} color={COLORS.mutedLight} />
        <Text className="text-muted mt-3 text-center">No words yet. Add some from “Add Word”.</Text>
      </View>
    );
  }

  const len = words.length;
  const w = words[idx % len];

  // ── Vue LISTE ──
  if (view === 'list') {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? words.filter((x) =>
          (x.chinese || '').toLowerCase().includes(q)
          || (x.pinyin || '').toLowerCase().includes(q)
          || (x.english || '').toLowerCase().includes(q))
      : words;
    return (
      <Animated.View style={{ flex: 1, backgroundColor: COLORS.page, opacity: screenFade }}>
        <View style={{ flex: 1, width: '100%', maxWidth: 600, alignSelf: 'center' }}>
        <View {...listPan.panHandlers} style={{ paddingTop: 8 }}>
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.line, marginBottom: 8 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8 }}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search your words…"
              placeholderTextColor={COLORS.mutedLight}
              autoCapitalize="none"
              style={{ flex: 1, backgroundColor: '#fff', borderRadius: 999, borderWidth: 1, borderColor: COLORS.line, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15 }}
            />
            <Pressable onPress={() => switchView('card')} hitSlop={10} style={{ marginLeft: 12 }}>
              <Ionicons name="grid" size={24} color={COLORS.jiayou} />
            </Pressable>
          </View>
        </View>
        <FlatList
          data={filtered}
          keyExtractor={(x) => String(x.id)}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          renderItem={({ item, index }) => (
            <Pressable
              onPress={() => { setIdx(words.indexOf(item)); switchView('card'); }}
              style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: index % 2 ? '#fff' : '#fbfcfe', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.lineSoft }}
            >
              <Text style={{ fontSize: 20, fontWeight: '700', color: '#1a1a2e', width: 80 }}>{item.chinese}</Text>
              <Text style={{ color: COLORS.muted, flex: 1 }} numberOfLines={1}>{item.pinyin}</Text>
              <Text style={{ color: '#1a1a2e', flex: 1, textAlign: 'right' }} numberOfLines={1}>{item.english}</Text>
            </Pressable>
          )}
          ListEmptyComponent={<Text style={{ textAlign: 'center', color: COLORS.mutedLight, padding: 20 }}>No match.</Text>}
        />
        </View>
      </Animated.View>
    );
  }

  // ── Vue CARTE ──
  const chars = Array.from(w.chinese || '');
  const isSingle = chars.length === 1;
  const learningEnglish = direction === 'zh→en';

  // Encadré du "mot à apprendre" : hauteur FIXE, identique sur toutes les cartes.
  const glyphBoxH = Math.round(cardH * 0.34);

  // Taille de police du chinois selon la longueur (phrase → plus petit + retour
  // à la ligne). Le nombre de caractères pilote la taille pour tenir dans la boîte.
  const n = chars.length;
  const zhSize = n <= 1 ? 88 : n <= 2 ? 76 : n <= 4 ? 58 : n <= 8 ? 42
    : n <= 12 ? 32 : n <= 18 ? 26 : n <= 26 ? 21 : 18;
  // Taille de l'anglais quand il est le "mot à apprendre" (haut, sens zh→en).
  const enLen = (w.english || '').length;
  const enSize = enLen <= 6 ? 42 : enLen <= 12 ? 34 : enLen <= 22 ? 27
    : enLen <= 40 ? 22 : 18;

  // Rend les caractères chinois ; cliquables (sens du caractère) seulement pour
  // les mots/phrases de plus d'1 caractère (sur 1 caractère, le sens est déjà là).
  const renderGlyphs = (size, interactive) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
      {chars.map((ch, i) =>
        interactive && !isSingle ? (
          <Pressable key={i} onPress={() => openChar(ch)}>
            <Text style={{ fontSize: size, lineHeight: size * 1.12, fontWeight: '800', color: '#1a1a2e' }}>{ch}</Text>
          </Pressable>
        ) : (
          <Text key={i} style={{ fontSize: size, lineHeight: size * 1.12, fontWeight: '800', color: '#1a1a2e' }}>{ch}</Text>
        )
      )}
    </View>
  );

  const descriptionText = learningEnglish ? (w.description_zh || w.description) : w.description;

  return (
    <Animated.View style={{ flex: 1, backgroundColor: COLORS.page, alignItems: 'center', justifyContent: 'center', opacity: screenFade }}>
      <Animated.View {...cardPan.panHandlers} style={{ width: cardW, height: cardH, opacity: fade }}>
        <View style={{ flex: 1, backgroundColor: '#fff', borderRadius: 24, padding: 18, ...SHADOW_CARD_FLAT }}>
          {/* haut : picto score + HSK */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Text style={{ fontSize: 22 }}>{scorePicto(w.score || 0)}</Text>
            <View style={{ borderWidth: 1, borderColor: COLORS.line, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ fontSize: 11, color: COLORS.muted, fontWeight: '600' }}>HSK : {w.hsk || 'Street'}</Text>
            </View>
          </View>

          {/* Encadré "mot à apprendre" — hauteur FIXE, wrap, police adaptative.
              en→zh : chinois en haut. zh→en : anglais en haut. */}
          <View style={{ height: glyphBoxH, borderWidth: 1, borderColor: COLORS.lineSoft, borderRadius: 16, paddingHorizontal: 10, marginTop: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {learningEnglish ? (
              <Text style={{ fontSize: enSize, fontWeight: '800', color: COLORS.jiayou, textAlign: 'center' }}>
                {w.english || 'No translation'}
              </Text>
            ) : (
              renderGlyphs(zhSize, true)
            )}
          </View>

          {/* Réponse (masquable). en→zh : pinyin + anglais. zh→en : chinois + pinyin. */}
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}>
            {hideTranslation ? (
              <Text style={{ color: COLORS.mutedLight, fontStyle: 'italic' }}>translation hidden</Text>
            ) : learningEnglish ? (
              <>
                {renderGlyphs(Math.min(zhSize, 40), true)}
                <Text style={{ fontSize: 20, fontWeight: '700', color: COLORS.muted, marginTop: 6 }}>{w.pinyin}</Text>
                {descriptionText ? (
                  <Text style={{ fontSize: 12.5, color: COLORS.mutedLight, fontStyle: 'italic', textAlign: 'center', marginTop: 8 }}>{descriptionText}</Text>
                ) : null}
              </>
            ) : (
              <>
                <Text style={{ fontSize: 22, fontWeight: '700', color: COLORS.muted }}>{w.pinyin}</Text>
                <Text style={{ fontSize: 20, fontWeight: '600', color: COLORS.jiayou, marginTop: 6, textAlign: 'center' }}>
                  {w.english || 'No translation'}
                </Text>
                {descriptionText ? (
                  <Text style={{ fontSize: 12.5, color: COLORS.mutedLight, fontStyle: 'italic', textAlign: 'center', marginTop: 8 }}>{descriptionText}</Text>
                ) : null}
              </>
            )}
          </View>

          {/* contrôles ronds : écoute + réglages */}
          <View style={{ position: 'absolute', bottom: 14, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' }}>
            <Pressable
              onPress={() => (learningEnglish
                ? speak(w.english, 'en-US')
                : speak(w.chinese, 'zh-CN'))}
              style={circleBtn}
            >
              <Ionicons name="volume-medium" size={22} color={COLORS.jiayou} />
            </Pressable>
            <Pressable onPress={() => setMenuOpen(true)} style={circleBtn}>
              <Ionicons name="settings-outline" size={20} color={COLORS.muted} />
            </Pressable>
          </View>
        </View>
      </Animated.View>

      {/* contrôles nav : ‹  hide translation  › */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: cardW, maxWidth: 300, marginTop: 20 }}>
        <Pressable onPress={() => go('prev')} style={{ width: 46, height: 46, borderRadius: 999, backgroundColor: COLORS.jiayou, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <Pressable onPress={() => setHideTranslation((h) => !h)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name={hideTranslation ? 'eye' : 'eye-off'} size={15} color={COLORS.muted} />
          <Text style={{ color: COLORS.muted, fontSize: 13, textDecorationLine: 'underline' }}>
            {hideTranslation ? 'Show translation' : 'Hide translation'}
          </Text>
        </Pressable>
        <Pressable onPress={() => go('next')} style={{ width: 46, height: 46, borderRadius: 999, backgroundColor: COLORS.jiayou, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-forward" size={22} color="#fff" />
        </Pressable>
      </View>

      <Text style={{ position: 'absolute', bottom: 16, color: COLORS.mutedLight, fontSize: 12 }}>
        {(idx % len) + 1} / {len} · swipe ↑ for the list
      </Text>

      {/* ── Popup sens d'un caractère ── */}
      <Popup visible={!!charInfo} onClose={() => setCharInfo(null)} maxWidth={280}>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 52, fontWeight: '800', color: '#1a1a2e' }}>{charInfo?.char}</Text>
          {charInfo?.loading ? (
            <ActivityIndicator color={COLORS.jiayou} style={{ marginTop: 12 }} />
          ) : charInfo?.data ? (
            <>
              <View style={{ backgroundColor: COLORS.jiayouContainer, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 4, marginTop: 12 }}>
                <Text style={{ color: '#1976d2', fontWeight: '600' }}>{charInfo.data.pinyin || 'N/A'}</Text>
              </View>
              <Text style={{ color: COLORS.muted, marginTop: 8, textAlign: 'center' }}>{charInfo.data.english || 'No translation'}</Text>
              {charInfo.data.hsk ? (
                <View style={{ backgroundColor: '#e8f5e8', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3, marginTop: 8 }}>
                  <Text style={{ color: '#2e7d32', fontSize: 12, fontWeight: '600' }}>HSK {charInfo.data.hsk}</Text>
                </View>
              ) : null}
            </>
          ) : (
            <Text style={{ color: COLORS.mutedLight, marginTop: 12 }}>Character not registered</Text>
          )}
          <Pressable onPress={() => speak(charInfo?.char)} style={[circleBtn, { marginTop: 16 }]}>
            <Ionicons name="volume-medium" size={20} color={COLORS.jiayou} />
          </Pressable>
        </View>
      </Popup>

      {/* ── Popup réglages (edit / delete) ── */}
      <Popup visible={menuOpen} onClose={() => setMenuOpen(false)} maxWidth={300}>
        <Pressable onPress={() => { setMenuOpen(false); openEdit(w); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }}>
          <Ionicons name="pencil" size={20} color={COLORS.jiayou} />
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#1d1d1f' }}>Edit word</Text>
        </Pressable>
        <View style={{ height: 1, backgroundColor: COLORS.lineSoft }} />
        <Pressable onPress={() => { setMenuOpen(false); setConfirmDel(w); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }}>
          <Ionicons name="trash" size={20} color={COLORS.danger} />
          <Text style={{ fontSize: 16, fontWeight: '600', color: COLORS.danger }}>Delete word</Text>
        </Pressable>
      </Popup>

      {/* ── Popup édition ── */}
      <Popup visible={!!editing} onClose={() => setEditing(null)} maxWidth={440}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#1d1d1f', marginBottom: 16 }}>Edit word</Text>
        {[
          { key: 'chinese', label: 'Chinese' },
          { key: 'pinyin', label: 'Pinyin' },
          { key: 'english', label: 'English' },
          { key: 'description', label: 'Description', multiline: true },
        ].map((f) => (
          <View key={f.key} style={{ marginBottom: 12 }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.muted, marginBottom: 4 }}>{f.label}</Text>
            <TextInput
              value={ef[f.key]}
              onChangeText={(t) => setEf((s) => ({ ...s, [f.key]: t }))}
              autoCapitalize="none"
              multiline={f.multiline}
              placeholder={f.multiline ? 'Optional note or example…' : undefined}
              placeholderTextColor={COLORS.mutedLight}
              style={{ borderWidth: 1.5, borderColor: COLORS.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16, minHeight: f.multiline ? 72 : undefined, textAlignVertical: f.multiline ? 'top' : 'center' }}
            />
          </View>
        ))}
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
          <Pressable onPress={() => setEditing(null)} style={{ flex: 1, paddingVertical: 13, borderRadius: 14, borderWidth: 2, borderColor: COLORS.line, alignItems: 'center' }}>
            <Text style={{ color: '#444', fontWeight: '600' }}>Cancel</Text>
          </Pressable>
          <Pressable onPress={saveEdit} disabled={busy} style={{ flex: 1, paddingVertical: 13, borderRadius: 14, backgroundColor: COLORS.jiayou, alignItems: 'center' }}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Save</Text>}
          </Pressable>
        </View>
      </Popup>

      {/* ── Popup suppression ── */}
      <Popup visible={!!confirmDel} onClose={() => setConfirmDel(null)} maxWidth={380}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#1d1d1f', marginBottom: 8 }}>Delete word</Text>
        <Text style={{ color: COLORS.muted, marginBottom: 20 }}>
          Remove “{confirmDel?.chinese}” from your collection?
        </Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Pressable onPress={() => setConfirmDel(null)} style={{ flex: 1, paddingVertical: 13, borderRadius: 14, borderWidth: 2, borderColor: COLORS.line, alignItems: 'center' }}>
            <Text style={{ color: '#444', fontWeight: '600' }}>Cancel</Text>
          </Pressable>
          <Pressable onPress={doDelete} disabled={busy} style={{ flex: 1, paddingVertical: 13, borderRadius: 14, backgroundColor: COLORS.danger, alignItems: 'center' }}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Delete</Text>}
          </Pressable>
        </View>
      </Popup>
    </Animated.View>
  );
}
