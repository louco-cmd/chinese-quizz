import { View, Text } from 'react-native';
import { COLORS } from '../../theme';
import { useT } from '../../i18n';

function Cell({ value, label, color = '#111' }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontSize: 22, fontWeight: '700', color, lineHeight: 24 }}>{value}</Text>
      <Text style={{ fontSize: 11, color: '#999', marginTop: 3 }}>{label}</Text>
    </View>
  );
}

// Bloc de stats de quiz — même forme que DuelStats.
// Quizzes joués / précision moyenne / meilleur score / mots maîtrisés.
export default function QuizStats({ quizzes = 0, avg = 0, best = 0, mastered = 0 }) {
  const { t } = useT();
  return (
    <View style={{ flexDirection: 'row' }}>
      <Cell value={quizzes} label={t('quiz_quizzes')} color={COLORS.jiayou} />
      <Cell value={`${avg}%`} label={t('quiz_avg')} color={COLORS.success} />
      <Cell value={`${best}%`} label={t('quiz_best')} color="#7828a7" />
      <Cell value={mastered} label={t('quiz_mastered')} />
    </View>
  );
}
