import { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Modal, Keyboard, Platform, Switch, useWindowDimensions, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../../ui';
import RichTextArea from '../../components/RichTextArea';
import CatLoader from '../../components/CatLoader';
import AiRecapLoader from '../../components/teachers/AiRecapLoader';
import { teacherLookupWords, teacherCreateLesson, teacherUpdateLesson, teacherStudentClassContext, teacherSendTask, getLessonRecap } from '../../api';
import { COLORS } from '../../theme';

const CN = /[一-鿿]/;
// Champ flexible (traduction) : multiligne → les sens longs s'affichent sur
// plusieurs lignes au lieu de scroller horizontalement (pas de scroll parasite).
const inputFlex = 'bg-surface-page border border-line rounded-lg px-2.5 py-2 text-[14px] text-ink';

// Création / édition d'une task — PLEIN ÉCRAN, une seule page (fusion de l'ancien
// wizard titre → mots → traductions). direction-aware comme teach-class.ejs.
//  • Titre OPTIONNEL : vide → la date du jour sert de titre.
//  • Description sur toute la largeur.
//  • Mots : chaque ajout résout la traduction et l'ajoute DIRECTEMENT à la liste
//    éditable en dessous (modifiable en direct, qu'il manque une trad ou non).
//  • Desktop : titre+description à gauche, mots à droite (côte à côte, une page).
// `editLesson` (optionnel) = { id, title, summary, words:[{chinese,pinyin,english}] }
// `endCourse` (optionnel) = slot { id, student_id, student_name } → MODE FIN DE
//   COURS : titre « Summary and homework for {student} », résolution de la classe
//   (classe de l'élève / existante / nouvelle) et envoi via teacherSendTask.
export default function CreateTaskPopup({ visible, classId, direction, editLesson = null, endCourse = null, onClose, onCreated }) {
  const isZhEn = direction === 'zh→en'; // cours d'anglais → saisie en anglais
  const { width } = useWindowDimensions();
  const isDesktop = width >= 760;
  const isEnd = !!endCourse;
  const studentName = endCourse?.student_name || 'your student';

  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [input, setInput] = useState('');
  const [cards, setCards] = useState([]); // {cid, chinese, pinyin, english, found, loading}
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [kb, setKb] = useState(0);
  const inputRef = useRef(null);
  const cidRef = useRef(0);
  const scrollRef = useRef(null);
  const wordsY = useRef(0); // position Y de la section « mots » (scroll au focus)

  // Mode fin de cours : résolution de la classe cible.
  const [ctx, setCtx] = useState(null); // { classes, student_classes } | null (loading)
  const [studentClassId, setStudentClassId] = useState(null);
  const [useExisting, setUseExisting] = useState(false);
  const [existingId, setExistingId] = useState(null);
  const [newName, setNewName] = useState('');
  const [recapLoading, setRecapLoading] = useState(false); // IA génère le compte rendu
  const [skipRecap, setSkipRecap] = useState(false);       // prof choisit d'écrire à la main
  const recapDone = useRef(false);

  // Titre par défaut = date du jour (lisible) quand le prof n'en met pas.
  const todayLabel = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  const endTitleDefault = `Summary and homework for ${studentName}`;

  function reset() {
    setTitle(''); setSummary(''); setInput('');
    setCards([]); setErr(''); setBusy(false); cidRef.current = 0;
    setCtx(null); setStudentClassId(null); setUseExisting(false); setExistingId(null); setNewName('');
    setRecapLoading(false); setSkipRecap(false); recapDone.current = false;
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
      // Mode fin de cours : titre pré-rempli + nom de classe par défaut.
      if (isEnd) { setNewName(studentName === 'your student' ? 'New class' : `${studentName}`); }
    }
  }, [visible, editLesson]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mode fin de cours : charge le contexte de classe de l'élève.
  useEffect(() => {
    if (!visible || !isEnd) return;
    let alive = true;
    if (!endCourse?.student_id) { setCtx({ classes: [], student_classes: [] }); return; }
    teacherStudentClassContext(endCourse.student_id)
      .then((d) => {
        if (!alive) return;
        const sc = d.student_classes || [];
        setCtx({ classes: d.classes || [], student_classes: sc });
        if (sc.length) setStudentClassId(sc[0].id);
      })
      .catch(() => { if (alive) setCtx({ classes: [], student_classes: [] }); });
    return () => { alive = false; };
  }, [visible, isEnd, endCourse?.student_id]);

  // Mode fin de cours : récupère le compte rendu IA (transcription → DeepSeek).
  // pending → animation + poll ; ready → préremplit résumé + mots ; sinon manuel.
  useEffect(() => {
    if (!visible || !isEnd || !endCourse?.id) return;
    recapDone.current = false;
    let alive = true;
    let tries = 0;

    const applyReady = async (data) => {
      if (!alive || recapDone.current) return;
      recapDone.current = true;
      setRecapLoading(false);
      if (data.summary) setSummary((s) => (s && s.trim() ? s : data.summary)); // n'écrase pas une saisie
      const words = Array.isArray(data.words) ? data.words.filter(Boolean) : [];
      if (!words.length) return;
      try {
        const { results } = await teacherLookupWords(words);
        const built = (results || []).map((r) => {
          const typed = r.input;
          if (r.mot) return { cid: ++cidRef.current, chinese: r.mot.chinese, pinyin: r.mot.pinyin || '', english: r.mot.english || '', found: true, loading: false };
          if (isZhEn) return { cid: ++cidRef.current, chinese: '', pinyin: '', english: typed, found: false, loading: false };
          return { cid: ++cidRef.current, chinese: typed, pinyin: r.pinyin || '', english: '', found: false, loading: false };
        });
        if (alive) setCards((cs) => {
          const seen = new Set(cs.map(dupKey));
          return [...cs, ...built.filter((c) => !seen.has(isZhEn ? c.english : c.chinese))];
        });
      } catch { /* mots facultatifs */ }
    };

    const poll = async () => {
      if (!alive || recapDone.current) return;
      try {
        const d = await getLessonRecap(endCourse.id);
        if (!alive) return;
        if (d.status === 'ready') { applyReady(d); return; }
        if (d.status === 'pending' && tries < 30) { tries += 1; setRecapLoading(true); setTimeout(poll, 4000); return; }
        setRecapLoading(false); // none / error / timeout → saisie manuelle
      } catch { if (alive) setRecapLoading(false); }
    };
    poll();
    return () => { alive = false; };
  }, [visible, isEnd, endCourse?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Les nouveaux mots s'ajoutent EN HAUT de la liste (juste sous le champ) →
    // restent visibles même clavier ouvert.
    setCards((cs) => [{ cid, ...base, found: false, loading: true }, ...cs]);
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

  // Classe cible en mode fin de cours (class_id OU class_name).
  const studentClasses = ctx?.student_classes || [];
  const allClasses = ctx?.classes || [];
  const hasStudentClass = studentClasses.length > 0;
  function resolveClass() {
    if (hasStudentClass) return { class_id: studentClassId || studentClasses[0].id };
    if (useExisting) return existingId ? { class_id: existingId } : null;
    return newName.trim() ? { class_name: newName.trim() } : null;
  }

  async function save() {
    // En fin de cours, les mots sont facultatifs (un homework peut n'être que du
    // texte) ; sinon il faut au moins un mot.
    if (!isEnd && !cards.length) { setErr('Add at least one word.'); return; }
    const bad = cards.find((w) => !cardComplete(w));
    if (bad) { setErr(`Complete the translation for "${(isZhEn ? bad.english : bad.chinese) || '—'}"`); return; }

    const words = cards.map((w) => ({ chinese: w.chinese, pinyin: w.pinyin, english: w.english }));

    if (isEnd) {
      const cls = resolveClass();
      if (!cls) { setErr(useExisting ? 'Pick a class.' : 'Name the new class.'); return; }
      setBusy(true); setErr('');
      try {
        await teacherSendTask({
          student_id: endCourse.student_id,
          slot_id: endCourse.id,
          ...cls,
          title: title.trim() || endTitleDefault,
          summary: summary.trim(),
          words,
        });
        onCreated();
        close();
      } catch (e) { setErr(e.message || 'Error'); setBusy(false); }
      return;
    }

    setBusy(true); setErr('');
    const payload = { title: title.trim() || todayLabel, summary: summary.trim(), words };
    try {
      if (editLesson) await teacherUpdateLesson(editLesson.id, payload);
      else await teacherCreateLesson(classId, payload);
      onCreated();
      close();
    } catch (e) { setErr(e.message || 'Error'); setBusy(false); }
  }

  const ClassRadio = ({ c, selected, onSelect, meta }) => (
    <Pressable onPress={onSelect}
      className="flex-row items-center gap-2.5 rounded-xl border p-3 mb-2"
      style={{ borderWidth: 1.5, borderColor: selected ? COLORS.jiayou : '#e6e8eb', backgroundColor: selected ? '#eef4ff' : '#fff' }}>
      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? COLORS.jiayou : '#c7ced6'} />
      <View style={{ flex: 1 }}>
        <Text className="text-[15px] font-bold text-ink" numberOfLines={1}>{c.name}</Text>
        {meta ? <Text className="text-[12px] text-muted-light mt-0.5">{meta}</Text> : null}
      </View>
    </Pressable>
  );

  // Bloc « Classe » (mode fin de cours uniquement).
  const ClassBlock = !isEnd ? null : (
    <View className="mt-5">
      <Text className="text-[13px] font-semibold text-muted mb-1.5">Class</Text>
      {ctx === null ? (
        <ActivityIndicator color={COLORS.jiayou} style={{ marginVertical: 8 }} />
      ) : hasStudentClass ? (
        studentClasses.length === 1 ? (
          <View className="flex-row items-center gap-2 bg-jiayou-soft rounded-xl p-3">
            <Ionicons name="checkmark-circle" size={18} color={COLORS.jiayou} />
            <Text className="flex-1 text-[14.5px] font-bold text-ink" numberOfLines={1}>{studentClasses[0].name}</Text>
          </View>
        ) : (
          <>
            <Text className="text-[12.5px] text-muted mb-2">{studentName} is in several classes — pick one:</Text>
            {studentClasses.map((c) => <ClassRadio key={c.id} c={c} selected={studentClassId === c.id} onSelect={() => setStudentClassId(c.id)} />)}
          </>
        )
      ) : (
        <>
          <View className="flex-row items-center gap-2.5 mb-3">
            <View className="flex-1">
              <Text className="text-[14px] font-bold text-ink">Add to an existing class</Text>
              <Text className="text-[12px] text-muted-light mt-0.5">Off → a new class is created for {studentName}.</Text>
            </View>
            <Switch value={useExisting} onValueChange={(v) => { setUseExisting(v); setErr(''); }} trackColor={{ false: '#d7dce3', true: COLORS.jiayou }} thumbColor="#fff" />
          </View>
          {useExisting ? (
            allClasses.length === 0 ? (
              <Text className="text-[13px] text-muted-light">No class yet — turn this off to create one.</Text>
            ) : allClasses.map((c) => (
              <ClassRadio key={c.id} c={c} selected={existingId === c.id} onSelect={() => setExistingId(c.id)}
                meta={`${c.student_count} student${c.student_count === 1 ? '' : 's'} · ${c.lesson_count} task${c.lesson_count === 1 ? '' : 's'}`} />
            ))
          ) : (
            <TextInput value={newName} onChangeText={setNewName} maxLength={80}
              placeholder="e.g. Beginner A1" placeholderTextColor={COLORS.mutedLight}
              className="bg-surface-page border border-line rounded-xl px-3.5 h-12 text-[15px] text-ink" />
          )}
        </>
      )}
    </View>
  );

  // ── Blocs réutilisés (mobile = empilés, desktop = côte à côte) ──────────────
  const DetailsBlock = (
    <View style={{ flex: isDesktop ? 1 : undefined }}>
      <Text className="text-[13px] font-semibold text-muted mb-1.5">Title</Text>
      <TextInput
        value={title} onChangeText={setTitle} maxLength={120}
        placeholder={isEnd ? endTitleDefault : todayLabel} placeholderTextColor={COLORS.mutedLight}
        className="bg-surface-page border border-line rounded-xl px-3.5 h-12 text-[15px] text-ink" />
      <Text className="text-[11.5px] text-muted-light mt-1">
        {isEnd ? 'Optional — a default title is used if empty.' : "Optional — left empty, today's date is used."}
      </Text>

      <Text className="text-[13px] font-semibold text-muted mb-1.5 mt-4">{isEnd ? 'Summary & homework' : 'Description'}</Text>
      <RichTextArea
        value={summary} onChange={setSummary} maxLength={4000}
        minHeight={isDesktop ? 220 : 160}
        placeholder={isEnd ? 'Recap, what to review, homework…' : 'Notes for your students — what this task is about…'}
      />

      {ClassBlock}
    </View>
  );

  // Au focus du champ mots : remonte la section en haut de l'écran pour que le
  // champ + les résultats restent au-dessus du clavier.
  const onWordsFocus = () => setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, wordsY.current - 12), animated: true }), 90);

  const WordsBlock = (
    <View
      onLayout={(e) => { wordsY.current = e.nativeEvent.layout.y; }}
      style={{ flex: isDesktop ? 1 : undefined, marginTop: isDesktop ? 0 : 20 }}
    >
      <Text className="text-[13px] font-semibold text-muted mb-1.5">
        Words {isZhEn ? '(English)' : '(Chinese 中文)'}
      </Text>
      <View className="flex-row gap-2">
        <TextInput
          ref={inputRef} value={input} onChangeText={setInput} onSubmitEditing={addWord} onFocus={onWordsFocus}
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
                  <TextInput value={w.chinese} onChangeText={(t) => setCard(w.cid, { chinese: t })} multiline placeholder="汉字 *" placeholderTextColor={COLORS.mutedLight} className={`flex-1 ${inputFlex}`} style={{ minHeight: 40 }} textAlignVertical="center" />
                  <TextInput value={w.pinyin} onChangeText={(t) => setCard(w.cid, { pinyin: t })} multiline placeholder="pinyin" placeholderTextColor={COLORS.mutedLight} className={inputFlex} style={{ width: 96, minHeight: 40 }} textAlignVertical="center" />
                </>
              ) : (
                <>
                  <TextInput value={w.pinyin} onChangeText={(t) => setCard(w.cid, { pinyin: t })} multiline placeholder="pinyin" placeholderTextColor={COLORS.mutedLight} className={inputFlex} style={{ width: 96, minHeight: 40 }} textAlignVertical="center" />
                  <TextInput value={w.english} onChangeText={(t) => setCard(w.cid, { english: t })} multiline placeholder="english *" placeholderTextColor={COLORS.mutedLight} className={`flex-1 ${inputFlex}`} style={{ minHeight: 40 }} textAlignVertical="center" />
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
        {/* En-tête fixe : fermer · titre (centré absolu) · enregistrer */}
        <View className="h-14 border-b border-line bg-white justify-center px-4">
          <Text pointerEvents="none" numberOfLines={1}
            className="text-[16px] font-bold text-ink"
            style={{ position: 'absolute', left: 72, right: 72, textAlign: 'center' }}>
            {isEnd ? `Summary & homework · ${studentName}` : editLesson ? 'Edit task' : 'New task'}
          </Text>
          <View className="flex-row items-center justify-between">
            <Pressable onPress={close} hitSlop={8} className="w-9 h-9 items-center justify-center -ml-1.5">
              <Ionicons name="close" size={24} color={COLORS.muted} />
            </Pressable>
            <Button title={isEnd ? 'Send' : editLesson ? 'Save' : 'Create'} size="sm" loading={busy} disabled={isEnd && recapLoading && !skipRecap} onPress={save} style={{ paddingHorizontal: 20 }} />
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
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

          {/* IA encore en cours après « skip » : petit rappel au-dessus du formulaire. */}
          {recapLoading && skipRecap ? (
            <View className="flex-row items-center gap-3 bg-jiayou-soft border border-[#dbe3f1] rounded-xl px-3.5 py-2.5 mb-3">
              <CatLoader size={28} />
              <Text className="flex-1 text-[12px] text-muted">The AI recap is still cooking — it'll drop in when ready.</Text>
            </View>
          ) : null}

          {isEnd && recapLoading && !skipRecap ? (
            /* ── Mode AI-load : écran d'attente dédié ─────────────────────── */
            <AiRecapLoader studentName={studentName} onSkip={() => setSkipRecap(true)} />
          ) : isDesktop ? (
            <View className="flex-row gap-6">{DetailsBlock}{WordsBlock}</View>
          ) : (
            <>{DetailsBlock}{WordsBlock}</>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
