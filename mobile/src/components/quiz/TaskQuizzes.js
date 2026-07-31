import { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SHADOW_CARD } from '../../theme';
import { useT } from '../../i18n';
import { getStudentClasses, startTask } from '../../api';

// Section "Task quizzes from your teacher" (page quiz) : chaque task avec jauge
// de maîtrise + bouton Practice qui lance le quiz sur les mots de la task.
export default function TaskQuizzes({ onStart }) {
  const { t: tr } = useT();
  const [tasks, setTasks] = useState(null);
  const [busy, setBusy] = useState(null); // id en cours de démarrage

  useEffect(() => {
    let alive = true;
    getStudentClasses().then((d) => { if (alive) setTasks(d.tasks || []); }).catch(() => alive && setTasks([]));
    return () => { alive = false; };
  }, []);

  async function practice(t) {
    setBusy(t.id);
    try {
      const d = await startTask(t.id);
      onStart({ type: d.type || 'pinyin', ids: d.ids || [], lessonId: t.id });
    } catch { /* noop */ } finally { setBusy(null); }
  }

  if (!tasks || tasks.length === 0) return null;

  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 16, ...SHADOW_CARD }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Ionicons name="school" size={18} color={COLORS.muted} />
        <Text style={{ fontSize: 15, fontWeight: '700', color: '#444' }}>{tr('qz_task_quizzes')}</Text>
      </View>

      {tasks.map((t, i) => {
        const k = Math.max(0, Math.min(100, Number(t.knowledge) || 0));
        return (
          <View
            key={t.id}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: i === tasks.length - 1 ? 0 : 1, borderColor: '#f5f5f5' }}
          >
            <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#e8f0ff', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="school" size={16} color={COLORS.jiayou} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontWeight: '600', color: '#1a1a2e', fontSize: 14 }} numberOfLines={1}>{t.title}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                <View style={{ width: 70, height: 5, borderRadius: 999, backgroundColor: '#e4e8ef', overflow: 'hidden' }}>
                  <View style={{ width: `${k}%`, height: '100%', backgroundColor: COLORS.jiayou }} />
                </View>
                <Text style={{ fontSize: 11.5, color: COLORS.muted }}>{k}%</Text>
              </View>
            </View>
            <Pressable
              onPress={() => practice(t)}
              disabled={busy === t.id}
              style={{ backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14, minWidth: 78, alignItems: 'center' }}
            >
              {busy === t.id ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{tr('qz_practice')}</Text>}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}
