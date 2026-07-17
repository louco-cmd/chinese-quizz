import { useState, useEffect, useCallback } from 'react';
import { View, ScrollView, Platform, useWindowDimensions } from 'react-native';
import DuelSectionCard from '../components/duels/DuelSectionCard';
import CtaCard from '../components/duels/CtaCard';
import QuizStats from '../components/quiz/QuizStats';
import QuizSettingsPopup from '../components/quiz/QuizSettingsPopup';
import TaskQuizzes from '../components/quiz/TaskQuizzes';
import DifficultWords from '../components/quiz/DifficultWords';
import QuizPlayScreen from './QuizPlayScreen';
import { getQuizStats } from '../api';
import { useT } from '../i18n';

// Page Quiz : même structure que la page Duels (stats sticky à gauche en desktop,
// CTA unifiés, sections empilées à droite).
export default function QuizScreen() {
  const { t } = useT();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 992;
  const hPad = isDesktop ? 24 : 16;

  const [pendingType, setPendingType] = useState(null); // type en attente de réglages
  const [playing, setPlaying] = useState(null); // { type, count, hsk, difficulty }
  const [stats, setStats] = useState(null);

  const loadStats = useCallback(async () => {
    try { setStats(await getQuizStats()); } catch { /* silencieux */ }
  }, []);
  useEffect(() => { loadStats(); }, [loadStats]);

  if (playing) {
    return (
      <QuizPlayScreen
        config={playing}
        onExit={() => { setPlaying(null); loadStats(); }}
      />
    );
  }

  // ── Blocs réutilisés dans les deux dispositions ──
  const statsCard = (
    <DuelSectionCard icon="stats-chart" title={t('quiz_mystats')}>
      <QuizStats
        quizzes={stats?.quizzes || 0}
        avg={stats?.avg || 0}
        best={stats?.best || 0}
        mastered={stats?.mastered || 0}
      />
    </DuelSectionCard>
  );

  // En zh→en (apprendre l'anglais), pas de distinction pinyin/caractères :
  // une seule entrée "Quiz" (on voit le chinois, on tape l'anglais).
  const learningEnglish = stats?.direction === 'zh→en';

  const rightColumn = (
    <>
      {/* CTA (même forme/hauteur que la page Duels) */}
      {learningEnglish ? (
        <View style={{ marginBottom: 14 }}>
          <View style={{ flexDirection: 'row' }}>
            <CtaCard
              colors={['#0d6efd', '#0a4fcf']}
              icon="create"
              title={t('quiz_single')}
              text={t('quiz_single_sub')}
              onPress={() => setPendingType('pinyin')}
            />
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 14, marginBottom: 14 }}>
          <CtaCard
            colors={['#0d6efd', '#0a4fcf']}
            icon="text"
            title={t('quiz_pinyin')}
            text={t('quiz_pinyin_sub')}
            onPress={() => setPendingType('pinyin')}
          />
          <CtaCard
            colors={['#7828a7', '#4e1e7e']}
            icon="language"
            title={t('quiz_chars')}
            text={t('quiz_chars_sub')}
            onPress={() => setPendingType('character')}
          />
        </View>
      )}

      {/* Task quizzes du professeur */}
      <TaskQuizzes onStart={(cfg) => setPlaying(cfg)} />

      {/* Your difficulties */}
      <DifficultWords onQuickQuiz={(ids) => setPlaying({ type: 'pinyin', ids })} />
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <ScrollView contentContainerStyle={{ paddingVertical: 16 }}>
        <View style={{ width: '100%', maxWidth: 1200, alignSelf: 'center', paddingHorizontal: hPad }}>
          {isDesktop ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 24 }}>
              <View style={[{ flex: 4 }, Platform.OS === 'web' ? { position: 'sticky', top: 16 } : null]}>
                {statsCard}
              </View>
              <View style={{ flex: 8 }}>{rightColumn}</View>
            </View>
          ) : (
            <>
              {statsCard}
              {rightColumn}
            </>
          )}
        </View>
      </ScrollView>

      <QuizSettingsPopup
        visible={!!pendingType}
        type={pendingType}
        onClose={() => setPendingType(null)}
        onStart={(opts) => {
          const type = pendingType;
          setPendingType(null);
          setPlaying({ type, ...opts });
        }}
      />
    </View>
  );
}
