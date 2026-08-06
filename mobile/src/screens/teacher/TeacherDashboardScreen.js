import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, TextInput, Platform, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import Popup from '../../components/Popup';
import { ErrorRetry } from '../../components/ErrorRetry';
import { teacherOverview, teacherClasses, teacherCreateClass } from '../../api';
import { COLORS, SHADOW_CARD } from '../../theme';
import CatLoader from '../../components/CatLoader';

function StatPill({ n, label, wide }) {
  return (
    <View className={`bg-surface-page border border-line-soft rounded-xl py-2.5 px-1.5 items-center ${wide ? 'w-full' : 'flex-1'}`}>
      <Text className="text-jiayou font-extrabold text-[20px] leading-none">{n}</Text>
      <Text className="text-muted-light text-[10px] uppercase tracking-wide mt-1 text-center">{label}</Text>
    </View>
  );
}

export default function TeacherDashboardScreen({ teacherName, onOpenClass }) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 992;
  const [ov, setOv] = useState(null);
  const [classes, setClasses] = useState([]);
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
      const [o, c] = await Promise.all([teacherOverview(), teacherClasses()]);
      setOv(o); setClasses(c.classrooms || []);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    if (!name.trim()) { setCErr('Class name required'); return; }
    setSaving(true); setCErr('');
    try {
      await teacherCreateClass(name.trim());
      setCreating(false); setName('');
      load();
    } catch (e) { setCErr(e.message); } finally { setSaving(false); }
  }

  async function copyCode(code) {
    try { await Clipboard.setStringAsync(code); setCopied(code); setTimeout(() => setCopied(null), 1400); } catch { /* ignore */ }
  }

  if (loading) return <View className="flex-1 items-center justify-center bg-surface-page"><CatLoader size={110} /></View>;
  if (error) return <View className="flex-1 bg-surface-page"><ErrorRetry error={error} onRetry={load} /></View>;

  const statsCard = (
    <View className="bg-white rounded-2xl p-5" style={SHADOW_CARD}>
      <Text className="text-jiayou font-extrabold text-[17px]">{teacherName || 'Teacher'}</Text>
      <Text className="text-muted-light text-[12px] mb-3">Your teaching at a glance</Text>
      <View className="flex-row gap-2 mb-2">
        <StatPill n={ov?.classes ?? 0} label="Classes" />
        <StatPill n={ov?.students ?? 0} label="Students" />
        <StatPill n={ov?.tasks ?? 0} label="Tasks" />
      </View>
      <StatPill n={`${ov?.avg_knowledge ?? 0}%`} label="Student average knowledge" wide />
    </View>
  );

  const rightColumn = (
    <>
      {/* New class CTA */}
      <Pressable onPress={() => { setCErr(''); setName(''); setCreating(true); }} className="mb-4 active:opacity-90">
        <LinearGradient colors={['#0d6efd', '#0a58ca']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 16, paddingVertical: 18, paddingHorizontal: 16 }}>
          <Ionicons name="arrow-forward-circle" size={20} color="rgba(255,255,255,0.7)" style={{ position: 'absolute', top: 10, right: 12 }} />
          <View className="items-center">
            <Text className="text-white font-bold text-[17px]">New class</Text>
            <Text className="text-white/80 text-[13px] mt-0.5">Create a class and invite students</Text>
          </View>
        </LinearGradient>
      </Pressable>

      {classes.length === 0 ? (
        <View className="items-center py-10">
          <Ionicons name="easel-outline" size={30} color="#c4c9d0" />
          <Text className="text-muted mt-2 text-[13px]">No classes yet. Create your first one!</Text>
        </View>
      ) : (
        classes.map((c) => (
          <Pressable key={c.id} onPress={() => onOpenClass(c.id)} className="bg-white rounded-2xl p-4 mb-3 active:opacity-95" style={SHADOW_CARD}>
            <View className="flex-row items-start justify-between">
              <Text className="text-jiayou font-extrabold text-[17px] flex-1 pr-2">{c.name}</Text>
              <Ionicons name="chevron-forward" size={18} color="#9aa4b2" />
            </View>
            <View className="flex-row flex-wrap gap-2 mt-2.5">
              <View className="bg-jiayou-soft border border-[#dbe3f1] rounded-full px-3 py-1"><Text className="text-[12px] text-[#5a6b8a]"><Text className="text-jiayou font-bold">{c.student_count}</Text> student{c.student_count === 1 ? '' : 's'}</Text></View>
              <View className="bg-jiayou-soft border border-[#dbe3f1] rounded-full px-3 py-1"><Text className="text-[12px] text-[#5a6b8a]"><Text className="text-jiayou font-bold">{c.lesson_count}</Text> task{c.lesson_count === 1 ? '' : 's'}</Text></View>
            </View>
            <View className="flex-row items-center gap-2 mt-3">
              <Text className="font-extrabold text-jiayou bg-surface-page border border-dashed border-[#a9c0e8] px-3 py-1 rounded-lg tracking-[3px]">{c.join_code}</Text>
              <Pressable onPress={() => copyCode(c.join_code)} hitSlop={8} className="w-9 h-9 rounded-lg bg-jiayou-soft items-center justify-center">
                <Ionicons name={copied === c.join_code ? 'checkmark' : 'copy-outline'} size={16} color={COLORS.jiayou} />
              </Pressable>
            </View>
          </Pressable>
        ))
      )}
    </>
  );

  return (
    <View className="flex-1 bg-surface-page">
      <ScrollView contentContainerStyle={{ paddingVertical: 16 }}>
        <View style={{ width: '100%', maxWidth: 1100, alignSelf: 'center', paddingHorizontal: isDesktop ? 24 : 16 }}>
          {isDesktop ? (
            <View className="flex-row items-start gap-6">
              <View style={[{ flex: 4 }, Platform.OS === 'web' ? { position: 'sticky', top: 16 } : null]}>{statsCard}</View>
              <View style={{ flex: 8 }}>{rightColumn}</View>
            </View>
          ) : (
            <>
              <View className="mb-4">{statsCard}</View>
              {rightColumn}
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
