import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, Platform, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DuelSectionCard from '../components/duels/DuelSectionCard';
import CtaCard from '../components/duels/CtaCard';
import QuizStats from '../components/quiz/QuizStats';
import QuizSettingsPopup from '../components/quiz/QuizSettingsPopup';
import TaskQuizzes from '../components/quiz/TaskQuizzes';
import DifficultWords from '../components/quiz/DifficultWords';
import QuizPlayScreen from './QuizPlayScreen';
import { getQuizStats, getQuizPacks } from '../api';
import { useT } from '../i18n';
import { COLORS } from '../theme';

const HSK_GLYPH = { hsk1: '一', hsk2: '二', hsk3: '三', hsk4: '四', hsk5: '五', hsk6: '六' };
const glyphOf = (k) => HSK_GLYPH[k] || '汉';

function PackRow({ pack, onPress }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
      <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: '#e8f0ff', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 22, fontWeight: '700', color: '#5b8def' }}>{glyphOf(pack.cover_key)}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: '#1a1a2e' }} numberOfLines={1}>{pack.title}</Text>
        <Text style={{ fontSize: 12.5, color: COLORS.muted, marginTop: 1 }}>{pack.word_count} words</Text>
      </View>
      <View style={{ width: 34, height: 34, borderRadius: 999, backgroundColor: COLORS.jiayou, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="play" size={16} color="#fff" />
      </View>
    </Pressable>
  );
}

// Page Quiz : stats sticky à gauche (desktop) + CTA "Start a quiz" (mode fusionné
// pinyin/characters) + "Train on a pack" + task quizzes + difficultés.
export default function QuizScreen() {
  const { t } = useT();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 992;
  const hPad = isDesktop ? 24 : 16;

  const [pending, setPending] = useState(null); // { scope:'collection' } | { scope:'pack', packId, title }
  const [playing, setPlaying] = useState(null);
  const [stats, setStats] = useState(null);
  const [packs, setPacks] = useState([]);

  const loadStats = useCallback(async () => {
    try { setStats(await getQuizStats()); } catch { /* silencieux */ }
  }, []);
  const loadPacks = useCallback(async () => {
    try { const d = await getQuizPacks(); setPacks(d.packs || []); } catch { /* silencieux */ }
  }, []);
  useEffect(() => { loadStats(); loadPacks(); }, [loadStats, loadPacks]);

  if (playing) {
    return (
      <QuizPlayScreen
        config={playing}
        onExit={() => { setPlaying(null); loadStats(); }}
      />
    );
  }

  const learningEnglish = stats?.direction === 'zh→en';

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

  const rightColumn = (
    <>
      {/* CTA unique : ouvre les réglages (mode + scope collection). */}
      <View style={{ flexDirection: 'row', marginBottom: 14 }}>
        <CtaCard
          colors={['#0d6efd', '#0a4fcf']}
          icon="rocket"
          title={learningEnglish ? t('quiz_single') : 'Start a quiz'}
          text={learningEnglish ? t('quiz_single_sub') : 'Pinyin or characters, your whole collection'}
          onPress={() => setPending({ scope: 'collection' })}
        />
      </View>

      {/* Train on a pack */}
      {packs.length ? (
        <View style={{ marginBottom: 14 }}>
          <DuelSectionCard icon="albums" title="Train on a pack">
            {packs.map((p, i) => (
              <View key={p.id}>
                {i > 0 ? <View style={{ height: 1, backgroundColor: '#f2f2f4' }} /> : null}
                <PackRow pack={p} onPress={() => setPending({ scope: 'pack', packId: p.id, title: p.title })} />
              </View>
            ))}
          </DuelSectionCard>
        </View>
      ) : null}

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
        visible={!!pending}
        scope={pending?.scope || 'collection'}
        packLabel={pending?.title}
        showMode={!learningEnglish}
        onClose={() => setPending(null)}
        onStart={(opts) => {
          const p = pending;
          setPending(null);
          setPlaying(p?.scope === 'pack' ? { ...opts, packId: p.packId } : opts);
        }}
      />
    </View>
  );
}
