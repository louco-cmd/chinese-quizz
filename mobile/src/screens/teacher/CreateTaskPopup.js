import { useState, useRef } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Popup from '../../components/Popup';
import { teacherLookupWords, teacherCreateLesson } from '../../api';
import { COLORS } from '../../theme';

const CN = /[一-鿿]/;
const inputSm = 'bg-surface-page border border-line rounded-lg px-2.5 h-10 text-[14px] text-ink';

// Création d'une task en 3 étapes (titre/résumé → mots → traductions),
// direction-aware comme teach-class.ejs. `direction` = quiz_direction du prof.
export default function CreateTaskPopup({ visible, classId, direction, onClose, onCreated }) {
  const isZhEn = direction === 'zh→en'; // cours d'anglais → saisie en anglais
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [input, setInput] = useState('');
  const [pending, setPending] = useState([]);   // mots tapés
  const [cards, setCards] = useState([]);        // {chinese, pinyin, english, found}
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const inputRef = useRef(null);

  function reset() {
    setStep(1); setTitle(''); setSummary(''); setInput('');
    setPending([]); setCards([]); setErr(''); setBusy(false);
  }
  function close() { reset(); onClose(); }

  const wordValid = (v) => (!v ? true : isZhEn ? !CN.test(v) : !/[^一-鿿]/.test(v));

  function addPill() {
    const v = input.trim();
    if (!v || !wordValid(v)) return;
    if (!pending.includes(v)) setPending((p) => [...p, v]);
    setInput('');
    // Garde le focus pour enchaîner les mots sans re-cliquer.
    inputRef.current?.focus();
  }

  async function goStep2() {
    if (!title.trim()) { setErr('Title required'); return; }
    setErr(''); setStep(2);
  }

  async function fetchWords() {
    let list = [...pending];
    if (input.trim() && wordValid(input.trim()) && !list.includes(input.trim())) list = [...list, input.trim()];
    if (!list.length) { setErr('Add at least one word.'); return; }
    setBusy(true); setErr('');
    try {
      const { results } = await teacherLookupWords(list);
      const next = [...cards];
      (results || []).forEach((r) => {
        const typed = r.input;
        const dupe = next.some((t) => (isZhEn ? t.english === typed : t.chinese === typed));
        if (dupe) return;
        if (r.mot) next.push({ chinese: r.mot.chinese, pinyin: r.mot.pinyin || '', english: r.mot.english || '', found: true });
        else if (isZhEn) next.push({ chinese: '', pinyin: '', english: typed, found: false });
        else next.push({ chinese: typed, pinyin: r.pinyin || '', english: '', found: false });
      });
      setCards(next); setPending([]); setInput('');
      setStep(3);
    } catch (e) { setErr(e.message || 'Lookup error'); } finally { setBusy(false); }
  }

  const cardComplete = (w) => (isZhEn ? !!String(w.chinese).trim() : !!String(w.english).trim());

  function setCard(i, patch) { setCards((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c))); }
  function removeCard(i) { setCards((cs) => cs.filter((_, j) => j !== i)); }

  async function create() {
    if (!cards.length) { setErr('No words to send.'); return; }
    const bad = cards.find((w) => !cardComplete(w));
    if (bad) { setErr(`Complete the translation for "${isZhEn ? bad.english : bad.chinese}"`); return; }
    setBusy(true); setErr('');
    try {
      await teacherCreateLesson(classId, {
        title: title.trim(), summary: summary.trim(),
        words: cards.map((w) => ({ chinese: w.chinese, pinyin: w.pinyin, english: w.english })),
      });
      onCreated();
      close();
    } catch (e) { setErr(e.message || 'Error'); setBusy(false); }
  }

  return (
    <Popup visible={visible} onClose={close} maxWidth={460}>
      {/* En-tête + points d'étape */}
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-[17px] font-bold text-ink">New task</Text>
        <View className="flex-row gap-1.5">
          {[1, 2, 3].map((i) => <View key={i} className={`h-1.5 rounded-full ${i <= step ? 'w-5 bg-jiayou' : 'w-1.5 bg-line'}`} />)}
        </View>
      </View>

      {step === 1 && (
        <>
          <Text className="text-[13px] font-semibold text-muted mb-1.5">Title *</Text>
          <TextInput value={title} onChangeText={setTitle} maxLength={120} placeholder="e.g. Week 1 — greetings"
            placeholderTextColor={COLORS.mutedLight} className="bg-surface-page border border-line rounded-xl px-3.5 h-12 text-[15px] text-ink mb-3" />
          <Text className="text-[13px] font-semibold text-muted mb-1.5">Summary (optional)</Text>
          <TextInput value={summary} onChangeText={setSummary} maxLength={2000} multiline placeholder="Notes for your students…"
            placeholderTextColor={COLORS.mutedLight} className="bg-surface-page border border-line rounded-xl px-3.5 py-3 text-[15px] text-ink" style={{ minHeight: 80, textAlignVertical: 'top' }} />
          {err ? <Text className="text-danger text-[13px] font-semibold mt-2">{err}</Text> : null}
          <View className="flex-row gap-3 mt-4">
            <Pressable onPress={close} className="flex-1 bg-[#f1f3f5] rounded-xl py-3 items-center"><Text className="text-muted font-bold">Cancel</Text></Pressable>
            <Pressable onPress={goStep2} className="flex-1 bg-jiayou rounded-xl py-3 items-center"><Text className="text-white font-bold">Next</Text></Pressable>
          </View>
        </>
      )}

      {step === 2 && (
        <>
          <Text className="text-[13px] font-semibold text-muted mb-1.5">
            Add words {isZhEn ? '(English)' : '(Chinese 中文)'}
          </Text>
          <View className="flex-row gap-2">
            <TextInput ref={inputRef} value={input} onChangeText={setInput} onSubmitEditing={addPill}
              autoFocus blurOnSubmit={false} returnKeyType="next" autoCapitalize="none"
              placeholder={isZhEn ? 'type a word…' : '输入汉字…'} placeholderTextColor={COLORS.mutedLight}
              className="flex-1 bg-surface-page border border-line rounded-xl px-3.5 h-12 text-[15px] text-ink" />
            <Pressable onPress={addPill} className="w-12 h-12 rounded-xl bg-jiayou items-center justify-center"><Ionicons name="add" size={22} color="#fff" /></Pressable>
          </View>
          {input && !wordValid(input.trim()) ? (
            <Text className="text-danger text-[12px] mt-1.5">{isZhEn ? 'English words only' : '只能输入中文 · Chinese only'}</Text>
          ) : null}
          <View className="flex-row flex-wrap gap-2 mt-3">
            {pending.map((w, i) => (
              <View key={i} className="flex-row items-center gap-1.5 bg-jiayou-soft border border-[#dbe3f1] rounded-full pl-3 pr-1.5 py-1.5">
                <Text className="text-[14px] text-ink">{w}</Text>
                <Pressable onPress={() => setPending((p) => p.filter((_, j) => j !== i))} hitSlop={6}><Ionicons name="close-circle" size={16} color={COLORS.muted} /></Pressable>
              </View>
            ))}
          </View>
          {err ? <Text className="text-danger text-[13px] font-semibold mt-2">{err}</Text> : null}
          <View className="flex-row gap-3 mt-4">
            <Pressable onPress={() => setStep(1)} className="flex-1 bg-[#f1f3f5] rounded-xl py-3 items-center"><Text className="text-muted font-bold">Back</Text></Pressable>
            <Pressable onPress={fetchWords} disabled={busy} className="flex-1 bg-jiayou rounded-xl py-3 items-center">
              {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text className="text-white font-bold">Continue</Text>}
            </Pressable>
          </View>
        </>
      )}

      {step === 3 && (
        <>
          <Text className="text-[13px] font-semibold text-muted mb-2">Complete the translations</Text>
          <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
            {cards.map((w, i) => {
              const ok = cardComplete(w);
              return (
                <View key={i} className={`flex-row items-center gap-2 rounded-xl border p-2 mb-2 ${ok ? 'border-[#cfe6d6] bg-[#f2fbf5]' : 'border-[#f3d2d2] bg-[#fdf5f5]'}`}>
                  <Text className="text-jiayou font-extrabold text-[16px] min-w-[42px] text-center">{(isZhEn ? w.english : w.chinese) || '—'}</Text>
                  {isZhEn ? (
                    <>
                      <TextInput value={w.chinese} onChangeText={(t) => setCard(i, { chinese: t })} placeholder="汉字 *" placeholderTextColor={COLORS.mutedLight} className={`flex-1 ${inputSm}`} />
                      <TextInput value={w.pinyin} onChangeText={(t) => setCard(i, { pinyin: t })} placeholder="pinyin" placeholderTextColor={COLORS.mutedLight} className={inputSm} style={{ maxWidth: 96 }} />
                    </>
                  ) : (
                    <>
                      <TextInput value={w.pinyin} onChangeText={(t) => setCard(i, { pinyin: t })} placeholder="pinyin" placeholderTextColor={COLORS.mutedLight} className={inputSm} style={{ maxWidth: 96 }} />
                      <TextInput value={w.english} onChangeText={(t) => setCard(i, { english: t })} placeholder="english *" placeholderTextColor={COLORS.mutedLight} className={`flex-1 ${inputSm}`} />
                    </>
                  )}
                  <Pressable onPress={() => removeCard(i)} hitSlop={6}><Ionicons name="close" size={16} color={COLORS.danger} /></Pressable>
                </View>
              );
            })}
          </ScrollView>
          {err ? <Text className="text-danger text-[13px] font-semibold mt-2">{err}</Text> : null}
          <View className="flex-row gap-3 mt-4">
            <Pressable onPress={() => setStep(2)} className="flex-1 bg-[#f1f3f5] rounded-xl py-3 items-center"><Text className="text-muted font-bold">Back</Text></Pressable>
            <Pressable onPress={create} disabled={busy} className="flex-1 bg-jiayou rounded-xl py-3 items-center">
              {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text className="text-white font-bold">Create task</Text>}
            </Pressable>
          </View>
        </>
      )}
    </Popup>
  );
}
