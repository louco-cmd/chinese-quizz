import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AccountCard from '../account/AccountCard';
import { COLORS, SHADOW_CARD } from '../../theme';

function since(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}
function fmtSession(iso) {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${time}`;
}

// Carte "My mentor" de la page account : sessions à venir + profs rejoints +
// profs trial (séance réservée mais pas encore enrolled) + tasks.
export default function YourMentorsCard({ mentors, tasks, upcomingSessions, onLeave, onOpenTask, onJoinLesson }) {
  const myLessons = (upcomingSessions || []).filter((u) => !u.i_am_teacher);

  // Profs avec qui on a une séance à venir mais qui ne sont pas encore dans mentors.
  const enrolledIds = new Set((mentors || []).map((m) => m.teacher_id || m.id));
  const trialTeachers = [];
  const seen = new Set();
  myLessons.forEach((u) => {
    if (u.teacher_id && !enrolledIds.has(u.teacher_id) && !seen.has(u.teacher_id)) {
      seen.add(u.teacher_id);
      trialTeachers.push({ id: u.teacher_id, name: u.other_name });
    } else if (!u.teacher_id && u.other_name && !seen.has(u.other_name)) {
      // fallback : pas de teacher_id → dédupe par nom
      seen.add(u.other_name);
      trialTeachers.push({ id: null, name: u.other_name });
    }
  });

  const allMentors = [...(mentors || [])];
  const hasMentors = allMentors.length > 0 || trialTeachers.length > 0;

  return (
    <AccountCard icon="school-outline" title="My mentor">

      {/* Sessions à venir */}
      {myLessons.length > 0 && (
        <View style={{ marginBottom: 14 }}>
          <Text style={{ fontSize: 11.5, fontWeight: '700', color: '#999', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Upcoming sessions</Text>
          {myLessons.map((u) => (
            <View key={u.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#f0f7ff', borderRadius: 14, padding: 12, marginBottom: 8, ...SHADOW_CARD }}>
              <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: '#dbeeff', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="videocam" size={20} color={COLORS.jiayou} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13.5, fontWeight: '800', color: '#1a1a2e' }}>{fmtSession(u.starts_at)}</Text>
                <Text style={{ fontSize: 12, color: COLORS.muted, marginTop: 1 }}>with {u.other_name || '—'}{u.note === 'trial' ? ' · Trial' : ''}</Text>
              </View>
              <Pressable
                onPress={() => onJoinLesson?.(u.id)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: COLORS.jiayou }}
              >
                <Ionicons name="videocam" size={13} color="#fff" />
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12.5 }}>Join</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {/* Profs trial (séance réservée, pas encore enrolled) */}
      {trialTeachers.map((t, i) => (
        <View
          key={t.id ?? t.name}
          style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            paddingVertical: 10,
            borderBottomWidth: i === trialTeachers.length - 1 && allMentors.length === 0 ? 0 : 1,
            borderColor: '#f5f5f5',
          }}
        >
          <Text style={{ fontWeight: '600', color: '#1a1a2e', fontSize: 14 }}>{t.name || 'Teacher'}</Text>
          <View style={{ backgroundColor: '#fff3e0', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ fontSize: 11.5, fontWeight: '700', color: '#e07b00' }}>Trial pending</Text>
          </View>
        </View>
      ))}

      {/* Profs enrollés */}
      {allMentors.map((m, i) => (
        <Pressable
          key={m.id}
          onPress={() => onLeave?.(m)}
          style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            paddingVertical: 10, borderBottomWidth: i === allMentors.length - 1 ? 0 : 1, borderColor: '#f5f5f5',
          }}
        >
          <Text style={{ fontWeight: '600', color: '#1a1a2e', fontSize: 14 }}>{m.name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 12.5, color: '#aaa' }}>Since {since(m.since)}</Text>
            <Ionicons name="chevron-forward" size={15} color="#c4c4c4" />
          </View>
        </Pressable>
      ))}

      {hasMentors && (
        <>
          <View style={{ height: 1, backgroundColor: '#eef0f4', marginVertical: 12 }} />
          <Text style={{ fontSize: 11.5, fontWeight: '700', color: '#999', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Tasks</Text>
          {tasks.length === 0 ? (
            <Text style={{ color: '#aaa', fontSize: 13.5, paddingVertical: 6 }}>No tasks yet — your mentor will add some soon.</Text>
          ) : (
            tasks.map((t) => {
              const k = Math.max(0, Math.min(100, Number(t.knowledge) || 0));
              return (
                <Pressable
                  key={t.id}
                  onPress={() => onOpenTask?.(t)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 10,
                    backgroundColor: '#f7f8fa', borderRadius: 12,
                    paddingVertical: 10, paddingHorizontal: 12, marginBottom: 8,
                  }}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontWeight: '600', color: '#1a1a2e', fontSize: 14 }} numberOfLines={1}>{t.title}</Text>
                    <Text style={{ fontSize: 12, color: '#aaa', marginTop: 1 }}>{t.word_count} word{t.word_count === 1 ? '' : 's'}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ width: 70, height: 6, borderRadius: 999, backgroundColor: '#e4e8ef', overflow: 'hidden' }}>
                      <View style={{ width: `${k}%`, height: '100%', backgroundColor: COLORS.jiayou }} />
                    </View>
                    <Text style={{ fontWeight: '700', color: COLORS.jiayou, fontSize: 12.5, minWidth: 34, textAlign: 'right' }}>{k}%</Text>
                  </View>
                </Pressable>
              );
            })
          )}
        </>
      )}
    </AccountCard>
  );
}
