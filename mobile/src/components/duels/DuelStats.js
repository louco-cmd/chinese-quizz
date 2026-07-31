import { View, Text } from 'react-native';
import { useT } from '../../i18n';
import { COLORS } from '../../theme';

function Cell({ value, label, color = '#111' }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontSize: 22, fontWeight: '700', color, lineHeight: 24 }}>{value}</Text>
      <Text style={{ fontSize: 11, color: '#999', marginTop: 3 }}>{label}</Text>
    </View>
  );
}

// Bloc de statistiques de duel : Wins / Losses / Win rate / Total.
export default function DuelStats({ wins, losses }) {
  const { t } = useT();
  const total = wins + losses;
  const rate = total > 0 ? Math.round((wins / total) * 100) : 0;
  return (
    <View style={{ flexDirection: 'row' }}>
      <Cell value={wins} label={t('du_wins')} color={COLORS.success} />
      <Cell value={losses} label={t('du_losses')} color={COLORS.danger} />
      <Cell value={`${rate}%`} label={t('du_winrate')} color={COLORS.jiayou} />
      <Cell value={total} label={t('du_total')} />
    </View>
  );
}
