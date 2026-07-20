import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ActivityIndicator, ScrollView,
  KeyboardAvoidingView, Platform, Animated, Easing, useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Popup from '../components/Popup';
import { COLORS } from '../theme';
import { searchWords, captureWord, createWord, getPinyin } from '../api';

const CARD_W = 240;
const CARD_GAP = 14;
const ITEM_W = CARD_W + CARD_GAP;

// Perfect match sur n'importe quel champ (chinois / anglais / pinyin sans tons)
function normPinyin(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
}
function isExact(w, term) {
  const q = (term || '').trim();
  if (!q) return false;
  return (w.chinese || '') === q
    || (w.english || '').toLowerCase() === q.toLowerCase()
    || (normPinyin(q) && normPinyin(w.pinyin) === normPinyin(q));
}
// Le terme ressemble-t-il à du chinois ? (au moins un caractère CJK)
function isChinese(s) {
  return /[一-鿿]/.test(s || '');
}

export default function AddWordScreen() {
  const { width: screenW } = useWindowDimensions();
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const [loading, setLoading] = useState(false);
  const [captured, setCaptured] = useState({}); // id -> true | 'loading'
  const [error, setError] = useState('');

  // Popup "New word" (création / édition avant capture)
  const [editor, setEditor] = useState(null); // { chinese, pinyin, englishList, description }
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState('');
  const pinyinTouched = useRef(false); // l'utilisateur a-t-il édité le pinyin à la main ?
  const pinyinTimer = useRef(null);

  // Auto-génère le pinyin quand le chinois change (sauf si édité manuellement).
  useEffect(() => {
    const cn = (editor?.chinese || '').trim();
    clearTimeout(pinyinTimer.current);
    if (!editor || pinyinTouched.current || !isChinese(cn)) return;
    pinyinTimer.current = setTimeout(async () => {
      try {
        const d = await getPinyin(cn);
        if (d.pinyin) setEditor((e) => (e && !pinyinTouched.current ? { ...e, pinyin: d.pinyin } : e));
      } catch { /* silencieux */ }
    }, 350);
    return () => clearTimeout(pinyinTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor?.chinese]);

  // Carrousel ancré
  const scrollX = useRef(new Animated.Value(0)).current;

  // Logo flottant (comme l'animation logoFloat de l'EJS)
  const float = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: -10, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [float]);

  const term = q.trim();

  async function run() {
    if (!term) return;
    setError('');
    setLoading(true);
    try {
      const d = await searchWords(term);
      setResults(d.results || []);
      setShowResults(true);
      scrollX.setValue(0);
    } catch (e) {
      setError(e.message || 'Search error');
    } finally {
      setLoading(false);
    }
  }

  async function capture(id) {
    setCaptured((c) => ({ ...c, [id]: 'loading' }));
    try {
      await captureWord(id);
      setCaptured((c) => ({ ...c, [id]: true }));
    } catch {
      setCaptured((c) => ({ ...c, [id]: false }));
    }
  }

  // ── Popup New word ─────────────────────────────────────────────────────────
  // Depuis la carte "Create" : préremplit selon que le terme est chinois ou non.
  function openCreate() {
    setEditorError('');
    pinyinTouched.current = false; // pinyin auto-généré depuis le chinois
    setEditor(
      isChinese(term)
        ? { chinese: term, pinyin: '', englishList: [''], description: '' }
        : { chinese: '', pinyin: '', englishList: [term], description: '' }
    );
  }
  // Depuis une carte trouvée : "éditer avant de capturer".
  function openEdit(w) {
    setEditorError('');
    pinyinTouched.current = !!(w.pinyin || '').trim(); // garde le pinyin existant
    setEditor({
      chinese: w.chinese || '',
      pinyin: w.pinyin || '',
      englishList: (w.english || '').split('/').map((s) => s.trim()).filter(Boolean).length
        ? (w.english || '').split('/').map((s) => s.trim()).filter(Boolean)
        : [''],
      description: w.description || '',
    });
  }
  function setField(key, value) {
    setEditor((e) => ({ ...e, [key]: value }));
  }
  function setEnglishAt(i, value) {
    setEditor((e) => {
      const list = [...e.englishList];
      list[i] = value;
      return { ...e, englishList: list };
    });
  }
  function addEnglish() {
    setEditor((e) => ({ ...e, englishList: [...e.englishList, ''] }));
  }
  function removeEnglish(i) {
    setEditor((e) => ({ ...e, englishList: e.englishList.filter((_, idx) => idx !== i) }));
  }

  async function saveNewWord() {
    const chinese = (editor.chinese || '').trim();
    const english = editor.englishList.map((s) => s.trim()).filter(Boolean).join(' / ');
    const pinyin = (editor.pinyin || '').trim();
    const description = (editor.description || '').trim();
    if (!chinese) return setEditorError('Chinese characters are required.');
    if (!english) return setEditorError('At least one English translation is required.');

    setSaving(true);
    setEditorError('');
    try {
      const d = await createWord({ chinese, pinyin, english, description });
      if (d.word) setCaptured((c) => ({ ...c, [d.word.id]: true }));
      setEditor(null);
      setShowResults(false);
      setQ('');
    } catch (e) {
      setEditorError(e.message || 'Could not add the word.');
    } finally {
      setSaving(false);
    }
  }

  // Largeur intérieure de la popup résultats → padding pour centrer 1re/dernière carte
  const popupW = Math.min(560, screenW - 40);
  const sidePad = Math.max(16, (popupW - CARD_W) / 2);

  return (
    <LinearGradient colors={['#0d6efd', '#0dcaf0']} style={{ flex: 1 }}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 }}>
          <Animated.Text
            style={{
              fontSize: 72, fontWeight: '800', color: '#fff', marginBottom: 28,
              textShadowColor: 'rgba(0,0,0,0.2)', textShadowOffset: { width: 0, height: 4 }, textShadowRadius: 15,
              transform: [{ translateY: float }],
            }}
          >
            加油
          </Animated.Text>

          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '600', marginBottom: 16 }}>Add a word</Text>

          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Chinese, pinyin or English…"
            placeholderTextColor="#adb5bd"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={run}
            style={{
              backgroundColor: '#fff', borderRadius: 50, paddingVertical: 20, paddingHorizontal: 24,
              fontSize: 19, textAlign: 'center', color: COLORS.jiayou, fontWeight: '500',
              width: '88%', maxWidth: 460,
              shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 30, elevation: 6,
            }}
          />

          {term ? (
            <Pressable
              onPress={run}
              disabled={loading}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                backgroundColor: '#fff', borderRadius: 14, paddingVertical: 13, paddingHorizontal: 20,
                marginTop: 20, alignSelf: 'center',
                shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.12, shadowRadius: 18, elevation: 4,
              }}
            >
              {loading ? (
                <ActivityIndicator color={COLORS.jiayou} />
              ) : (
                <>
                  <Text style={{ color: COLORS.jiayou, fontWeight: '700', fontSize: 16 }}>Add the word</Text>
                  <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: COLORS.jiayou, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="add" size={18} color="#fff" />
                  </View>
                </>
              )}
            </Pressable>
          ) : null}

          {error ? <Text style={{ color: '#fff', marginTop: 14, fontWeight: '600' }}>{error}</Text> : null}
        </View>
      </KeyboardAvoidingView>

      {/* ── Popup résultats : carrousel ancré (snap + fondu au blanc) ── */}
      <Popup
        visible={showResults}
        onClose={() => setShowResults(false)}
        maxWidth={560}
        contentStyle={{ paddingHorizontal: 0, paddingVertical: 18, overflow: 'hidden' }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 4 }}>
          <Text style={{ color: '#1a1a2e', fontSize: 16, fontWeight: '700' }}>
            {results.length ? `${results.length} result${results.length > 1 ? 's' : ''}` : 'No match'}
          </Text>
          <Pressable onPress={() => setShowResults(false)} hitSlop={10}>
            <Ionicons name="close" size={24} color={COLORS.muted} />
          </Pressable>
        </View>

        <View>
          <Animated.ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={ITEM_W}
            snapToAlignment="center"
            decelerationRate="normal"
            scrollEventThrottle={16}
            onScroll={Animated.event(
              [{ nativeEvent: { contentOffset: { x: scrollX } } }],
              { useNativeDriver: true }
            )}
            contentContainerStyle={{ paddingHorizontal: sidePad, paddingVertical: 18, gap: CARD_GAP }}
          >
            {results.map((w, i) => {
              const owned = w.owned || captured[w.id] === true;
              const st = captured[w.id];
              // Ancrage : la carte centrée est nette et grande, les voisines rétrécies
              const inputRange = [(i - 1) * ITEM_W, i * ITEM_W, (i + 1) * ITEM_W];
              const scale = scrollX.interpolate({ inputRange, outputRange: [0.9, 1, 0.9], extrapolate: 'clamp' });
              const opacity = scrollX.interpolate({ inputRange, outputRange: [0.55, 1, 0.55], extrapolate: 'clamp' });
              return (
                <Animated.View key={w.id} style={{ transform: [{ scale }], opacity }}>
                  <BoosterCard
                    w={w}
                    exact={isExact(w, term)}
                    owned={owned}
                    capturing={st === 'loading'}
                    onCapture={() => capture(w.id)}
                    onEdit={() => openEdit(w)}
                  />
                </Animated.View>
              );
            })}

            {/* Toujours proposer la création d'un nouveau mot, même en cas de match exact. */}
            <Pressable
              onPress={openCreate}
              style={{
                width: CARD_W, borderRadius: 20, minHeight: 210, alignItems: 'center', justifyContent: 'center',
                borderWidth: 2, borderStyle: 'dashed', borderColor: '#c9b8ec', backgroundColor: '#faf8ff',
              }}
            >
              <Ionicons name="add-circle" size={40} color="#6f42c1" />
              <Text style={{ color: '#6f42c1', fontWeight: '700', marginTop: 8 }} numberOfLines={1}>
                Create a new word
              </Text>
            </Pressable>

            {results.length === 0 && (
              <View style={{ width: CARD_W, minHeight: 160, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: COLORS.muted }}>No match found.</Text>
              </View>
            )}
          </Animated.ScrollView>

          {/* Fondu au blanc sur les bords gauche / droite */}
          <LinearGradient
            colors={['#fff', 'rgba(255,255,255,0)']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            pointerEvents="none"
            style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 48 }}
          />
          <LinearGradient
            colors={['rgba(255,255,255,0)', '#fff']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            pointerEvents="none"
            style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 48 }}
          />
        </View>

        <Text style={{ color: COLORS.mutedLight, textAlign: 'center', fontSize: 12, marginTop: 2 }}>
          ← swipe to browse →
        </Text>
      </Popup>

      {/* ── Popup New word (création / édition avant capture) ── */}
      <Popup visible={!!editor} onClose={() => setEditor(null)} maxWidth={440}>
        {editor && (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="add-circle" size={20} color={COLORS.jiayou} />
                <Text style={{ fontSize: 17, fontWeight: '700', color: '#1a1a2e' }}>New word</Text>
              </View>
              <Pressable onPress={() => setEditor(null)} hitSlop={10}>
                <Ionicons name="close" size={22} color={COLORS.muted} />
              </Pressable>
            </View>

            <FieldLabel>Chinese characters</FieldLabel>
            <ModalInput value={editor.chinese} onChangeText={(v) => setField('chinese', v)} placeholder="汉字…" />

            <FieldLabel>Pinyin</FieldLabel>
            <ModalInput
              value={editor.pinyin}
              onChangeText={(v) => { pinyinTouched.current = true; setField('pinyin', v); }}
              placeholder="Auto-generated…"
              autoCapitalize="none"
            />

            <FieldLabel>English</FieldLabel>
            {editor.englishList.map((val, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <View style={{ flex: 1 }}>
                  <ModalInput value={val} onChangeText={(v) => setEnglishAt(i, v)} placeholder="English translation…" noMargin />
                </View>
                {editor.englishList.length > 1 && (
                  <Pressable onPress={() => removeEnglish(i)} hitSlop={8}>
                    <Ionicons name="close-circle" size={22} color={COLORS.danger} />
                  </Pressable>
                )}
              </View>
            ))}
            <Pressable onPress={addEnglish} style={{ marginBottom: 16 }}>
              <Text style={{ color: COLORS.jiayou, fontWeight: '600', fontSize: 13 }}>
                <Ionicons name="add-circle-outline" size={13} color={COLORS.jiayou} />  Add another translation
              </Text>
            </Pressable>

            <FieldLabel>Description (optional)</FieldLabel>
            <ModalInput
              value={editor.description}
              onChangeText={(v) => setField('description', v)}
              placeholder="Add a short description…"
              multiline
            />

            {editorError ? (
              <Text style={{ color: COLORS.danger, fontSize: 13, marginBottom: 10, fontWeight: '600' }}>{editorError}</Text>
            ) : null}

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
              <Pressable
                onPress={() => setEditor(null)}
                style={{ flex: 1, backgroundColor: '#f1f3f5', borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}
              >
                <Text style={{ color: COLORS.muted, fontWeight: '700' }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={saveNewWord}
                disabled={saving}
                style={{ flex: 1, backgroundColor: COLORS.jiayou, borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}
              >
                {saving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={{ color: '#fff', fontWeight: '700' }}>Capture (3 ₵)</Text>}
              </Pressable>
            </View>
          </>
        )}
      </Popup>
    </LinearGradient>
  );
}

function FieldLabel({ children }) {
  return (
    <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
      {children}
    </Text>
  );
}

function ModalInput({ noMargin, multiline, ...props }) {
  return (
    <TextInput
      placeholderTextColor="#adb5bd"
      autoCorrect={false}
      multiline={multiline}
      style={{
        backgroundColor: '#f8f9fa', borderWidth: 1, borderColor: '#e3e8f7', borderRadius: 12,
        paddingVertical: 12, paddingHorizontal: 14, fontSize: 15, color: '#1a1a2e',
        marginBottom: noMargin ? 0 : 16, minHeight: multiline ? 72 : undefined,
        textAlignVertical: multiline ? 'top' : 'center',
      }}
      {...props}
    />
  );
}

function BoosterCard({ w, exact, owned, capturing, onCapture, onEdit }) {
  return (
    <View
      style={{
        width: CARD_W, borderRadius: 20, padding: 18, paddingTop: 22, alignItems: 'center',
        backgroundColor: '#f4f7ff',
        borderWidth: exact ? 1.5 : 1, borderColor: exact ? COLORS.jiayou : '#e3e8f7',
        // ombre iOS seule (pas d'elevation) : carte animée en opacity dans le
        // carrousel → l'elevation Android donnerait un rectangle gris au scroll.
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 12,
      }}
    >
      {exact && (
        <View style={{ position: 'absolute', top: 10, left: 12, backgroundColor: COLORS.jiayou, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>EXACT</Text>
        </View>
      )}

      {/* Éditer avant de capturer */}
      <Pressable onPress={onEdit} hitSlop={8} style={{ position: 'absolute', top: 10, right: 12 }}>
        <Ionicons name="create-outline" size={18} color={COLORS.muted} />
      </Pressable>

      <Text style={{ fontSize: 34, fontWeight: '800', color: COLORS.jiayou, marginTop: 6, textAlign: 'center' }}>{w.chinese}</Text>
      <Text style={{ color: '#6c757d', fontSize: 16, marginTop: 6 }}>{w.pinyin}</Text>
      <Text style={{ color: '#1a1a2e', fontWeight: '600', marginTop: 4, textAlign: 'center' }}>{w.english}</Text>
      <Text style={{ color: '#adb5bd', fontSize: 12, marginTop: 8 }}>
        {(w.owner_count || 0) > 0 ? `${w.owner_count} user${w.owner_count === 1 ? '' : 's'}` : ' '}
      </Text>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 16, width: '100%' }}>
        {owned ? (
          <View style={{ flex: 1, backgroundColor: '#d4edda', borderRadius: 11, paddingVertical: 9, alignItems: 'center' }}>
            <Text style={{ color: '#198754', fontWeight: '700', fontSize: 13 }}>✓ Captured</Text>
          </View>
        ) : (
          <Pressable onPress={onCapture} style={{ flex: 1, backgroundColor: COLORS.jiayou, borderRadius: 11, paddingVertical: 9, alignItems: 'center' }}>
            {capturing
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Capture</Text>}
          </Pressable>
        )}
      </View>
    </View>
  );
}
