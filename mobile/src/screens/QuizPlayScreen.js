import { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ErrorRetry } from '../components/ErrorRetry';
import { getMe, getQuizPlayWords, saveQuiz, saveTaskResult } from '../api';
import { useT } from '../i18n';
import useAndroidBack from '../useAndroidBack';
import { COLORS, SHADOW_CARD } from '../theme';
import CatLoader from '../components/CatLoader';

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
// Lettres seules (minuscule, accents retirés) — pour l'anglais on ne compare QUE
// les lettres/chiffres : ponctuation (. , ' -) et espaces ignorés.
function stripLetters(str) {
  return (str || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}
// Sens valides d'une réponse, séparés par / (et , 、 … pour l'anglais) → UN SEUL
// suffit. Anglais : parseAnswers ; pinyin : découpe sur / uniquement.
function answerSenses(w, type, direction) {
  if (direction === 'zh→en') return parseAnswers(w?.english);
  if (type === 'pinyin') return (w?.pinyin || '').split('/').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return parseAnswers(w?.chinese);
}
// Jetons (un par mot/syllabe) du 1er sens → structure des boîtes (une par jeton).
// On écarte les jetons qui n'ont AUCUN caractère comparable (ponctuation seule :
// « ! », « ? »…) : ils ne comptent pas dans la solution, donc pas de boîte vide.
function firstSenseTokens(w, type, direction) {
  const hasContent = (tok) => (type === 'pinyin' && direction !== 'zh→en'
    ? normalizePinyin(tok).length > 0
    : stripLetters(tok).length > 0);
  return (answerSenses(w, type, direction)[0] || '').split(/\s+/).filter((t) => t && hasContent(t));
}

const infoLabel = (hsk, levels) => {
  let h;
  if (!hsk || hsk === 'all') h = 'all HSK';
  else if (hsk.includes('-')) { const [a, b] = hsk.split('-'); h = b === '7' ? `HSK ${a}–6 + Street` : `HSK ${a}–${b}`; }
  else h = `HSK ${hsk}`;
  const n = (levels || []).length;
  return n ? `${h} • ${n} level${n > 1 ? 's' : ''}` : `${h} • all levels`;
};

export default function QuizPlayScreen({ config, onExit }) {
  const { t: tr } = useT();
  // Retour Android → quitter le quiz (revenir à la liste), pas fermer l'app.
  useAndroidBack(() => { onExit(); return true; }, true, [onExit]);
  const { type, count, hsk, levels, ids, packId, lessonId, title } = config;
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
      const [me, d] = await Promise.all([getMe().catch(() => ({})), getQuizPlayWords({ type, count, hsk, levels, ids, packId })]);
      if (me.quiz_direction) setDirection(me.quiz_direction);
      const ws = d.words || [];
      if (!ws.length) { setError(tr('qp_not_enough')); setWords(null); return; }
      setWords(ws);
      results.current = ws.map((w) => ({ mot_id: w.id, correct: null, bonus: 0, pinyin: w.pinyin }));
      resetQuestion(ws[0]);
    } catch (e) {
      setError(e.message || tr('qp_could_not_start'));
    } finally {
      setLoading(false);
    }
  }, [type, count, hsk, levels]);

  useEffect(() => { load(); }, [load]);

  // Relance un quiz complet : réinitialise score/progression avant de recharger
  // (sinon `ended` reste vrai et l'écran de résultats ne bouge pas).
  function restart() {
    setEnded(false);
    setIdx(0);
    setCorrectCount(0);
    setWrongCount(0);
    setCoins(0);
    correctCountRef.current = 0;
    load();
  }

  const isPinyin = type === 'pinyin' && direction !== 'zh→en';

  function resetQuestion(w) {
    setSecond(false);
    setFeedback(null);
    setLocked(false);
    if (direction === 'zh→en' || type === 'pinyin') {
      // Un champ par jeton (mot anglais / syllabe pinyin) du 1er sens ; au moins 1.
      const toks = firstSenseTokens(w, type, direction);
      setInputs((toks.length ? toks : ['']).map(() => ''));
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
    if (lessonId) { try { await saveTaskResult(lessonId, correctCountRef.current, ws.length); } catch { /* noop */ } }
  }

  // On garde une ref du score courant pour finish() (évite les closures périmées)
  const correctCountRef = useRef(0);
  useEffect(() => { correctCountRef.current = correctCount; }, [correctCount]);

  function checkAnswer(w) {
    const senses = answerSenses(w, type, direction);
    if (direction === 'zh→en') {
      // Lettres concaténées des champs vs lettres de chaque sens (ponctuation/espaces
      // ignorés) → UN sens suffit.
      const got = stripLetters(inputs.join(''));
      return got.length > 0 && senses.some((s) => stripLetters(s) === got);
    }
    if (type === 'pinyin') {
      // Syllabes concaténées vs chaque sens pinyin → UN sens suffit.
      const got = normalizePinyin(inputs.join(' '));
      return got.length > 0 && senses.some((s) => normalizePinyin(s) === got);
    }
    return senses.some((a) => a === inputs[0].trim().toLowerCase());
  }

  function submit() {
    if (locked) return;
    const w = words[idx];
    const ok = checkAnswer(w);
    const answer = direction === 'zh→en' ? w.english : type === 'pinyin' ? w.pinyin : w.chinese;
    const bonus = 0; // saisie structurée (un mot par champ) → une seule réponse.

    if (ok) {
      // Point (+ bonus) seulement si trouvé à la 1re tentative.
      if (results.current[idx].correct === null) { results.current[idx].correct = true; results.current[idx].bonus = bonus; }
      if (!second) setCorrectCount((c) => c + 1 + bonus);
      setFeedback({ kind: 'success', text: tr('qp_correct') });
      setLocked(true);
      setTimeout(() => advance(idx + 1, words), 1000);
    } else if (!second) {
      // 1re erreur : on marque faux, on MONTRE la réponse, puis 2e chance (recopie).
      results.current[idx].correct = false;
      setWrongCount((c) => c + 1);
      setSecond(true);
      setFeedback({ kind: 'reveal', text: `${tr('qp_answer')} ${answer}` });
      setInputs((arr) => arr.map(() => ''));
      setTimeout(() => firstRef.current?.focus?.(), 60);
    } else {
      // 2e erreur : on révèle la réponse et on avance
      setFeedback({ kind: 'reveal', text: `${tr('qp_answer')} ${answer}` });
      setLocked(true);
      setTimeout(() => advance(idx + 1, words), 1400);
    }
  }

  // ── Rendu ──
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8f9fa' }}>
        <CatLoader size={110} />
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
    const motivation = pct >= 80 ? tr('qp_motiv_80')
      : pct >= 60 ? tr('qp_motiv_60')
      : pct >= 40 ? tr('qp_motiv_40')
      : tr('qp_motiv_0');
    return (
      <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
        <TopBar onExit={onExit} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 420, alignItems: 'center', ...SHADOW_CARD }}>
            <Ionicons name="trophy" size={48} color="#f7c948" />
            <Text style={{ fontSize: 26, fontWeight: '800', color: '#1a1a2e', marginTop: 12 }}>{correctCount}/{total}</Text>
            <Text style={{ fontSize: 15, color: COLORS.jiayou, fontWeight: '600', marginTop: 2 }}>{pct}% {tr('qp_pct_correct')}</Text>
            <Text style={{ fontSize: 14, color: COLORS.muted, textAlign: 'center', marginTop: 12 }}>{motivation}</Text>
            {coins > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff8e1', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, marginTop: 16 }}>
                <Ionicons name="add-circle" size={16} color="#d97706" />
                <Text style={{ color: '#856404', fontWeight: '700' }}>{coins} {tr('qp_coins_earned')}</Text>
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 24, width: '100%' }}>
              <Pressable onPress={onExit} style={{ flex: 1, backgroundColor: '#f1f3f5', borderRadius: 999, paddingVertical: 13, alignItems: 'center' }}>
                <Text style={{ color: COLORS.muted, fontWeight: '700' }}>{tr('common_back')}</Text>
              </Pressable>
              <Pressable onPress={restart} style={{ flex: 1, backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 13, alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>{tr('qp_new_quiz')}</Text>
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
      ? tr('qp_how_pinyin').replace('{w}', w.english)
      : tr('qp_how_chinese').replace('{w}', w.english);

  const fbColor = feedback?.kind === 'success' ? { bg: '#e8f5e9', fg: COLORS.success } : { bg: '#fff3cd', fg: '#856404' };

  // Champs à jetons (un par mot/syllabe) : pinyin OU anglais. Les boîtes sont
  // structurées sur le 1er sens ; n'importe quel sens (séparé par /) est accepté.
  const isEn = direction === 'zh→en';
  const tokenFields = isPinyin || isEn;
  const senses = answerSenses(w, type, direction);
  const primary = tokenFields ? firstSenseTokens(w, type, direction) : [];
  const multiHint = senses.length > 1;
  const tokenTarget = (i) => (isEn ? stripLetters(primary[i] || '').length : normalizePinyin(primary[i] || '').length);
  const typedLen = (tt) => (isEn ? stripLetters(tt).length : (tt || '').length);

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <TopBar onExit={onExit} progress={`${idx + 1}/${words.length}`} />
      <ScrollView contentContainerStyle={{ padding: 16, alignItems: 'center' }} keyboardShouldPersistTaps="handled">
        <View style={{ width: '100%', maxWidth: 560 }}>
          {/* Question */}
          <View style={{ alignItems: 'center', marginVertical: 22 }}>
            {direction === 'zh→en' ? (
              <>
                <Text style={{ fontSize: 16, color: COLORS.muted }}>{tr('qp_what_mean_en')}</Text>
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
                      onSubmitEditing={submit}
                      editable={!locked}
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder={`${target}`}
                      placeholderTextColor="#c4c4c4"
                      style={[syllableStyle(second), isEn ? { minWidth: Math.max(64, target * 14 + 22) } : null]}
                    />
                  );
                })
              ) : (
                <TextInput
                  ref={firstRef}
                  value={inputs[0]}
                  onChangeText={(t) => setInputs([t])}
                  onSubmitEditing={submit}
                  editable={!locked}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={tr('qp_write_chinese')}
                  placeholderTextColor="#adb5bd"
                  style={fullInputStyle(second)}
                />
              )}
            </View>
            {multiHint ? (
              <Text style={{ textAlign: 'center', color: COLORS.mutedLight, fontSize: 12, marginBottom: 14 }}>
                {`${senses.length} ${tr('qp_answers_possible')}`}
              </Text>
            ) : null}

            <Pressable
              onPress={submit}
              disabled={locked}
              style={{ backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6, opacity: locked ? 0.6 : 1 }}
            >
              <Ionicons name="send" size={16} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{tr('qp_submit')}</Text>
            </Pressable>
          </View>

          {/* Score + progression */}
          <View style={{ alignItems: 'center', marginTop: 18 }}>
            <Text style={{ fontWeight: '700', fontSize: 16, color: '#1a1a2e' }}>✅ {correctCount}  |  ❌ {wrongCount}</Text>
            <Text style={{ color: COLORS.muted, marginTop: 4 }}>{tr('qp_question')} {idx + 1}/{words.length}</Text>
            <Text style={{ color: '#adb5bd', fontSize: 12, marginTop: 4 }}>{packId ? (title || tr('qp_pack')) : lessonId ? (title || tr('qp_lesson')) : ids ? tr('qz_your_difficulties') : infoLabel(hsk, levels)}</Text>
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
