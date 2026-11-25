import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ErrorRetry } from '../../components/ErrorRetry';
import { teacherLessonProgress, teacherDeleteLesson } from '../../api';
import { Modal, Button } from '../../ui';
import CreateTaskPopup from './CreateTaskPopup';
import MarkdownText from '../../components/MarkdownText';
import { COLORS, SHADOW_CARD } from '../../theme';
import CatLoader from '../../components/CatLoader';

const SUMMARY_LINE_H = 20;
const SUMMARY_MAX_LINES = 5;

// Texte repliable : au-delà de 5 lignes on tronque avec un « Show more / less ».
// On mesure la hauteur réelle via un Text invisible (onTextLayout n'existe pas sur
// react-native-web) → marche en natif ET sur web.
function CollapsibleText({ text }) {
  const [expanded, setExpanded] = useState(false);
  const [fullH, setFullH] = useState(0);
  const needsClamp = fullH > SUMMARY_LINE_H * SUMMARY_MAX_LINES + 2;
  return (
    <View>
      {expanded
        ? <MarkdownText value={text} size={14} color="#495267" />
        : <MarkdownText value={text} size={14} color="#495267" numberOfLines={SUMMARY_MAX_LINES} />}
      {/* Mesure invisible de la hauteur totale (non tronquée). */}
      <Text pointerEvents="none" style={{ fontSize: 14, lineHeight: SUMMARY_LINE_H, position: 'absolute', left: 0, right: 0, opacity: 0, zIndex: -1 }}
        onLayout={(e) => { const h = e.nativeEvent.layout.height; if (Math.abs(h - fullH) > 1) setFullH(h); }}>{text}</Text>
      {needsClamp ? (
        <Pressable onPress={() => setExpanded((x) => !x)} hitSlop={6} style={{ marginTop: 4, alignSelf: 'flex-start' }}>
          <Text style={{ color: COLORS.jiayou, fontWeight: '700', fontSize: 12.5 }}>{expanded ? 'Show less' : 'Show more'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

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

export default function TeacherTaskScreen({ lessonId, direction, onBack }) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 900;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try { setData(await teacherLessonProgress(lessonId)); } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [lessonId]);
  useEffect(() => { load(); }, [load]);

  async function doDelete() {
    setDeleting(true);
    try { await teacherDeleteLesson(lessonId); onBack(true); } catch (e) { setError(e.message); setConfirmDel(false); } finally { setDeleting(false); }
  }

  if (loading) return <View className="flex-1 items-center justify-center bg-surface-page"><CatLoader size={110} /></View>;
  if (error && !data) return <View className="flex-1 bg-surface-page"><ErrorRetry error={error} onRetry={load} /></View>;

  const { lesson, words = [], students = [] } = data;
  const studentCount = students.length;
  const totalQuizzes = students.reduce((a, s) => a + (Number(s.quiz_count) || 0), 0);
  const avgKnowledge = studentCount ? Math.round(students.reduce((a, s) => a + (Number(s.knowledge) || 0), 0) / studentCount) : 0;

  // Bloc stats, même présentation que la carte « My classes » de la page Classes.
  const stats = [
    { label: 'Avg knowledge', value: `${avgKnowledge}%`, color: COLORS.jiayou },
    { label: `Quiz${totalQuizzes === 1 ? '' : 'zes'} done`, value: totalQuizzes, color: COLORS.ink },
    { label: `Student${studentCount === 1 ? '' : 's'}`, value: studentCount, color: COLORS.ink },
  ];

  return (
    <View className="flex-1 bg-surface-page">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <View style={{ width: '100%', maxWidth: 820, alignSelf: 'center' }}>
          <Pressable onPress={() => onBack(false)} hitSlop={10} className="flex-row items-center gap-1 mb-3">
            <Ionicons name="chevron-back" size={20} color={COLORS.muted} />
            <Text className="text-muted text-[14px]">Back to class</Text>
          </Pressable>

          {/* ── Bloc statistique (style page Classes) ──────────────────── */}
          <View className="bg-white rounded-2xl p-5 mb-4" style={SHADOW_CARD}>
            <View className="flex-row items-center gap-2 mb-4">
              <Ionicons name="stats-chart" size={16} color={COLORS.muted} />
              <Text className="text-ink font-extrabold text-[16px]">Task stats</Text>
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

          {/* ── Bloc titre + texte (résumé repliable) ──────────────────── */}
          <View className="bg-white rounded-2xl p-5 mb-4" style={SHADOW_CARD}>
            <Text className="text-jiayou font-extrabold text-[20px]">{lesson.title}</Text>
            <Text className="text-muted-light text-[12px] mt-1">
              {new Date(lesson.created_at).toLocaleDateString()} · {words.length} word{words.length === 1 ? '' : 's'}
            </Text>
            {lesson.summary ? <View className="mt-2"><CollapsibleText text={lesson.summary} /></View> : null}
          </View>

          {/* ── Liste des mots (style duel results) ────────────────────── */}
          <View className="bg-white rounded-2xl overflow-hidden mb-4" style={SHADOW_CARD}>
            <View className="flex-row items-center gap-2 px-4 pt-4 pb-2">
              <Ionicons name="book" size={16} color={COLORS.jiayou} />
              <Text className="font-bold text-jiayou text-[14px]">Words to learn</Text>
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
            <Button title="Edit task" variant="secondary" icon="create-outline" onPress={() => setEditOpen(true)} style={{ flex: 1, justifyContent: 'center' }} />
            <Button title="Delete task" variant="danger" icon="trash-outline" onPress={() => setConfirmDel(true)} style={{ flex: 1, justifyContent: 'center' }} />
          </View>
        </View>
      </ScrollView>

      {/* ── Édition de la task (titre + résumé + mots) ───────────────── */}
      <CreateTaskPopup
        visible={editOpen}
        direction={direction}
        editLesson={editOpen ? { id: lessonId, title: lesson.title, summary: lesson.summary, words } : null}
        onClose={() => setEditOpen(false)}
        onCreated={() => { setEditOpen(false); load(); }}
      />

      {/* ── Confirmation suppression ─────────────────────────────────── */}
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
