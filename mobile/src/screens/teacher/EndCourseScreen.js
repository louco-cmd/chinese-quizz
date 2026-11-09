import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, Switch, Platform, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { teacherStudentClassContext, teacherLookupWords, teacherSendTask } from '../../api';
import { Button } from '../../ui';
import { COLORS } from '../../theme';

const CN = /[一-鿿]/;

// Page « fin de cours » (post-appel vidéo), rendue DANS le shell prof (header +
// tab bar conservés). Colonne gauche sticky (desktop) : classe + cours concerné
// + bouton Send. Colonne droite : résumé + mots.
//
// Logique classe :
//  • l'élève a déjà une classe avec ce prof → la task y est rangée directement
//    (sélection si plusieurs) ;
//  • sinon → création d'une classe par défaut (nom pré-rempli, éditable), avec un
//    toggle « Add to an existing class » pour choisir une classe existante à la place.
export default function EndCourseScreen({ slot, direction = 'en→zh', onClose, onSent }) {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const isZhEn = direction === 'zh→en';
  const studentName = slot?.student_name || 'your student';

  const fmtCourse = (s) => {
    if (!s?.starts_at) return null;
    const d = new Date(s.starts_at);
    const date = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const t1 = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const end = s.ends_at ? new Date(s.ends_at) : null;
    const t2 = end ? end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : null;
    return t2 ? `${date} · ${t1}–${t2}` : `${date} · ${t1}`;
  };
  const courseWhen = fmtCourse(slot);

  const [title, setTitle] = useState(`Course with ${studentName}`);
  const [summary, setSummary] = useState('');

  // Mots : cartes éditables {chinese, pinyin, english, found}.
  const [input, setInput] = useState('');
  const [cards, setCards] = useState([]);
  const [looking, setLooking] = useState(false);
  const inputRef = useRef(null);

  // Classe.
  const [ctx, setCtx] = useState(null); // { classes, student_classes } | null (loading)
  const [studentClassId, setStudentClassId] = useState(null); // classe de l'élève choisie (si plusieurs)
  const [useExisting, setUseExisting] = useState(false);       // toggle « add to an existing class »
  const [existingId, setExistingId] = useState(null);          // classe existante choisie (toggle ON)
  const [newName, setNewName] = useState(studentName === 'your student' ? 'New class' : `${studentName}`);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    if (!slot?.student_id) { setCtx({ classes: [], student_classes: [] }); return; }
    teacherStudentClassContext(slot.student_id)
      .then((d) => {
        if (!alive) return;
        const sc = d.student_classes || [];
        setCtx({ classes: d.classes || [], student_classes: sc });
        if (sc.length) setStudentClassId(sc[0].id);
      })
      .catch(() => { if (alive) setCtx({ classes: [], student_classes: [] }); });
    return () => { alive = false; };
  }, [slot?.student_id]);

  const studentClasses = ctx?.student_classes || [];
  const allClasses = ctx?.classes || [];
  const hasStudentClass = studentClasses.length > 0;

  const wordValid = (v) => (!v ? true : isZhEn ? !CN.test(v) : !/[^一-鿿]/.test(v));

  async function addWord() {
    const v = input.trim();
    if (!v || !wordValid(v)) return;
    const dupe = cards.some((c) => (isZhEn ? c.english === v : c.chinese === v));
    if (dupe) { setInput(''); return; }
    setLooking(true); setErr('');
    try {
      const { results } = await teacherLookupWords([v]);
      const r = (results || [])[0];
      let cardW;
      if (r?.mot) cardW = { chinese: r.mot.chinese, pinyin: r.mot.pinyin || '', english: r.mot.english || '', found: true };
      else if (isZhEn) cardW = { chinese: '', pinyin: '', english: v, found: false };
      else cardW = { chinese: v, pinyin: r?.pinyin || '', english: '', found: false };
      setCards((cs) => [...cs, cardW]);
      setInput('');
      inputRef.current?.focus();
    } catch (e) { setErr(e.message || 'Lookup error'); } finally { setLooking(false); }
  }

  const setCardAt = (i, patch) => setCards((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const removeCard = (i) => setCards((cs) => cs.filter((_, j) => j !== i));
  const cardComplete = (w) => (isZhEn ? !!String(w.chinese).trim() : !!String(w.english).trim());

  // Détermine la classe cible (class_id OU class_name) selon la logique ci-dessus.
  function resolveClass() {
    if (hasStudentClass) return { class_id: studentClassId || studentClasses[0].id };
    if (useExisting) return existingId ? { class_id: existingId } : null;
    return newName.trim() ? { class_name: newName.trim() } : null;
  }

  async function send() {
    if (!title.trim()) { setErr('Add a title for the task.'); return; }
    const cls = resolveClass();
    if (!cls) { setErr(useExisting ? 'Pick a class.' : 'Name the new class.'); return; }
    const bad = cards.find((w) => !cardComplete(w));
    if (bad) { setErr(`Complete the translation for "${isZhEn ? bad.english : bad.chinese}"`); return; }
    setBusy(true); setErr('');
    try {
      await teacherSendTask({
        student_id: slot?.student_id,
        ...cls,
        title: title.trim(),
        summary: summary.trim(),
        words: cards.map((w) => ({ chinese: w.chinese, pinyin: w.pinyin, english: w.english })),
      });
      onSent?.();
    } catch (e) { setErr(e.message || 'Error'); setBusy(false); }
  }

  const inputSm = { backgroundColor: '#f8f9fa', borderWidth: 1, borderColor: COLORS.line || '#e6e8eb', borderRadius: 10, paddingHorizontal: 10, height: 40, fontSize: 14, color: '#1a1a2e' };

  const ClassOption = ({ c, selected, onSelect, meta }) => (
    <Pressable onPress={onSelect}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, borderWidth: 1.5, padding: 12, borderColor: selected ? COLORS.jiayou : (COLORS.line || '#e6e8eb'), backgroundColor: selected ? '#eef4ff' : '#fff' }}>
      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? COLORS.jiayou : '#c7ced6'} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: '#1a1a2e' }} numberOfLines={1}>{c.name}</Text>
        {meta ? <Text style={{ fontSize: 12, color: COLORS.mutedLight, marginTop: 1 }}>{meta}</Text> : null}
      </View>
    </Pressable>
  );

  const SendBtn = (
    <Button onPress={send} loading={busy} icon="send" title="Send task" fullWidth style={{ paddingVertical: 15 }} />
  );

  // Bouton secondaire : quitter sans créer de task.
  const SkipBtn = (
    <Button
      onPress={() => onClose?.()} disabled={busy} variant="secondary" title="Skip task creation for now"
      fullWidth style={{ paddingVertical: 14, marginTop: 10 }} textStyle={{ color: COLORS.muted, fontWeight: '800', fontSize: 14.5 }}
    />
  );

  // ── Encart CLASSE (haut de la colonne gauche sticky) ────────────────────────
  const classCard = (
    <View style={card}>
      <View style={cardHead}>
        <Ionicons name="school" size={16} color={COLORS.jiayou} />
        <Text style={cardTitle}>Class</Text>
      </View>

      {ctx === null ? (
        <ActivityIndicator color={COLORS.jiayou} style={{ marginVertical: 8 }} />
      ) : hasStudentClass ? (
        studentClasses.length === 1 ? (
          <>
            <Text style={{ fontSize: 12.5, color: COLORS.muted, marginBottom: 8 }}>This task goes to {studentName}'s class:</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#eef4ff', borderRadius: 12, padding: 12 }}>
              <Ionicons name="checkmark-circle" size={18} color={COLORS.jiayou} />
              <Text style={{ flex: 1, fontSize: 15, fontWeight: '700', color: '#1a1a2e' }} numberOfLines={1}>{studentClasses[0].name}</Text>
            </View>
          </>
        ) : (
          <>
            <Text style={{ fontSize: 12.5, color: COLORS.muted, marginBottom: 10 }}>{studentName} is in several of your classes — pick one:</Text>
            <View style={{ gap: 8 }}>
              {studentClasses.map((c) => (
                <ClassOption key={c.id} c={c} selected={studentClassId === c.id} onSelect={() => setStudentClassId(c.id)} />
              ))}
            </View>
          </>
        )
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#1a1a2e' }}>Add to an existing class</Text>
              <Text style={{ fontSize: 12, color: COLORS.mutedLight, marginTop: 1 }}>Off → a new class is created for {studentName}.</Text>
            </View>
            <Switch value={useExisting} onValueChange={(v) => { setUseExisting(v); setErr(''); }}
              trackColor={{ false: '#d7dce3', true: COLORS.jiayou }} thumbColor="#fff" />
          </View>

          {useExisting ? (
            allClasses.length === 0 ? (
              <Text style={{ color: COLORS.mutedLight, fontSize: 13 }}>No class yet — turn this off to create one.</Text>
            ) : (
              <View style={{ gap: 8 }}>
                {allClasses.map((c) => (
                  <ClassOption key={c.id} c={c} selected={existingId === c.id} onSelect={() => setExistingId(c.id)}
                    meta={`${c.student_count} student${c.student_count === 1 ? '' : 's'} · ${c.lesson_count} task${c.lesson_count === 1 ? '' : 's'}`} />
                ))}
              </View>
            )
          ) : (
            <>
              <Text style={label}>New class name</Text>
              <TextInput value={newName} onChangeText={setNewName} maxLength={80}
                placeholder="e.g. Beginner A1" placeholderTextColor={COLORS.mutedLight} style={bigInput} />
              <Text style={{ fontSize: 12, color: COLORS.mutedLight, marginTop: 6 }}>{studentName} will be added automatically.</Text>
            </>
          )}
        </>
      )}
    </View>
  );

  // ── Encart COURS CONCERNÉ (sous la classe, colonne gauche) ──────────────────
  const courseCard = (
    <View style={card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Ionicons name="person-circle" size={22} color={COLORS.jiayou} />
        <View style={{ flex: 1 }}>
          <Text style={infoLabel}>Student</Text>
          <Text style={infoValue}>
            {studentName}
            {slot?.student_id != null ? <Text style={{ color: COLORS.mutedLight, fontWeight: '600' }}>{`  ·  ID ${slot.student_id}`}</Text> : null}
          </Text>
        </View>
      </View>
      {courseWhen ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderColor: '#f2f4f7', paddingTop: 10, marginTop: 10 }}>
          <Ionicons name="calendar" size={22} color={COLORS.jiayou} />
          <View style={{ flex: 1 }}>
            <Text style={infoLabel}>Lesson</Text>
            <Text style={infoValue}>{courseWhen}</Text>
          </View>
        </View>
      ) : null}
      {wide ? (
        <View style={{ marginTop: 16 }}>
          {err ? <Text style={{ color: COLORS.danger, fontSize: 13, fontWeight: '700', marginBottom: 10 }}>{err}</Text> : null}
          {SendBtn}
          {SkipBtn}
        </View>
      ) : null}
    </View>
  );

  const leftColumn = <>{classCard}{courseCard}</>;

  // ── Colonne droite : résumé + mots ──────────────────────────────────────────
  const rightColumn = (
    <>
      {/* Résumé du cours */}
      <View style={card}>
        <View style={cardHead}>
          <Ionicons name="document-text" size={16} color={COLORS.jiayou} />
          <Text style={cardTitle}>Course summary</Text>
        </View>
        <Text style={label}>Title</Text>
        <TextInput value={title} onChangeText={setTitle} maxLength={120} placeholder="e.g. Week 1 — greetings"
          placeholderTextColor={COLORS.mutedLight} style={bigInput} />
        <Text style={[label, { marginTop: 12 }]}>What you covered (optional)</Text>
        <TextInput value={summary} onChangeText={setSummary} maxLength={2000} multiline
          placeholder="Notes, recap, what to focus on…" placeholderTextColor={COLORS.mutedLight}
          style={[bigInput, { minHeight: 90, paddingTop: 12, textAlignVertical: 'top' }]} />
      </View>

      {/* Mots à apprendre */}
      <View style={card}>
        <View style={cardHead}>
          <Ionicons name="book" size={16} color={COLORS.jiayou} />
          <Text style={cardTitle}>Words to learn</Text>
          {cards.length ? <Text style={{ marginLeft: 'auto', fontSize: 12, fontWeight: '800', color: COLORS.muted }}>{cards.length}</Text> : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput ref={inputRef} value={input} onChangeText={setInput} onSubmitEditing={addWord}
            blurOnSubmit={false} returnKeyType="next" autoCapitalize="none"
            placeholder={isZhEn ? 'type a word…' : '输入汉字…'} placeholderTextColor={COLORS.mutedLight}
            style={[bigInput, { flex: 1 }]} />
          <Pressable onPress={addWord} disabled={looking}
            style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: COLORS.jiayou, alignItems: 'center', justifyContent: 'center' }}>
            {looking ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="add" size={22} color="#fff" />}
          </Pressable>
        </View>
        {input && !wordValid(input.trim()) ? (
          <Text style={{ color: COLORS.danger, fontSize: 12, marginTop: 6 }}>{isZhEn ? 'English words only' : '只能输入中文 · Chinese only'}</Text>
        ) : null}

        {cards.length === 0 ? (
          <Text style={{ color: COLORS.mutedLight, fontSize: 13, marginTop: 12 }}>No words yet — add the vocabulary from today's lesson.</Text>
        ) : (
          <View style={{ marginTop: 12, gap: 8 }}>
            {cards.map((w, i) => {
              const ok = cardComplete(w);
              return (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, borderWidth: 1, padding: 8, borderColor: ok ? '#cfe6d6' : '#f3d2d2', backgroundColor: ok ? '#f2fbf5' : '#fdf5f5' }}>
                  <Text style={{ color: COLORS.jiayou, fontWeight: '800', fontSize: 16, minWidth: 42, textAlign: 'center' }}>{(isZhEn ? w.english : w.chinese) || '—'}</Text>
                  {isZhEn ? (
                    <>
                      <TextInput value={w.chinese} onChangeText={(t) => setCardAt(i, { chinese: t })} placeholder="汉字 *" placeholderTextColor={COLORS.mutedLight} style={[inputSm, { flex: 1 }]} />
                      <TextInput value={w.pinyin} onChangeText={(t) => setCardAt(i, { pinyin: t })} placeholder="pinyin" placeholderTextColor={COLORS.mutedLight} style={[inputSm, { maxWidth: 96 }]} />
                    </>
                  ) : (
                    <>
                      <TextInput value={w.pinyin} onChangeText={(t) => setCardAt(i, { pinyin: t })} placeholder="pinyin" placeholderTextColor={COLORS.mutedLight} style={[inputSm, { maxWidth: 96 }]} />
                      <TextInput value={w.english} onChangeText={(t) => setCardAt(i, { english: t })} placeholder="english *" placeholderTextColor={COLORS.mutedLight} style={[inputSm, { flex: 1 }]} />
                    </>
                  )}
                  <Pressable onPress={() => removeCard(i)} hitSlop={6}><Ionicons name="close" size={16} color={COLORS.danger} /></Pressable>
                </View>
              );
            })}
          </View>
        )}
      </View>
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.page || '#f4f5f7' }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: wide ? 32 : 150 }} keyboardShouldPersistTaps="handled">
        <View style={{ width: '100%', maxWidth: wide ? 1000 : 640, alignSelf: 'center' }}>
          <Text style={{ fontSize: 24, fontWeight: '800', color: '#1a1a2e', marginBottom: 16 }}>Send a task to student</Text>
          {wide ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 24 }}>
              <View style={[{ width: 320 }, Platform.OS === 'web' ? { position: 'sticky', top: 16 } : null]}>{leftColumn}</View>
              <View style={{ flex: 1 }}>{rightColumn}</View>
            </View>
          ) : (
            <>
              {leftColumn}
              {rightColumn}
            </>
          )}
        </View>
      </ScrollView>

      {/* CTA sticky (mobile seulement) : sur desktop il est dans l'encart cours. */}
      {!wide ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 26, backgroundColor: 'rgba(248,249,250,0.96)', borderTopWidth: 1, borderColor: '#eef1f5' }}>
          <View style={{ width: '100%', maxWidth: 640, alignSelf: 'center' }}>
            {err ? <Text style={{ color: COLORS.danger, fontSize: 13, fontWeight: '700', marginBottom: 8, textAlign: 'center' }}>{err}</Text> : null}
            {SendBtn}
            {SkipBtn}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const card = { backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 14, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 };
const cardHead = { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 };
const cardTitle = { fontSize: 15, fontWeight: '800', color: '#1a1a2e' };
const label = { fontSize: 13, fontWeight: '600', color: COLORS.muted, marginBottom: 6 };
const infoLabel = { fontSize: 11, fontWeight: '800', color: COLORS.mutedLight, textTransform: 'uppercase', letterSpacing: 0.4 };
const infoValue = { fontSize: 15, fontWeight: '700', color: '#1a1a2e', marginTop: 1 };
const bigInput = { backgroundColor: '#f8f9fa', borderWidth: 1, borderColor: COLORS.line || '#e6e8eb', borderRadius: 12, paddingHorizontal: 14, minHeight: 48, fontSize: 15, color: '#1a1a2e' };
