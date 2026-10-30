import { View, Text } from 'react-native';
import { useT } from '../../i18n';
import KnowledgeRing from './KnowledgeRing';

const BLUE = ['#0a58ca', '#3d8bfd', '#79aaff'];

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

function zhRings(it, t) {
  const p = it.pinyinPct != null ? it.pinyinPct : (it.masteredPct || 0);
  return [
    <RingItem key="p" pct={p} color={BLUE[0]} label={t('ac_type_pinyin')} />,
    <RingItem key="c" pct={it.characterPct || 0} color={BLUE[1]} label={t('ac_type_character')} />,
    <RingItem key="r" pct={it.readingPct || 0} color={BLUE[2]} label={t('ac_type_reading')} />,
  ];
}

function otherRings(it, t) {
  return [
    <RingItem key="w" pct={it.pinyinPct != null ? it.pinyinPct : (it.masteredPct || 0)} color={BLUE[0]} label={t('ac_type_writing')} />,
    <RingItem key="r" pct={it.readingPct || 0} color={BLUE[1]} label={t('ac_type_reading')} />,
  ];
}

export default function HskStatList({ items, isChinese }) {
  const { t } = useT();
  const zh = isChinese !== false;
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
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text style={{ fontWeight: '700', color: '#1a1a2e', fontSize: 14 }}>{it.label}</Text>
              <View style={{
                minWidth: 26, alignItems: 'center', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2,
                backgroundColor: isStreet ? '#198754' : '#0d6efd',
              }}>
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{it.count}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 12, columnGap: 24 }}>
              {zh ? zhRings(it, t) : otherRings(it, t)}
            </View>
          </View>
        );
      })}
    </View>
  );
}
