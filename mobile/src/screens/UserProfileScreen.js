import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { flagEmoji } from '../components/account/EditProfilePopup';
import StartDuelPopup from '../components/duels/StartDuelPopup';
import { ErrorRetry } from '../components/ErrorRetry';
import { getUserProfile } from '../api';
import { COLORS, SHADOW_CARD } from '../theme';

// Barre de maîtrise segmentée (mastered / learning / medium / novice).
const SEGMENTS = [
  { key: 'mastered', color: COLORS.jiayou },
  { key: 'learning', color: '#0dcaf0' },
  { key: 'medium', color: '#ffc107' },
  { key: 'novice', color: '#adb5bd' },
];
function MasteryGauge({ label, dist, total }) {
  const pct = (n) => (total > 0 ? (n / total) * 100 : 0);
  const masteredPct = total > 0 ? Math.round((dist.mastered / total) * 100) : 0;
  return (
    <View style={{ marginTop: 14 }}>
      <View style={{ flexDirection: 'row', height: 8, borderRadius: 6, overflow: 'hidden', backgroundColor: '#f0f2f5' }}>
        {SEGMENTS.map((s) => {
          const w = pct(dist[s.key]);
          return w > 0 ? <View key={s.key} style={{ width: `${w}%`, backgroundColor: s.color }} /> : null;
        })}
      </View>
      <Text style={{ textAlign: 'center', fontSize: 12, color: COLORS.muted, marginTop: 6 }}>
        {total > 0 ? `${masteredPct}% ${label} mastered` : `No ${label}`}
      </Text>
    </View>
  );
}

function Stat({ value, label, color = '#1a1a2e' }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontSize: 20, fontWeight: '700', color }}>{value}</Text>
      <Text style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

function Card({ children, style }) {
  return <View style={{ backgroundColor: '#fff', borderRadius: 16, ...SHADOW_CARD, ...style }}>{children}</View>;
}

// Profil public d'un joueur — miroir de views/user-profile.ejs.
export default function UserProfileScreen({ userId, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [challenge, setChallenge] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setData(await getUserProfile(userId));
    } catch (e) {
      setError(e.message || 'Could not load this profile.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const joined = data?.created_at
    ? new Date(data.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <ScrollView contentContainerStyle={{ paddingVertical: 16, paddingBottom: 32 }}>
        <View style={{ width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 16 }}>

          {/* En-tête : retour + défier */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <Pressable onPress={onBack} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="chevron-back" size={22} color={COLORS.jiayou} />
              <Text style={{ color: COLORS.jiayou, fontWeight: '600', fontSize: 15 }}>Back</Text>
            </Pressable>
            {data && !data.isMe ? (
              <Pressable
                onPress={() => setChallenge(true)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 }}
              >
                <Ionicons name="flash" size={15} color="#fff" />
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13.5 }}>Challenge</Text>
              </Pressable>
            ) : null}
          </View>

          {loading ? (
            <ActivityIndicator color={COLORS.jiayou} style={{ marginTop: 40 }} />
          ) : error ? (
            <ErrorRetry error={error} onRetry={load} />
          ) : (
            <>
              {/* Carte profil */}
              <Card style={{ padding: 18, marginBottom: 16 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: '#e8f0ff', alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="person" size={26} color={COLORS.jiayou} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ fontSize: 18, fontWeight: '700', color: '#1a1a2e' }} numberOfLines={1}>{data.name}</Text>
                      <Text style={{ fontSize: 18 }}>{flagEmoji(data.country)}</Text>
                    </View>
                    <Text style={{ fontSize: 13, color: COLORS.muted, marginTop: 3 }} numberOfLines={2}>
                      {data.tagline ? `“${data.tagline}”` : 'No tagline yet'}
                    </Text>
                    {joined ? <Text style={{ fontSize: 11.5, color: '#adb5bd', marginTop: 3 }}>Joined {joined}</Text> : null}
                  </View>
                </View>

                {/* Stats globales */}
                <View style={{ flexDirection: 'row', marginTop: 18 }}>
                  <Stat value={data.words} label="Words" />
                  <Stat value={data.quizzes} label="Quizzes" />
                  <Stat value={data.duels} label="Duels" />
                </View>

                {/* Duels : victoires / défaites / ratio */}
                <View style={{ flexDirection: 'row', marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderColor: '#f0f0f0' }}>
                  <Stat value={data.wins ?? 0} label="Wins" color={COLORS.success} />
                  <Stat value={data.losses ?? 0} label="Losses" color={COLORS.danger} />
                  <Stat value={`${data.ratio ?? 0}%`} label="Win rate" color={COLORS.jiayou} />
                </View>

                {/* Jauges de maîtrise */}
                <MasteryGauge label="Pinyin" dist={data.mastery.pinyin} total={data.mastery.total} />
                <MasteryGauge label="Characters" dist={data.mastery.character} total={data.mastery.total} />
              </Card>

              {/* Statistiques des mots (HSK) */}
              <Card>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderColor: '#f0f0f0' }}>
                  <Ionicons name="bar-chart" size={18} color={COLORS.jiayou} />
                  <Text style={{ fontSize: 15, fontWeight: '700', color: '#444' }}>Words statistics</Text>
                </View>
                {data.hsk.length === 0 ? (
                  <View style={{ alignItems: 'center', paddingVertical: 28 }}>
                    <Ionicons name="bar-chart-outline" size={32} color="#cbd5e1" />
                    <Text style={{ color: '#adb5bd', marginTop: 8, fontSize: 13 }}>No words learned yet</Text>
                  </View>
                ) : (
                  data.hsk.map((h, i) => (
                    <View key={h.label} style={{
                      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                      paddingHorizontal: 16, paddingVertical: 13,
                      borderBottomWidth: i === data.hsk.length - 1 ? 0 : 1, borderColor: '#f5f5f5',
                    }}>
                      <Text style={{ fontSize: 14, fontWeight: '500', color: '#1a1a2e' }}>{h.label}</Text>
                      <View style={{ backgroundColor: COLORS.jiayou, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 3 }}>
                        <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{h.count} words</Text>
                      </View>
                    </View>
                  ))
                )}
              </Card>
            </>
          )}
        </View>
      </ScrollView>

      {/* Popup de défi (réutilise StartDuelPopup) */}
      {data ? (
        <StartDuelPopup
          visible={challenge}
          presetOpponent={{ id: data.id, name: data.name }}
          onClose={() => setChallenge(false)}
          onCreated={() => setChallenge(false)}
        />
      ) : null}
    </View>
  );
}
