import { useT } from '../../i18n';
import { StatRow, StatTile } from '../../ui';

// Ligne Words / Quizzes / Duels, bordée haut et bas — migrée sur StatRow + StatTile.
export default function StatTriplet({ words, quizzes, duels }) {
  const { t } = useT();
  return (
    <StatRow>
      <StatTile value={words} label={t('ac_words')} />
      <StatTile value={quizzes} label={t('ac_quizzes')} />
      <StatTile value={duels} label={t('nav_duels')} />
    </StatRow>
  );
}
