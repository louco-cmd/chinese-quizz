import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Popup from '../../components/Popup';
import { ErrorRetry } from '../../components/ErrorRetry';
import { teacherLessonProgress, teacherDeleteLesson } from '../../api';
import { COLORS, SHADOW_CARD } from '../../theme';

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
}

export default function TeacherTaskScreen({ lessonId, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try { setData(await teacherLessonProgress(lessonId)); } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [lessonId]);
  useEffect(() => { load(); }, [load]);

  async function doDelete() {
    setDeleting(true);
    try { await teacherDeleteLesson(lessonId); onBack(true); } catch (e) { setError(e.message); setConfirmDel(false); } finally { setDeleting(false); }
  }

  if (loading) return <View className="flex-1 items-center justify-center bg-surface-page"><ActivityIndicator color={COLORS.jiayou} /></View>;
  if (error && !data) return <View className="flex-1 bg-surface-page"><ErrorRetry error={error} onRetry={load} /></View>;

  const { lesson, words = [], students = [] } = data;

  return (
    <View className="flex-1 bg-surface-page">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <View style={{ width: '100%', maxWidth: 820, alignSelf: 'center' }}>
          <Pressable onPress={() => onBack(false)} hitSlop={10} className="flex-row items-center gap-1 mb-3">
            <Ionicons name="chevron-back" size={20} color={COLORS.muted} />
            <Text className="text-muted text-[14px]">Back to class</Text>
          </Pressable>

          {/* Panneau task */}
          <View className="bg-white rounded-2xl p-5 mb-4" style={SHADOW_CARD}>
            <View className="flex-row items-start justify-between gap-2">
              <Text className="text-jiayou font-extrabold text-[20px] flex-1">{lesson.title}</Text>
              <Pressable onPress={() => setConfirmDel(true)} hitSlop={8} className="border border-[#f3d2d2] rounded-lg w-9 h-9 items-center justify-center">
                <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
              </Pressable>
            </View>
            <Text className="text-muted-light text-[12px] mt-1">{new Date(lesson.created_at).toLocaleDateString()} · {words.length} word{words.length === 1 ? '' : 's'}</Text>
            {lesson.summary ? <Text className="text-[#495267] text-[14px] mt-2 leading-5">{lesson.summary}</Text> : null}
            <View className="flex-row flex-wrap gap-2 mt-3">
              {words.length === 0 ? <Text className="text-muted text-[13px]">No words.</Text> : words.map((w) => (
                <View key={w.id} className="items-center bg-jiayou-soft border border-[#dbe3f1] rounded-xl px-3 py-2">
                  <Text className="text-jiayou font-extrabold text-[17px]">{w.chinese}</Text>
                  <Text className="text-muted-light text-[11px]">{w.pinyin || ''}{w.pinyin && w.english ? ' · ' : ''}{w.english || ''}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Progression élèves */}
          <View className="bg-white rounded-2xl p-5" style={SHADOW_CARD}>
            <View className="flex-row items-center gap-2 mb-3">
              <Ionicons name="people" size={18} color={COLORS.jiayou} />
              <Text className="font-bold text-jiayou text-[15px]">Student progress</Text>
            </View>
            {students.length === 0 ? (
              <View className="items-center py-8"><Ionicons name="people-outline" size={28} color="#c4c9d0" /><Text className="text-muted mt-2 text-[13px]">No students in this class yet.</Text></View>
            ) : (
              students.map((s, i) => {
                const k = Number(s.knowledge) || 0;
                return (
                  <View key={s.student_id} className={`flex-row items-center gap-3.5 py-3 ${i === students.length - 1 ? '' : 'border-b border-line-soft'}`}>
                    <View className="w-11 h-11 rounded-full bg-[#e7edf7] items-center justify-center"><Text className="text-jiayou font-extrabold text-[14px]">{initials(s.name)}</Text></View>
                    <View className="flex-1 min-w-0">
                      <Text className="font-bold text-ink text-[14px]" numberOfLines={1}>{s.name || 'Student'}</Text>
                      <Text className="text-muted-light text-[12px] mt-0.5">{s.quiz_count} quiz{s.quiz_count === 1 ? '' : 'zes'} on this task</Text>
                      <View className="h-2 rounded-full bg-[#eef2f8] overflow-hidden mt-1.5"><View style={{ width: `${k}%`, height: '100%', backgroundColor: COLORS.jiayou, borderRadius: 4 }} /></View>
                    </View>
                    <Text className="text-jiayou font-extrabold text-[14px] min-w-[42px] text-right">{k}%</Text>
                  </View>
                );
              })
            )}
          </View>
        </View>
      </ScrollView>

      <Popup visible={confirmDel} onClose={() => setConfirmDel(false)} maxWidth={380}>
        <View className="items-center mb-2"><Text className="text-[30px]">🗑️</Text></View>
        <Text className="text-[16px] font-bold text-ink text-center mb-1">Delete this task?</Text>
        <Text className="text-[13px] text-muted text-center leading-5 mb-4">This removes the task and its progress. This cannot be undone.</Text>
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
