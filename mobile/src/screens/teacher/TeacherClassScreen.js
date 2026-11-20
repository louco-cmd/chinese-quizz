import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, Alert, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { ErrorRetry } from '../../components/ErrorRetry';
import CreateTaskPopup from './CreateTaskPopup';
import {
  teacherClass, teacherClassLessons, teacherRevokeStudent, teacherDeleteClass,
} from '../../api';
import { Modal, Button, ProgressBar } from '../../ui';
import { COLORS, SHADOW_CARD } from '../../theme';
import CatLoader from '../../components/CatLoader';

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
}
function hhmm(d) { return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
// Fenêtre de visio : jouable de 15 min avant à 10 min après la fin.
function lessonJoinable(l) {
  const now = Date.now();
  const s = new Date(l.starts_at).getTime(), e = new Date(l.ends_at).getTime();
  return now >= s - 15 * 60000 && now <= e + 10 * 60000;
}

// Petite barre de progression bleue (primitive ProgressBar).
function Bar({ pct }) {
  return <ProgressBar value={Math.max(0, Math.min(100, pct))} max={100} height={8} color={COLORS.jiayou} track="#eef2f8" style={{ marginTop: 6 }} />;
}

export default function TeacherClassScreen({ classId, direction, onBack, onOpenTask, onVideoCall }) {
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

  // ── Haut : « Create a task » (dégradé) + « Start next Lesson » (prochain cours)
  const next = data.next_lesson;
  const nextJoinable = next ? lessonJoinable(next) : false;
  const nextDate = next ? (() => { const s = new Date(next.starts_at); try { return s.toLocaleDateString(); } catch { return ''; } })() : '';
  const topCards = (
    <View className="flex-row mb-4" style={{ gap: 12, alignItems: 'stretch' }}>
      {/* Créer une task → partage résumé + mots aux élèves. */}
      <Pressable onPress={() => setCreating(true)} className="flex-1 active:opacity-90">
        <LinearGradient colors={['#1a73ff', '#0a3fc4']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, borderRadius: 16, paddingVertical: 20, paddingHorizontal: 14, minHeight: 112, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="checkmark-circle" size={26} color="#fff" style={{ marginBottom: 7 }} />
          <Text className="text-white font-extrabold text-[15px] text-center">Create a task</Text>
          <Text className="text-white/80 text-[11.5px] mt-0.5 text-center">To share to your students</Text>
        </LinearGradient>
      </Pressable>

      {/* Prochain cours : démarre la visio si c'est l'heure, sinon informatif. */}
      <Pressable onPress={() => { if (next && nextJoinable) onVideoCall?.(next); }} className="flex-1 active:opacity-90">
        <View className="bg-white rounded-2xl p-4 flex-1 justify-center items-center" style={[SHADOW_CARD, { minHeight: 112 }]}>
          <Ionicons name={next ? 'videocam' : 'calendar-clear-outline'} size={22} color={next ? COLORS.jiayou : COLORS.mutedLight} style={{ marginBottom: 5 }} />
          <Text className={next ? 'text-ink font-extrabold text-[14.5px] text-center' : 'text-muted-light font-extrabold text-[14.5px] text-center'}>{next ? 'Start next Lesson' : 'No upcoming class'}</Text>
          {next ? (
            <>
              <Text className="text-muted text-[12px] mt-0.5" numberOfLines={1}>{hhmm(new Date(next.starts_at))} · {nextDate}</Text>
              {next.student_name ? (
                <View className="self-center rounded-full px-2.5 py-1 mt-2" style={{ backgroundColor: COLORS.ink }}>
                  <Text className="text-white font-bold text-[11px]" numberOfLines={1}>{next.student_name}</Text>
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      </Pressable>
    </View>
  );

  // ── Liste des tasks : icône · titre + pill « N words » · « X% Completed » + barre · chevron
  const taskList = lessons.length === 0 ? (
    <View className="items-center py-10"><Ionicons name="journal-outline" size={28} color="#c4c9d0" /><Text className="text-muted mt-2 text-[13px]">No tasks yet.</Text></View>
  ) : lessons.map((task) => {
    const k = Number(task.avg_knowledge) || 0;
    return (
      <Pressable key={task.id} onPress={() => onOpenTask(task.id)} className="bg-white rounded-2xl px-4 py-3.5 mb-3 flex-row items-center gap-3 active:opacity-90" style={SHADOW_CARD}>
        <View className="rounded-full bg-jiayou-soft items-center justify-center" style={{ width: 40, height: 40 }}>
          <Ionicons name="checkmark-circle" size={20} color={COLORS.jiayou} />
        </View>
        <View className="flex-1 min-w-0">
          <View className="flex-row items-center gap-2">
            <Text className="text-ink font-extrabold text-[15px] shrink" numberOfLines={1}>{task.title}</Text>
            <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: COLORS.jiayou }}>
              <Text className="text-white font-bold text-[10.5px]">{task.word_count} word{task.word_count === 1 ? '' : 's'}</Text>
            </View>
          </View>
          <View className="flex-row items-center gap-2 mt-1.5">
            <Text className="text-muted-light text-[11px]" style={{ width: 86 }} numberOfLines={1}>{k}% Completed</Text>
            <View className="flex-1"><ProgressBar value={k} max={100} height={6} color={COLORS.jiayou} track="#eef2f8" /></View>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#c4c9d0" />
      </Pressable>
    );
  });

  const deleteBtn = (
    <Pressable onPress={() => setConfirmDel(true)} className="flex-row items-center justify-center gap-2 mt-4 py-3">
      <Ionicons name="trash-outline" size={16} color={COLORS.danger} /><Text className="text-danger font-semibold text-[13.5px]">Delete this class</Text>
    </Pressable>
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
            // Desktop : élèves/code en colonne gauche, contenu (CTA + tasks) à droite.
            <View className="flex-row items-start gap-6">
              <View style={{ width: 300 }}>{sidebar}</View>
              <View style={{ flex: 1 }}>{topCards}{taskList}{deleteBtn}</View>
            </View>
          ) : (
            // Mobile (Figma) : CTA + tasks en premier ; la carte élèves/code reste
            // sous la liste pour garder la progression par élève + le code d'invit.
            <>
              {topCards}
              {taskList}
              <View className="mt-1 mb-1">{sidebar}</View>
              {deleteBtn}
            </>
          )}
        </View>
      </ScrollView>

      <CreateTaskPopup visible={creating} classId={classId} direction={direction} onClose={() => setCreating(false)} onCreated={load} />

      <Modal visible={confirmDel} onClose={() => setConfirmDel(false)} maxWidth={400}>
        <Text className="text-[17px] font-bold text-ink mb-2">Delete class?</Text>
        <Text className="text-[14px] text-muted leading-5 mb-5">This permanently removes the class, its tasks and student links. This cannot be undone.</Text>
        <View className="flex-row gap-3">
          <Button title="Cancel" variant="secondary" onPress={() => setConfirmDel(false)} style={{ flex: 1, justifyContent: 'center' }} />
          <Button title="Delete" variant="danger" loading={deleting} onPress={doDelete} style={{ flex: 1, justifyContent: 'center' }} />
        </View>
      </Modal>
    </View>
  );
}
