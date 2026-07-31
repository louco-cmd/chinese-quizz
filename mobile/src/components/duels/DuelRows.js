import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme';
import { useT } from '../../i18n';
import Avatar from '../Avatar';

// Style de ligne en OBJET INLINE (pas de fonction/rowBase) — le plus robuste sur
// natif. `last` retire la bordure du bas de la dernière ligne.
const row = (last) => ({
  flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 12,
  borderBottomWidth: last ? 0 : 1, borderBottomColor: '#f5f5f5',
});

// ── Duel en attente : avatar + adversaire + mise. ──
export function PendingDuelRow({ duel, last, onPlay }) {
  const { t } = useT();
  const other = duel.user_role === 'challenger' ? duel.opponent_name : duel.challenger_name;
  const played = duel.my_score !== null && duel.my_score !== undefined;

  const inner = (
    <>
      <Avatar icon={duel.opponent_avatar_icon} color={duel.opponent_avatar_color} name={other} size={38} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: '600', color: '#1a1a2e', fontSize: 14 }}>{other}</Text>
        <Text style={{ fontSize: 12, color: '#999', marginTop: 1 }}>
          {played ? `${t('du_waiting_for')} ${other}` : t('du_tap_play')}
        </Text>
      </View>
      {duel.bet_amount > 0 ? (
        <View style={{ backgroundColor: '#fff3cd', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
          <Text style={{ color: '#856404', fontWeight: '700', fontSize: 12 }}>{duel.bet_amount}₵</Text>
        </View>
      ) : null}
      {played ? (
        <View style={{ backgroundColor: '#e8f0ff', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
          <Text style={{ color: COLORS.jiayou, fontWeight: '700', fontSize: 12 }}>{duel.my_score} {t('du_pts')}</Text>
        </View>
      ) : (
        <Ionicons name="play-circle" size={22} color={COLORS.jiayou} />
      )}
    </>
  );

  if (played) return <View style={row(last)}>{inner}</View>;
  return <Pressable onPress={() => onPlay(duel)} style={row(last)}>{inner}</Pressable>;
}

// ── Duel récent terminé : avatar + score + issue. ──
export function RecentDuelRow({ duel, last, onPress }) {
  const { t } = useT();
  const cfg = {
    won: { color: COLORS.success, label: t('du_won'), bg: '#e8f5e9' },
    lost: { color: COLORS.danger, label: t('du_lost'), bg: '#fff0f0' },
    draw: { color: COLORS.muted, label: t('du_draw'), bg: '#f1f3f5' },
  }[duel.result] || { color: COLORS.muted, label: '—', bg: '#f1f3f5' };
  const inner = (
    <>
      <Avatar icon={duel.opponent_avatar_icon} color={duel.opponent_avatar_color} name={duel.opponent_name} size={38} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: '600', color: '#1a1a2e', fontSize: 14 }}>{duel.opponent_name}</Text>
        <Text style={{ fontSize: 12, color: '#999', marginTop: 1 }}>{duel.my_score} – {duel.opp_score}</Text>
      </View>
      <View style={{ backgroundColor: cfg.bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
        <Text style={{ color: cfg.color, fontWeight: '700', fontSize: 12 }}>{cfg.label}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color="#c4c9d0" />
    </>
  );
  if (!onPress) return <View style={row(last)}>{inner}</View>;
  return <Pressable onPress={() => onPress(duel)} style={row(last)}>{inner}</Pressable>;
}

// ── Rival (bully) cliquable pour lancer un défi. ──
export function PlayerRow({ player, last, onChallenge }) {
  const { t } = useT();
  const positive = (player.balance || 0) >= 0;
  return (
    <Pressable onPress={() => onChallenge(player)} style={row(last)}>
      <Avatar name={player.name} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: '600', color: '#1a1a2e', fontSize: 14 }}>{player.name}</Text>
        {player.balance !== undefined ? (
          <Text style={{ fontSize: 12, color: positive ? COLORS.success : COLORS.danger, marginTop: 1 }}>
            {positive ? '+' : ''}{player.balance}₵ {t('du_net')}
          </Text>
        ) : null}
      </View>
      <Ionicons name="flash" size={18} color={COLORS.jiayou} />
    </Pressable>
  );
}

// ── Ligne de classement : rang + nom + W/L ──
export function LeaderboardRow({ player, rank, last }) {
  const medal = ['#f7c948', '#c0c4cc', '#d9945b'][rank - 1];
  return (
    <View style={row(last)}>
      <View style={{ width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: medal || '#f8f9fa' }}>
        <Text style={{ fontWeight: '700', fontSize: 13, color: medal ? '#fff' : '#888' }}>{rank}</Text>
      </View>
      <Text style={{ flex: 1, fontWeight: '600', color: '#1a1a2e', fontSize: 14 }}>{player.name}</Text>
      <Text style={{ color: COLORS.success, fontWeight: '700', fontSize: 13 }}>{player.wins}W</Text>
      <Text style={{ color: '#adb5bd', fontSize: 13, marginLeft: 8 }}>{player.losses}L</Text>
    </View>
  );
}
