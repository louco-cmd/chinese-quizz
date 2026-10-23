import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import Popup from '../../components/Popup';
import { ErrorRetry } from '../../components/ErrorRetry';
import CreateTaskPopup from './CreateTaskPopup';
import {
  teacherClass, teacherClassLessons, teacherRevokeStudent, teacherDeleteClass,
} from '../../api';
import { COLORS, SHADOW_CARD } from '../../theme';
import CatLoader from '../../components/CatLoader';

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
}

// Petite barre de progression bleue.
function Bar({ pct }) {
  return (
    <View className="h-2 rounded-full bg-[#eef2f8] overflow-hidden mt-1.5">
      <View style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', backgroundColor: COLORS.jiayou, borderRadius: 4 }} />
    </View>
  );
}

// Grande CTA en dégradé (Create task / Invite).
function GradientCta({ colors, icon, title, sub, onPress }) {
  return (
    <Pressable onPress={onPress} className="flex-1 active:opacity-90">
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 16, paddingVertical: 22, paddingHorizontal: 16, minHeight: 96, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={20} color="#fff" style={{ marginBottom: 6 }} />
        <Text className="text-white font-bold text-[15.5px] text-center">{title}</Text>
        <Text className="text-white/80 text-[12px] mt-0.5 text-center">{sub}</Text>
      </LinearGradient>
    </Pressable>
  );
}

export default function TeacherClassScreen({ classId, direction, onBack, onOpenTask }) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 992;
  const [data, setData] = useState(null);
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const [d, l] = await Promise.all([teacherClass(classId), teacherClassLessons(classId)]);
      setData(d); setLessons(l.lessons || []);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [classId]);
  useEffect(() => { load(); }, [load]);

  async function copyCode() {
    if (!data?.classroom?.join_code) return;
    try { await Clipboard.setStringAsync(data.classroom.join_code); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* ignore */ }
  }
  async function invite() {
    await copyCode();
    Alert.alert('', 'Class code copied — share it so students can join.');
  }
  function confirmRevoke(s) {
    Alert.alert('Remove student', `Remove ${s.name || 'this student'} from the class?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => { setRevoking(true); try { await teacherRevokeStudent(classId, s.id); await load(); } catch { /* ignore */ } finally { setRevoking(false); } } },
    ]);
  }
  async function doDelete() {
    setDeleting(true);
    try { await teacherDeleteClass(classId); onBack(true); } catch (e) { setError(e.message); setConfirmDel(false); } finally { setDeleting(false); }
  }

  if (loading) return <View className="flex-1 items-center justify-center bg-surface-page"><CatLoader size={110} /></View>;
  if (error && !data) return <View className="flex-1 bg-surface-page"><ErrorRetry error={error} onRetry={load} /></View>;

  const c = data.classroom;
  const students = data.students || [];

  // ── Colonne gauche : titre + code + élèves (progression) ────────────────────
  const sidebar = (
    <View className="bg-white rounded-2xl p-5" style={SHADOW_CARD}>
      <Text className="text-ink font-extrabold text-[20px] mb-3">{c.name}</Text>
      <View className="flex-row items-center justify-between bg-surface-page rounded-xl px-3 py-2 mb-3">
        <Text className="text-muted-light text-[12px]">Class code</Text>
        <View className="flex-row items-center gap-2">
          <Text className="font-extrabold text-jiayou tracking-[2px] text-[14px]">{c.join_code}</Text>
          <Pressable onPress={copyCode} hitSlop={8}><Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={15} color={COLORS.jiayou} /></Pressable>
        </View>
      </View>
      {students.length === 0 ? (
        <Text className="text-muted-light text-[12.5px] py-3 text-center">No students yet. Share the code!</Text>
      ) : students.map((s, i) => {
        const pct = Number(s.avg_score) || 0;
        return (
          <View key={s.id} className={`py-3 ${i === students.length - 1 ? '' : 'border-b border-line-soft'}`}>
            <View className="flex-row items-center gap-2.5">
              <View className="rounded-full bg-[#e7edf7] items-center justify-center" style={{ width: 34, height: 34 }}>
                <Text className="text-jiayou font-extrabold text-[12px]">{initials(s.name)}</Text>
              </View>
              <View className="flex-1 min-w-0">
                <Text className="text-ink font-bold text-[13.5px]" numberOfLines={1}>{s.name || 'Student'}</Text>
                <Text className="text-muted-light text-[11px]">{s.word_count} words</Text>
              </View>
              <Pressable onPress={() => confirmRevoke(s)} disabled={revoking} hitSlop={8} className="w-7 h-7 items-center justify-center">
                <Ionicons name="close" size={15} color="#c4c9d0" />
              </Pressable>
            </View>
            <Bar pct={pct} />
            <Text className="text-muted-light text-[10.5px] mt-1">{pct}% mastered words</Text>
          </View>
        );
      })}
    </View>
  );

  // ── Droite : 2 CTA + liste des tâches ───────────────────────────────────────
  const main = (
    <>
      <View className={isDesktop ? 'flex-row gap-4 mb-4' : 'mb-4'} style={!isDesktop ? { gap: 12 } : null}>
        <GradientCta colors={['#1a73ff', '#0a3fc4']} icon="rocket" title="Create task" sub="Summary + words for your students" onPress={() => setCreating(true)} />
        <GradientCta colors={['#7b2ff7', '#4b1d9e']} icon="cube" title="Invite to join the class" sub="Share the code with your students" onPress={invite} />
      </View>

      {lessons.length === 0 ? (
        <View className="items-center py-10"><Ionicons name="journal-outline" size={28} color="#c4c9d0" /><Text className="text-muted mt-2 text-[13px]">No tasks yet.</Text></View>
      ) : lessons.map((task) => {
        const k = Number(task.avg_knowledge) || 0;
        return (
          <View key={task.id} className="bg-white rounded-2xl px-4 py-3.5 mb-3" style={SHADOW_CARD}>
            <View className="flex-row items-center gap-3">
              <View className="rounded-full bg-jiayou-soft items-center justify-center" style={{ width: 38, height: 38 }}>
                <Ionicons name="journal" size={17} color={COLORS.jiayou} />
              </View>
              <View className="flex-1">
                <Text className="text-ink font-extrabold text-[15px]" numberOfLines={1}>{task.title}</Text>
                <Text className="text-muted-light text-[11.5px] mt-0.5">{new Date(task.created_at).toLocaleDateString()} · {task.word_count} word{task.word_count === 1 ? '' : 's'}</Text>
              </View>
              <Pressable onPress={() => onOpenTask(task.id)} className="bg-jiayou rounded-full px-4 py-2 active:opacity-90">
                <Text className="text-white font-bold text-[12.5px]">Open task</Text>
              </Pressable>
            </View>
            <Bar pct={k} />
            <Text className="text-muted-light text-[11px] mt-1">{k}% mastered by students</Text>
          </View>
        );
      })}

      <Pressable onPress={() => setConfirmDel(true)} className="flex-row items-center justify-center gap-2 mt-4 py-3">
        <Ionicons name="trash-outline" size={16} color={COLORS.danger} /><Text className="text-danger font-semibold text-[13.5px]">Delete this class</Text>
      </Pressable>
    </>
  );

  return (
    <View className="flex-1 bg-surface-page">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <View style={{ width: '100%', maxWidth: 1180, alignSelf: 'center' }}>
          <Pressable onPress={() => onBack(false)} hitSlop={10} className="flex-row items-center gap-1 mb-3">
            <Ionicons name="chevron-back" size={20} color={COLORS.muted} />
            <Text className="text-muted text-[14px]">Classes</Text>
          </Pressable>
          {isDesktop ? (
            <View className="flex-row items-start gap-6">
              <View style={{ width: 300 }}>{sidebar}</View>
              <View style={{ flex: 1 }}>{main}</View>
            </View>
          ) : (
            <>
              <View className="mb-4">{sidebar}</View>
              {main}
            </>
          )}
        </View>
      </ScrollView>

      <CreateTaskPopup visible={creating} classId={classId} direction={direction} onClose={() => setCreating(false)} onCreated={load} />

      <Popup visible={confirmDel} onClose={() => setConfirmDel(false)} maxWidth={400}>
        <Text className="text-[17px] font-bold text-ink mb-2">Delete class?</Text>
        <Text className="text-[14px] text-muted leading-5 mb-5">This permanently removes the class, its tasks and student links. This cannot be undone.</Text>
        <View className="flex-row gap-3">
          <Pressable onPress={() => setConfirmDel(false)} className="flex-1 bg-[#f1f3f5] rounded-xl py-3 items-center"><Text className="text-muted font-bold">Cancel</Text></Pressable>
          <Pressable onPress={doDelete} disabled={deleting} className="flex-1 bg-danger rounded-xl py-3 items-center">
            {deleting ? <ActivityIndicator color="#fff" size="small" /> : <Text className="text-white font-bold">Delete</Text>}
          </Pressable>
        </View>
      </Popup>
    </View>
  );
}
