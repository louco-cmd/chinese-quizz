import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, useWindowDimensions, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { ErrorRetry } from '../../components/ErrorRetry';
import { teacherOverview, teacherClasses, teacherCreateClass, getUpcomingSessions } from '../../api';
import { Modal, Button } from '../../ui';
import { COLORS, SHADOW_CARD } from '../../theme';
import CatLoader from '../../components/CatLoader';

function hhmm(d) { return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function fmtWhen(iso) {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dd = new Date(d); dd.setHours(0, 0, 0, 0);
  const prefix = dd.getTime() === today.getTime() ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'short' });
  return `${prefix} ${hhmm(d)}`;
}

export default function TeacherDashboardScreen({ teacherName, onOpenClass, onOpenAgenda, onVideoCall }) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 992;
  const [ov, setOv] = useState(null);
  const [classes, setClasses] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [cErr, setCErr] = useState('');
  const [copied, setCopied] = useState(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [o, c, u] = await Promise.all([teacherOverview(), teacherClasses(), getUpcomingSessions()]);
      setOv(o); setClasses(c.classrooms || []);
      setUpcoming((u.sessions || []).filter((x) => x.i_am_teacher).slice(0, 2));
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    if (!name.trim()) { setCErr('Class name required'); return; }
    setSaving(true); setCErr('');
    try { await teacherCreateClass(name.trim()); setCreating(false); setName(''); load(); }
    catch (e) { setCErr(e.message); } finally { setSaving(false); }
  }
  async function copyCode(code) {
    try { await Clipboard.setStringAsync(code); setCopied(code); setTimeout(() => setCopied(null), 1400); } catch { /* ignore */ }
  }

  if (loading) return <View className="flex-1 items-center justify-center bg-surface-page"><CatLoader size={110} /></View>;
  if (error) return <View className="flex-1 bg-surface-page"><ErrorRetry error={error} onRetry={load} /></View>;

  // ── Carte récap « My classes » : 4 stats (Students / Lessons / Revenue / Trend).
  //   Revenue = revenus générés CE MOIS (₵) agrégés depuis les transactions prof
  //   (cours donnés, part quiz élève, tâches finies, ventes de packs).
  //   Trend = variation vs mois N-1 (progression / régression) sur ces revenus.
  const revMonth = ov?.rev_month ?? 0;
  const revPrev = ov?.rev_prev ?? 0;
  // % de variation du revenu vs mois précédent. Prev = 0 → « New » si on a généré
  // quelque chose ce mois, sinon neutre.
  let trendStr = '—', trendColor = COLORS.mutedLight;
  if (revPrev > 0) {
    const pct = Math.round(((revMonth - revPrev) / revPrev) * 100);
    trendStr = `${pct > 0 ? '↑ +' : pct < 0 ? '↓ ' : ''}${pct}%`;
    trendColor = pct > 0 ? COLORS.success : pct < 0 ? COLORS.danger : COLORS.mutedLight;
  } else if (revMonth > 0) {
    trendStr = 'New'; trendColor = COLORS.success;
  }
  const stats = [
    { label: 'Students', value: ov?.students ?? 0, color: COLORS.success },
    { label: 'Lessons', value: ov?.tasks ?? 0, color: COLORS.danger },
    { label: 'Revenue', value: `${revMonth}₵`, color: COLORS.jiayou },
    { label: 'vs last month', value: trendStr, color: trendColor },
  ];
  const statsCard = (
    <View className="bg-white rounded-2xl p-5" style={SHADOW_CARD}>
      <View className="flex-row items-center gap-2 mb-4">
        <Ionicons name="stats-chart" size={16} color={COLORS.muted} />
        <Text className="text-ink font-extrabold text-[16px]">My classes</Text>
      </View>
      <View className="flex-row">
        {stats.map((s) => (
          <View key={s.label} className="flex-1 items-center px-1">
            <Text style={{ color: s.color, fontSize: 20, fontWeight: '800' }} numberOfLines={1}>{s.value}</Text>
            <Text className="text-muted-light text-[11px] mt-1 text-center" numberOfLines={1}>{s.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );

  // ── CTA : « Open a new class » (plein, bleu) + « Start next Lesson » (prochain cours).
  const next = upcoming[0];
  const nextJoinable = next
    ? (Date.now() >= new Date(next.starts_at).getTime() - 15 * 60000 && Date.now() <= new Date(next.ends_at).getTime() + 10 * 60000)
    : false;
  const ctaRow = (
    <View className="flex-row gap-3 mb-4" style={{ alignItems: 'stretch' }}>
      {/* Ouvrir une nouvelle classe → modal de création. */}
      <Pressable onPress={() => { setCErr(''); setName(''); setCreating(true); }} className="flex-1 active:opacity-90">
        <LinearGradient colors={['#1a73ff', '#0a3fc4']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, borderRadius: 16, paddingVertical: 18, paddingHorizontal: 14, minHeight: 104, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 34, height: 34, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
            <Ionicons name="add" size={22} color="#fff" />
          </View>
          <Text className="text-white font-bold text-[15px] text-center">Open a new class</Text>
          <Text className="text-white/80 text-[11.5px] mt-0.5 text-center">Invite a student on a new class</Text>
        </LinearGradient>
      </Pressable>

      {/* Démarrer le prochain cours : rejoint la visio si c'est l'heure, sinon agenda. */}
      <Pressable
        onPress={() => { if (next && nextJoinable) onVideoCall?.(next); else onOpenAgenda?.(); }}
        className="flex-1 active:opacity-90"
      >
        <View className="bg-white rounded-2xl p-4 flex-1 justify-center" style={[SHADOW_CARD, { minHeight: 104 }]}>
          <View className="flex-row items-center gap-1.5 mb-1.5">
            <Ionicons name={next ? 'videocam' : 'calendar-clear-outline'} size={15} color={next ? COLORS.jiayou : COLORS.mutedLight} />
            <Text className={next ? 'text-ink font-extrabold text-[13.5px]' : 'text-muted-light font-extrabold text-[13.5px]'}>{next ? 'Start next Lesson' : 'No upcoming class'}</Text>
          </View>
          {next ? (
            <>
              <Text className="text-muted text-[12px]" numberOfLines={1}>
                {fmtWhen(next.starts_at)} · {new Date(next.starts_at).toLocaleDateString()}
              </Text>
              <View className="self-start rounded-full px-2.5 py-1 mt-2" style={{ backgroundColor: COLORS.ink }}>
                <Text className="text-white font-bold text-[11px]" numberOfLines={1}>{next.other_name || next.student_name || 'Student'}</Text>
              </View>
            </>
          ) : null}
        </View>
      </Pressable>
    </View>
  );

  // ── Ligne de classe (avatar bleu + nom + élèves·tâches + code + détails) ─────
  const classRow = (c) => (
    <View key={c.id} className="bg-white rounded-2xl px-4 py-3.5 mb-3" style={SHADOW_CARD}>
      <View className="flex-row items-center gap-3">
        <View className="rounded-full items-center justify-center" style={{ width: 40, height: 40, backgroundColor: COLORS.jiayou }}>
          <Ionicons name="school" size={19} color="#fff" />
        </View>
        <View className="flex-1">
          <Text className="text-ink font-extrabold text-[15px]" numberOfLines={1}>{c.name}</Text>
          {c.student_names && c.student_names.length > 0 ? (
            <Text className="text-muted text-[12px] mt-0.5" numberOfLines={1}>{c.student_names.join(', ')}</Text>
          ) : null}
          <Text className="text-muted-light text-[12px] mt-0.5">
            {c.student_count} student{c.student_count === 1 ? '' : 's'} · {c.lesson_count} Task{c.lesson_count === 1 ? '' : 's'}
          </Text>
        </View>
      </View>
      <View className="flex-row items-center justify-between mt-3">
        <View className="flex-row items-center gap-1.5">
          <Text className="text-muted-light text-[11px]">Class code</Text>
          <Text className="font-extrabold text-jiayou tracking-[2px] text-[13px]">{c.join_code}</Text>
          <Pressable onPress={() => copyCode(c.join_code)} hitSlop={8} className="w-7 h-7 rounded-lg bg-jiayou-soft items-center justify-center">
            <Ionicons name={copied === c.join_code ? 'checkmark' : 'copy-outline'} size={14} color={COLORS.jiayou} />
          </Pressable>
        </View>
        <Pressable onPress={() => onOpenClass(c.id)} className="bg-jiayou rounded-full px-4 py-2 active:opacity-90">
          <Text className="text-white font-bold text-[12.5px]">See class details</Text>
        </Pressable>
      </View>
    </View>
  );

  const main = (
    <>
      {ctaRow}
      {classes.length === 0 ? (
        <View className="items-center py-10">
          <Ionicons name="easel-outline" size={30} color="#c4c9d0" />
          <Text className="text-muted mt-2 text-[13px]">No classes yet. Create your first one!</Text>
        </View>
      ) : classes.map(classRow)}
    </>
  );

  return (
    <View className="flex-1 bg-surface-page">
      <ScrollView contentContainerStyle={{ paddingVertical: 16 }}>
        <View style={{ width: '100%', maxWidth: 1180, alignSelf: 'center', paddingHorizontal: isDesktop ? 24 : 16 }}>
          {isDesktop ? (
            <View className="flex-row items-start gap-6">
              <View style={{ width: 340 }}>{statsCard}</View>
              <View style={{ flex: 1 }}>{main}</View>
            </View>
          ) : (
            <>
              <View className="mb-4">{statsCard}</View>
              {main}
            </>
          )}
        </View>
      </ScrollView>

      <Modal visible={creating} onClose={() => setCreating(false)} maxWidth={420}>
        <Text className="text-[17px] font-bold text-ink mb-3">New class</Text>
        <Text className="text-[13px] font-semibold text-muted mb-1.5">Class name</Text>
        <TextInput
          value={name} onChangeText={setName} maxLength={80} autoFocus
          placeholder="e.g. Beginner HSK1 — Tuesday" placeholderTextColor={COLORS.mutedLight}
          className="bg-surface-page border border-line rounded-xl px-3.5 h-12 text-[15px] text-ink"
        />
        {cErr ? <Text className="text-danger text-[13px] font-semibold mt-2">{cErr}</Text> : null}
        <View className="flex-row gap-3 mt-4">
          <Button title="Cancel" variant="secondary" onPress={() => setCreating(false)} style={{ flex: 1, justifyContent: 'center' }} />
          <Button title="Create" loading={saving} onPress={create} style={{ flex: 1, justifyContent: 'center' }} />
        </View>
      </Modal>
    </View>
  );
}
