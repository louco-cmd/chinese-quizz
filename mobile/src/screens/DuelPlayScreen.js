import { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Popup from '../components/Popup';
import { ErrorRetry } from '../components/ErrorRetry';
import { getMe, getDuel, submitDuelScore } from '../api';
import { COLORS, SHADOW_CARD } from '../theme';

// Helpers identiques à quiz-play.ejs
function normalizePinyin(str) {
  return (str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '').toLowerCase().trim();
}
function parseAnswers(str) {
  if (!str) return [];
  return str.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '')
    .split(/[/,，、。;；]/).map((s) => s.trim().toLowerCase())
    .filter((s, i, arr) => s.length > 0 && arr.indexOf(s) === i);
}
function shuffle(a) { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }

// Page de duel jouée : même format que le quiz, + confirmation avant de quitter
// (le score courant est soumis comme score final — anti-triche, comme l'EJS).
export default function DuelPlayScreen({ duelId, onExit }) {
  const [direction, setDirection] = useState('en→zh');
  const [duel, setDuel] = useState(null);
  const [words, setWords] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [idx, setIdx] = useState(0);
  const [inputs, setInputs] = useState(['']);
  const [second, setSecond] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [wrongCount, setWrongCount] = useState(0);
  const [locked, setLocked] = useState(false);

  const [result, setResult] = useState(null); // { duel_completed, you_won, ... } ou 'submitting'
  const [showLeave, setShowLeave] = useState(false);
  const submitted = useRef(false);
  const firstRef = useRef(null);
  const inputRefs = useRef([]); // un ref par syllabe (auto-avance)
  const correctRef = useRef(0);
  useEffect(() => { correctRef.current = correctCount; }, [correctCount]);

  const type = duel?.quiz_type || 'pinyin';
  const isPinyin = type === 'pinyin' && direction !== 'zh→en';

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [me, d] = await Promise.all([getMe().catch(() => ({})), getDuel(duelId)]);
      if (me.quiz_direction) setDirection(me.quiz_direction);
      setDuel(d);
      if (d.already_played) { setWords([]); return; } // déjà joué → écran d'attente
      const ws = shuffle(d.words || []);
      if (!ws.length) { setError('This duel has no words.'); return; }
      setWords(ws);
      resetQuestion(ws[0], d.quiz_type, me.quiz_direction || direction);
    } catch (e) {
      setError(e.message || 'Could not load the duel.');
    } finally {
      setLoading(false);
    }
  }, [duelId]);

  useEffect(() => { load(); }, [load]);

  function resetQuestion(w, t = type, dir = direction) {
    setSecond(false); setFeedback(null); setLocked(false);
    if (t === 'pinyin' && dir !== 'zh→en') setInputs((w.pinyin || '').split(' ').map(() => ''));
    else setInputs(['']);
    setTimeout(() => firstRef.current?.focus?.(), 60);
  }

  function checkAnswer(w) {
    if (direction === 'zh→en') return parseAnswers(w.english).some((a) => a === inputs[0].trim().toLowerCase());
    if (type === 'pinyin') return normalizePinyin(inputs.join(' ')) === normalizePinyin(w.pinyin);
    return parseAnswers(w.chinese).some((a) => a === inputs[0].trim());
  }

  function advance(nextIdx) {
    if (nextIdx >= words.length) { finish(); return; }
    setIdx(nextIdx);
    resetQuestion(words[nextIdx]);
  }

  async function finish() {
    setResult('submitting');
    try {
      const r = await submitDuelScore(duelId, correctRef.current);
      submitted.current = true;
      setResult(r);
    } catch {
      setResult({ error: true });
    }
  }

  function submit() {
    if (locked) return;
    const w = words[idx];
    const ok = checkAnswer(w);
    const answer = direction === 'zh→en' ? w.english : type === 'pinyin' ? w.pinyin : w.chinese;
    if (ok) {
      if (!second) setCorrectCount((c) => c + 1);
      setFeedback({ kind: 'success', text: 'Correct!' });
      setLocked(true);
      setTimeout(() => advance(idx + 1), 900);
    } else if (!second) {
      // 1re erreur : on marque faux, on MONTRE la réponse, puis 2e chance (recopie).
      setWrongCount((c) => c + 1);
      setSecond(true);
      setFeedback({ kind: 'reveal', text: `Answer: ${answer}` });
      setInputs((arr) => arr.map(() => ''));
      setTimeout(() => firstRef.current?.focus?.(), 60);
    } else {
      setFeedback({ kind: 'reveal', text: `Answer: ${answer}` });
      setLocked(true);
      setTimeout(() => advance(idx + 1), 1300);
    }
  }

  // Sortie : si le duel est commencé et non soumis → avertir (score soumis comme final).
  const inProgress = words && words.length > 0 && !result && !submitted.current && (idx > 0 || correctCount > 0 || wrongCount > 0);
  function requestExit() {
    if (inProgress) setShowLeave(true);
    else onExit();
  }
  async function confirmLeave() {
    setShowLeave(false);
    if (!submitted.current) {
      try { await submitDuelScore(duelId, correctRef.current); } catch { /* on quitte quand même */ }
    }
    onExit();
  }

  // ── Rendu ──
  if (loading) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8f9fa' }}><ActivityIndicator color={COLORS.jiayou} /></View>;
  }
  if (error) {
    return <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}><TopBar onExit={onExit} /><ErrorRetry error={error} onRetry={load} /></View>;
  }

  // Déjà joué → écran d'attente
  if (duel?.already_played) {
    return (
      <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
        <TopBar onExit={onExit} />
        <Centered>
          <Ionicons name="hourglass-outline" size={44} color={COLORS.muted} />
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#1a1a2e', marginTop: 12 }}>Already played</Text>
          <Text style={{ color: COLORS.muted, textAlign: 'center', marginTop: 6 }}>
            Waiting for {duel.opponent_name} to play their round.
          </Text>
          <PrimaryBtn label="Back to duels" onPress={onExit} />
        </Centered>
      </View>
    );
  }

  // Résultat / soumission
  if (result) {
    return (
      <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
        <TopBar onExit={onExit} />
        <Centered>
          {result === 'submitting' ? (
            <><ActivityIndicator color={COLORS.jiayou} /><Text style={{ color: COLORS.muted, marginTop: 12 }}>Submitting your score…</Text></>
          ) : result.error ? (
            <>
              <Ionicons name="alert-circle" size={44} color={COLORS.danger} />
              <Text style={{ marginTop: 10, color: COLORS.muted }}>Could not submit your score.</Text>
              <PrimaryBtn label="Back to duels" onPress={onExit} />
            </>
          ) : (
            <>
              <Ionicons
                name={result.duel_completed ? (result.you_won ? 'trophy' : 'flag') : 'checkmark-circle'}
                size={52}
                color={result.duel_completed ? (result.you_won ? '#f7c948' : COLORS.muted) : COLORS.success}
              />
              <Text style={{ fontSize: 24, fontWeight: '800', color: '#1a1a2e', marginTop: 12 }}>
                {correctCount}/{words.length}
              </Text>
              <Text style={{ fontSize: 15, color: COLORS.muted, textAlign: 'center', marginTop: 8 }}>
                {result.duel_completed
                  ? (result.you_won ? 'You won the duel! 🎉' : result.winner_id ? 'You lost this one — rematch?' : "It's a tie!")
                  : `Score submitted — waiting for ${duel.opponent_name} to play.`}
              </Text>
              <PrimaryBtn label="Back to duels" onPress={onExit} />
            </>
          )}
        </Centered>
      </View>
    );
  }

  const w = words[idx];
  const question = direction === 'zh→en' ? null
    : type === 'pinyin' ? `How to say "${w.english}" in pinyin?` : `How to write "${w.english}" in Chinese?`;
  const fb = feedback?.kind === 'success' ? { bg: '#e8f5e9', fg: COLORS.success } : { bg: '#fff3cd', fg: '#856404' };

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <TopBar onExit={requestExit} progress={`${idx + 1}/${words.length}`} label={`vs ${duel.opponent_name}`} />
      <ScrollView contentContainerStyle={{ padding: 16, alignItems: 'center' }} keyboardShouldPersistTaps="handled">
        <View style={{ width: '100%', maxWidth: 560 }}>
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

          {feedback && (
            <View style={{ backgroundColor: fb.bg, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, marginBottom: 16, alignItems: 'center' }}>
              <Text style={{ color: fb.fg, fontWeight: '700' }}>{feedback.text}</Text>
            </View>
          )}

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
                    onSubmitEditing={submit} editable={!locked} autoCapitalize="none" autoCorrect={false}
                    placeholder={`${normalizePinyin(w.pinyin.split(' ')[i] || '').length}`} placeholderTextColor="#c4c4c4"
                    style={syllableStyle(second)}
                  />
                ))
              ) : (
                <TextInput
                  ref={firstRef} value={inputs[0]} onChangeText={(t) => setInputs([t])}
                  onSubmitEditing={submit} editable={!locked} autoCapitalize="none" autoCorrect={false}
                  placeholder={direction === 'zh→en' ? 'English translation…' : 'Write Chinese characters…'}
                  placeholderTextColor="#adb5bd" style={fullInputStyle(second)}
                />
              )}
            </View>
            <Pressable onPress={submit} disabled={locked}
              style={{ backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6, opacity: locked ? 0.6 : 1 }}>
              <Ionicons name="send" size={16} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Submit</Text>
            </Pressable>
          </View>

          <View style={{ alignItems: 'center', marginTop: 18 }}>
            <Text style={{ fontWeight: '700', fontSize: 16, color: '#1a1a2e' }}>✅ {correctCount}  |  ❌ {wrongCount}</Text>
            <Text style={{ color: COLORS.muted, marginTop: 4 }}>Question {idx + 1}/{words.length}</Text>
          </View>
        </View>
      </ScrollView>

      {/* Avertissement anti-triche avant de quitter */}
      <Popup visible={showLeave} onClose={() => setShowLeave(false)} maxWidth={400}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 }}>Leave the duel?</Text>
        <Text style={{ fontSize: 14, color: COLORS.muted, lineHeight: 20, marginBottom: 20 }}>
          To keep things fair, your current score {correctCount}/{words.length} will be submitted as your final score. You can't retry.
        </Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Pressable onPress={() => setShowLeave(false)} style={{ flex: 1, backgroundColor: '#f1f3f5', borderRadius: 999, paddingVertical: 13, alignItems: 'center' }}>
            <Text style={{ color: COLORS.muted, fontWeight: '700' }}>Keep playing</Text>
          </Pressable>
          <Pressable onPress={confirmLeave} style={{ flex: 1, backgroundColor: COLORS.danger, borderRadius: 999, paddingVertical: 13, alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Leave & submit</Text>
          </Pressable>
        </View>
      </Popup>
    </View>
  );
}

function TopBar({ onExit, progress, label }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#f0f0f0' }}>
      <Pressable onPress={onExit} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Ionicons name="chevron-back" size={22} color={COLORS.jiayou} />
        <Text style={{ color: COLORS.jiayou, fontWeight: '600' }}>{label || 'Duel'}</Text>
      </Pressable>
      {progress ? <Text style={{ color: COLORS.muted, fontWeight: '600' }}>{progress}</Text> : <View />}
    </View>
  );
}

function Centered({ children }) {
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>{children}</View>;
}
function PrimaryBtn({ label, onPress }) {
  return (
    <Pressable onPress={onPress} style={{ backgroundColor: COLORS.jiayou, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 28, marginTop: 22 }}>
      <Text style={{ color: '#fff', fontWeight: '700' }}>{label}</Text>
    </Pressable>
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
