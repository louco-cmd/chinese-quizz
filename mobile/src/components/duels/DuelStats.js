import { useT } from '../../i18n';
import { StatRow, StatTile, COLORS } from '../../ui';

// Bloc de statistiques de duel : Wins / Losses / Win rate / Total.
// Migré sur les primitives (StatRow + StatTile). `bordered={false}` : pas de
// filets (on est déjà dans le corps d'une carte), padding vertical neutralisé.
export default function DuelStats({ wins, losses }) {
  const { t } = useT();
  const total = wins + losses;
  const rate = total > 0 ? Math.round((wins / total) * 100) : 0;
  return (
    <StatRow bordered={false} style={{ paddingVertical: 0 }}>
      <StatTile value={wins} label={t('du_wins')} valueColor={COLORS.success} />
      <StatTile value={losses} label={t('du_losses')} valueColor={COLORS.danger} />
      <StatTile value={`${rate}%`} label={t('du_winrate')} valueColor={COLORS.jiayou} />
      <StatTile value={total} label={t('du_total')} />
    </StatRow>
  );
}
