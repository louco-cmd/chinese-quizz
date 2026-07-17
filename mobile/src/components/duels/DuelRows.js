import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme';

// Petit avatar rond avec l'initiale du nom.
function Avatar({ name, bg = '#e8f0ff', color = COLORS.jiayou }) {
  return (
    <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color, fontWeight: '700', fontSize: 16 }}>{(name || '?').charAt(0).toUpperCase()}</Text>
    </View>
  );
}

const rowBase = (last) => ({
  flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 12,
  borderTopWidth: last ? 0 : 0, borderBottomWidth: last ? 0 : 1, borderColor: '#f5f5f5',
});

// ── Duel en attente : avatar + adversaire + mise.
// Si j'ai déjà joué (my_score renseigné) → affiche mon score, pas de bouton jouer.
export function PendingDuelRow({ duel, last, onPlay }) {
  const other = duel.user_role === 'challenger' ? duel.opponent_name : duel.challenger_name;
  const played = duel.my_score !== null && duel.my_score !== undefined;

  const inner = (
    <>
      <Avatar name={other} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: '600', color: '#1a1a2e', fontSize: 14 }}>{other}</Text>
        <Text style={{ fontSize: 12, color: '#999', marginTop: 1 }}>
          {played ? `Waiting for ${other}` : 'Tap to play your round'}
        </Text>
      </View>
      {duel.bet_amount > 0 ? (
        <View style={{ backgroundColor: '#fff3cd', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
          <Text style={{ color: '#856404', fontWeight: '700', fontSize: 12 }}>{duel.bet_amount}₵</Text>
        </View>
      ) : null}
      {played ? (
        <View style={{ backgroundColor: '#e8f0ff', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
          <Text style={{ color: COLORS.jiayou, fontWeight: '700', fontSize: 12 }}>{duel.my_score} pts</Text>
        </View>
      ) : (
        <Ionicons name="play-circle" size={22} color={COLORS.jiayou} />
      )}
    </>
  );

  // Déjà joué → ligne non cliquable (impossible de rejouer)
  if (played) return <View style={rowBase(last)}>{inner}</View>;
  return (
    <Pressable onPress={() => onPlay(duel)} style={({ pressed }) => [rowBase(last), pressed && { backgroundColor: '#f8f9fb' }]}>
      {inner}
    </Pressable>
  );
}

// ── Duel récent terminé : avatar + score + issue. Cliquable → détail du duel. ──
export function RecentDuelRow({ duel, last, onPress }) {
  const cfg = {
    won: { color: COLORS.success, label: 'Won', bg: '#e8f5e9' },
    lost: { color: COLORS.danger, label: 'Lost', bg: '#fff0f0' },
    draw: { color: COLORS.muted, label: 'Draw', bg: '#f1f3f5' },
  }[duel.result] || { color: COLORS.muted, label: '—', bg: '#f1f3f5' };
  const inner = (
    <>
      <Avatar name={duel.opponent_name} bg={cfg.bg} color={cfg.color} />
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
  if (!onPress) return <View style={rowBase(last)}>{inner}</View>;
  return (
    <Pressable onPress={() => onPress(duel)} style={({ pressed }) => [rowBase(last), pressed && { backgroundColor: '#f8f9fb' }]}>
      {inner}
    </Pressable>
  );
}

// ── Rival (bully) cliquable pour lancer un défi : avatar + nom + solde net ──
export function PlayerRow({ player, last, onChallenge }) {
  const positive = (player.balance || 0) >= 0;
  return (
    <Pressable onPress={() => onChallenge(player)} style={({ pressed }) => [rowBase(last), pressed && { backgroundColor: '#f8f9fb' }]}>
      <Avatar name={player.name} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: '600', color: '#1a1a2e', fontSize: 14 }}>{player.name}</Text>
        {player.balance !== undefined ? (
          <Text style={{ fontSize: 12, color: positive ? COLORS.success : COLORS.danger, marginTop: 1 }}>
            {positive ? '+' : ''}{player.balance}₵ net
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
    <View style={rowBase(last)}>
      <View style={{
        width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
        backgroundColor: medal || '#f8f9fa',
      }}>
        <Text style={{ fontWeight: '700', fontSize: 13, color: medal ? '#fff' : '#888' }}>{rank}</Text>
      </View>
      <Text style={{ flex: 1, fontWeight: '600', color: '#1a1a2e', fontSize: 14 }}>{player.name}</Text>
      <Text style={{ color: COLORS.success, fontWeight: '700', fontSize: 13 }}>{player.wins}W</Text>
      <Text style={{ color: '#adb5bd', fontSize: 13, marginLeft: 8 }}>{player.losses}L</Text>
    </View>
  );
}
