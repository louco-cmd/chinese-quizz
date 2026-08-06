import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import Popup from '../../components/Popup';
import CtaCard from '../../components/duels/CtaCard';
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
function scoreStyle(s) {
  if (s >= 75) return { bg: '#d4edda', fg: '#198754' };
  if (s >= 50) return { bg: '#fff3cd', fg: '#997404' };
  return { bg: '#f8d7da', fg: '#dc3545' };
}

export default function TeacherClassScreen({ classId, direction, onBack, onOpenTask }) {
  const [data, setData] = useState(null);
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [studentsOpen, setStudentsOpen] = useState(true);
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
  async function revoke(studentId) {
    setRevoking(true);
    try { await teacherRevokeStudent(classId, studentId); await load(); } catch { /* ignore */ } finally { setRevoking(false); }
  }
  async function doDelete() {
    setDeleting(true);
    try { await teacherDeleteClass(classId); onBack(true); } catch (e) { setError(e.message); setConfirmDel(false); } finally { setDeleting(false); }
  }

  if (loading) return <View className="flex-1 items-center justify-center bg-surface-page"><CatLoader size={110} /></View>;
  if (error && !data) return <View className="flex-1 bg-surface-page"><ErrorRetry error={error} onRetry={load} /></View>;

  const c = data.classroom;
  const students = data.students || [];

  return (
    <View className="flex-1 bg-surface-page">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <View style={{ width: '100%', maxWidth: 820, alignSelf: 'center' }}>
          <Pressable onPress={() => onBack(false)} hitSlop={10} className="flex-row items-center gap-1 mb-3">
            <Ionicons name="chevron-back" size={20} color={COLORS.muted} />
            <Text className="text-muted text-[14px]">Classes</Text>
          </Pressable>

          {/* Carte classe + code */}
          <View className="bg-white rounded-2xl p-5 mb-4" style={SHADOW_CARD}>
            <View className="flex-row items-center justify-between flex-wrap gap-2">
              <Text className="text-jiayou font-extrabold text-[19px] flex-1">{c.name}</Text>
              <View className="flex-row items-center gap-2">
                <Text className="font-extrabold text-jiayou bg-surface-page border border-dashed border-[#a9c0e8] px-3 py-1 rounded-lg tracking-[3px]">{c.join_code}</Text>
                <Pressable onPress={copyCode} hitSlop={8} className="w-9 h-9 rounded-lg bg-jiayou-soft items-center justify-center">
                  <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={COLORS.jiayou} />
                </Pressable>
              </View>
            </View>
          </View>

          {/* Élèves (repliable) */}
          <View className="bg-white rounded-2xl mb-4 overflow-hidden" style={SHADOW_CARD}>
            <Pressable onPress={() => setStudentsOpen((o) => !o)} className="flex-row items-center justify-between px-4 py-3.5 border-b border-line-soft">
              <View className="flex-row items-center gap-2">
                <Ionicons name="people" size={18} color={COLORS.jiayou} />
                <Text className="font-bold text-[#444] text-[15px]">Students ({students.length})</Text>
              </View>
              <Ionicons name={studentsOpen ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.muted} />
            </Pressable>
            {studentsOpen ? (
              students.length === 0 ? (
                <Text className="text-muted text-[13px] text-center py-6">No students yet. Share the code!</Text>
              ) : (
                students.map((s, i) => {
                  const st = scoreStyle(Number(s.avg_score) || 0);
                  return (
                    <View key={s.id} className={`flex-row items-center gap-3 px-4 py-3 ${i === students.length - 1 ? '' : 'border-b border-line-soft'}`}>
                      <View className="w-10 h-10 rounded-full bg-[#e7edf7] items-center justify-center"><Text className="text-jiayou font-extrabold text-[13px]">{initials(s.name)}</Text></View>
                      <View className="flex-1 min-w-0">
                        <Text className="font-bold text-ink text-[14px]" numberOfLines={1}>{s.name || 'Student'}</Text>
                        <View className="flex-row items-center gap-1.5 mt-0.5">
                          <View style={{ backgroundColor: st.bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 }}><Text style={{ color: st.fg, fontWeight: '700', fontSize: 11 }}>{Number(s.avg_score) || 0}%</Text></View>
                          <Text className="text-muted-light text-[12px]">· {s.word_count} words</Text>
                        </View>
                      </View>
                      <Pressable onPress={() => revoke(s.id)} disabled={revoking} className="border border-line rounded-lg px-2.5 py-1.5"><Text className="text-danger text-[12px] font-semibold">Revoke</Text></Pressable>
                    </View>
                  );
                })
              )
            ) : null}
          </View>

          {/* Create a task : grand bouton dégradé (même composant que les CTA quiz élève) */}
          <View className="flex-row mb-4">
            <CtaCard
              colors={['#0d6efd', '#0a58ca']}
              icon="journal"
              title="Create a task"
              text="Summary + words for your students"
              onPress={() => setCreating(true)}
            />
          </View>

          {/* Tasks (grille 2 colonnes, cartes carrées) */}
          <Text className="font-bold text-[#444] text-[15px] mb-2.5">Tasks ({lessons.length})</Text>
          {lessons.length === 0 ? (
            <View className="items-center py-8"><Ionicons name="journal-outline" size={28} color="#c4c9d0" /><Text className="text-muted mt-2 text-[13px]">No tasks yet.</Text></View>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 }}>
              {lessons.map((t) => {
                const k = Number(t.avg_knowledge) || 0;
                return (
                  <Pressable key={t.id} onPress={() => onOpenTask(t.id)} style={{ width: '48.5%', ...SHADOW_CARD }} className="bg-white rounded-2xl p-3.5 active:opacity-95">
                    <Text className="font-bold text-jiayou text-[14.5px]" numberOfLines={2}>{t.title}</Text>
                    <Text className="text-muted-light text-[11px] mt-1" numberOfLines={1}>{t.word_count} word{t.word_count === 1 ? '' : 's'} · {new Date(t.created_at).toLocaleDateString()}</Text>
                    <Text className="text-muted-light text-[10px] uppercase tracking-wide mt-2.5">Class knowledge</Text>
                    <View className="h-2 rounded-full bg-[#eef2f8] overflow-hidden mt-1"><View style={{ width: `${k}%`, height: '100%', backgroundColor: COLORS.jiayou, borderRadius: 4 }} /></View>
                    <Text className="text-jiayou font-extrabold text-[13px] mt-1 text-right">{k}%</Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          {/* Danger */}
          <Pressable onPress={() => setConfirmDel(true)} className="flex-row items-center justify-center gap-2 mt-4 py-3">
            <Ionicons name="trash-outline" size={16} color={COLORS.danger} /><Text className="text-danger font-semibold text-[13.5px]">Delete this class</Text>
          </Pressable>
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
