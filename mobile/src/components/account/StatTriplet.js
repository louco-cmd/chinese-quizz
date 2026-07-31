import { View, Text } from 'react-native';
import { useT } from '../../i18n';

function Stat({ value, label }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontSize: 24, fontWeight: '700', color: '#111', lineHeight: 26 }}>{value}</Text>
      <Text style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{label}</Text>
    </View>
  );
}

// Ligne Words / Quizzes / Duels, bordée haut et bas (comme .stats-row EJS).
export default function StatTriplet({ words, quizzes, duels }) {
  const { t } = useT();
  return (
    <View style={{
      flexDirection: 'row', paddingVertical: 14,
      borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#f0f0f0',
    }}>
      <Stat value={words} label={t('ac_words')} />
      <Stat value={quizzes} label={t('ac_quizzes')} />
      <Stat value={duels} label={t('nav_duels')} />
    </View>
  );
}
