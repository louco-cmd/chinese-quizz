import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ErrorRetry } from '../../components/ErrorRetry';
import { teacherLessonProgress, teacherDeleteLesson, teacherUpdateLesson } from '../../api';
import { Modal, Button, StatTile, StatRow } from '../../ui';
import { COLORS, SHADOW_CARD } from '../../theme';
import CatLoader from '../../components/CatLoader';

// Ligne de mot — style « duel results » : terme (caractère + pinyin) à gauche,
// traduction à droite. Largeur fixe du terme en desktop → colonnes alignées.
function WordRow({ word, last, isDesktop }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: last ? 0 : 1, borderColor: '#f3f4f7' }}>
      <View style={{ width: isDesktop ? 150 : undefined, minWidth: 70, alignItems: 'center' }}>
        <Text style={{ fontSize: 21, fontWeight: '700', color: COLORS.jiayou, textAlign: 'center' }}>{word.chinese}</Text>
        {word.pinyin ? <Text style={{ fontSize: 12, color: COLORS.mutedLight, fontWeight: '600', marginTop: 2, textAlign: 'center' }}>{word.pinyin}</Text> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 14, color: '#1d1d1f', fontWeight: '500' }}>{word.english || '—'}</Text>
      </View>
    </View>
  );
}

export default function TeacherTaskScreen({ lessonId, onBack }) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 900;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Édition (titre + résumé)
  const [editOpen, setEditOpen] = useState(false);
  const [eTitle, setETitle] = useState('');
  const [eSummary, setESummary] = useState('');
  const [saving, setSaving] = useState(false);
  const [eErr, setEErr] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setData(await teacherLessonProgress(lessonId)); } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [lessonId]);
  useEffect(() => { load(); }, [load]);

  async function doDelete() {
    setDeleting(true);
    try { await teacherDeleteLesson(lessonId); onBack(true); } catch (e) { setError(e.message); setConfirmDel(false); } finally { setDeleting(false); }
  }

  function openEdit() {
    setETitle(data?.lesson?.title || '');
    setESummary(data?.lesson?.summary || '');
    setEErr(''); setEditOpen(true);
  }
  async function doEdit() {
    if (!eTitle.trim()) { setEErr('Title required'); return; }
    setSaving(true); setEErr('');
    try { await teacherUpdateLesson(lessonId, { title: eTitle.trim(), summary: eSummary.trim() }); setEditOpen(false); await load(); }
    catch (e) { setEErr(e.message || 'Error'); } finally { setSaving(false); }
  }

  if (loading) return <View className="flex-1 items-center justify-center bg-surface-page"><CatLoader size={110} /></View>;
  if (error && !data) return <View className="flex-1 bg-surface-page"><ErrorRetry error={error} onRetry={load} /></View>;

  const { lesson, words = [], students = [] } = data;
  const studentCount = students.length;
  const totalQuizzes = students.reduce((a, s) => a + (Number(s.quiz_count) || 0), 0);
  const avgKnowledge = studentCount ? Math.round(students.reduce((a, s) => a + (Number(s.knowledge) || 0), 0) / studentCount) : 0;

  return (
    <View className="flex-1 bg-surface-page">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <View style={{ width: '100%', maxWidth: 820, alignSelf: 'center' }}>
          <Pressable onPress={() => onBack(false)} hitSlop={10} className="flex-row items-center gap-1 mb-3">
            <Ionicons name="chevron-back" size={20} color={COLORS.muted} />
            <Text className="text-muted text-[14px]">Back to class</Text>
          </Pressable>

          {/* ── En-tête + bloc statistique ─────────────────────────────── */}
          <View className="bg-white rounded-2xl p-5 mb-4" style={SHADOW_CARD}>
            <Text className="text-jiayou font-extrabold text-[20px]">{lesson.title}</Text>
            <Text className="text-muted-light text-[12px] mt-1">
              {new Date(lesson.created_at).toLocaleDateString()} · {words.length} word{words.length === 1 ? '' : 's'}
            </Text>
            {lesson.summary ? <Text className="text-[#495267] text-[14px] mt-2 leading-5">{lesson.summary}</Text> : null}

            <StatRow style={{ marginTop: 14 }}>
              <StatTile value={`${avgKnowledge}%`} label="Avg knowledge" valueColor={COLORS.jiayou} />
              <StatTile value={totalQuizzes} label={`Quiz${totalQuizzes === 1 ? '' : 'zes'} done`} />
              <StatTile value={studentCount} label={`Student${studentCount === 1 ? '' : 's'}`} />
            </StatRow>
          </View>

          {/* ── Liste des mots (style duel results) ────────────────────── */}
          <View className="bg-white rounded-2xl overflow-hidden mb-4" style={SHADOW_CARD}>
            <View className="flex-row items-center gap-2 px-4 pt-4 pb-2">
              <Ionicons name="book" size={16} color={COLORS.jiayou} />
              <Text className="font-bold text-jiayou text-[14px]">Words</Text>
            </View>
            {words.length === 0 ? (
              <View className="items-center py-8">
                <Ionicons name="file-tray-outline" size={28} color="#c4c9d0" />
                <Text className="text-muted mt-2 text-[13px]">No words in this task.</Text>
              </View>
            ) : (
              words.map((w, i) => <WordRow key={w.id} word={w} last={i === words.length - 1} isDesktop={isDesktop} />)
            )}
          </View>

          {/* ── Actions : Edit / Delete ────────────────────────────────── */}
          <View className="flex-row gap-3">
            <Button title="Edit task" variant="secondary" icon="create-outline" onPress={openEdit} style={{ flex: 1, justifyContent: 'center' }} />
            <Button title="Delete task" variant="danger" icon="trash-outline" onPress={() => setConfirmDel(true)} style={{ flex: 1, justifyContent: 'center' }} />
          </View>
        </View>
      </ScrollView>

      {/* ── Modal édition (titre + résumé) ───────────────────────────── */}
      <Modal visible={editOpen} onClose={() => setEditOpen(false)} maxWidth={460}>
        <Text className="text-[17px] font-bold text-ink mb-3">Edit task</Text>
        <Text className="text-[13px] font-semibold text-muted mb-1.5">Title *</Text>
        <TextInput
          value={eTitle} onChangeText={setETitle} maxLength={120} placeholder="Task title"
          placeholderTextColor={COLORS.mutedLight}
          className="bg-surface-page border border-line rounded-xl px-3.5 h-12 text-[15px] text-ink mb-3"
        />
        <Text className="text-[13px] font-semibold text-muted mb-1.5">Summary (optional)</Text>
        <TextInput
          value={eSummary} onChangeText={setESummary} maxLength={2000} multiline placeholder="Notes for your students…"
          placeholderTextColor={COLORS.mutedLight}
          className="bg-surface-page border border-line rounded-xl px-3.5 py-3 text-[15px] text-ink"
          style={{ minHeight: 80, textAlignVertical: 'top' }}
        />
        {eErr ? <Text className="text-danger text-[13px] font-semibold mt-2">{eErr}</Text> : null}
        <View className="flex-row gap-3 mt-4">
          <Button title="Cancel" variant="secondary" onPress={() => setEditOpen(false)} style={{ flex: 1, justifyContent: 'center' }} />
          <Button title="Save" loading={saving} onPress={doEdit} style={{ flex: 1, justifyContent: 'center' }} />
        </View>
      </Modal>

      {/* ── Modal confirmation suppression ───────────────────────────── */}
      <Modal visible={confirmDel} onClose={() => setConfirmDel(false)} maxWidth={380}>
        <View className="items-center mb-2"><Text className="text-[30px]">🗑️</Text></View>
        <Text className="text-[16px] font-bold text-ink text-center mb-1">Delete this task?</Text>
        <Text className="text-[13px] text-muted text-center leading-5 mb-4">This removes the task and its progress. This cannot be undone.</Text>
        <View className="flex-row gap-3">
          <Button title="Cancel" variant="secondary" onPress={() => setConfirmDel(false)} style={{ flex: 1, justifyContent: 'center' }} />
          <Button title="Delete" variant="danger" loading={deleting} onPress={doDelete} style={{ flex: 1, justifyContent: 'center' }} />
        </View>
      </Modal>
    </View>
  );
}
