import { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Modal, Keyboard, Platform, useWindowDimensions, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../../ui';
import { teacherLookupWords, teacherCreateLesson, teacherUpdateLesson } from '../../api';
import { COLORS } from '../../theme';

const CN = /[一-鿿]/;
const inputSm = 'bg-surface-page border border-line rounded-lg px-2.5 h-10 text-[14px] text-ink';

// Création / édition d'une task — PLEIN ÉCRAN, une seule page (fusion de l'ancien
// wizard titre → mots → traductions). direction-aware comme teach-class.ejs.
//  • Titre OPTIONNEL : vide → la date du jour sert de titre.
//  • Description sur toute la largeur.
//  • Mots : chaque ajout résout la traduction et l'ajoute DIRECTEMENT à la liste
//    éditable en dessous (modifiable en direct, qu'il manque une trad ou non).
//  • Desktop : titre+description à gauche, mots à droite (côte à côte, une page).
// `editLesson` (optionnel) = { id, title, summary, words:[{chinese,pinyin,english}] }
export default function CreateTaskPopup({ visible, classId, direction, editLesson = null, onClose, onCreated }) {
  const isZhEn = direction === 'zh→en'; // cours d'anglais → saisie en anglais
  const { width } = useWindowDimensions();
  const isDesktop = width >= 760;

  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [input, setInput] = useState('');
  const [cards, setCards] = useState([]); // {cid, chinese, pinyin, english, found, loading}
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [kb, setKb] = useState(0);
  const inputRef = useRef(null);
  const cidRef = useRef(0);

  // Titre par défaut = date du jour (lisible) quand le prof n'en met pas.
  const todayLabel = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

  function reset() {
    setTitle(''); setSummary(''); setInput('');
    setCards([]); setErr(''); setBusy(false); cidRef.current = 0;
  }
  // À l'ouverture : reset (création) ou pré-remplissage (édition).
  useEffect(() => {
    if (!visible) return;
    if (editLesson) {
      setInput(''); setErr(''); setBusy(false);
      setTitle(editLesson.title || ''); setSummary(editLesson.summary || '');
      setCards((editLesson.words || []).map((w) => ({
        cid: ++cidRef.current,
        chinese: w.chinese || '', pinyin: w.pinyin || '', english: w.english || '', found: true, loading: false,
      })));
    } else {
      reset();
    }
  }, [visible, editLesson]);

  // Hauteur du clavier : dans un <Modal>, KeyboardAvoidingView ne marche pas sur
  // Android → on réserve la hauteur en paddingBottom du scroll.
  useEffect(() => {
    if (!visible) { setKb(0); return; }
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, (e) => setKb(e.endCoordinates?.height || 0));
    const h = Keyboard.addListener(hideEvt, () => setKb(0));
    return () => { s.remove(); h.remove(); };
  }, [visible]);

  function close() { reset(); onClose(); }

  const wordValid = (v) => (!v ? true : isZhEn ? !CN.test(v) : !/[^一-鿿]/.test(v));
  const dupKey = (c) => (isZhEn ? c.english : c.chinese);

  // Ajout d'un mot : on le pousse TOUT DE SUITE (optimiste) puis on résout la
  // traduction en arrière-plan et on patche la ligne → liste live.
  async function addWord() {
    const v = input.trim();
    if (!v || !wordValid(v)) return;
    if (cards.some((c) => dupKey(c) === v)) { setInput(''); return; }
    const cid = ++cidRef.current;
    const base = isZhEn
      ? { chinese: '', pinyin: '', english: v }
      : { chinese: v, pinyin: '', english: '' };
    setCards((cs) => [...cs, { cid, ...base, found: false, loading: true }]);
    setInput(''); setErr('');
    inputRef.current?.focus();
    try {
      const { results } = await teacherLookupWords([v]);
      const r = (results || [])[0];
      setCards((cs) => cs.map((c) => {
        if (c.cid !== cid) return c;
        if (r?.mot) return { ...c, chinese: r.mot.chinese, pinyin: r.mot.pinyin || '', english: r.mot.english || '', found: true, loading: false };
        // Pas trouvé : on garde la saisie, on complète juste le pinyin si fourni.
        return { ...c, pinyin: !isZhEn ? (r?.pinyin || c.pinyin) : c.pinyin, found: false, loading: false };
      }));
    } catch {
      setCards((cs) => cs.map((c) => (c.cid === cid ? { ...c, loading: false } : c)));
    }
  }

  const cardComplete = (w) => (isZhEn ? !!String(w.chinese).trim() : !!String(w.english).trim());
  function setCard(cid, patch) { setCards((cs) => cs.map((c) => (c.cid === cid ? { ...c, ...patch } : c))); }
  function removeCard(cid) { setCards((cs) => cs.filter((c) => c.cid !== cid)); }

  async function save() {
    if (!cards.length) { setErr('Add at least one word.'); return; }
    const bad = cards.find((w) => !cardComplete(w));
    if (bad) { setErr(`Complete the translation for "${(isZhEn ? bad.english : bad.chinese) || '—'}"`); return; }
    setBusy(true); setErr('');
    const payload = {
      title: title.trim() || todayLabel,
      summary: summary.trim(),
      words: cards.map((w) => ({ chinese: w.chinese, pinyin: w.pinyin, english: w.english })),
    };
    try {
      if (editLesson) await teacherUpdateLesson(editLesson.id, payload);
      else await teacherCreateLesson(classId, payload);
      onCreated();
      close();
    } catch (e) { setErr(e.message || 'Error'); setBusy(false); }
  }

  // ── Blocs réutilisés (mobile = empilés, desktop = côte à côte) ──────────────
  const DetailsBlock = (
    <View style={{ flex: isDesktop ? 1 : undefined }}>
      <Text className="text-[13px] font-semibold text-muted mb-1.5">Title</Text>
      <TextInput
        value={title} onChangeText={setTitle} maxLength={120}
        placeholder={todayLabel} placeholderTextColor={COLORS.mutedLight}
        className="bg-surface-page border border-line rounded-xl px-3.5 h-12 text-[15px] text-ink" />
      <Text className="text-[11.5px] text-muted-light mt-1">Optional — left empty, today's date is used.</Text>

      <Text className="text-[13px] font-semibold text-muted mb-1.5 mt-4">Description</Text>
      <TextInput
        value={summary} onChangeText={setSummary} maxLength={2000} multiline
        placeholder="Notes for your students — what this task is about…"
        placeholderTextColor={COLORS.mutedLight}
        className="bg-surface-page border border-line rounded-xl px-3.5 py-3 text-[15px] text-ink"
        style={{ minHeight: isDesktop ? 220 : 150, textAlignVertical: 'top' }} />
    </View>
  );

  const WordsBlock = (
    <View style={{ flex: isDesktop ? 1 : undefined, marginTop: isDesktop ? 0 : 20 }}>
      <Text className="text-[13px] font-semibold text-muted mb-1.5">
        Words {isZhEn ? '(English)' : '(Chinese 中文)'}
      </Text>
      <View className="flex-row gap-2">
        <TextInput
          ref={inputRef} value={input} onChangeText={setInput} onSubmitEditing={addWord}
          blurOnSubmit={false} returnKeyType="next" autoCapitalize="none"
          placeholder={isZhEn ? 'type a word + ↵' : '输入汉字 + ↵'} placeholderTextColor={COLORS.mutedLight}
          className="flex-1 bg-surface-page border border-line rounded-xl px-3.5 h-12 text-[15px] text-ink" />
        <Pressable onPress={addWord} className="w-12 h-12 rounded-xl bg-jiayou items-center justify-center">
          <Ionicons name="add" size={22} color="#fff" />
        </Pressable>
      </View>
      {input && !wordValid(input.trim()) ? (
        <Text className="text-danger text-[12px] mt-1.5">{isZhEn ? 'English words only' : '只能输入中文 · Chinese only'}</Text>
      ) : null}

      {/* Liste live des mots, éditable en direct */}
      <View className="mt-3">
        {cards.length === 0 ? (
          <View className="items-center py-6">
            <Ionicons name="albums-outline" size={26} color={COLORS.mutedLight} />
            <Text className="text-[12.5px] text-muted-light mt-2">No word yet — add some above.</Text>
          </View>
        ) : cards.map((w) => {
          const ok = cardComplete(w);
          return (
            <View key={w.cid} className={`flex-row items-center gap-2 rounded-xl border p-2 mb-2 ${ok ? 'border-[#cfe6d6] bg-[#f2fbf5]' : 'border-[#f3d2d2] bg-[#fdf5f5]'}`}>
              <Text className="text-jiayou font-extrabold text-[16px] min-w-[42px] text-center">{(isZhEn ? w.english : w.chinese) || '—'}</Text>
              {w.loading ? (
                <View className="flex-1 flex-row items-center gap-2"><ActivityIndicator size="small" color={COLORS.jiayou} /><Text className="text-[12.5px] text-muted-light">looking up…</Text></View>
              ) : isZhEn ? (
                <>
                  <TextInput value={w.chinese} onChangeText={(t) => setCard(w.cid, { chinese: t })} placeholder="汉字 *" placeholderTextColor={COLORS.mutedLight} className={`flex-1 ${inputSm}`} />
                  <TextInput value={w.pinyin} onChangeText={(t) => setCard(w.cid, { pinyin: t })} placeholder="pinyin" placeholderTextColor={COLORS.mutedLight} className={inputSm} style={{ maxWidth: 96 }} />
                </>
              ) : (
                <>
                  <TextInput value={w.pinyin} onChangeText={(t) => setCard(w.cid, { pinyin: t })} placeholder="pinyin" placeholderTextColor={COLORS.mutedLight} className={inputSm} style={{ maxWidth: 96 }} />
                  <TextInput value={w.english} onChangeText={(t) => setCard(w.cid, { english: t })} placeholder="english *" placeholderTextColor={COLORS.mutedLight} className={`flex-1 ${inputSm}`} />
                </>
              )}
              <Pressable onPress={() => removeCard(w.cid)} hitSlop={6}><Ionicons name="close" size={16} color={COLORS.danger} /></Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent onRequestClose={close}>
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: COLORS.page }}>
        {/* En-tête fixe : fermer · titre · enregistrer */}
        <View className="flex-row items-center justify-between px-4 h-14 border-b border-line bg-white">
          <Pressable onPress={close} hitSlop={8} className="flex-row items-center gap-1">
            <Ionicons name="close" size={24} color={COLORS.muted} />
          </Pressable>
          <Text className="text-[16px] font-bold text-ink">{editLesson ? 'Edit task' : 'New task'}</Text>
          <Button title={editLesson ? 'Save' : 'Create'} loading={busy} onPress={save} style={{ paddingHorizontal: 16, height: 38, justifyContent: 'center' }} />
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 24 + kb, width: '100%', maxWidth: isDesktop ? 1000 : 560, alignSelf: 'center' }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {err ? (
            <View className="bg-[#fdf2f2] border border-[#f3d2d2] rounded-xl px-3.5 py-2.5 mb-3">
              <Text className="text-danger text-[13px] font-semibold">{err}</Text>
            </View>
          ) : null}

          {isDesktop ? (
            <View className="flex-row gap-6">{DetailsBlock}{WordsBlock}</View>
          ) : (
            <>{DetailsBlock}{WordsBlock}</>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
