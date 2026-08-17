import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ActivityIndicator, ScrollView,
  KeyboardAvoidingView, Platform, Animated, Easing, useWindowDimensions, Keyboard,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFonts, LaBelleAurore_400Regular } from '@expo-google-fonts/la-belle-aurore';
import { Ionicons } from '@expo/vector-icons';
import Popup from '../components/Popup';
import { COLORS } from '../theme';
import { searchWords, captureWord, createWord, getPinyin, getMe } from '../api';

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);
const BAR_H = 62; // hauteur de la barre = diamètre du bouton rond

const CARD_W = 200;   // plus étroite → on aperçoit mieux la carte suivante
const CARD_H = 280;    // format portrait qui incite au scroll
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

export default function AddWordScreen({ onBalanceChanged }) {
  const { width: screenW } = useWindowDimensions();
  const [fontsLoaded] = useFonts({ LaBelleAurore_400Regular });
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const [loading, setLoading] = useState(false);
  const [captured, setCaptured] = useState({}); // id -> true | 'loading'
  const [error, setError] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  // Langue apprise : zh→en = on apprend l'anglais → l'anglais devient le mot principal.
  const [learningEnglish, setLearningEnglish] = useState(false);
  useEffect(() => { getMe().then((me) => setLearningEnglish(me?.quiz_direction === 'zh→en')).catch(() => {}); }, []);
  // Overlay de succès de capture (check vert qui pop) avant fermeture + reset.
  const [showSuccess, setShowSuccess] = useState(false);
  const successAnim = useRef(new Animated.Value(0)).current;

  // Bouton loupe qui "se détache" du corps de la barre au focus (ressort organique).
  const detach = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // useNativeDriver:false : on anime aussi la largeur de la barre (layout).
    Animated.spring(detach, { toValue: searchFocused ? 1 : 0, friction: 7, tension: 80, useNativeDriver: false }).start();
  }, [searchFocused, detach]);

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
  // Reflet de lumière : rejoué chaque fois que la carte centrée change. On écoute
  // scrollX (fiable web ET natif) plutôt que onMomentumScrollEnd, peu fiable sur web.
  const [activeIndex, setActiveIndex] = useState(0);
  const shine = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let last = -1;
    const id = scrollX.addListener(({ value }) => {
      const i = Math.round(value / ITEM_W);
      if (i !== last) {
        last = i;
        setActiveIndex(i);
        shine.setValue(0);
        Animated.timing(shine, { toValue: 1, duration: 650, useNativeDriver: true }).start();
      }
    });
    return () => scrollX.removeListener(id);
  }, [scrollX, shine]);

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
    setError('');
    setCaptured((c) => ({ ...c, [id]: 'loading' }));
    try {
      await captureWord(id);
      setCaptured((c) => ({ ...c, [id]: true }));
      onBalanceChanged?.(); // capturer coûte 3 coins → rafraîchir le solde du header
      runCaptureSuccess();
    } catch (e) {
      setCaptured((c) => ({ ...c, [id]: false }));
      // Solde insuffisant ou plafond free → on le dit clairement.
      setError(e.message || 'Could not capture this word.');
    }
  }

  // Petite animation de succès, puis fermeture de la popup + reset de la recherche.
  function runCaptureSuccess() {
    setShowSuccess(true);
    successAnim.setValue(0);
    Animated.spring(successAnim, { toValue: 1, friction: 5, tension: 90, useNativeDriver: true }).start();
    setTimeout(() => {
      setShowResults(false);
      setShowSuccess(false);
      setQ('');
      setResults([]);
      setCaptured({});
      setError('');
      Keyboard.dismiss();
    }, 850);
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
  // Depuis une carte trouvée : "éditer avant de capturer". `personalize` → on
  // sauvegarde une entrée PERSONNALISÉE (forceNew) au lieu de réutiliser le mot
  // du dico, sinon les modifs seraient ignorées.
  function openEdit(w) {
    setEditorError('');
    pinyinTouched.current = !!(w.pinyin || '').trim(); // garde le pinyin existant
    setEditor({
      personalize: true,
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
      const d = await createWord({ chinese, pinyin, english, description, forceNew: !!editor.personalize });
      if (d.word) setCaptured((c) => ({ ...c, [d.word.id]: true }));
      onBalanceChanged?.(); // création coûte 3 coins → rafraîchir le solde
      setEditor(null);
      runCaptureSuccess(); // même animation de succès + fermeture + reset que la capture directe
    } catch (e) {
      setEditorError(e.message || 'Could not add the word.');
    } finally {
      setSaving(false);
    }
  }

  // Largeur intérieure de la popup résultats → padding pour centrer 1re/dernière carte
  const popupW = Math.min(560, screenW - 40);
  const sidePad = Math.max(16, (popupW - CARD_W) / 2);

  // Tap hors de la barre → blur. Uniquement en natif : sur web, le navigateur
  // gère déjà le blur au clic extérieur, et un Pressable capterait le focus
  // (clic = focus puis dismiss immédiat → champ impossible à sélectionner).
  const DismissArea = Platform.OS === 'web' ? View : Pressable;
  const dismissProps = Platform.OS === 'web' ? {} : { onPress: () => Keyboard.dismiss() };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.jiayou }}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <DismissArea {...dismissProps} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingBottom: 96 }}>
          <Animated.Text
            style={{
              fontSize: 72, fontWeight: '800', color: '#fff', marginBottom: 28,
              textShadowColor: 'rgba(0,0,0,0.2)', textShadowOffset: { width: 0, height: 4 }, textShadowRadius: 15,
              transform: [{ translateY: float }],
            }}
          >
            加油
          </Animated.Text>

          <Text
            style={{
              color: '#fff', width: '100%',
              fontFamily: fontsLoaded ? 'LaBelleAurore_400Regular' : undefined,
              fontStyle: fontsLoaded ? 'normal' : 'italic',
              fontSize: 26, lineHeight: 38, marginBottom: 16, textAlign: 'center', paddingHorizontal: 20,
            }}
          >
            Start capturing
          </Text>

          {Platform.OS === 'web' ? (
            // Web : la barre prend toute la largeur au repos (bouton caché) ; le
            // bouton apparaît dès le focus OU dès qu'il y a du texte (le texte le
            // garde monté pour que le clic aboutisse malgré le blur du navigateur).
            <View style={{ flexDirection: 'row', alignItems: 'center', width: '86%', maxWidth: 440 }}>
              <TextInput
                value={q}
                onChangeText={setQ}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                placeholder={screenW < 420 ? 'Search a word…' : 'Chinese, pinyin or English…'}
                placeholderTextColor="#adb5bd"
                autoCapitalize="none" autoCorrect={false} returnKeyType="search" onSubmitEditing={run}
                style={{
                  flex: 1, minWidth: 0, height: BAR_H, backgroundColor: '#fff', borderRadius: BAR_H / 2, paddingHorizontal: 24,
                  fontSize: 18, textAlign: 'center', color: COLORS.jiayou, fontWeight: '500',
                  shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 30, elevation: 6,
                }}
              />
              {searchFocused || term ? (
                <Pressable onPress={run} disabled={loading}
                  style={{ marginLeft: 10, width: BAR_H, height: BAR_H, borderRadius: BAR_H / 2, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
                    shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.18, shadowRadius: 14, elevation: 6 }}>
                  {loading ? <ActivityIndicator color={COLORS.jiayou} /> : <Ionicons name="search" size={23} color={COLORS.jiayou} />}
                </Pressable>
              ) : null}
            </View>
          ) : (
            // Natif : la barre rétrécit et le bouton loupe s'y "détache" au focus.
            <View style={{ flexDirection: 'row', alignItems: 'center', width: '86%', maxWidth: 440 }}>
              <AnimatedTextInput
                value={q}
                onChangeText={setQ}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                placeholder={screenW < 420 ? 'Search a word…' : 'Chinese, pinyin or English…'}
                placeholderTextColor="#adb5bd"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                onSubmitEditing={run}
                style={{
                  flex: 1, height: BAR_H,
                  marginRight: detach.interpolate({ inputRange: [0, 1], outputRange: [0, BAR_H + 8] }),
                  backgroundColor: '#fff', borderRadius: BAR_H / 2, paddingHorizontal: 24,
                  fontSize: 18, textAlign: 'center', color: COLORS.jiayou, fontWeight: '500',
                  shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 30, elevation: 6,
                }}
              />
              <Animated.View
                pointerEvents={searchFocused ? 'auto' : 'none'}
                style={{
                  position: 'absolute', right: 0, top: 0, bottom: 0, justifyContent: 'center',
                  opacity: detach,
                  transform: [{ scale: detach.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
                }}
              >
                <Pressable
                  onPress={run}
                  disabled={loading}
                  style={{
                    width: BAR_H, height: BAR_H, borderRadius: BAR_H / 2, backgroundColor: '#fff',
                    alignItems: 'center', justifyContent: 'center',
                    shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.18, shadowRadius: 14, elevation: 6,
                  }}
                >
                  {loading ? <ActivityIndicator color={COLORS.jiayou} /> : <Ionicons name="search" size={23} color={COLORS.jiayou} />}
                </Pressable>
              </Animated.View>
            </View>
          )}

          {error ? <Text style={{ color: '#fff', marginTop: 14, fontWeight: '600' }}>{error}</Text> : null}
        </DismissArea>
      </KeyboardAvoidingView>

      {/* ── Popup résultats : carrousel ancré (snap + fondu au blanc) ──
          L'éditeur "New word" est rendu DANS cette même popup (il remplace le
          carrousel) : un seul <Modal> à la fois, sinon iOS plante en empilant
          deux modals transparents. Tap dehors : ferme l'éditeur → retour au
          carrousel ; sinon ferme la popup. */}
      <Popup
        visible={showResults}
        onClose={() => (editor ? setEditor(null) : setShowResults(false))}
        maxWidth={560}
        contentStyle={{ paddingHorizontal: 0, paddingVertical: 18, overflow: 'hidden' }}
      >
        {editor ? (
          <WordEditor
            editor={editor}
            saving={saving}
            editorError={editorError}
            onClose={() => setEditor(null)}
            setField={setField}
            setEnglishAt={setEnglishAt}
            addEnglish={addEnglish}
            removeEnglish={removeEnglish}
            onPinyinEdit={(v) => { pinyinTouched.current = true; setField('pinyin', v); }}
            onSave={saveNewWord}
          />
        ) : (
        <>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 4 }}>
          <Text style={{ color: '#1a1a2e', fontSize: 16, fontWeight: '700' }}>
            {results.length ? `${results.length} result${results.length > 1 ? 's' : ''}` : '😢'}
          </Text>
          <Pressable onPress={() => setShowResults(false)} hitSlop={10}>
            <Ionicons name="close" size={24} color={COLORS.muted} />
          </Pressable>
        </View>

        {/* Aucun résultat : Jiayou ne connaît pas ce mot → on invite à le traduire. */}
        {results.length === 0 ? (
          <Text style={{ color: '#1a1a2e', fontSize: 18, fontWeight: '800', textAlign: 'center', paddingHorizontal: 24, marginTop: 2 }}>
            Jiayou doesn't know this word
          </Text>
        ) : null}

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
                    shine={i === activeIndex ? shine : null}
                    learningEnglish={learningEnglish}
                  />
                </Animated.View>
              );
            })}

            {/* Toujours proposer la création d'un nouveau mot, même en cas de match exact. */}
            <Pressable
              onPress={openCreate}
              style={{
                width: CARD_W, borderRadius: 20, minHeight: CARD_H, alignItems: 'center', justifyContent: 'center',
                borderWidth: 2, borderStyle: 'dashed', borderColor: '#c9b8ec', backgroundColor: '#faf8ff',
              }}
            >
              <Ionicons name="add-circle" size={40} color="#6f42c1" />
              <Text style={{ color: '#6f42c1', fontWeight: '700', marginTop: 8, textAlign: 'center' }} numberOfLines={1}>
                Create a new word
              </Text>
              <Text style={{ color: '#9a7fd0', fontSize: 12, fontWeight: '600', marginTop: 4, textAlign: 'center', paddingHorizontal: 14 }}>
                and share it with Jiaworld
              </Text>
            </Pressable>

          </Animated.ScrollView>

          {/* Fondu au blanc sur les bords — réduit pour mieux voir le scroll. */}
          <LinearGradient
            colors={['#fff', 'rgba(255,255,255,0)']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            pointerEvents="none"
            style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 16 }}
          />
          <LinearGradient
            colors={['rgba(255,255,255,0)', '#fff']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            pointerEvents="none"
            style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 16 }}
          />
        </View>

        {results.length > 0 ? (
          <Text style={{ color: COLORS.mutedLight, textAlign: 'center', fontSize: 12, marginTop: 2 }}>
            ← swipe to browse →
          </Text>
        ) : null}
        </>
        )}

        {/* Overlay de succès : check vert qui pop, avant la fermeture auto. */}
        {showSuccess ? (
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.97)', alignItems: 'center', justifyContent: 'center' }}>
            <Animated.View style={{ alignItems: 'center', opacity: successAnim, transform: [{ scale: successAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }] }}>
              <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: '#198754', alignItems: 'center', justifyContent: 'center', shadowColor: '#198754', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 16, elevation: 6 }}>
                <Ionicons name="checkmark" size={58} color="#fff" />
              </View>
              <Text style={{ color: '#198754', fontWeight: '800', fontSize: 18, marginTop: 14 }}>Captured!</Text>
            </Animated.View>
          </View>
        ) : null}
      </Popup>
    </View>
  );
}

// Éditeur "New word" — rendu DANS la popup résultats (pas un Modal séparé, pour
// éviter le crash iOS des modals empilés). Scrollable : le formulaire peut
// dépasser la hauteur d'écran avec le clavier ouvert sur iPhone.
function WordEditor({ editor, saving, editorError, onClose, setField, setEnglishAt, addEnglish, removeEnglish, onPinyinEdit, onSave }) {
  return (
    <ScrollView
      style={{ maxHeight: 520 }}
      contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 6 }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="add-circle" size={20} color={COLORS.jiayou} />
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#1a1a2e' }}>New word</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={10}>
          <Ionicons name="close" size={22} color={COLORS.muted} />
        </Pressable>
      </View>

      <FieldLabel>Chinese characters</FieldLabel>
      <ModalInput value={editor.chinese} onChangeText={(v) => setField('chinese', v)} placeholder="汉字…" />

      <FieldLabel>Pinyin</FieldLabel>
      <ModalInput
        value={editor.pinyin}
        onChangeText={onPinyinEdit}
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
          onPress={onClose}
          style={{ flex: 1, backgroundColor: '#f1f3f5', borderRadius: 999, paddingVertical: 13, alignItems: 'center' }}
        >
          <Text style={{ color: COLORS.muted, fontWeight: '700' }}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={onSave}
          disabled={saving}
          style={{ flex: 1, backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 13, alignItems: 'center' }}
        >
          {saving
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={{ color: '#fff', fontWeight: '700' }}>Capture (3 ₵)</Text>}
        </Pressable>
      </View>
    </ScrollView>
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

function BoosterCard({ w, exact, owned, capturing, onCapture, onEdit, shine, learningEnglish }) {
  // Reflet : bande de lumière diagonale qui traverse la carte quand elle se cale.
  const shineTx = shine
    ? shine.interpolate({ inputRange: [0, 1], outputRange: [-90, CARD_W + 90] })
    : null;
  const shineOpacity = shine
    ? shine.interpolate({ inputRange: [0, 0.15, 0.8, 1], outputRange: [0, 0.75, 0.75, 0] })
    : null;

  // Mot principal = langue apprise. Anglais appris → anglais en bleu ; sinon chinois.
  const primary = learningEnglish ? w.english : w.chinese;

  return (
    // Wrapper : porte l'ombre (pas d'overflow, sinon l'ombre iOS serait rognée).
    <View style={{ borderRadius: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 12 }}>
      {/* Conteneur qui CLIPPE : contient le contenu + le reflet. */}
      <View
        style={{
          width: CARD_W, minHeight: CARD_H, borderRadius: 20, padding: 18, paddingTop: 22, overflow: 'hidden', backgroundColor: '#f4f7ff',
          borderWidth: exact ? 1.5 : 1, borderColor: exact ? COLORS.jiayou : '#e3e8f7',
        }}
      >
      {exact && (
        <View style={{ position: 'absolute', top: 10, left: 12, zIndex: 2, backgroundColor: COLORS.jiayou, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>EXACT</Text>
        </View>
      )}

      {/* Infos du mot — centrées, occupent l'espace jusqu'au bouton du bas. */}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {/* L'anglais est bien plus long que les caractères → plus petit, sur
            plusieurs lignes, et rétréci pour tenir dans la carte étroite. */}
        <Text
          numberOfLines={learningEnglish ? 3 : 1}
          adjustsFontSizeToFit
          minimumFontScale={0.5}
          style={{ fontSize: learningEnglish ? 26 : 40, fontWeight: '800', color: COLORS.jiayou, textAlign: 'center' }}
        >
          {primary}
        </Text>
        {learningEnglish ? (
          <>
            <Text style={{ color: '#1a1a2e', fontWeight: '700', fontSize: 20, marginTop: 8, textAlign: 'center' }}>{w.chinese}</Text>
            <Text style={{ color: '#6c757d', fontSize: 15, marginTop: 4 }}>{w.pinyin}</Text>
          </>
        ) : (
          <>
            <Text style={{ color: '#6c757d', fontSize: 16, marginTop: 8 }}>{w.pinyin}</Text>
            <Text style={{ color: '#1a1a2e', fontWeight: '600', marginTop: 4, textAlign: 'center' }}>{w.english}</Text>
          </>
        )}
        <Text style={{ color: '#adb5bd', fontSize: 12, marginTop: 8 }}>
          {(w.owner_count || 0) > 0 ? `${w.owner_count} user${w.owner_count === 1 ? '' : 's'}` : ' '}
        </Text>
      </View>

      {/* Zone d'action, collée en bas : bouton principal + lien secondaire. */}
      <View style={{ width: '100%' }}>
        {owned ? (
          <View style={{ backgroundColor: '#d4edda', borderRadius: 999, paddingVertical: 10, alignItems: 'center' }}>
            <Text style={{ color: '#198754', fontWeight: '700', fontSize: 13 }}>✓ Captured</Text>
          </View>
        ) : (
          <Pressable onPress={onCapture} style={{ backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 10, alignItems: 'center' }}>
            {capturing
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Capture</Text>}
          </Pressable>
        )}
        {!owned ? (
          <Pressable onPress={onEdit} hitSlop={6} style={{ alignItems: 'center', paddingTop: 10 }}>
            <Text style={{ color: COLORS.muted, fontSize: 12.5, textDecorationLine: 'underline' }}>Edit before capture</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Reflet de lumière (au-dessus de tout, ne capte pas les taps). */}
      {shine ? (
        <Animated.View
          pointerEvents="none"
          style={{ position: 'absolute', top: -30, bottom: -30, width: 70, opacity: shineOpacity, transform: [{ translateX: shineTx }, { rotate: '18deg' }] }}
        >
          <LinearGradient
            colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.85)', 'rgba(255,255,255,0)']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={{ flex: 1 }}
          />
        </Animated.View>
      ) : null}
      </View>
    </View>
  );
}
