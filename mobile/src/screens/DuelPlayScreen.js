import { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Popup from '../components/Popup';
import { ErrorRetry } from '../components/ErrorRetry';
import { getMe, getDuel, submitDuelScore } from '../api';
import { useT } from '../i18n';
import useAndroidBack from '../useAndroidBack';
import { COLORS, SHADOW_CARD } from '../theme';
import CatLoader from '../components/CatLoader';
import RevealAnswerCard from '../components/RevealAnswerCard';
import { isZhLearning } from '../langs';
import { registerPositiveMoment } from '../reviewPrompt';

// Helpers identiques à quiz-play.ejs
function normalizePinyin(str) {
  // Cf. QuizPlayScreen : on compare le pinyin sur ses SEULES lettres/chiffres —
  // diacritiques, espaces et ponctuation (' - , . …) ignorés (pas de faux négatif
  // ni de case créée pour un jeton de ponctuation).
  return (str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
// Comparaison souple des réponses en caractères (hanzi) : lettres (CJK inclus) +
// chiffres conservés, espaces et ponctuation ignorés.
function stripPunct(str) {
  return (str || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
function parseAnswers(str) {
  if (!str) return [];
  return str.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '')
    .split(/[/,，、。;；]/).map((s) => s.trim().toLowerCase())
    .filter((s, i, arr) => s.length > 0 && arr.indexOf(s) === i);
}
// Lettres seules (anglais) : ponctuation (. , ' -) et espaces ignorés à la vérif.
function stripLetters(str) {
  return (str || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}
// Sens valides d'une réponse, séparés par / → UN SEUL suffit.
function answerSenses(w, isPinyin) {
  if (isPinyin) {
    return (w?.pinyin || '').replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '')
      .split('/').map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
  return parseAnswers(w?.chinese); // terme appris (hanzi ou mot latin)
}
// Jetons (un par mot/syllabe) du 1er sens → structure des boîtes.
function firstSenseTokens(w, isPinyin) {
  const hasContent = (tok) => (isPinyin ? normalizePinyin(tok).length > 0 : stripLetters(tok).length > 0);
  return (answerSenses(w, isPinyin)[0] || '').split(/\s+/).filter((t) => t && hasContent(t));
}
function shuffle(a) { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }

// Page de duel jouée : même format que le quiz, + confirmation avant de quitter
// (le score courant est soumis comme score final — anti-triche, comme l'EJS).
export default function DuelPlayScreen({ duelId, onExit }) {
  const { t: tr } = useT();
  const [learningLang, setLearningLang] = useState('zh');
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
  const isZh = isZhLearning(learningLang);
  const isPinyin = isZh && type === 'pinyin';
  const isLatin = !isZh; // terme appris latin → saisie par jetons de lettres

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [me, d] = await Promise.all([getMe().catch(() => ({})), getDuel(duelId)]);
      if (me.learning_lang) setLearningLang(me.learning_lang);
      setDuel(d);
      if (d.already_played) { setWords([]); return; } // déjà joué → écran d'attente
      const ws = shuffle(d.words || []);
      if (!ws.length) { setError(tr('dp_no_words')); return; }
      setWords(ws);
      resetQuestion(ws[0], d.quiz_type, me.learning_lang || learningLang);
    } catch (e) {
      setError(e.message || 'Could not load the duel.');
    } finally {
      setLoading(false);
    }
  }, [duelId]);

  useEffect(() => { load(); }, [load]);

  function resetQuestion(w, t = type, lp = learningLang) {
    setSecond(false); setFeedback(null); setLocked(false);
    const zh = isZhLearning(lp);
    const pin = zh && t === 'pinyin';
    if (pin || !zh) {
      const toks = firstSenseTokens(w, pin);
      setInputs((toks.length ? toks : ['']).map(() => ''));
    } else setInputs(['']);
    setTimeout(() => firstRef.current?.focus?.(), 60);
  }

  function checkAnswer(w) {
    const senses = answerSenses(w, isPinyin);
    if (isPinyin) {
      const got = normalizePinyin(inputs.join(' '));
      return got.length > 0 && senses.some((s) => normalizePinyin(s) === got);
    }
    if (isLatin) {
      const got = stripLetters(inputs.join(''));
      return got.length > 0 && senses.some((s) => stripLetters(s) === got);
    }
    // Hanzi : comparaison souple (ponctuation/espaces ignorés).
    return senses.some((a) => stripPunct(a) === stripPunct(inputs[0]));
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
      // Duel GAGNÉ = fort moment positif → éventuelle demande d'avis in-app
      // (dormant tant que le build n'embarque pas expo-store-review ; gated).
      if (r && r.duel_completed && r.you_won) {
        try { registerPositiveMoment({ scoreRatio: 1 }); } catch { /* noop */ }
      }
    } catch {
      setResult({ error: true });
    }
  }

  function submit() {
    if (locked) return;
    const w = words[idx];
    const ok = checkAnswer(w);
    const answer = isPinyin ? w.pinyin : w.chinese;
    const bonus = 0; // saisie structurée (un mot par champ) → une seule réponse.
    if (ok) {
      if (!second) setCorrectCount((c) => c + 1 + bonus);
      setFeedback({ kind: 'success', text: tr('qp_correct') });
      setLocked(true);
      setTimeout(() => advance(idx + 1), 900);
    } else if (!second) {
      // 1re erreur : on marque faux, on MONTRE la réponse, puis 2e chance (recopie).
      setWrongCount((c) => c + 1);
      setSecond(true);
      setFeedback({ kind: 'reveal', word: w });
      setInputs((arr) => arr.map(() => ''));
      setTimeout(() => firstRef.current?.focus?.(), 60);
    } else {
      setFeedback({ kind: 'reveal', word: w });
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
  // Retour Android : ferme d'abord la confirmation si ouverte, sinon même flux que
  // la flèche (confirmation anti-triche si le duel est en cours).
  useAndroidBack(() => {
    if (showLeave) { setShowLeave(false); return true; }
    requestExit();
    return true;
  }, true, [showLeave, inProgress]);
  async function confirmLeave() {
    setShowLeave(false);
    if (!submitted.current) {
      try { await submitDuelScore(duelId, correctRef.current); } catch { /* on quitte quand même */ }
    }
    onExit();
  }

  // ── Rendu ──
  if (loading) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8f9fa' }}><CatLoader size={110} /></View>;
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
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#1a1a2e', marginTop: 12 }}>{tr('dp_already_played')}</Text>
          <Text style={{ color: COLORS.muted, textAlign: 'center', marginTop: 6 }}>
            {tr('dp_waiting_round').replace('{name}', duel.opponent_name)}
          </Text>
          <PrimaryBtn label={tr('dp_back_to_duels')} onPress={onExit} />
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
            <><CatLoader size={110} /><Text style={{ color: COLORS.muted, marginTop: 12 }}>{tr('dp_submitting')}</Text></>
          ) : result.error ? (
            <>
              <Ionicons name="alert-circle" size={44} color={COLORS.danger} />
              <Text style={{ marginTop: 10, color: COLORS.muted }}>{tr('dp_could_not_submit')}</Text>
              <PrimaryBtn label={tr('dp_back_to_duels')} onPress={onExit} />
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
                  ? (result.you_won ? tr('dp_you_won') : result.winner_id ? tr('dp_you_lost') : tr('dp_tie'))
                  : tr('dp_score_submitted').replace('{name}', duel.opponent_name)}
              </Text>
              <PrimaryBtn label={tr('dp_back_to_duels')} onPress={onExit} />
            </>
          )}
        </Centered>
      </View>
    );
  }

  const w = words[idx];
  // Question unifiée : consigne (muted) + mot demandé sur sa propre ligne.
  const promptLine = isPinyin
    ? tr('qp_how_pinyin_line')
    : isZh ? tr('qp_how_chinese_line') : tr('qp_how_word_line');
  // Duel pinyin (zh) : on montre la TRADUCTION (langue de base) et on saisit le
  // pinyin — comme le mode pinyin du quiz (jamais le hanzi). Non-zh : traduction
  // → terme appris. Dans les deux cas on affiche donc la traduction (w.english).
  const promptWord = w.english;
  const promptWordSize = 30;
  const fb = feedback?.kind === 'success' ? { bg: '#e8f5e9', fg: COLORS.success } : { bg: '#fff3cd', fg: '#856404' };

  // Champs à jetons : pinyin (syllabes) OU terme latin (mots). Hanzi = champ unique.
  const tokenFields = isPinyin || isLatin;
  const senses = answerSenses(w, isPinyin);
  const primary = tokenFields ? firstSenseTokens(w, isPinyin) : [];
  const multiHint = senses.length > 1;
  const tokenTarget = (i) => (isLatin ? stripLetters(primary[i] || '').length : normalizePinyin(primary[i] || '').length);
  const typedLen = (tt) => (isLatin ? stripLetters(tt).length : (tt || '').length);

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <TopBar onExit={requestExit} progress={`${idx + 1}/${words.length}`} label={`${tr('dp_vs')} ${duel.opponent_name}`} />
      <ScrollView contentContainerStyle={{ padding: 16, alignItems: 'center' }} keyboardShouldPersistTaps="handled">
        <View style={{ width: '100%', maxWidth: 560 }}>
          <View style={{ alignItems: 'center', marginVertical: 22 }}>
            <Text style={{ fontSize: 16, color: COLORS.muted, textAlign: 'center' }}>{promptLine}</Text>
            <Text style={{ fontSize: promptWordSize, fontWeight: '800', color: '#1a1a2e', marginTop: 10, textAlign: 'center' }}>{promptWord}</Text>
          </View>

          {feedback && (
            feedback.kind === 'reveal'
              ? <RevealAnswerCard word={feedback.word} learningLang={learningLang} type={type} />
              : (
                <View style={{ backgroundColor: fb.bg, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, marginBottom: 16, alignItems: 'center' }}>
                  <Text style={{ color: fb.fg, fontWeight: '700' }}>{feedback.text}</Text>
                </View>
              )
          )}

          <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 20, ...SHADOW_CARD }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginBottom: multiHint ? 6 : 16 }}>
              {tokenFields ? (
                inputs.map((val, i) => {
                  const target = tokenTarget(i);
                  return (
                    <TextInput
                      key={i}
                      ref={(el) => { inputRefs.current[i] = el; if (i === 0) firstRef.current = el; }}
                      value={val}
                      onChangeText={(t) => {
                        setInputs((arr) => arr.map((x, j) => (j === i ? t : x)));
                        // Auto-avance vers le champ suivant une fois le compte de lettres atteint.
                        if (target && typedLen(t) >= target && i < inputs.length - 1) {
                          inputRefs.current[i + 1]?.focus?.();
                        }
                      }}
                      onSubmitEditing={submit} editable={!locked} autoCapitalize="none" autoCorrect={false}
                      placeholder={`${target}`} placeholderTextColor="#c4c4c4"
                      style={[syllableStyle(second), isLatin ? { minWidth: Math.max(64, target * 14 + 22) } : null]}
                    />
                  );
                })
              ) : (
                <TextInput
                  ref={firstRef} value={inputs[0]} onChangeText={(t) => setInputs([t])}
                  onSubmitEditing={submit} editable={!locked} autoCapitalize="none" autoCorrect={false}
                  placeholder={tr('qp_write_chinese')}
                  placeholderTextColor="#adb5bd" style={fullInputStyle(second)}
                />
              )}
            </View>
            {multiHint ? (
              <Text style={{ textAlign: 'center', color: COLORS.mutedLight, fontSize: 12, marginBottom: 14 }}>
                {`${senses.length} ${tr('qp_answers_possible')}`}
              </Text>
            ) : null}
            <Pressable onPress={submit} disabled={locked}
              style={{ backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6, opacity: locked ? 0.6 : 1 }}>
              <Ionicons name="send" size={16} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{tr('qp_submit')}</Text>
            </Pressable>
          </View>

          <View style={{ alignItems: 'center', marginTop: 18 }}>
            <Text style={{ fontWeight: '700', fontSize: 16, color: '#1a1a2e' }}>✅ {correctCount}  |  ❌ {wrongCount}</Text>
            <Text style={{ color: COLORS.muted, marginTop: 4 }}>{tr('qp_question')} {idx + 1}/{words.length}</Text>
          </View>
        </View>
      </ScrollView>

      {/* Avertissement anti-triche avant de quitter */}
      <Popup visible={showLeave} onClose={() => setShowLeave(false)} maxWidth={400}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 }}>{tr('dp_leave_title')}</Text>
        <Text style={{ fontSize: 14, color: COLORS.muted, lineHeight: 20, marginBottom: 20 }}>
          {tr('dp_leave_body').replace('{score}', `${correctCount}/${words.length}`)}
        </Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Pressable onPress={() => setShowLeave(false)} style={{ flex: 1, backgroundColor: '#f1f3f5', borderRadius: 999, paddingVertical: 13, alignItems: 'center' }}>
            <Text style={{ color: COLORS.muted, fontWeight: '700' }}>{tr('dp_keep_playing')}</Text>
          </Pressable>
          <Pressable onPress={confirmLeave} style={{ flex: 1, backgroundColor: COLORS.danger, borderRadius: 999, paddingVertical: 13, alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>{tr('dp_leave_submit')}</Text>
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
