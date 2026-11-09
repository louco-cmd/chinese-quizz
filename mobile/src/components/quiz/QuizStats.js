import { useT } from '../../i18n';
import { StatRow, StatTile, COLORS } from '../../ui';

// Bloc de stats de quiz — migré sur les primitives (StatRow + StatTile).
// Quizzes joués / précision moyenne / meilleur score / mots maîtrisés.
export default function QuizStats({ quizzes = 0, avg = 0, best = 0, mastered = 0 }) {
  const { t } = useT();
  return (
    <StatRow bordered={false} style={{ paddingVertical: 0 }}>
      <StatTile value={quizzes} label={t('quiz_quizzes')} valueColor={COLORS.jiayou} />
      <StatTile value={`${avg}%`} label={t('quiz_avg')} valueColor={COLORS.success} />
      <StatTile value={`${best}%`} label={t('quiz_best')} valueColor="#7828a7" />
      <StatTile value={mastered} label={t('quiz_mastered')} />
    </StatRow>
  );
}
