import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, TextInput, useWindowDimensions, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import Popup from '../../components/Popup';
import { ErrorRetry } from '../../components/ErrorRetry';
import { teacherOverview, teacherClasses, teacherCreateClass, teacherStudents, getUpcomingSessions } from '../../api';
import { COLORS, SHADOW_CARD } from '../../theme';
import CatLoader from '../../components/CatLoader';

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
}
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
  const [students, setStudents] = useState([]);
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
      const [o, c, s, u] = await Promise.all([teacherOverview(), teacherClasses(), teacherStudents(), getUpcomingSessions()]);
      setOv(o); setClasses(c.classrooms || []); setStudents(s.students || []);
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

  // ── Colonne gauche : nom + liste des élèves + « See calendar » ──────────────
  const sidebar = (
    <View className="bg-white rounded-2xl p-5" style={SHADOW_CARD}>
      <Text className="text-ink font-extrabold text-[20px] mb-4">{teacherName || 'Teacher'}</Text>
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-ink font-bold text-[15px]">Students</Text>
        <Text className="text-muted-light font-bold text-[14px]">{students.length}</Text>
      </View>
      {students.length === 0 ? (
        <Text className="text-muted-light text-[12.5px] py-3">No students yet — invite them from a class.</Text>
      ) : students.map((s) => (
        <View key={s.id} className="flex-row items-center gap-2.5 py-2">
          <View className="rounded-full bg-[#e7edf7] items-center justify-center" style={{ width: 34, height: 34 }}>
            <Text className="text-jiayou font-extrabold text-[12px]">{initials(s.name)}</Text>
          </View>
          <View className="flex-1">
            <Text className="text-ink font-bold text-[13.5px]" numberOfLines={1}>{s.name || 'Student'}</Text>
            <Text className="text-muted-light text-[11px]">{s.class_count} class{s.class_count === 1 ? '' : 'es'} · {s.word_count} words</Text>
          </View>
        </View>
      ))}
      <Pressable onPress={onOpenAgenda} className="bg-jiayou rounded-full py-3 items-center mt-4 active:opacity-90">
        <Text className="text-white font-bold text-[14px]">See calendar</Text>
      </Pressable>
    </View>
  );

  // ── Haut droite : CTA nouvelle classe + mini-carte « Next lesson » ──────────
  const topRow = (
    <View className={isDesktop ? 'flex-row gap-4 mb-4' : 'mb-4'}>
      <Pressable onPress={() => { setCErr(''); setName(''); setCreating(true); }} className={`active:opacity-90 ${isDesktop ? 'flex-1' : 'mb-3'}`}>
        <LinearGradient colors={['#1a73ff', '#0a3fc4']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 16, paddingVertical: 22, paddingHorizontal: 16, minHeight: 92, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="rocket" size={20} color="#fff" style={{ marginBottom: 6 }} />
          <Text className="text-white font-bold text-[16px]">Open a new class</Text>
          <Text className="text-white/80 text-[12.5px] mt-0.5">Invite students to a new class</Text>
        </LinearGradient>
      </Pressable>
      <View className="bg-white rounded-2xl p-4" style={[SHADOW_CARD, isDesktop ? { width: 260 } : null]}>
        <Text className="text-ink font-extrabold text-[14px] mb-2">Next lesson</Text>
        {upcoming.length === 0 ? (
          <Text className="text-muted-light text-[12.5px]">No upcoming lesson.</Text>
        ) : upcoming.map((u) => {
          const now = Date.now();
          const st = new Date(u.starts_at).getTime(), en = new Date(u.ends_at).getTime();
          const joinable = now >= st - 15 * 60000 && now <= en + 10 * 60000;
          const started = now >= st;
          const trial = (u.note || '').toLowerCase() === 'trial';
          return (
            <View key={u.id} className="flex-row items-center justify-between py-1.5">
              <View className="flex-row items-center gap-1.5">
                <Text className="text-ink text-[13px] font-semibold">{fmtWhen(u.starts_at)}</Text>
                {trial ? (
                  <View className="bg-[#fff4e5] rounded px-1.5 py-0.5">
                    <Text className="text-[#c77700] font-extrabold text-[9px]">TRIAL</Text>
                  </View>
                ) : null}
              </View>
              {joinable ? (
                <Pressable onPress={() => onVideoCall?.(u.id)} className="bg-jiayou rounded-full px-3 py-1.5">
                  <Text className="text-white font-bold text-[11.5px]">{started ? 'Rejoin' : 'Start class'}</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );

  // ── Ligne de classe ─────────────────────────────────────────────────────────
  const classRow = (c) => (
    <View key={c.id} className="bg-white rounded-2xl px-4 py-3.5 mb-3" style={SHADOW_CARD}>
      <View className="flex-row items-center gap-3">
        <View className="rounded-full bg-jiayou-soft items-center justify-center" style={{ width: 38, height: 38 }}>
          <Ionicons name="easel" size={18} color={COLORS.jiayou} />
        </View>
        <View className="flex-1">
          <Text className="text-ink font-extrabold text-[15px]" numberOfLines={1}>{c.name}</Text>
          <Text className="text-muted-light text-[12px] mt-0.5">
            {c.student_count} student{c.student_count === 1 ? '' : 's'} · {c.lesson_count} task{c.lesson_count === 1 ? '' : 's'}
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
      {topRow}
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
              <View style={{ width: 300 }}>{sidebar}</View>
              <View style={{ flex: 1 }}>{main}</View>
            </View>
          ) : (
            <>
              {main}
              <View className="mt-2">{sidebar}</View>
            </>
          )}
        </View>
      </ScrollView>

      <Popup visible={creating} onClose={() => setCreating(false)} maxWidth={420}>
        <Text className="text-[17px] font-bold text-ink mb-3">New class</Text>
        <Text className="text-[13px] font-semibold text-muted mb-1.5">Class name</Text>
        <TextInput
          value={name} onChangeText={setName} maxLength={80} autoFocus
          placeholder="e.g. Beginner HSK1 — Tuesday" placeholderTextColor={COLORS.mutedLight}
          className="bg-surface-page border border-line rounded-xl px-3.5 h-12 text-[15px] text-ink"
        />
        {cErr ? <Text className="text-danger text-[13px] font-semibold mt-2">{cErr}</Text> : null}
        <View className="flex-row gap-3 mt-4">
          <Pressable onPress={() => setCreating(false)} className="flex-1 bg-[#f1f3f5] rounded-xl py-3 items-center"><Text className="text-muted font-bold">Cancel</Text></Pressable>
          <Pressable onPress={create} disabled={saving} className="flex-1 bg-jiayou rounded-xl py-3 items-center">
            {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text className="text-white font-bold">Create</Text>}
          </Pressable>
        </View>
      </Popup>
    </View>
  );
}
