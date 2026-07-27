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
import Popup from '../components/Popup';
import { getQuizStats, getQuizPacks } from '../api';
import { useT } from '../i18n';
import { COLORS, TAB_CLEARANCE } from '../theme';

const HSK_GLYPH = { hsk1: '一', hsk2: '二', hsk3: '三', hsk4: '四', hsk5: '五', hsk6: '六' };
const glyphOf = (k) => HSK_GLYPH[k] || '汉';

// Ligne de pack dans la popup : glyphe + titre + jauge de maîtrise (comme les tasks).
function PackRow({ pack, onPress, last }) {
  const k = Math.max(0, Math.min(100, Number(pack.mastery) || 0));
  return (
    <Pressable
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderColor: '#f2f2f4' }}
    >
      <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: '#f0e9fb', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 22, fontWeight: '700', color: '#7828a7' }}>{glyphOf(pack.cover_key)}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: '#1a1a2e' }} numberOfLines={1}>{pack.title}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 }}>
          <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: '#eceef1', overflow: 'hidden' }}>
            <View style={{ width: `${k}%`, height: '100%', backgroundColor: '#7828a7' }} />
          </View>
          <Text style={{ fontSize: 11.5, color: COLORS.muted, width: 58 }}>{k}% · {pack.word_count}w</Text>
        </View>
      </View>
      <View style={{ width: 34, height: 34, borderRadius: 999, backgroundColor: '#7828a7', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="play" size={16} color="#fff" />
      </View>
    </Pressable>
  );
}

// Page Quiz : stats sticky à gauche (desktop) + CTA "Start a quiz" (mode fusionné
// pinyin/characters) + "Train on a pack" + task quizzes + difficultés.
export default function QuizScreen({ onOpenStore, initialPack, onInitialConsumed, onBalanceChanged }) {
  const { t } = useT();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 992;
  const hPad = isDesktop ? 24 : 16;

  const [pending, setPending] = useState(null); // { scope:'collection' } | { scope:'pack', packId, title }
  const [playing, setPlaying] = useState(null);
  const [stats, setStats] = useState(null);
  const [packs, setPacks] = useState([]);
  const [packsOpen, setPacksOpen] = useState(false);

  const loadStats = useCallback(async () => {
    try { setStats(await getQuizStats()); } catch { /* silencieux */ }
  }, []);
  const loadPacks = useCallback(async () => {
    try { const d = await getQuizPacks(); setPacks(d.packs || []); } catch { /* silencieux */ }
  }, []);
  useEffect(() => { loadStats(); loadPacks(); }, [loadStats, loadPacks]);

  // Quiz lancé depuis le store / la page account → ouvre les réglages du pack.
  useEffect(() => {
    if (!initialPack) return;
    setPending({ scope: 'pack', packId: initialPack.id, title: initialPack.title });
    onInitialConsumed?.();
  }, [initialPack, onInitialConsumed]);

  if (playing) {
    return (
      <QuizPlayScreen
        config={playing}
        onExit={() => { setPlaying(null); loadStats(); onBalanceChanged?.(); }}
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
      {/* Deux tuiles côte à côte : quiz sur la collection (bleu) / sur un pack (violet). */}
      <View style={{ flexDirection: 'row', gap: 14, marginBottom: 14 }}>
        <CtaCard
          colors={['#0d6efd', '#0a4fcf']}
          icon="rocket"
          title={learningEnglish ? t('quiz_single') : 'Start a quiz'}
          text={learningEnglish ? t('quiz_single_sub') : 'Your whole collection'}
          onPress={() => setPending({ scope: 'collection' })}
        />
        <CtaCard
          colors={['#7828a7', '#4e1e7e']}
          icon="albums"
          title="Train on a pack"
          text="Practice a specific pack"
          onPress={() => setPacksOpen(true)}
        />
      </View>

      {/* Task quizzes du professeur */}
      <TaskQuizzes onStart={(cfg) => setPlaying(cfg)} />

      {/* Your difficulties */}
      <DifficultWords onQuickQuiz={(ids) => setPlaying({ type: 'pinyin', ids })} />
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: TAB_CLEARANCE }}>
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

      {/* Popup "Train on a pack" : liste des packs + lien vers le store */}
      <Popup visible={packsOpen} onClose={() => setPacksOpen(false)} maxWidth={440}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="albums" size={20} color="#7828a7" />
            <Text style={{ fontSize: 18, fontWeight: '800', color: '#1a1a2e' }}>Train on a pack</Text>
          </View>
          <Pressable onPress={() => setPacksOpen(false)} hitSlop={10}><Ionicons name="close" size={22} color={COLORS.muted} /></Pressable>
        </View>

        {packs.length ? (
          <View style={{ marginTop: 6 }}>
            {packs.map((p, i) => (
              <PackRow
                key={p.id}
                pack={p}
                last={i === packs.length - 1}
                onPress={() => { setPacksOpen(false); setPending({ scope: 'pack', packId: p.id, title: p.title }); }}
              />
            ))}
          </View>
        ) : (
          <View style={{ alignItems: 'center', paddingVertical: 22 }}>
            <Ionicons name="albums-outline" size={34} color={COLORS.mutedLight} />
            <Text style={{ color: COLORS.muted, marginTop: 10, textAlign: 'center' }}>You don't own any pack yet.</Text>
          </View>
        )}

        {/* Lien vers le store */}
        <Pressable
          onPress={() => { setPacksOpen(false); onOpenStore?.(); }}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 16, paddingVertical: 13, borderRadius: 999, borderWidth: 1.5, borderColor: '#e0d3f2', backgroundColor: '#faf7ff' }}
        >
          <Ionicons name="storefront" size={16} color="#7828a7" />
          <Text style={{ color: '#7828a7', fontWeight: '700' }}>Get new packs</Text>
        </Pressable>
      </Popup>

      <QuizSettingsPopup
        visible={!!pending}
        scope={pending?.scope || 'collection'}
        packLabel={pending?.title}
        showMode={!learningEnglish}
        onClose={() => setPending(null)}
        onStart={(opts) => {
          const p = pending;
          setPending(null);
          setPlaying(p?.scope === 'pack' ? { ...opts, packId: p.packId, title: p.title } : opts);
        }}
      />
    </View>
  );
}
