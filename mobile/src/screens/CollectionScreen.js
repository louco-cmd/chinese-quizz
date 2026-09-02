import { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, Animated, PanResponder, FlatList,
  useWindowDimensions, Platform, ActivityIndicator, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import { Loading, ErrorRetry } from '../components/ErrorRetry';
import Popup from '../components/Popup';
import { COLORS, SHADOW_CARD_FLAT, TAB_CLEARANCE } from '../theme';
import { useT } from '../i18n';
import useAndroidBack from '../useAndroidBack';
import { getCollection, updateWord, deleteWord, bulkDeleteWords, notifyUpgrade, getCharacter, getMe, getPurchasedPacks, getMyPacks, getPinyin } from '../api';
import { langMeta } from '../langs';
import CatLoader from '../components/CatLoader';
import { ttsFor } from '../langs';

// Sélection de la meilleure voix par langue (qualité "Enhanced" en priorité).
// Gratuit : utilise les voix du moteur TTS du système (Google TTS sur Android,
// AVSpeechSynthesizer sur iOS). Mis en cache après le 1er chargement.
let _voiceCache = null;
async function bestVoiceFor(lang) {
  if (!_voiceCache) {
    _voiceCache = {};
    try {
      const voices = await Speech.getAvailableVoicesAsync();
      const byPrefix = {};
      for (const v of voices) {
        const prefix = (v.language || '').toLowerCase().split(/[-_]/)[0];
        (byPrefix[prefix] = byPrefix[prefix] || []).push(v);
      }
      for (const prefix of Object.keys(byPrefix)) {
        const list = byPrefix[prefix];
        const enhanced = list.find((v) => v.quality === Speech.VoiceQuality.Enhanced);
        _voiceCache[prefix] = (enhanced || list[0]).identifier;
      }
    } catch { /* pas de liste de voix : on garde la voix par défaut */ }
  }
  return _voiceCache[(lang || '').toLowerCase().split(/[-_]/)[0]];
}

// Lit un texte. `cbs.onStart/onDone` pour piloter un loader ; `cbs.rate` règle la
// vitesse (1 = normal, <1 = plus lent). Coupe toute lecture en cours pour éviter
// les chevauchements.
async function speak(t, lang = 'zh-CN', cbs = {}) {
  if (!t) { cbs.onDone?.(); return; }
  try { Speech.stop(); } catch { /* noop */ }
  const voice = await bestVoiceFor(lang);
  Speech.speak(t, {
    language: lang,
    voice, // undefined → voix par défaut
    rate: cbs.rate ?? 1.0,
    onStart: cbs.onStart,
    onDone: cbs.onDone,
    onStopped: cbs.onDone,
    onError: cbs.onDone,
  });
}

// Majuscule sur la 1re lettre de l'anglais (cosmétique).
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
// Contient au moins un caractère chinois (pour l'auto-génération du pinyin).
const isChinese = (s) => /[一-鿿]/.test(s || '');

function scorePicto(s) {
  if (s >= 90) return '🏆';
  if (s >= 75) return '😎';
  if (s >= 50) return '🙂';
  if (s >= 25) return '😐';
  return '🌱';
}

// Paliers de connaissance (mêmes seuils/icônes que scorePicto) pour le filtre.
const KNOWLEDGE = [
  { key: 'trophy', emoji: '🏆', lk: 'quiz_mastered', min: 90 },
  { key: 'cool', emoji: '😎', lk: 'kn_strong', min: 75 },
  { key: 'ok', emoji: '🙂', lk: 'kn_okay', min: 50 },
  { key: 'meh', emoji: '😐', lk: 'kn_weak', min: 25 },
  { key: 'seed', emoji: '🌱', lk: 'kn_new', min: 0 },
];
const bucketOf = (s) => (s >= 90 ? 'trophy' : s >= 75 ? 'cool' : s >= 50 ? 'ok' : s >= 25 ? 'meh' : 'seed');
const hskKey = (w) => (w.hsk ? String(w.hsk) : 'street');
const hskLabel = (k) => (k === 'street' ? 'Street' : `HSK ${k}`);

// La police suit la LANGUE du texte, pas la colonne : le chinois (hanzi) reste
// gros/gras, l'occidental plus léger — où qu'il soit (mot appris ou traduction).
const CJK_RE = /[㐀-鿿豈-﫿]/;
const scriptStyle = (s) => (CJK_RE.test(s || '')
  ? { fontSize: 18, fontWeight: '700' }
  : { fontSize: 14.5, fontWeight: '500' });

const circleBtn = {
  width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff',
  borderWidth: 1, borderColor: COLORS.line, alignItems: 'center', justifyContent: 'center',
  // ombre iOS uniquement (pas d'elevation) : ces boutons vivent dans la carte
  // animée en opacity → l'elevation Android donnerait un halo gris pendant le fondu.
  shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 12,
};

export default function CollectionScreen({ onNavigate }) {
  const { t: tr } = useT();
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
  const [filterOpen, setFilterOpen] = useState(false);
  const [fHsk, setFHsk] = useState([]);    // niveaux HSK sélectionnés ('1'..'6','street')
  const [fKnow, setFKnow] = useState([]);  // paliers de connaissance sélectionnés
  const [fPackId, setFPackId] = useState(null); // filtrer sur un pack acheté précis
  const [packMenuOpen, setPackMenuOpen] = useState(false); // menu déroulant packs
  const [purchasedPacks, setPurchasedPacks] = useState([]); // packs achetés (pour le menu)
  const [editing, setEditing] = useState(null);
  // chineseList : traductions chinoises multiples (stockées slash-séparées, comme
  // l'anglais). pinyin auto-généré par entrée, joint par ' / '.
  const [ef, setEf] = useState({ chineseList: [''], pinyin: '', englishList: [''], description: '' });
  const pinyinTouched = useRef(false); // l'user a édité le pinyin à la main → stop auto
  const pinyinTimer = useRef(null);
  const skipPinyinGen = useRef(true);  // ne pas régénérer au 1er rendu (garde le pinyin chargé)
  const [confirmDel, setConfirmDel] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Multi-sélection (vue liste, PREMIUM) : suppression en masse.
  const [isPremium, setIsPremium] = useState(false);
  const [learningLang, setLearningLang] = useState('zh'); // langue apprise (masque HSK/pinyin hors zh)
  const [nativeLang, setNativeLang] = useState('en'); // langue de la traduction (labels)
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState([]); // ids sélectionnés
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  // Nb de lignes du titre / de la description sur la carte → aligné à GAUCHE
  // au-delà de 2 lignes (plus lisible), centré sinon.
  const [titleLines, setTitleLines] = useState(1);
  const [descLines, setDescLines] = useState(1);
  const [charInfo, setCharInfo] = useState(null); // { char, loading, data }
  const [busy, setBusy] = useState(false);
  const [speakingKey, setSpeakingKey] = useState(null); // bouton audio en cours ('card'|'char')

  // Lance la lecture vocale avec loader : `key` identifie le bouton qui montre le
  // spinner jusqu'à la fin (la 1re lecture est lente le temps d'init du moteur TTS).
  // Ré-appui rapide sur LE MÊME bouton (< 4 s) → relit plus lentement (aide à
  // distinguer les sons). Un appui après ce délai repart à vitesse normale.
  const lastPlayRef = useRef({ key: null, at: 0 });
  function play(text, lang, key) {
    if (!text) return;
    const now = Date.now();
    const prev = lastPlayRef.current;
    const rapid = prev.key === key && now - prev.at < 4000;
    lastPlayRef.current = { key, at: now };
    setSpeakingKey(key);
    const clear = () => setSpeakingKey((k) => (k === key ? null : k));
    speak(text, lang, { rate: rapid ? 0.5 : 1.0, onDone: clear }).catch(clear);
  }

  // Coupe la lecture si on quitte l'écran.
  useEffect(() => () => { try { Speech.stop(); } catch { /* noop */ } }, []);

  const fade = useRef(new Animated.Value(1)).current;        // change de carte
  const screenFade = useRef(new Animated.Value(1)).current;  // change de vue
  // Rétrécissement (fuite en arrière) synchronisé avec le fondu de vue.
  const screenScale = screenFade.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] });
  const viewRef = useRef('card');
  viewRef.current = view;
  const switchingRef = useRef(false);
  const lenRef = useRef(0);

  // Deck = mots filtrés par la popup (HSK / connaissance / pack). Partagé par la
  // vue carte ET la vue liste (la liste y ajoute la recherche texte).
  const passesFilters = (x) => {
    if (fHsk.length && !fHsk.includes(hskKey(x))) return false;
    if (fKnow.length && !fKnow.includes(bucketOf(x.score || 0))) return false;
    if (fPackId && !(x.pack_ids || []).includes(fPackId)) return false;
    return true;
  };
  const deck = words.filter(passesFilters);
  lenRef.current = deck.length;

  const activeCount = fHsk.length + fKnow.length + (fPackId ? 1 : 0);
  const hskOptions = [...new Set(words.map(hskKey))]
    .sort((a, b) => (a === 'street' ? 99 : +a) - (b === 'street' ? 99 : +b));
  const toggleIn = (setter) => (val) => setter((arr) => (arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val]));
  const resetFilters = () => { setFHsk([]); setFKnow([]); setFPackId(null); setPackMenuOpen(false); };
  const selectedPack = purchasedPacks.find((p) => p.id === fPackId);

  // Popup de filtres — partagée entre les deux vues.
  const filterPopup = (
    <Popup visible={filterOpen} onClose={() => setFilterOpen(false)} maxWidth={420} scroll={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Text style={{ fontSize: 18, fontWeight: '800', color: '#1a1a2e' }}>{tr('co_filters')}</Text>
        <Pressable onPress={() => setFilterOpen(false)} hitSlop={10}><Ionicons name="close" size={22} color={COLORS.muted} /></Pressable>
      </View>

      {/* Filtre HSK : propre au chinois → masqué pour les autres langues apprises. */}
      {learningLang === 'zh' ? (
        <>
          <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>{tr('co_hsk_level')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
            {hskOptions.map((k) => {
              const on = fHsk.includes(k);
              return (
                <Pressable key={k} onPress={() => toggleIn(setFHsk)(k)} style={{ borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, backgroundColor: on ? '#e8f0ff' : '#fff', borderColor: on ? COLORS.jiayou : COLORS.line }}>
                  <Text style={{ color: on ? COLORS.jiayou : COLORS.muted, fontWeight: on ? '700' : '500', fontSize: 13.5 }}>{k === 'street' ? tr('qz_street') : hskLabel(k)}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>{tr('co_knowledge')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
        {KNOWLEDGE.map((b) => {
          const on = fKnow.includes(b.key);
          return (
            <Pressable key={b.key} onPress={() => toggleIn(setFKnow)(b.key)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, backgroundColor: on ? '#e8f0ff' : '#fff', borderColor: on ? COLORS.jiayou : COLORS.line }}>
              <Text style={{ fontSize: 15 }}>{b.emoji}</Text>
              <Text style={{ color: on ? COLORS.jiayou : COLORS.muted, fontWeight: on ? '700' : '500', fontSize: 13.5 }}>{tr(b.lk)}</Text>
            </Pressable>
          );
        })}
      </View>

      {purchasedPacks.length ? (
        <View style={{ marginBottom: 18 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>{tr('co_pack')}</Text>
          {/* Menu déroulant : sélectionne un pack acheté pour n'afficher que ses mots. */}
          <Pressable
            onPress={() => setPackMenuOpen((o) => !o)}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderWidth: 1, borderColor: packMenuOpen ? COLORS.jiayou : COLORS.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 }}
          >
            <Text style={{ color: selectedPack ? '#1a1a2e' : COLORS.muted, fontWeight: selectedPack ? '700' : '500', fontSize: 14 }} numberOfLines={1}>
              {selectedPack ? selectedPack.title : tr('co_all_words')}
            </Text>
            <Ionicons name={packMenuOpen ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.muted} />
          </Pressable>
          {packMenuOpen ? (
            <View style={{ borderWidth: 1, borderColor: COLORS.line, borderRadius: 12, marginTop: 6, overflow: 'hidden' }}>
              <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled>
                <Pressable
                  onPress={() => { setFPackId(null); setPackMenuOpen(false); }}
                  style={{ paddingHorizontal: 14, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: !fPackId ? '#e8f0ff' : '#fff' }}
                >
                  <Text style={{ color: !fPackId ? COLORS.jiayou : '#1a1a2e', fontWeight: !fPackId ? '700' : '500', fontSize: 14 }}>{tr('co_all_words')}</Text>
                  {!fPackId ? <Ionicons name="checkmark" size={16} color={COLORS.jiayou} /> : null}
                </Pressable>
                {purchasedPacks.map((p) => {
                  const on = p.id === fPackId;
                  return (
                    <Pressable
                      key={p.id}
                      onPress={() => { setFPackId(p.id); setPackMenuOpen(false); }}
                      style={{ paddingHorizontal: 14, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: COLORS.lineSoft, backgroundColor: on ? '#e8f0ff' : '#fff' }}
                    >
                      <Text style={{ flex: 1, color: on ? COLORS.jiayou : '#1a1a2e', fontWeight: on ? '700' : '500', fontSize: 14 }} numberOfLines={1}>{p.title}</Text>
                      {on ? <Ionicons name="checkmark" size={16} color={COLORS.jiayou} /> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Pressable onPress={resetFilters} disabled={!activeCount} style={{ flex: 1, backgroundColor: '#f1f3f5', borderRadius: 999, paddingVertical: 13, alignItems: 'center', opacity: activeCount ? 1 : 0.5 }}>
          <Text style={{ color: COLORS.muted, fontWeight: '700' }}>{tr('co_reset')}</Text>
        </Pressable>
        <Pressable onPress={() => setFilterOpen(false)} style={{ flex: 1, backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 13, alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>{tr('co_show')} {deck.length}</Text>
        </Pressable>
      </View>
    </Popup>
  );

  // Bouton filtre flottant — vue LISTE uniquement (bas-droite, au-dessus de la
  // TabBar). Ombre portée marquée (iOS shadow + elevation Android) pour le détacher
  // du fond ; plus de fondu de vue sur ce FAB → pas de halo gris à craindre.
  const filterFab = (
    <Pressable
      onPress={() => setFilterOpen(true)}
      hitSlop={10}
      style={{
        position: 'absolute', bottom: TAB_CLEARANCE, right: 16, zIndex: 20,
        width: 54, height: 54, borderRadius: 27, backgroundColor: '#fff',
        alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.line,
        shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.22, shadowRadius: 14,
        elevation: 8,
      }}
    >
      <Ionicons name={activeCount ? 'funnel' : 'funnel-outline'} size={23} color={COLORS.jiayou} />
      {activeCount ? (
        <View style={{ position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: COLORS.jiayou, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{activeCount}</Text>
        </View>
      ) : null}
    </Pressable>
  );

  // Gélule filtre — vue CARTE : posée au-dessus de la carte, alignée à droite.
  // (Le FAB flottant faisait un peu "collé à la TabBar" sur cette vue.)
  const filterPill = (
    <Pressable
      onPress={() => setFilterOpen(true)}
      hitSlop={8}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8,
        borderWidth: 1, borderColor: activeCount ? COLORS.jiayou : COLORS.line,
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8,
      }}
    >
      <Ionicons name={activeCount ? 'funnel' : 'funnel-outline'} size={15} color={COLORS.jiayou} />
      <Text style={{ color: COLORS.jiayou, fontWeight: '700', fontSize: 13.5 }}>{tr('co_filter')}</Text>
      {activeCount ? (
        <View style={{ minWidth: 18, height: 18, borderRadius: 9, backgroundColor: COLORS.jiayou, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{activeCount}</Text>
        </View>
      ) : null}
    </Pressable>
  );

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

  // Packs achetés ET créés → alimentent le menu déroulant du filtre (dédupliqués).
  useEffect(() => {
    Promise.all([
      getMyPacks().catch(() => ({ packs: [] })),
      getPurchasedPacks().catch(() => ({ packs: [] })),
    ]).then(([mine, bought]) => {
      const map = new Map();
      for (const p of [...(mine.packs || []), ...(bought.packs || [])]) if (!map.has(p.id)) map.set(p.id, p);
      setPurchasedPacks([...map.values()]);
    });
  }, []);

  // Sens d'apprentissage : zh→en → on inverse l'affichage de la carte.
  useEffect(() => {
    getMe().then((u) => { setIsPremium(!!u?.isPremium); if (u?.learning_lang) setLearningLang(u.learning_lang); if (u?.native_lang) setNativeLang(u.native_lang); }).catch(() => {});
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

  // Retour Android : en vue liste, revient à la vue carte (consomme le retour) ;
  // en vue carte, on ne consomme pas → App.js remonte à l'accueil.
  useAndroidBack(() => {
    if (viewRef.current === 'list') { switchView('card'); return true; }
    return false;
  }, true, [switchView]);

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
    // Sens multiples (chinois ET anglais) stockés séparés par '/' en base → listes.
    const enList = (word.english || '').split('/').map((s) => s.trim()).filter(Boolean);
    const cnList = (word.chinese || '').split('/').map((s) => s.trim()).filter(Boolean);
    pinyinTouched.current = false;
    skipPinyinGen.current = true; // garde le pinyin existant au 1er rendu
    setEf({
      chineseList: cnList.length ? cnList : [''],
      pinyin: word.pinyin || '',
      englishList: enList.length ? enList : [''],
      description: word.description || '',
    });
    setEditing(word);
  }
  // Handlers des listes de traductions (comme l'écran Add Word).
  const setEnglishAt = (i, v) => setEf((s) => { const l = [...s.englishList]; l[i] = v; return { ...s, englishList: l }; });
  const addEnglish = () => setEf((s) => ({ ...s, englishList: [...s.englishList, ''] }));
  const removeEnglish = (i) => setEf((s) => ({ ...s, englishList: s.englishList.filter((_, idx) => idx !== i) }));
  const setChineseAt = (i, v) => setEf((s) => { const l = [...s.chineseList]; l[i] = v; return { ...s, chineseList: l }; });
  const addChinese = () => setEf((s) => ({ ...s, chineseList: [...s.chineseList, ''] }));
  const removeChinese = (i) => setEf((s) => ({ ...s, chineseList: s.chineseList.filter((_, idx) => idx !== i) }));

  // Auto-génère le pinyin (une entrée par traduction chinoise, jointes par ' / ')
  // quand les traductions chinoises changent — sauf si l'user a édité le pinyin.
  useEffect(() => {
    if (!editing) return undefined;
    if (skipPinyinGen.current) { skipPinyinGen.current = false; return undefined; }
    if (pinyinTouched.current) return undefined;
    clearTimeout(pinyinTimer.current);
    pinyinTimer.current = setTimeout(async () => {
      const entries = ef.chineseList.map((s) => s.trim());
      const pys = await Promise.all(entries.map(async (cn) => {
        if (!isChinese(cn)) return '';
        try { const d = await getPinyin(cn); return d.pinyin || ''; } catch { return ''; }
      }));
      const joined = pys.filter(Boolean).join(' / ');
      if (joined) setEf((s) => (pinyinTouched.current ? s : { ...s, pinyin: joined }));
    }, 400);
    return () => clearTimeout(pinyinTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ef.chineseList]);

  async function saveEdit() {
    if (!editing) return;
    setBusy(true);
    try {
      const payload = {
        chinese: ef.chineseList.map((s) => s.trim()).filter(Boolean).join(' / '),
        pinyin: ef.pinyin.trim(),
        english: ef.englishList.map((s) => s.trim()).filter(Boolean).join(' / '),
        description: ef.description,
        meaning_id: editing.meaning_id, // édite CE sens précis
      };
      const { word } = await updateWord(editing.id, payload);
      // Un id peut avoir plusieurs sens en collection → on cible (id, meaning_id).
      setWords((ws) => ws.map((x) => (x.id === editing.id && x.meaning_id === editing.meaning_id ? { ...x, ...word } : x)));
      setEditing(null);
    } catch { /* garde la popup */ } finally { setBusy(false); }
  }
  async function doDelete() {
    if (!confirmDel) return;
    const id = confirmDel.id;
    const mid = confirmDel.meaning_id;
    setBusy(true);
    try {
      await deleteWord(id, mid);
      setWords((ws) => ws.filter((x) => !(x.id === id && x.meaning_id === mid)));
      setIdx((i) => { const nl = Math.max(words.length - 1, 1); return i >= nl ? nl - 1 : i; });
      setConfirmDel(null);
    } catch { /* garde la popup */ } finally { setBusy(false); }
  }

  // ── Multi-sélection (premium) ──
  function enterSelect() {
    if (!isPremium) { notifyUpgrade('bulk_delete'); return; } // paywall si non premium
    setSelectMode(true); setSelected([]);
  }
  function exitSelect() { setSelectMode(false); setSelected([]); }
  function toggleSelect(id) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }
  async function doBulkDelete() {
    if (!selected.length) return;
    setBulkBusy(true);
    try {
      await bulkDeleteWords(selected);
      const gone = new Set(selected);
      setWords((ws) => ws.filter((x) => !gone.has(x.id)));
      setConfirmBulk(false); setSelectMode(false); setSelected([]);
    } catch { /* garde la popup */ } finally { setBulkBusy(false); }
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
        {/* Illustration : pile de flashcards inclinées avec une pousse. */}
        <View style={{ width: 160, height: 150, marginBottom: 30 }}>
          <View style={{ position: 'absolute', top: 16, left: 22, width: 116, height: 116, borderRadius: 22, backgroundColor: '#dbe7ff', transform: [{ rotate: '-11deg' }] }} />
          <View style={{ position: 'absolute', top: 12, left: 22, width: 116, height: 116, borderRadius: 22, backgroundColor: '#eef3ff', transform: [{ rotate: '7deg' }] }} />
          <View style={{ position: 'absolute', top: 18, left: 22, width: 116, height: 116, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', ...SHADOW_CARD_FLAT, borderWidth: 1, borderColor: COLORS.line }}>
            <Text style={{ fontSize: 30, fontWeight: '800', color: COLORS.jiayou }}>加</Text>
            <Text style={{ fontSize: 12, color: COLORS.mutedLight, marginTop: 2 }}>jiā</Text>
          </View>
          <Text style={{ position: 'absolute', top: 0, right: 10, fontSize: 34 }}>🌱</Text>
        </View>

        <Text style={{ fontSize: 20, fontWeight: '800', color: COLORS.ink, textAlign: 'center' }}>{tr('co_empty_title')}</Text>
        <Text style={{ fontSize: 14.5, color: COLORS.muted, textAlign: 'center', marginTop: 8, lineHeight: 21, maxWidth: 300 }}>{tr('co_empty_sub')}</Text>

        {/* CTA primaire : acheter des packs (JiaStore) */}
        <Pressable
          onPress={() => onNavigate?.('store')}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 15, paddingHorizontal: 26, marginTop: 30, width: '100%', maxWidth: 320 }}
          className="active:opacity-80"
        >
          <Ionicons name="storefront" size={19} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15.5 }}>{tr('co_empty_buy')}</Text>
        </Pressable>

        {/* CTA secondaire : ajouter des mots un par un (Add Word) */}
        <Pressable
          onPress={() => onNavigate?.('add')}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#fff', borderWidth: 1.5, borderColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 14, paddingHorizontal: 26, marginTop: 12, width: '100%', maxWidth: 320 }}
          className="active:opacity-70"
        >
          <Ionicons name="add-circle-outline" size={19} color={COLORS.jiayou} />
          <Text style={{ color: COLORS.jiayou, fontWeight: '800', fontSize: 15.5 }}>{tr('co_empty_add')}</Text>
        </Pressable>
      </View>
    );
  }

  const len = deck.length;
  const w = len ? deck[idx % len] : null;

  // ── Vue LISTE ──
  if (view === 'list') {
    const q = query.trim().toLowerCase();
    const searchMatch = (x) => !q
      || (x.chinese || '').toLowerCase().includes(q)
      || (x.pinyin || '').toLowerCase().includes(q)
      || (x.english || '').toLowerCase().includes(q);
    const filtered = deck.filter(searchMatch);
    return (
      <Animated.View style={{ flex: 1, backgroundColor: COLORS.page, opacity: screenFade, transform: [{ scale: screenScale }] }}>
        <View style={{ flex: 1, width: '100%', maxWidth: 600, alignSelf: 'center' }}>
        <View {...(selectMode ? {} : listPan.panHandlers)} style={{ paddingTop: 8 }}>
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.line, marginBottom: 8 }} />
          {selectMode ? (
            // Barre de sélection : Annuler · N sélectionnés · Tout sélectionner.
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 8, height: 42 }}>
              <Pressable onPress={exitSelect} hitSlop={10}><Text style={{ color: COLORS.jiayou, fontWeight: '700', fontSize: 15 }}>{tr('co_cancel')}</Text></Pressable>
              <Text style={{ fontWeight: '800', color: '#1a1a2e', fontSize: 15 }}>{tr('co_selected').replace('{n}', selected.length)}</Text>
              <Pressable onPress={() => setSelected(selected.length === filtered.length ? [] : filtered.map((x) => x.id))} hitSlop={10}>
                <Text style={{ color: COLORS.jiayou, fontWeight: '700', fontSize: 15 }}>{tr('co_select_all')}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8 }}>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={tr('co_search')}
                placeholderTextColor={COLORS.mutedLight}
                autoCapitalize="none"
                style={{ flex: 1, backgroundColor: '#fff', borderRadius: 999, borderWidth: 1, borderColor: COLORS.line, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15 }}
              />
              {/* Entrer en multi-sélection (premium). */}
              <Pressable onPress={enterSelect} hitSlop={10} style={{ marginLeft: 14 }}>
                <Ionicons name="checkmark-circle-outline" size={24} color={COLORS.jiayou} />
              </Pressable>
              <Pressable onPress={() => switchView('card')} hitSlop={10} style={{ marginLeft: 14 }}>
                <Ionicons name="grid" size={24} color={COLORS.jiayou} />
              </Pressable>
            </View>
          )}
        </View>

        {filterPopup}
        <FlatList
          data={filtered}
          keyExtractor={(x) => `${x.id}:${x.meaning_id}`}
          // marge basse : FAB filtre / TabBar / barre de suppression ne masquent
          // pas les dernières lignes.
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: TAB_CLEARANCE + (selectMode ? 96 : 80) }}
          renderItem={({ item, index }) => {
            const sel = selected.includes(item.id);
            return (
              <Pressable
                onPress={() => (selectMode
                  ? toggleSelect(item.id)
                  : (setIdx(Math.max(0, deck.indexOf(item))), switchView('card')))}
                style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: sel ? '#eaf1ff' : (index % 2 ? '#fff' : '#fbfcfe'), paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.lineSoft }}
              >
                {selectMode ? (
                  <Ionicons name={sel ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={sel ? COLORS.jiayou : COLORS.mutedLight} style={{ marginRight: 10 }} />
                ) : null}
                {learningLang === 'zh' ? (
                  <>
                    <Text style={{ ...scriptStyle(item.chinese), color: '#1a1a2e', width: 80 }}>{item.chinese}</Text>
                    <Text style={{ color: COLORS.muted, flex: 1 }} numberOfLines={1}>{item.pinyin}</Text>
                    <Text style={{ ...scriptStyle(item.english), color: '#1a1a2e', flex: 1, textAlign: 'right' }} numberOfLines={1}>{cap(item.english)}</Text>
                  </>
                ) : (
                  // Pas de pinyin hors chinois → le mot appris récupère toute la
                  // colonne de gauche (plus de crop « sauciss/e »). La police suit
                  // la langue : mot appris occidental = léger, traduction zh = gras.
                  <>
                    <Text style={{ ...scriptStyle(item.chinese), color: '#1a1a2e', flex: 1.4, marginRight: 12 }} numberOfLines={1}>{item.chinese}</Text>
                    <Text style={{ ...scriptStyle(item.english), color: '#1a1a2e', flex: 1, textAlign: 'right' }} numberOfLines={1}>{cap(item.english)}</Text>
                  </>
                )}
              </Pressable>
            );
          }}
          ListEmptyComponent={<Text style={{ textAlign: 'center', color: COLORS.mutedLight, padding: 20 }}>{tr('co_no_match')}</Text>}
        />
        </View>

        {/* Barre de suppression (mode sélection) ou FAB filtre sinon. */}
        {selectMode && selected.length ? (
          // bottom = TAB_CLEARANCE : passe AU-DESSUS de la TabBar (absolue), comme le FAB.
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: TAB_CLEARANCE, paddingHorizontal: 16, zIndex: 20 }}>
            <View style={{ width: '100%', maxWidth: 600, alignSelf: 'center' }}>
              <Pressable onPress={() => setConfirmBulk(true)}
                style={{ backgroundColor: COLORS.danger, borderRadius: 999, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, ...SHADOW_CARD_FLAT }}>
                <Ionicons name="trash" size={17} color="#fff" />
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{tr('co_bulk_delete')} · {selected.length}</Text>
              </Pressable>
            </View>
          </View>
        ) : (!selectMode ? filterFab : null)}

        {/* Confirm suppression en masse (aucun autre modal ouvert en vue liste). */}
        <Popup visible={confirmBulk} onClose={() => { if (!bulkBusy) setConfirmBulk(false); }} maxWidth={360}>
          <Text style={{ fontSize: 16, fontWeight: '800', color: '#1a1a2e', marginBottom: 10, textAlign: 'center' }}>{tr('co_bulk_delete')}</Text>
          <Text style={{ fontSize: 14, color: COLORS.muted, textAlign: 'center', lineHeight: 20, marginBottom: 18 }}>
            {tr('co_bulk_confirm').replace('{n}', selected.length)}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable onPress={() => setConfirmBulk(false)} disabled={bulkBusy} style={{ flex: 1, paddingVertical: 13, borderRadius: 999, borderWidth: 2, borderColor: COLORS.line, alignItems: 'center' }}>
              <Text style={{ color: '#444', fontWeight: '700' }}>{tr('co_cancel')}</Text>
            </Pressable>
            <Pressable onPress={doBulkDelete} disabled={bulkBusy} style={{ flex: 1.3, paddingVertical: 13, borderRadius: 999, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, backgroundColor: COLORS.danger }}>
              {bulkBusy ? <ActivityIndicator color="#fff" size="small" /> : (<><Ionicons name="trash" size={15} color="#fff" /><Text style={{ color: '#fff', fontWeight: '800' }}>{tr('co_bulk_delete')}</Text></>)}
            </Pressable>
          </View>
        </Popup>
      </Animated.View>
    );
  }

  // Filtres actifs qui ne laissent aucun mot (vue carte) → état vide + reset.
  if (!w) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: COLORS.page }}>
        <Ionicons name="funnel-outline" size={40} color={COLORS.mutedLight} />
        <Text style={{ color: COLORS.muted, marginTop: 12, textAlign: 'center' }}>{tr('co_no_match_filters')}</Text>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 18 }}>
          <Pressable onPress={() => setFilterOpen(true)} style={{ borderWidth: 1.5, borderColor: COLORS.line, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20 }}>
            <Text style={{ color: COLORS.jiayou, fontWeight: '700' }}>{tr('co_edit_filters')}</Text>
          </Pressable>
          <Pressable onPress={resetFilters} style={{ backgroundColor: COLORS.jiayou, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 22 }}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>{tr('co_clear_filters')}</Text>
          </Pressable>
        </View>
        {filterPopup}
      </View>
    );
  }

  // ── Vue CARTE ──
  const chars = Array.from(w.chinese || '');
  const isSingle = chars.length === 1;
  // Le terme appris est toujours w.chinese ; sa traduction native est w.english.
  // isZh pilote hanzi+pinyin+HSK+tap-caractère ; sinon on affiche un mot latin.
  const isZh = learningLang === 'zh';

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

  const descriptionText = w.description;

  return (
    <Animated.View style={{ flex: 1, backgroundColor: COLORS.page, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 16, opacity: screenFade, transform: [{ scale: screenScale }] }}>
      {/* Gélule filtre posée au-dessus de la carte, alignée à droite. */}
      <View style={{ width: cardW, flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 10 }}>
        {filterPill}
      </View>

      <Animated.View {...cardPan.panHandlers} style={{ width: cardW, height: cardH, opacity: fade }}>
        <View style={{ flex: 1, backgroundColor: '#fff', borderRadius: 24, padding: 18, ...SHADOW_CARD_FLAT }}>
          {/* haut : picto score + HSK */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Text style={{ fontSize: 22 }}>{scorePicto(w.score || 0)}</Text>
            {/* Badge HSK : spécifique au chinois → masqué pour les autres langues apprises. */}
            {learningLang === 'zh' ? (
              <View style={{ borderWidth: 1, borderColor: COLORS.line, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ fontSize: 11, color: COLORS.muted, fontWeight: '600' }}>HSK : {w.hsk || tr('qz_street')}</Text>
              </View>
            ) : null}
          </View>

          {/* Encadré "mot à apprendre" — hauteur FIXE, wrap, police adaptative.
              Toujours le terme appris (w.chinese) : hanzi+pinyin si chinois, sinon
              mot dans la langue apprise. */}
          <View style={{ height: glyphBoxH, borderWidth: 1, borderColor: COLORS.lineSoft, borderRadius: 16, paddingHorizontal: 10, marginTop: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {isZh ? (
              <View style={{ alignItems: 'center' }}>
                {renderGlyphs(zhSize, true)}
                {w.pinyin ? (
                  <Text style={{ fontSize: 16, fontWeight: '600', color: COLORS.muted, textAlign: 'center', marginTop: 6 }}>
                    {w.pinyin}
                  </Text>
                ) : null}
              </View>
            ) : (
              <Text style={{ fontSize: enSize, fontWeight: '800', color: '#1a1a2e', textAlign: 'center' }}>
                {w.chinese}
              </Text>
            )}
          </View>

          {/* Réponse (masquable) = la traduction native (w.english) + description.
              Identique quelle que soit la langue apprise. */}
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingHorizontal: 6, paddingTop: 16 }}>
            {hideTranslation ? (
              <Text style={{ color: COLORS.mutedLight, fontStyle: 'italic' }}>{tr('co_translation_hidden')}</Text>
            ) : (
              <>
                <Text
                  onTextLayout={(e) => setTitleLines(e.nativeEvent.lines.length)}
                  style={{ fontSize: 20, fontWeight: '600', color: COLORS.jiayou, alignSelf: 'stretch', textAlign: titleLines > 2 ? 'left' : 'center' }}
                >
                  {w.english ? cap(w.english) : tr('co_no_translation')}
                </Text>
                <Text
                  onTextLayout={(e) => setDescLines(e.nativeEvent.lines.length)}
                  style={{ fontSize: 12.5, color: descriptionText ? COLORS.mutedLight : '#d3d7de', fontStyle: 'italic', alignSelf: 'stretch', textAlign: descLines > 2 ? 'left' : 'center', marginTop: 8 }}
                >
                  {descriptionText || tr('co_no_description')}
                </Text>
              </>
            )}
          </View>

          {/* contrôles ronds : écoute · masquer la traduction · réglages */}
          <View style={{ position: 'absolute', bottom: 14, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' }}>
            <Pressable
              onPress={() => play(w.chinese, ttsFor(learningLang), 'card')}
              style={circleBtn}
            >
              {speakingKey === 'card'
                ? <ActivityIndicator size="small" color={COLORS.jiayou} />
                : <Ionicons name="volume-medium" size={22} color={COLORS.jiayou} />}
            </Pressable>
            <Pressable
              onPress={() => setHideTranslation((h) => !h)}
              style={{ ...circleBtn, width: undefined, borderRadius: 22, flexDirection: 'row', gap: 6, paddingHorizontal: 14 }}
            >
              <Ionicons name={hideTranslation ? 'eye' : 'eye-off'} size={18} color={COLORS.muted} />
              <Text style={{ color: COLORS.muted, fontSize: 13, fontWeight: '600' }}>
                {hideTranslation ? tr('co_show_btn') : tr('co_hide_btn')}
              </Text>
            </Pressable>
            <Pressable onPress={() => setMenuOpen(true)} style={circleBtn}>
              <Ionicons name="settings-outline" size={20} color={COLORS.muted} />
            </Pressable>
          </View>
        </View>
      </Animated.View>

      {/* contrôles nav : ‹  compteur  › — flèches aux bords, compteur centré entre elles. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: cardW, marginTop: 20 }}>
        <Pressable onPress={() => go('prev')} style={{ width: 46, height: 46, borderRadius: 999, backgroundColor: COLORS.jiayou, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <Text numberOfLines={1} style={{ flex: 1, textAlign: 'center', marginHorizontal: 8, color: COLORS.mutedLight, fontSize: 12 }}>
          {(idx % len) + 1} / {len} · {tr('co_swipe_list')}
        </Text>
        <Pressable onPress={() => go('next')} style={{ width: 46, height: 46, borderRadius: 999, backgroundColor: COLORS.jiayou, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-forward" size={22} color="#fff" />
        </Pressable>
      </View>

      {filterPopup}

      {/* ── Popup sens d'un caractère ── */}
      <Popup visible={!!charInfo} onClose={() => setCharInfo(null)} maxWidth={280}>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 52, fontWeight: '800', color: '#1a1a2e' }}>{charInfo?.char}</Text>
          {charInfo?.loading ? (
            <View style={{ marginTop: 12, alignItems: 'center' }}><CatLoader size={80} /></View>
          ) : charInfo?.data ? (
            <>
              <View style={{ backgroundColor: COLORS.jiayouContainer, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 4, marginTop: 12 }}>
                <Text style={{ color: '#1976d2', fontWeight: '600' }}>{charInfo.data.pinyin || 'N/A'}</Text>
              </View>
              <Text style={{ color: COLORS.muted, marginTop: 8, textAlign: 'center' }}>{charInfo.data.english || tr('co_no_translation')}</Text>
              {charInfo.data.hsk ? (
                <View style={{ backgroundColor: '#e8f5e8', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3, marginTop: 8 }}>
                  <Text style={{ color: '#2e7d32', fontSize: 12, fontWeight: '600' }}>HSK {charInfo.data.hsk}</Text>
                </View>
              ) : null}
            </>
          ) : (
            <Text style={{ color: COLORS.mutedLight, marginTop: 12 }}>{tr('co_char_not_registered')}</Text>
          )}
          <Pressable onPress={() => play(charInfo?.char, 'zh-CN', 'char')} style={[circleBtn, { marginTop: 16 }]}>
            {speakingKey === 'char'
              ? <ActivityIndicator size="small" color={COLORS.jiayou} />
              : <Ionicons name="volume-medium" size={20} color={COLORS.jiayou} />}
          </Pressable>
        </View>
      </Popup>

      {/* ── Popup réglages (edit / delete) ── */}
      <Popup visible={menuOpen} onClose={() => setMenuOpen(false)} maxWidth={300}>
        <Pressable onPress={() => { setMenuOpen(false); openEdit(w); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }}>
          <Ionicons name="pencil" size={20} color={COLORS.jiayou} />
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#1d1d1f' }}>{tr('co_edit_word')}</Text>
        </Pressable>
        <View style={{ height: 1, backgroundColor: COLORS.lineSoft }} />
        <Pressable onPress={() => { setMenuOpen(false); setConfirmDel(w); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }}>
          <Ionicons name="trash" size={20} color={COLORS.danger} />
          <Text style={{ fontSize: 16, fontWeight: '600', color: COLORS.danger }}>{tr('co_delete_word')}</Text>
        </Pressable>
      </Popup>

      {/* ── Popup édition ── */}
      <Popup visible={!!editing} onClose={() => setEditing(null)} maxWidth={440}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#1d1d1f', marginBottom: 16 }}>{tr('co_edit_word')}</Text>

        {/* Terme appris : label selon la langue apprise (Chinese/English/French…). */}
        <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.muted, marginBottom: 4 }}>{learningLang === 'zh' ? tr('co_chinese') : langMeta(learningLang).label}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          {ef.chineseList.map((val, i) => (
            <View key={i} style={{ width: '47.5%', flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <TextInput
                value={val}
                onChangeText={(t) => setChineseAt(i, t)}
                autoCapitalize="none"
                placeholder={learningLang === 'zh' ? '汉字…' : `${langMeta(learningLang).label}…`}
                placeholderTextColor={COLORS.mutedLight}
                style={{ flex: 1, minWidth: 0, borderWidth: 1.5, borderColor: COLORS.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 }}
              />
              {ef.chineseList.length > 1 ? (
                <Pressable onPress={() => removeChinese(i)} hitSlop={6}>
                  <Ionicons name="close-circle" size={20} color={COLORS.danger} />
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
        <Pressable onPress={addChinese} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <Ionicons name="add-circle-outline" size={16} color={COLORS.jiayou} />
          <Text style={{ color: COLORS.jiayou, fontWeight: '600', fontSize: 13 }}>{tr('co_add_translation')}</Text>
        </Pressable>

        {/* Pinyin : uniquement pour un cours de chinois. */}
        {learningLang === 'zh' ? (
          <>
            <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.muted, marginBottom: 4 }}>{tr('co_pinyin')}</Text>
            <TextInput
              value={ef.pinyin}
              onChangeText={(t) => { pinyinTouched.current = true; setEf((s) => ({ ...s, pinyin: t })); }}
              autoCapitalize="none"
              placeholder={tr('co_pinyin')}
              placeholderTextColor={COLORS.mutedLight}
              style={{ borderWidth: 1.5, borderColor: COLORS.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16, marginBottom: 12 }}
            />
          </>
        ) : null}

        {/* Traduction : label selon la langue de base (native). */}
        <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.muted, marginBottom: 4 }}>{nativeLang === 'en' ? tr('co_english') : langMeta(nativeLang).label}</Text>
        {ef.englishList.map((val, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <TextInput
              value={val}
              onChangeText={(t) => setEnglishAt(i, t)}
              autoCapitalize="none"
              placeholder={tr('co_english_ph')}
              placeholderTextColor={COLORS.mutedLight}
              style={{ flex: 1, borderWidth: 1.5, borderColor: COLORS.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16 }}
            />
            {ef.englishList.length > 1 ? (
              <Pressable onPress={() => removeEnglish(i)} hitSlop={8}>
                <Ionicons name="close-circle" size={22} color={COLORS.danger} />
              </Pressable>
            ) : null}
          </View>
        ))}
        <Pressable onPress={addEnglish} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <Ionicons name="add-circle-outline" size={16} color={COLORS.jiayou} />
          <Text style={{ color: COLORS.jiayou, fontWeight: '600', fontSize: 13 }}>{tr('co_add_translation')}</Text>
        </Pressable>

        <View style={{ marginBottom: 12 }}>
          <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.muted, marginBottom: 4 }}>{tr('co_description')}</Text>
          <TextInput
            value={ef.description}
            onChangeText={(t) => setEf((s) => ({ ...s, description: t }))}
            autoCapitalize="none"
            multiline
            placeholder={tr('co_desc_ph')}
            placeholderTextColor={COLORS.mutedLight}
            style={{ borderWidth: 1.5, borderColor: COLORS.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16, minHeight: 72, textAlignVertical: 'top' }}
          />
        </View>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
          <Pressable onPress={() => setEditing(null)} style={{ flex: 1, paddingVertical: 13, borderRadius: 999, borderWidth: 2, borderColor: COLORS.line, alignItems: 'center' }}>
            <Text style={{ color: '#444', fontWeight: '600' }}>{tr('common_cancel')}</Text>
          </Pressable>
          <Pressable onPress={saveEdit} disabled={busy} style={{ flex: 1, paddingVertical: 13, borderRadius: 999, backgroundColor: COLORS.jiayou, alignItems: 'center' }}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>{tr('common_save')}</Text>}
          </Pressable>
        </View>
      </Popup>

      {/* ── Popup suppression ── */}
      <Popup visible={!!confirmDel} onClose={() => setConfirmDel(null)} maxWidth={380}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#1d1d1f', marginBottom: 8 }}>{tr('co_delete_word')}</Text>
        <Text style={{ color: COLORS.muted, marginBottom: 20 }}>
          {tr('co_remove_confirm').replace('{word}', confirmDel?.chinese || '')}
        </Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Pressable onPress={() => setConfirmDel(null)} style={{ flex: 1, paddingVertical: 13, borderRadius: 999, borderWidth: 2, borderColor: COLORS.line, alignItems: 'center' }}>
            <Text style={{ color: '#444', fontWeight: '600' }}>{tr('common_cancel')}</Text>
          </Pressable>
          <Pressable onPress={doDelete} disabled={busy} style={{ flex: 1, paddingVertical: 13, borderRadius: 999, backgroundColor: COLORS.danger, alignItems: 'center' }}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>{tr('common_delete')}</Text>}
          </Pressable>
        </View>
      </Popup>
    </Animated.View>
  );
}
