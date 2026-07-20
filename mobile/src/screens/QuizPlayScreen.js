import { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ErrorRetry } from '../components/ErrorRetry';
import { getMe, getQuizPlayWords, saveQuiz, saveTaskResult } from '../api';
import { COLORS, SHADOW_CARD } from '../theme';

// ── Helpers (identiques à quiz-play.ejs) ──
function normalizePinyin(str) {
  return (str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '').toLowerCase().trim();
}
function parseAnswers(str) {
  if (!str) return [];
  return str
    .replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '')
    .split(/[/,，、。;；]/)
    .map((s) => s.trim().toLowerCase())
    .filter((s, i, arr) => s.length > 0 && arr.indexOf(s) === i);
}

const infoLabel = (hsk, difficulty) => {
  let h;
  if (!hsk || hsk === 'all') h = 'all HSK';
  else if (hsk.includes('-')) { const [a, b] = hsk.split('-'); h = b === '7' ? `HSK ${a}–6 + Street` : `HSK ${a}–${b}`; }
  else h = `HSK ${hsk}`;
  const d = { revision: 'Review', discovery: 'Discovery', balanced: 'Balanced' }[difficulty] || 'Balanced';
  return `${h} • ${d}`;
};

export default function QuizPlayScreen({ config, onExit }) {
  const { type, count, hsk, difficulty, ids, packId, lessonId, title } = config;
  const [direction, setDirection] = useState('en→zh');
  const [words, setWords] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [idx, setIdx] = useState(0);
  const [inputs, setInputs] = useState(['']);
  const [second, setSecond] = useState(false); // 2e tentative en cours
  const [feedback, setFeedback] = useState(null); // { kind: 'success'|'retry'|'reveal', text }
  const [correctCount, setCorrectCount] = useState(0);
  const [wrongCount, setWrongCount] = useState(0);
  const [locked, setLocked] = useState(false);

  const [ended, setEnded] = useState(false);
  const [coins, setCoins] = useState(0);
  const results = useRef([]);
  const firstRef = useRef(null);
  const inputRefs = useRef([]); // un ref par champ syllabe (auto-avance)

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [me, d] = await Promise.all([getMe().catch(() => ({})), getQuizPlayWords({ type, count, hsk, difficulty, ids, packId })]);
      if (me.quiz_direction) setDirection(me.quiz_direction);
      const ws = d.words || [];
      if (!ws.length) { setError('Not enough words in your collection for these settings.'); setWords(null); return; }
      setWords(ws);
      results.current = ws.map((w) => ({ mot_id: w.id, correct: null, pinyin: w.pinyin }));
      resetQuestion(ws[0]);
    } catch (e) {
      setError(e.message || 'Could not start the quiz.');
    } finally {
      setLoading(false);
    }
  }, [type, count, hsk, difficulty]);

  useEffect(() => { load(); }, [load]);

  const isPinyin = type === 'pinyin' && direction !== 'zh→en';

  function resetQuestion(w) {
    setSecond(false);
    setFeedback(null);
    setLocked(false);
    if (type === 'pinyin' && direction !== 'zh→en') {
      setInputs((w.pinyin || '').split(' ').map(() => ''));
    } else {
      setInputs(['']);
    }
    setTimeout(() => firstRef.current?.focus?.(), 60);
  }

  function advance(nextIdx, ws) {
    if (nextIdx >= ws.length) { finish(ws); return; }
    setIdx(nextIdx);
    resetQuestion(ws[nextIdx]);
  }

  async function finish(ws) {
    setEnded(true);
    try {
      const d = await saveQuiz({
        score: correctCountRef.current,
        total_questions: ws.length,
        quiz_type: type,
        results: results.current,
      });
      setCoins(d.coins_earned || 0);
    } catch { /* garde le score affiché même si la sauvegarde échoue */ }
    // Si c'est une task d'un prof, on remonte aussi le résultat (compteur côté prof)
    if (lessonId) { try { await saveTaskResult(lessonId, correctRef.current, ws.length); } catch { /* noop */ } }
  }

  // On garde une ref du score courant pour finish() (évite les closures périmées)
  const correctCountRef = useRef(0);
  useEffect(() => { correctCountRef.current = correctCount; }, [correctCount]);

  function checkAnswer(w) {
    if (direction === 'zh→en') {
      return parseAnswers(w.english).some((a) => a === inputs[0].trim().toLowerCase());
    }
    if (type === 'pinyin') {
      return normalizePinyin(inputs.join(' ')) === normalizePinyin(w.pinyin);
    }
    return parseAnswers(w.chinese).some((a) => a === inputs[0].trim());
  }

  function submit() {
    if (locked) return;
    const w = words[idx];
    const ok = checkAnswer(w);
    const answer = direction === 'zh→en' ? w.english : type === 'pinyin' ? w.pinyin : w.chinese;

    if (ok) {
      // Point seulement si trouvé à la 1re tentative
      if (results.current[idx].correct === null) results.current[idx].correct = true;
      if (!second) setCorrectCount((c) => c + 1);
      setFeedback({ kind: 'success', text: 'Correct!' });
      setLocked(true);
      setTimeout(() => advance(idx + 1, words), 1000);
    } else if (!second) {
      // 1re erreur : on marque faux, on MONTRE la réponse, puis 2e chance (recopie).
      results.current[idx].correct = false;
      setWrongCount((c) => c + 1);
      setSecond(true);
      setFeedback({ kind: 'reveal', text: `Answer: ${answer}` });
      setInputs((arr) => arr.map(() => ''));
      setTimeout(() => firstRef.current?.focus?.(), 60);
    } else {
      // 2e erreur : on révèle la réponse et on avance
      setFeedback({ kind: 'reveal', text: `Answer: ${answer}` });
      setLocked(true);
      setTimeout(() => advance(idx + 1, words), 1400);
    }
  }

  // ── Rendu ──
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8f9fa' }}>
        <ActivityIndicator color={COLORS.jiayou} />
      </View>
    );
  }
  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
        <TopBar onExit={onExit} />
        <ErrorRetry error={error} onRetry={load} />
      </View>
    );
  }

  if (ended) {
    const total = words.length;
    const pct = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    const motivation = pct >= 80 ? "Outstanding! You're a Chinese master!"
      : pct >= 60 ? 'Great job! Excellent progress!'
      : pct >= 40 ? 'Good effort! Keep practicing!'
      : "Practice makes perfect! Don't give up!";
    return (
      <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
        <TopBar onExit={onExit} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 420, alignItems: 'center', ...SHADOW_CARD }}>
            <Ionicons name="trophy" size={48} color="#f7c948" />
            <Text style={{ fontSize: 26, fontWeight: '800', color: '#1a1a2e', marginTop: 12 }}>{correctCount}/{total}</Text>
            <Text style={{ fontSize: 15, color: COLORS.jiayou, fontWeight: '600', marginTop: 2 }}>{pct}% correct</Text>
            <Text style={{ fontSize: 14, color: COLORS.muted, textAlign: 'center', marginTop: 12 }}>{motivation}</Text>
            {coins > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff8e1', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, marginTop: 16 }}>
                <Ionicons name="add-circle" size={16} color="#d97706" />
                <Text style={{ color: '#856404', fontWeight: '700' }}>{coins} coins earned</Text>
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 24, width: '100%' }}>
              <Pressable onPress={onExit} style={{ flex: 1, backgroundColor: '#f1f3f5', borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}>
                <Text style={{ color: COLORS.muted, fontWeight: '700' }}>Back</Text>
              </Pressable>
              <Pressable onPress={load} style={{ flex: 1, backgroundColor: COLORS.jiayou, borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>New quiz</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    );
  }

  const w = words[idx];
  const question = direction === 'zh→en'
    ? null
    : type === 'pinyin'
      ? `How to say "${w.english}" in pinyin?`
      : `How to write "${w.english}" in Chinese?`;

  const fbColor = feedback?.kind === 'success' ? { bg: '#e8f5e9', fg: COLORS.success } : { bg: '#fff3cd', fg: '#856404' };

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <TopBar onExit={onExit} progress={`${idx + 1}/${words.length}`} />
      <ScrollView contentContainerStyle={{ padding: 16, alignItems: 'center' }} keyboardShouldPersistTaps="handled">
        <View style={{ width: '100%', maxWidth: 560 }}>
          {/* Question */}
          <View style={{ alignItems: 'center', marginVertical: 22 }}>
            {direction === 'zh→en' ? (
              <>
                <Text style={{ fontSize: 16, color: COLORS.muted }}>What does this mean in English?</Text>
                <Text style={{ fontSize: 56, fontWeight: '800', color: '#1a1a2e', marginTop: 8 }}>{w.chinese}</Text>
              </>
            ) : (
              <Text style={{ fontSize: 22, fontWeight: '700', color: '#1a1a2e', textAlign: 'center' }}>{question}</Text>
            )}
          </View>

          {/* Feedback */}
          {feedback && (
            <View style={{ backgroundColor: fbColor.bg, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, marginBottom: 16, alignItems: 'center' }}>
              <Text style={{ color: fbColor.fg, fontWeight: '700' }}>{feedback.text}</Text>
            </View>
          )}

          {/* Champs de réponse */}
          <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 20, ...SHADOW_CARD }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginBottom: 16 }}>
              {isPinyin ? (
                inputs.map((val, i) => (
                  <TextInput
                    key={i}
                    ref={(el) => { inputRefs.current[i] = el; if (i === 0) firstRef.current = el; }}
                    value={val}
                    onChangeText={(t) => {
                      setInputs((arr) => arr.map((x, j) => (j === i ? t : x)));
                      // Auto-avance vers la syllabe suivante quand celle-ci est complète.
                      const target = normalizePinyin(w.pinyin.split(' ')[i] || '').length;
                      if (target && t.length >= target && i < inputs.length - 1) {
                        inputRefs.current[i + 1]?.focus?.();
                      }
                    }}
                    onSubmitEditing={submit}
                    editable={!locked}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder={`${normalizePinyin(w.pinyin.split(' ')[i] || '').length}`}
                    placeholderTextColor="#c4c4c4"
                    style={syllableStyle(second)}
                  />
                ))
              ) : (
                <TextInput
                  ref={firstRef}
                  value={inputs[0]}
                  onChangeText={(t) => setInputs([t])}
                  onSubmitEditing={submit}
                  editable={!locked}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={direction === 'zh→en' ? 'English translation…' : 'Write Chinese characters…'}
                  placeholderTextColor="#adb5bd"
                  style={fullInputStyle(second)}
                />
              )}
            </View>

            <Pressable
              onPress={submit}
              disabled={locked}
              style={{ backgroundColor: COLORS.jiayou, borderRadius: 12, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6, opacity: locked ? 0.6 : 1 }}
            >
              <Ionicons name="send" size={16} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Submit</Text>
            </Pressable>
          </View>

          {/* Score + progression */}
          <View style={{ alignItems: 'center', marginTop: 18 }}>
            <Text style={{ fontWeight: '700', fontSize: 16, color: '#1a1a2e' }}>✅ {correctCount}  |  ❌ {wrongCount}</Text>
            <Text style={{ color: COLORS.muted, marginTop: 4 }}>Question {idx + 1}/{words.length}</Text>
            <Text style={{ color: '#adb5bd', fontSize: 12, marginTop: 4 }}>{packId ? (title || 'Pack') : lessonId ? (title || 'Lesson') : ids ? 'Your difficulties' : infoLabel(hsk, difficulty)}</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function TopBar({ onExit, progress }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#f0f0f0' }}>
      <Pressable onPress={onExit} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Ionicons name="chevron-back" size={22} color={COLORS.jiayou} />
        <Text style={{ color: COLORS.jiayou, fontWeight: '600' }}>Quiz</Text>
      </Pressable>
      {progress ? <Text style={{ color: COLORS.muted, fontWeight: '600' }}>{progress}</Text> : <View />}
    </View>
  );
}

const syllableStyle = (second) => ({
  minWidth: 64, textAlign: 'center', backgroundColor: '#f8f9fa',
  borderWidth: 2, borderColor: second ? COLORS.danger : '#e3e8f7', borderRadius: 10,
  paddingVertical: 10, paddingHorizontal: 8, fontSize: 18, fontWeight: '600', color: '#1a1a2e',
});
const fullInputStyle = (second) => ({
  minWidth: 240, width: '100%', textAlign: 'center', backgroundColor: '#f8f9fa',
  borderWidth: 2, borderColor: second ? COLORS.danger : '#e3e8f7', borderRadius: 12,
  paddingVertical: 14, paddingHorizontal: 14, fontSize: 20, fontWeight: '600', color: '#1a1a2e',
});
