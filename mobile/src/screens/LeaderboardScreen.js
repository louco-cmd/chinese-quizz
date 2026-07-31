import { useState } from 'react';
import { View, Text, ScrollView, Pressable, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { flagEmoji } from '../components/account/EditProfilePopup';
import UserProfileScreen from './UserProfileScreen';
import Avatar from '../components/Avatar';
import { useT } from '../i18n';
import useAndroidBack from '../useAndroidBack';
import { COLORS, SHADOW_CARD, TAB_CLEARANCE } from '../theme';

function Stat({ value, label, color = '#1a1a2e' }) {
  return (
    <View style={{ alignItems: 'center', minWidth: 46 }}>
      <Text style={{ fontSize: 15, fontWeight: '700', color }}>{value}</Text>
      <Text style={{ fontSize: 10, color: '#adb5bd', marginTop: 1 }}>{label}</Text>
    </View>
  );
}

function Row({ player, rank, last, onPress }) {
  const { t } = useT();
  const medal = ['#f7c948', '#c0c4cc', '#d9945b'][rank - 1];
  return (
    <Pressable
      onPress={() => onPress(player)}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12,
        borderBottomWidth: last ? 0 : 1, borderColor: '#f5f5f5',
        backgroundColor: player.isMe ? '#f2f7ff' : 'transparent',
      }}
    >
      <View style={{
        width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
        backgroundColor: medal || '#f8f9fa',
      }}>
        <Text style={{ fontWeight: '700', fontSize: 13, color: medal ? '#fff' : '#888' }}>{rank}</Text>
      </View>

      <Avatar icon={player.avatar_icon} color={player.avatar_color} name={player.name} size={34} />

      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontWeight: '600', color: '#1a1a2e', fontSize: 14 }} numberOfLines={1}>{player.name}</Text>
          {player.country ? <Text style={{ fontSize: 14 }}>{flagEmoji(player.country)}</Text> : null}
          {player.isMe ? (
            <View style={{ backgroundColor: COLORS.jiayou, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 }}>
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>You</Text>
            </View>
          ) : null}
        </View>
        {player.tagline ? (
          <Text style={{ fontSize: 12, color: '#999', marginTop: 1 }} numberOfLines={1}>“{player.tagline}”</Text>
        ) : null}
      </View>

      <Stat value={`${player.ratio || 0}%`} label={t('lb_ratio')} color={COLORS.jiayou} />
      <Ionicons name="chevron-forward" size={15} color="#c4c9d0" />
    </Pressable>
  );
}

// Page de classement dédiée (ouverte depuis "My statistics").
export default function LeaderboardScreen({ board, onBack }) {
  const { t } = useT();
  const { width } = useWindowDimensions();
  const hPad = width >= 992 ? 24 : 16;
  const [profileId, setProfileId] = useState(null);

  // Retour Android : ferme d'abord le profil ouvert, sinon revient aux duels.
  useAndroidBack(() => {
    if (profileId) { setProfileId(null); return true; }
    onBack();
    return true;
  }, true, [profileId, onBack]);

  // Ligne cliquée → profil public du joueur.
  if (profileId) {
    return <UserProfileScreen userId={profileId} onBack={() => setProfileId(null)} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: TAB_CLEARANCE }}>
        <View style={{ width: '100%', maxWidth: 900, alignSelf: 'center', paddingHorizontal: hPad }}>
          {/* En-tête avec retour */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <Pressable onPress={onBack} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="chevron-back" size={22} color={COLORS.jiayou} />
              <Text style={{ color: COLORS.jiayou, fontWeight: '600', fontSize: 15 }}>{t('nav_duels')}</Text>
            </Pressable>
          </View>

          <View style={{ backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', ...SHADOW_CARD }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderColor: '#f0f0f0' }}>
              <Ionicons name="trophy" size={19} color="#f7c948" />
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#444' }}>{t('lb_leaderboard')}</Text>
              <Text style={{ marginLeft: 'auto', fontSize: 12, color: COLORS.muted }}>
                {board.length} {t('lb_players')}
              </Text>
            </View>

            {board.length === 0 ? (
              <Text style={{ color: '#adb5bd', textAlign: 'center', paddingVertical: 24 }}>{t('lb_none')}</Text>
            ) : (
              board.map((p, i) => <Row key={p.id} player={p} rank={i + 1} last={i === board.length - 1} onPress={(pl) => setProfileId(pl.id)} />)
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
