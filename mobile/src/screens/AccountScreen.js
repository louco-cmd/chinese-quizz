import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl, ActivityIndicator, Platform, useWindowDimensions } from 'react-native';
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
import { getAccount, getStudentClasses, leaveMentor } from '../api';
import { COLORS, TAB_CLEARANCE } from '../theme';

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

// Streak courant : jours consécutifs de pratique jusqu'à aujourd'hui (ou hier si
// rien fait aujourd'hui, pour ne pas casser la série avant la fin de journée).
function currentStreak(contribs) {
  const active = new Set((contribs || []).filter((c) => c.count > 0).map((c) => c.date));
  const key = (d) => d.toISOString().split('T')[0];
  const d = new Date(); d.setHours(0, 0, 0, 0);
  if (!active.has(key(d))) {
    d.setDate(d.getDate() - 1);
    if (!active.has(key(d))) return 0;
  }
  let n = 0;
  while (active.has(key(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

export default function AccountScreen({ onLogout, onNavigate, onStartQuiz }) {
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
        <ActivityIndicator color={COLORS.jiayou} />
      </View>
    );
  }
  if (error) {
    return <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}><ErrorRetry error={error} onRetry={load} /></View>;
  }

  const activeDays = (data.contributions || []).filter((c) => c.count > 0).length;
  const streak = currentStreak(data.contributions);
  const learningChinese = data.quizDirection !== 'zh→en';
  const total = data.mastery?.total || 0;
  const pinyinDist = data.mastery?.pinyin || {};
  const charDist = data.mastery?.character || {};
  const pinyinPct = total > 0 ? Math.round(((pinyinDist.mastered || 0) / total) * 100) : 0;
  const charPct = total > 0 ? Math.round(((charDist.mastered || 0) / total) * 100) : 0;

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
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
          year={data.year}
          activeDays={activeDays}
          contributions={data.contributions}
          hPad={hPad}
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
              <AccountCard icon="stats-chart-outline" title="Your statistics" actionLabel="Edit personal info" onPress={() => setEditing(true)}>
                {/* Stats d'utilisation en tête : série en cours + jours actifs */}
                <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
                  <UsageTile icon="🔥" value={streak} label={streak === 1 ? 'day streak' : 'day streak'} />
                  <UsageTile icon="📅" value={activeDays} label={`active ${activeDays === 1 ? 'day' : 'days'} in ${data.year}`} />
                </View>

                <StatTriplet words={data.words} quizzes={data.quizzes} duels={data.duels} />

                <View style={{ marginTop: 16 }}>
                  <MasteryBar
                    dist={pinyinDist}
                    total={total}
                    caption={`${pinyinPct}% ${learningChinese ? 'pinyin mastered' : 'of words mastered'}`}
                  />
                  {learningChinese && (
                    <MasteryBar dist={charDist} total={total} caption={`${charPct}% characters mastered`} />
                  )}
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

              <AccountCard icon="search-outline" title="Statistics on words">
                <HskStatList items={data.hsk} />
              </AccountCard>

              <AccountCard icon="time-outline" title="Recent quizzes" actionLabel="Start a new quiz" onPress={() => onNavigate?.('quiz')}>
                <RecentQuizzes quizzes={data.recentQuizzes} />
              </AccountCard>

              <MyPacksCard onNavigate={onNavigate} />
              <PurchasedPacksCard onStartQuiz={onStartQuiz} />
            </View>
          </View>

          {/* ── Log out ── */}
          <Pressable
            onPress={onLogout}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              paddingVertical: 14, marginTop: 4,
            }}
          >
            <Ionicons name="log-out-outline" size={18} color={COLORS.danger} />
            <Text style={{ color: COLORS.danger, fontWeight: '600' }}>Log out</Text>
          </Pressable>
        </View>
      </ScrollView>

      <EditProfilePopup
        visible={editing}
        initial={{ name: data.name, tagline: data.tagline, country: data.country }}
        onClose={() => setEditing(false)}
        onSaved={(u) => setData((d) => ({ ...d, ...u }))}
      />

      {/* Quitter un prof */}
      <Popup visible={!!leaving} onClose={() => setLeaving(null)} maxWidth={380}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 }}>Leave {leaving?.name}?</Text>
        <Text style={{ fontSize: 14, color: COLORS.muted, lineHeight: 20, marginBottom: 20 }}>
          You'll be removed from this teacher's classes and tasks. You can rejoin later with the class code.
        </Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Pressable onPress={() => setLeaving(null)} style={{ flex: 1, backgroundColor: '#f1f3f5', borderRadius: 999, paddingVertical: 13, alignItems: 'center' }}>
            <Text style={{ color: COLORS.muted, fontWeight: '700' }}>Cancel</Text>
          </Pressable>
          <Pressable onPress={confirmLeave} disabled={leaveBusy} style={{ flex: 1, backgroundColor: COLORS.danger, borderRadius: 999, paddingVertical: 13, alignItems: 'center' }}>
            {leaveBusy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Leave</Text>}
          </Pressable>
        </View>
      </Popup>
    </View>
  );
}
