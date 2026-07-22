import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ErrorRetry } from '../components/ErrorRetry';
import QuizPlayScreen from './QuizPlayScreen';
import { getLesson, startTask } from '../api';
import { COLORS, SHADOW_CARD } from '../theme';

// Page d'une task / cours (copie de student-course.ejs) : titre + notes + mots,
// et bouton "Practice these words" qui lance le quiz sur les mots du cours.
export default function CoursePage({ lessonId, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [playing, setPlaying] = useState(null); // config quiz

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setData(await getLesson(lessonId));
    } catch (e) {
      setError(e.message || 'Could not load the course.');
    } finally {
      setLoading(false);
    }
  }, [lessonId]);

  useEffect(() => { load(); }, [load]);

  async function practice() {
    setStarting(true);
    try {
      const d = await startTask(lessonId);
      setPlaying({ type: d.type || 'pinyin', ids: d.ids || [], lessonId });
    } catch { /* noop */ } finally { setStarting(false); }
  }

  if (playing) {
    return <QuizPlayScreen config={playing} onExit={() => { setPlaying(null); load(); }} />;
  }

  const Back = (
    <Pressable onPress={onBack} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 14 }}>
      <Ionicons name="chevron-back" size={20} color={COLORS.muted} />
      <Text style={{ color: COLORS.muted, fontSize: 14 }}>Back</Text>
    </Pressable>
  );

  if (loading) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8f9fa' }}><ActivityIndicator color={COLORS.jiayou} /></View>;
  }
  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: '#f8f9fa', padding: 16 }}>{Back}<ErrorRetry error={error} onRetry={load} /></View>
    );
  }

  const l = data.lesson || {};
  const words = data.words || [];

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <ScrollView contentContainerStyle={{ paddingVertical: 16 }}>
        <View style={{ width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 16 }}>
          {Back}

          {/* En-tête du cours */}
          <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 18, marginBottom: 14, ...SHADOW_CARD }}>
            <Text style={{ fontSize: 20, fontWeight: '800', color: '#1a1a2e' }}>{l.title}</Text>
            <Text style={{ fontSize: 12.5, color: COLORS.muted, marginTop: 4 }}>
              {l.class_name || ''}{l.created_at ? ` · ${new Date(l.created_at).toLocaleDateString()}` : ''}
            </Text>
            {l.summary
              ? <Text style={{ color: '#495267', marginTop: 12, lineHeight: 20 }}>{l.summary}</Text>
              : <Text style={{ color: COLORS.muted, fontSize: 13, marginTop: 12 }}>No notes.</Text>}
          </View>

          {/* Mots à apprendre */}
          <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 18, marginBottom: 16, ...SHADOW_CARD }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Ionicons name="list" size={18} color={COLORS.muted} />
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#444' }}>Words to learn</Text>
            </View>
            {words.length === 0 ? (
              <Text style={{ color: COLORS.muted, fontSize: 13 }}>No words.</Text>
            ) : (
              words.map((w, i) => (
                <View key={w.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: i === words.length - 1 ? 0 : 1, borderColor: '#f5f5f5' }}>
                  <Text style={{ fontSize: 22, fontWeight: '700', color: COLORS.jiayou, minWidth: 52 }}>{w.chinese}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, color: '#1a1a2e', fontWeight: '500' }}>{w.english}</Text>
                    <Text style={{ fontSize: 12.5, color: COLORS.muted, marginTop: 1 }}>{w.pinyin}</Text>
                  </View>
                </View>
              ))
            )}
          </View>

          {words.length > 0 && (
            <Pressable
              onPress={practice}
              disabled={starting}
              style={{ backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 15, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
            >
              {starting ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="game-controller" size={18} color="#fff" />
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Practice these words</Text>
                </>
              )}
            </Pressable>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
