import { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl, ActivityIndicator, Platform, useWindowDimensions, PanResponder } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AccountHero from '../components/account/AccountHero';
import AccountCard from '../components/account/AccountCard';
import StatTriplet from '../components/account/StatTriplet';
import MasteryBar from '../components/account/MasteryBar';
import HskStatList from '../components/account/HskStatList';
import RecentQuizzes from '../components/account/RecentQuizzes';
import EditProfilePopup from '../components/account/EditProfilePopup';
import YourMentorsCard from '../components/teachers/YourMentorsCard';
import MyPacksCard from '../components/account/MyPacksCard';
import PurchasedPacksCard from '../components/account/PurchasedPacksCard';
import Popup from '../components/Popup';
import CoursePage from './CoursePage';
import { ErrorRetry } from '../components/ErrorRetry';
import { getAccount, getStudentClasses, leaveMentor, prefetchSettings } from '../api';
import { useT } from '../i18n';
import { COLORS, TAB_CLEARANCE } from '../theme';
import CatLoader from '../components/CatLoader';

// Tuile de stat d'utilisation (série, jours actifs…) en tête de la carte stats.
function UsageTile({ icon, value, label }) {
  return (
    <View style={{ flex: 1, backgroundColor: '#f6f8fb', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 12, alignItems: 'center' }}>
      <Text style={{ fontSize: 20 }}>{icon}</Text>
      <Text style={{ fontSize: 26, fontWeight: '800', color: '#111', lineHeight: 30, marginTop: 2 }}>{value}</Text>
      <Text style={{ fontSize: 11, color: '#999', marginTop: 2, textAlign: 'center' }}>{label}</Text>
    </View>
  );
}

export default function AccountScreen({ onLogout, onNavigate, onStartQuiz }) {
  const { t } = useT();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [classes, setClasses] = useState(null); // { mentors, tasks }
  const [leaving, setLeaving] = useState(null); // mentor à quitter
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [courseId, setCourseId] = useState(null); // task ouverte
  const { width } = useWindowDimensions();
  const isDesktop = width >= 992;

  // Swipe vers la GAUCHE → ouvre les réglages. On ne capture QUE les gestes
  // clairement horizontaux (sinon le scroll vertical de la page serait volé).
  const navRef = useRef(onNavigate);
  navRef.current = onNavigate;
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dx < -18 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
      onPanResponderRelease: (_, g) => {
        if (g.dx < -55 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4) navRef.current?.('settings');
      },
    })
  ).current;
  const hPad = isDesktop ? 24 : 16;

  const load = useCallback(async () => {
    setError('');
    try {
      const [acc, cls] = await Promise.all([getAccount(), getStudentClasses().catch(() => null)]);
      setData(acc);
      setClasses(cls);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  // Précharge les réglages en arrière-plan → slide vers Settings instantané.
  useEffect(() => { prefetchSettings(); }, []);

  async function confirmLeave() {
    if (!leaving) return;
    setLeaveBusy(true);
    try {
      await leaveMentor(leaving.id);
      setLeaving(null);
      load();
    } catch { /* noop */ } finally { setLeaveBusy(false); }
  }

  // Sous-vue : page d'un cours ouverte depuis une task
  if (courseId) {
    return <CoursePage lessonId={courseId} onBack={() => { setCourseId(null); load(); }} />;
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8f9fa' }}>
        <CatLoader size={110} />
      </View>
    );
  }
  if (error) {
    return <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}><ErrorRetry error={error} onRetry={load} /></View>;
  }

  const activeDays = (data.contributions || []).filter((c) => c.count > 0).length;
  const learningChinese = (data.learning_lang || (data.quizDirection !== 'zh→en' ? 'zh' : 'en')) === 'zh';
  const total = data.mastery?.total || 0;
  const pinyinDist = data.mastery?.pinyin || {};
  const charDist = data.mastery?.character || {};
  const readingDist = data.mastery?.reading || {};
  const pinyinPct = total > 0 ? Math.round(((pinyinDist.mastered || 0) / total) * 100) : 0;
  const charPct = total > 0 ? Math.round(((charDist.mastered || 0) / total) * 100) : 0;
  const readingPct = total > 0 ? Math.round(((readingDist.mastered || 0) / total) * 100) : 0;

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }} {...pan.panHandlers}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: TAB_CLEARANCE }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={COLORS.jiayou} />
        }
      >
        <AccountHero
          name={data.name}
          tagline={data.tagline}
          country={data.country}
          avatarIcon={data.avatar_icon}
          avatarColor={data.avatar_color}
          year={data.year}
          activeDays={activeDays}
          contributions={data.contributions}
          hPad={hPad}
          onEdit={() => setEditing(true)}
        />

        {/* Corps centré et borné à 1200px comme .account-layout de l'EJS */}
        <View style={{ width: '100%', maxWidth: 1200, alignSelf: 'center', paddingHorizontal: hPad, paddingVertical: 16 }}>
          <View style={isDesktop ? { flexDirection: 'row', alignItems: 'flex-start', gap: 24 } : null}>
            {/* ── Colonne gauche : Your info (sticky sur desktop) ── */}
            <View
              style={
                isDesktop
                  ? [{ flex: 4 }, Platform.OS === 'web' ? { position: 'sticky', top: 16 } : null]
                  : null
              }
            >
              <AccountCard icon="stats-chart-outline" title={t('ac_your_stats')}>
                {/* Stats d'utilisation en tête : mots connus + rang en duel */}
                <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
                  <UsageTile icon="📖" value={data.wordsKnown ?? 0} label={data.wordsKnown === 1 ? t('ac_word_known') : t('ac_words_known')} />
                  <UsageTile
                    icon="🏆"
                    value={data.duelRank ? `#${data.duelRank}` : '—'}
                    label={data.duelRank ? `${t('ac_duel_rank')} ${data.duelRankTotal}` : t('ac_unranked')}
                  />
                </View>

                <StatTriplet words={data.words} quizzes={data.quizzes} duels={data.duels} />

                <View style={{ marginTop: 16 }}>
                  {/* zh : Pinyin + Caractères + Lecture. non-zh : Écriture + Lecture. */}
                  <MasteryBar
                    dist={pinyinDist}
                    total={total}
                    caption={`${pinyinPct}% ${learningChinese ? t('ac_pinyin_mastered') : t('ac_writing_mastered')}`}
                  />
                  {learningChinese && (
                    <MasteryBar dist={charDist} total={total} caption={`${charPct}% ${t('ac_chars_mastered')}`} />
                  )}
                  <MasteryBar dist={readingDist} total={total} caption={`${readingPct}% ${t('ac_reading_mastered')}`} />
                </View>
              </AccountCard>
            </View>

            {/* ── Colonne droite : mentors + stats + quiz récents ── */}
            <View style={isDesktop ? { flex: 8 } : null}>
              {classes && classes.mentors && classes.mentors.length > 0 && (
                <YourMentorsCard
                  mentors={classes.mentors}
                  tasks={classes.tasks || []}
                  onLeave={(m) => setLeaving(m)}
                  onOpenTask={(t) => setCourseId(t.id)}
                />
              )}

              <AccountCard icon="search-outline" title={t('ac_stats_on_words')}>
                <HskStatList items={data.hsk} />
              </AccountCard>

              <AccountCard icon="time-outline" title={t('ac_recent_quizzes')} actionLabel={t('ac_start_new_quiz')} onPress={() => onNavigate?.('quiz')}>
                <RecentQuizzes quizzes={data.recentQuizzes} />
              </AccountCard>

              <MyPacksCard onNavigate={onNavigate} />
              <PurchasedPacksCard onStartQuiz={onStartQuiz} />
            </View>
          </View>

        </View>
      </ScrollView>

      <EditProfilePopup
        visible={editing}
        initial={{ name: data.name, tagline: data.tagline, country: data.country, avatar_icon: data.avatar_icon, avatar_color: data.avatar_color }}
        onClose={() => setEditing(false)}
        onSaved={(u) => setData((d) => ({ ...d, ...u }))}
      />

      {/* Quitter un prof */}
      <Popup visible={!!leaving} onClose={() => setLeaving(null)} maxWidth={380}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 }}>{t('ac_leave_title').replace('{name}', leaving?.name || '')}</Text>
        <Text style={{ fontSize: 14, color: COLORS.muted, lineHeight: 20, marginBottom: 20 }}>
          {t('ac_leave_body')}
        </Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Pressable onPress={() => setLeaving(null)} style={{ flex: 1, backgroundColor: '#f1f3f5', borderRadius: 999, paddingVertical: 13, alignItems: 'center' }}>
            <Text style={{ color: COLORS.muted, fontWeight: '700' }}>{t('common_cancel')}</Text>
          </Pressable>
          <Pressable onPress={confirmLeave} disabled={leaveBusy} style={{ flex: 1, backgroundColor: COLORS.danger, borderRadius: 999, paddingVertical: 13, alignItems: 'center' }}>
            {leaveBusy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>{t('ac_leave')}</Text>}
          </Pressable>
        </View>
      </Popup>
    </View>
  );
}
