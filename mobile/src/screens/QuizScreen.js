import { useState, useEffect, useCallback } from 'react';
import { View, Image, Pressable, Platform, useWindowDimensions } from 'react-native';
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
// Design-system : surface d'import unique (cf. src/ui/COMPONENTS.md).
import { Screen, Text, Button, Row, Modal, ProgressBar, EmptyState, COLORS } from '../ui';

const HSK_GLYPH = { hsk1: '一', hsk2: '二', hsk3: '三', hsk4: '四', hsk5: '五', hsk6: '六' };
const glyphOf = (k) => HSK_GLYPH[k] || '汉';

// En dessous de ce nombre de mots, un quiz n'a pas d'intérêt : on invite l'user
// à étoffer sa collection (capture / pack) plutôt que de lancer un quiz vide.
const MIN_QUIZ_WORDS = 10;

// Ligne de pack dans la popup : glyphe + titre + jauge de maîtrise (comme les tasks).
function PackRow({ pack, onPress, last }) {
  const k = Math.max(0, Math.min(100, Number(pack.mastery) || 0));
  return (
    <Pressable
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderColor: '#f2f2f4' }}
    >
      <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: '#f0e9fb', alignItems: 'center', justifyContent: 'center' }}>
        {pack.logo_url
          ? <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
              <Image source={{ uri: pack.logo_url }} style={{ width: 22, height: 22 }} resizeMode="contain" />
            </View>
          : <Text weight="700" color="#7828a7" style={{ fontSize: 22 }}>{glyphOf(pack.cover_key)}</Text>}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="bodyStrong" numberOfLines={1}>{pack.title}</Text>
        <Row gap={8} style={{ marginTop: 5 }}>
          <ProgressBar value={k} max={100} height={6} color="#7828a7" track="#eceef1" style={{ flex: 1 }} />
          <Text variant="caption" style={{ width: 58 }}>{k}% · {pack.word_count}w</Text>
        </Row>
      </View>
      <View style={{ width: 34, height: 34, borderRadius: 999, backgroundColor: '#7828a7', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="play" size={16} color="#fff" />
      </View>
    </Pressable>
  );
}

// Page Quiz : stats sticky à gauche (desktop) + CTA "Start a quiz" (mode fusionné
// pinyin/characters) + "Train on a pack" + task quizzes + difficultés.
export default function QuizScreen({ onOpenStore, onCapture, initialPack, onInitialConsumed, initialQuizIds, onInitialQuizConsumed, onBalanceChanged, onNavigate, onActivityDone }) {
  const { t } = useT();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 992;

  const [pending, setPending] = useState(null); // { scope:'collection' } | { scope:'pack', packId, title } | { scope:'ids', ids }
  const [needWords, setNeedWords] = useState(false); // gate collection trop petite
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

  // Quiz du jour (push quotidien) → ouvre les réglages pré-ciblés sur les 10 mots.
  useEffect(() => {
    if (!initialQuizIds || !initialQuizIds.length) return;
    setPending({ scope: 'ids', ids: initialQuizIds });
    onInitialQuizConsumed?.();
  }, [initialQuizIds, onInitialQuizConsumed]);

  if (playing) {
    return (
      <QuizPlayScreen
        config={playing}
        onExit={() => { setPlaying(null); loadStats(); onBalanceChanged?.(); onActivityDone?.(); }}
      />
    );
  }

  // Cours de chinois → modes pinyin/caractère dispo ; sinon quiz de mot simple.
  const isZh = (stats?.learning_lang || 'zh') === 'zh';
  const learningEnglish = !isZh;

  const statsCard = (
    <DuelSectionCard
      icon="stats-chart"
      title={t('quiz_mystats')}
      note={onNavigate ? t('quiz_access_account') : undefined}
      onPress={onNavigate ? () => onNavigate('account') : undefined}
    >
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
      <Row gap={14} align="stretch" style={{ marginBottom: 14 }}>
        <CtaCard
          colors={['#0d6efd', '#0a4fcf']}
          icon="rocket"
          title={learningEnglish ? t('quiz_single') : t('qz_start_quiz')}
          text={learningEnglish ? t('quiz_single_sub') : t('qz_whole_collection')}
          onPress={() => {
            // Collection trop petite → popup d'explication au lieu d'un quiz vide.
            // On ne gate que si les stats sont chargées (sinon on ne bloque pas).
            if (stats && stats.words < MIN_QUIZ_WORDS) setNeedWords(true);
            else setPending({ scope: 'collection' });
          }}
        />
        <CtaCard
          colors={['#7828a7', '#4e1e7e']}
          icon="albums"
          title={t('qz_train_pack')}
          text={t('qz_train_pack_sub')}
          onPress={() => setPacksOpen(true)}
        />
      </Row>

      {/* Task quizzes du professeur */}
      <TaskQuizzes onStart={(cfg) => setPlaying(cfg)} />

      {/* Your difficulties */}
      <DifficultWords
        onQuickQuiz={(ids) => setPending({ scope: 'ids', ids })}
        wordsCount={stats?.words}
        onCapture={onCapture}
        onStartQuiz={() => setPending({ scope: 'collection' })}
      />
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.page }}>
      {/* edges=[] : l'écran est monté SOUS le Header de l'app, qui gère déjà le
          safe-area du haut — on ne le réapplique pas ici (sinon double padding). */}
      <Screen edges={[]} maxWidth={1200}>
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
      </Screen>

      {/* Popup "Train on a pack" : en-tête fixe + liste scrollable + bouton store
          collé en bas (hauteur plafonnée par le composant Popup). */}
      <Modal
        visible={packsOpen}
        onClose={() => setPacksOpen(false)}
        maxWidth={440}
        header={(
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <Row gap={8}>
              <Ionicons name="albums" size={20} color="#7828a7" />
              <Text variant="subtitle" weight="800">{t('qz_train_pack')}</Text>
            </Row>
            <Pressable onPress={() => setPacksOpen(false)} hitSlop={10}><Ionicons name="close" size={22} color={COLORS.muted} /></Pressable>
          </View>
        )}
        footer={(
          /* CTA « boutique » — violet de marque (hors variantes lib). */
          <Pressable
            onPress={() => { setPacksOpen(false); onOpenStore?.(); }}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, paddingVertical: 13, borderRadius: 999, borderWidth: 1.5, borderColor: '#e0d3f2', backgroundColor: '#faf7ff' }}
          >
            <Ionicons name="storefront" size={16} color="#7828a7" />
            <Text weight="700" color="#7828a7">{t('qz_get_packs')}</Text>
          </Pressable>
        )}
      >
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
          <EmptyState icon="albums-outline" style={{ paddingVertical: 22 }}>{t('qz_no_pack')}</EmptyState>
        )}
      </Modal>

      {/* Gate : collection < 10 mots → on explique + on oriente vers capture/pack. */}
      <Modal visible={needWords} onClose={() => setNeedWords(false)} maxWidth={420}>
        <View style={{ alignItems: 'center', marginBottom: 6 }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#eef4ff', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <Ionicons name="library" size={30} color={COLORS.jiayou} />
          </View>
          <Text variant="subtitle" align="center">{t('qz_need_words_title')}</Text>
          <Text variant="muted" align="center" style={{ lineHeight: 20, marginTop: 8 }}>{t('qz_need_words_body')}</Text>
        </View>

        <Button
          title={t('qz_need_words_capture')}
          icon="add-circle"
          fullWidth
          onPress={() => { setNeedWords(false); onCapture?.(); }}
          style={{ marginTop: 14 }}
        />
        {/* Action secondaire « boutique » — violet de marque (hors variantes lib). */}
        <Pressable
          onPress={() => { setNeedWords(false); onOpenStore?.(); }}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10, paddingVertical: 14, borderRadius: 999, borderWidth: 1.5, borderColor: '#e0d3f2', backgroundColor: '#faf7ff' }}
        >
          <Ionicons name="storefront" size={16} color="#7828a7" />
          <Text weight="700" color="#7828a7" style={{ fontSize: 15 }}>{t('qz_need_words_buy')}</Text>
        </Pressable>
      </Modal>

      <QuizSettingsPopup
        visible={!!pending}
        scope={pending?.scope || 'collection'}
        packLabel={pending?.title}
        showMode
        learningZh={isZh}
        onClose={() => setPending(null)}
        onStart={(opts) => {
          const p = pending;
          setPending(null);
          if (p?.scope === 'pack') setPlaying({ ...opts, packId: p.packId, title: p.title });
          else if (p?.scope === 'ids') setPlaying({ ...opts, ids: p.ids });
          else setPlaying(opts);
        }}
      />
    </View>
  );
}
