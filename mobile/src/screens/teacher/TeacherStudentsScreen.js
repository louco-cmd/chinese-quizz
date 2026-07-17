import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, ActivityIndicator, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ErrorRetry } from '../../components/ErrorRetry';
import { teacherStudents } from '../../api';
import { COLORS, SHADOW_CARD } from '../../theme';

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
}
function scoreStyle(s) {
  if (s >= 75) return { bg: '#d4edda', fg: '#198754' };
  if (s >= 50) return { bg: '#fff3cd', fg: '#997404' };
  return { bg: '#f8d7da', fg: '#dc3545' };
}

export default function TeacherStudentsScreen() {
  const { width } = useWindowDimensions();
  const cols = width >= 900 ? 4 : width >= 600 ? 3 : 2;
  const cardW = cols === 4 ? '23.5%' : cols === 3 ? '31.5%' : '48%';

  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { const d = await teacherStudents(); setStudents(d.students || []); } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <View className="flex-1 items-center justify-center bg-surface-page"><ActivityIndicator color={COLORS.jiayou} /></View>;
  if (error) return <View className="flex-1 bg-surface-page"><ErrorRetry error={error} onRetry={load} /></View>;

  return (
    <View className="flex-1 bg-surface-page">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <View style={{ width: '100%', maxWidth: 820, alignSelf: 'center' }}>
          {students.length === 0 ? (
            <View className="items-center py-16">
              <Ionicons name="people-outline" size={32} color="#c4c9d0" />
              <Text className="text-muted mt-2 text-[13px] text-center">No students yet. Invite them from your classes!</Text>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 }}>
              {students.map((s) => {
                const st = scoreStyle(Number(s.avg_score) || 0);
                return (
                  <View key={s.id} style={{ width: cardW, ...SHADOW_CARD }} className="bg-white rounded-2xl p-4 items-center">
                    <View className="rounded-full bg-[#e7edf7] items-center justify-center mb-2" style={{ width: 52, height: 52 }}>
                      <Text className="text-jiayou font-extrabold text-[16px]">{initials(s.name)}</Text>
                    </View>
                    <Text className="font-bold text-ink text-[14px] text-center" numberOfLines={1}>{s.name || 'Student'}</Text>
                    <Text className="text-muted-light text-[11px] mb-1.5">{s.class_count} class{s.class_count === 1 ? '' : 'es'}</Text>
                    <Text className="text-jiayou font-extrabold text-[16px] leading-none">{s.word_count}</Text>
                    <Text className="text-muted-light text-[10px] uppercase tracking-wide">words</Text>
                    <View style={{ backgroundColor: st.bg, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 2, marginTop: 8 }}>
                      <Text style={{ color: st.fg, fontWeight: '700', fontSize: 12 }}>{Number(s.avg_score) || 0}% avg</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
