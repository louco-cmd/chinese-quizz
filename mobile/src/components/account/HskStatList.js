import { View, Text } from 'react-native';
import { useT } from '../../i18n';
import KnowledgeRing from './KnowledgeRing';

// Nuances d'un même bleu (dégradé) pour les 3 types, du plus foncé au plus clair.
const BLUE = ['#0a58ca', '#3d8bfd', '#79aaff'];

// Un anneau + son type à côté (pinyin / caractères / lecture).
function RingItem({ pct, color, label }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <KnowledgeRing size={32} stroke={4} pct={pct} color={color} inner="#f6f8fb">
        <Text style={{ fontSize: 8.5, fontWeight: '800', color: '#333' }}>{pct}%</Text>
      </KnowledgeRing>
      <Text style={{ fontSize: 10, color: '#666', fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

// Stats HSK : une « cellule » par niveau (libellé + nombre de mots) contenant la
// maîtrise par type de quiz sous 3 anneaux. `items` = [{ key, label, count,
// pinyinPct, characterPct, readingPct }].
export default function HskStatList({ items }) {
  const { t } = useT();
  if (!items || !items.length) {
    return <Text style={{ color: '#aaa', textAlign: 'center', paddingVertical: 12 }}>{t('ac_no_words')}</Text>;
  }
  return (
    <View>
      {items.map((it) => {
        const isStreet = it.key === 'Street';
        return (
          <View
            key={it.key}
            style={{ backgroundColor: '#f6f8fb', borderRadius: 12, padding: 12, marginBottom: 10 }}
          >
            {/* En-tête de cellule : niveau + nombre de mots */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text style={{ fontWeight: '700', color: '#1a1a2e', fontSize: 14 }}>{it.label}</Text>
              <View style={{
                minWidth: 26, alignItems: 'center', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2,
                backgroundColor: isStreet ? '#198754' : '#0d6efd',
              }}>
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{it.count}</Text>
              </View>
            </View>
            {/* Maîtrise par type de quiz */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 12, columnGap: 8 }}>
              <RingItem pct={it.pinyinPct ?? it.masteredPct ?? 0} color={BLUE[0]} label={t('ac_type_pinyin')} />
              <RingItem pct={it.characterPct ?? 0} color={BLUE[1]} label={t('ac_type_character')} />
              <RingItem pct={it.readingPct ?? 0} color={BLUE[2]} label={t('ac_type_reading')} />
            </View>
          </View>
        );
      })}
    </View>
  );
}
