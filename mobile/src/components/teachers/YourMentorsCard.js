import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AccountCard from '../account/AccountCard';
import { COLORS } from '../../theme';

function since(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

// Carte "Your mentors" de la page account : profs rejoints (tap → quitter) +
// tasks avec progression (tap → page du cours).
export default function YourMentorsCard({ mentors, tasks, onLeave, onOpenTask }) {
  return (
    <AccountCard icon="school-outline" title="Your mentors">
      {mentors.map((m, i) => (
        <Pressable
          key={m.id}
          onPress={() => onLeave?.(m)}
          style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            paddingVertical: 10, borderBottomWidth: i === mentors.length - 1 ? 0 : 1, borderColor: '#f5f5f5',
          }}
        >
          <Text style={{ fontWeight: '600', color: '#1a1a2e', fontSize: 14 }}>{m.name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 12.5, color: '#aaa' }}>Since {since(m.since)}</Text>
            <Ionicons name="chevron-forward" size={15} color="#c4c4c4" />
          </View>
        </Pressable>
      ))}

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
              <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                <Text style={{ fontWeight: '600', color: '#1a1a2e', fontSize: 14 }} numberOfLines={1}>{t.title}</Text>
                <Text style={{ fontSize: 12, color: '#aaa' }}>· {t.word_count} word{t.word_count === 1 ? '' : 's'}</Text>
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
    </AccountCard>
  );
}
