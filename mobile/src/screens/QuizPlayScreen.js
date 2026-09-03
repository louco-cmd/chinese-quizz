import { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ErrorRetry } from '../components/ErrorRetry';
import { getMe, getQuizPlayWords, saveQuiz, saveTaskResult } from '../api';
import { useT } from '../i18n';
import useAndroidBack from '../useAndroidBack';
import { COLORS, SHADOW_CARD } from '../theme';
import CatLoader from '../components/CatLoader';
import RevealAnswerCard from '../components/RevealAnswerCard';
import { isZhLearning } from '../langs';

// ── Helpers (identiques à quiz-play.ejs) ──
function normalizePinyin(str) {
  // On compare le pinyin sur ses SEULES lettres/chiffres : diacritiques (tons),
  // espaces ET ponctuation (' - , . …) sont ignorés → pas de faux négatif quand
  // l'user omet une apostrophe (nǚ'ér) ou un tiret, et pas de case d'input créée
  // pour un jeton de ponctuation seule. (Les chiffres de ton « ni3 hao3 » restent.)
  return (str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
// Comparaison « souple » pour les réponses en CARACTÈRES (hanzi) : on garde les
// lettres (tous scripts, CJK inclus) et les chiffres, on retire espaces et
// ponctuation (', - , . …) → mêmes faux négatifs évités que pour le latin/pinyin.
function stripPunct(str) {
  return (str || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
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
// Réponse attendue selon le `kind` :
//  'pinyin' (cours de chinois, type pinyin/reading) → on saisit le pinyin ;
//  'base'   (cours non-zh, mode LECTURE) → on saisit la traduction en langue de
//           base (w.english = trad native, ex. montre "cat" → répondre "猫/chat") ;
//  'term'   (défaut) → le terme appris (w.chinese) : hanzi (zh, type caractère)
//           ou mot latin (non-zh, mode production).
function answerSenses(w, kind) {
  if (kind === 'pinyin') {
    return (w?.pinyin || '').replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '')
      .split('/').map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
  return parseAnswers(kind === 'base' ? w?.english : w?.chinese);
}
// Jetons (un par mot/syllabe) du 1er sens → structure des boîtes (une par jeton).
// On écarte les jetons sans caractère comparable (ponctuation seule).
function firstSenseTokens(w, kind) {
  const hasContent = (tok) => (kind === 'pinyin' ? normalizePinyin(tok).length > 0 : stripLetters(tok).length > 0);
  return (answerSenses(w, kind)[0] || '').split(/\s+/).filter((t) => t && hasContent(t));
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
  const [learningLang, setLearningLang] = useState('zh');
  const [nativeLang, setNativeLang] = useState('en'); // langue de base (réponse en mode lecture)
  const [words, setWords] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notEnough, setNotEnough] = useState(false); // pas assez de mots → empty state dédié

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
    setLoading(true); setError(''); setNotEnough(false);
    try {
      const [me, d] = await Promise.all([getMe().catch(() => ({})), getQuizPlayWords({ type, count, hsk, levels, ids, packId })]);
      const lp = me.learning_lang || learningLang;
      const np = me.native_lang || nativeLang;
      if (me.learning_lang) setLearningLang(me.learning_lang);
      if (me.native_lang) setNativeLang(me.native_lang);
      const ws = d.words || [];
      if (!ws.length) { setNotEnough(true); setWords(null); return; }
      setWords(ws);
      results.current = ws.map((w) => ({ mot_id: w.id, correct: null, bonus: 0, pinyin: w.pinyin }));
      resetQuestion(ws[0], lp, np); // langues fraîches : setState ci-dessus pas encore appliqué
    } catch (e) {
      // Le backend renvoie le code brut 'not_enough_words' (400) → empty state dédié.
      if (e?.message === 'not_enough_words') { setNotEnough(true); setWords(null); }
      else setError(e.message || tr('qp_could_not_start'));
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

  const isZh = isZhLearning(learningLang);
  const nativeIsZh = isZhLearning(nativeLang);
  // Pinyin/reading (réponse = pinyin) uniquement pour un cours de chinois.
  const isPinyin = isZh && (type === 'pinyin' || type === 'reading');
  // Cours non-zh, mode LECTURE : on montre le mot appris et on répond la TRAD (base).
  const readingBase = !isZh && type === 'reading';
  // Nature de la réponse : pinyin | base (trad native) | term (mot appris/hanzi).
  const answerKind = isPinyin ? 'pinyin' : readingBase ? 'base' : 'term';
  // Script de la réponse : hanzi (champ unique, exact) si on répond en chinois —
  // terme chinois (cours zh, type caractère) OU trad de base chinoise (apprenant
  // en/fr depuis le chinois, mode lecture). Sinon lettres (pinyin ou mot latin).
  const answerIsHanzi = answerKind === 'base' ? nativeIsZh : (answerKind === 'term' ? isZh : false);
  const latinTokens = !isPinyin && !answerIsHanzi; // saisie par jetons de lettres

  // `lp` explicite : au tout premier chargement, `setLearningLang(me.learning_lang)`
  // n'est pas encore appliqué (setState async) → on passe la langue fraîche pour
  // dimensionner correctement les cases.
  function resetQuestion(w, lp = learningLang, np = nativeLang) {
    setSecond(false);
    setFeedback(null);
    setLocked(false);
    const zh = isZhLearning(lp);
    const nzh = isZhLearning(np);
    const pin = zh && (type === 'pinyin' || type === 'reading');
    const kind = pin ? 'pinyin' : (!zh && type === 'reading') ? 'base' : 'term';
    const ansHanzi = kind === 'base' ? nzh : (kind === 'term' ? zh : false);
    const tokenFields = !ansHanzi; // pinyin/latin → jetons ; hanzi → champ unique
    if (tokenFields) {
      const toks = firstSenseTokens(w, kind);
      setInputs((toks.length ? toks : ['']).map(() => ''));
    } else {
      setInputs(['']); // hanzi : un seul champ
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
    const senses = answerSenses(w, answerKind);
    if (isPinyin) {
      // Syllabes concaténées vs chaque sens pinyin → UN sens suffit.
      const got = normalizePinyin(inputs.join(' '));
      return got.length > 0 && senses.some((s) => normalizePinyin(s) === got);
    }
    if (latinTokens) {
      // Mot latin (terme appris OU trad de base) : lettres concaténées vs lettres
      // de chaque sens (ponctuation/espaces ignorés) → UN sens suffit.
      const got = stripLetters(inputs.join(''));
      return got.length > 0 && senses.some((s) => stripLetters(s) === got);
    }
    // Hanzi : champ unique, comparaison souple (ponctuation/espaces ignorés).
    return senses.some((a) => stripPunct(a) === stripPunct(inputs[0]));
  }

  function submit() {
    if (locked) return;
    const w = words[idx];
    const ok = checkAnswer(w);
    const answer = isPinyin ? w.pinyin : readingBase ? w.english : w.chinese;
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
      setFeedback({ kind: 'reveal', word: w });
      setInputs((arr) => arr.map(() => ''));
      setTimeout(() => firstRef.current?.focus?.(), 60);
    } else {
      // 2e erreur : on révèle la réponse et on avance
      setFeedback({ kind: 'reveal', word: w });
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
  // Pas assez de mots pour ces réglages → empty state clair + retour (au lieu du
  // code brut "not_enough_words").
  if (notEnough) {
    return (
      <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
        <TopBar onExit={onExit} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: '#e8f0ff', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
            <Ionicons name="book-outline" size={38} color={COLORS.jiayou} />
          </View>
          <Text style={{ fontSize: 19, fontWeight: '800', color: '#1a1a2e', textAlign: 'center' }}>{tr('qp_not_enough_title')}</Text>
          <Text style={{ fontSize: 14.5, color: COLORS.muted, textAlign: 'center', marginTop: 8, lineHeight: 21, maxWidth: 320 }}>{tr('qp_not_enough')}</Text>
          <Pressable
            onPress={onExit}
            style={{ marginTop: 26, backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 14, paddingHorizontal: 40, flexDirection: 'row', alignItems: 'center', gap: 8 }}
          >
            <Ionicons name="arrow-back" size={17} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{tr('qp_not_enough_back')}</Text>
          </Pressable>
        </View>
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
  // Question unifiée : une consigne (muted) + le mot demandé sur sa propre ligne.
  // Le mode `reading` (zh ET non-zh) MONTRE le mot appris (hanzi / terme latin) et
  // demande la « lecture » : pinyin en chinois, traduction native en non-zh. Les
  // autres modes montrent la traduction native et demandent le mot appris.
  const showsTerm = type === 'reading';
  const promptLine = isPinyin
    ? (showsTerm ? tr('qp_how_reading_line') : tr('qp_how_pinyin_line'))
    : readingBase ? tr('qp_how_read_word_line')
    : isZh ? tr('qp_how_chinese_line') : tr('qp_how_word_line');
  const promptWord = showsTerm ? w.chinese : w.english;
  const promptWordSize = (isZh && showsTerm) ? 40 : 30; // hanzi plus gros

  const fbColor = feedback?.kind === 'success' ? { bg: '#e8f5e9', fg: COLORS.success } : { bg: '#fff3cd', fg: '#856404' };

  // Champs à jetons (un par mot/syllabe) : pinyin (syllabes) OU terme latin (mots).
  // Le hanzi (cours de chinois, type caractère) reste un champ unique.
  const tokenFields = isPinyin || latinTokens;
  const senses = answerSenses(w, answerKind);
  const primary = tokenFields ? firstSenseTokens(w, answerKind) : [];
  const multiHint = senses.length > 1;
  const tokenTarget = (i) => (latinTokens ? stripLetters(primary[i] || '').length : normalizePinyin(primary[i] || '').length);
  const typedLen = (tt) => (latinTokens ? stripLetters(tt).length : (tt || '').length);

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <TopBar onExit={onExit} progress={`${idx + 1}/${words.length}`} />
      <ScrollView contentContainerStyle={{ padding: 16, alignItems: 'center' }} keyboardShouldPersistTaps="handled">
        <View style={{ width: '100%', maxWidth: 560 }}>
          {/* Question — consigne + mot sur sa propre ligne (unifié EN/ZH) */}
          <View style={{ alignItems: 'center', marginVertical: 22 }}>
            <Text style={{ fontSize: 16, color: COLORS.muted, textAlign: 'center' }}>{promptLine}</Text>
            <Text style={{ fontSize: promptWordSize, fontWeight: '800', color: '#1a1a2e', marginTop: 10, textAlign: 'center' }}>{promptWord}</Text>
          </View>

          {/* Feedback : carte de réponse (caractère/pinyin/audio) après une erreur,
              sinon petit bandeau texte (succès). */}
          {feedback && (
            feedback.kind === 'reveal'
              ? <RevealAnswerCard word={feedback.word} learningLang={learningLang} type={type} />
              : (
                <View style={{ backgroundColor: fbColor.bg, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, marginBottom: 16, alignItems: 'center' }}>
                  <Text style={{ color: fbColor.fg, fontWeight: '700' }}>{feedback.text}</Text>
                </View>
              )
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
                      style={[syllableStyle(second), latinTokens ? { minWidth: Math.max(64, target * 14 + 22) } : null]}
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
