import { View, Text } from 'react-native';
import { useT } from '../../i18n';

// Liste des stats HSK : libellé à gauche, « x% mastered » + pastille du nombre
// à droite (façon .list-group + badge EJS). `items` = [{ label, count, masteredPct, key }].
export default function HskStatList({ items }) {
  const { t } = useT();
  if (!items || !items.length) {
    return <Text style={{ color: '#aaa', textAlign: 'center', paddingVertical: 12 }}>{t('ac_no_words')}</Text>;
  }
  return (
    <View>
      {items.map((it, i) => {
        const isStreet = it.key === 'Street';
        return (
          <View
            key={it.key}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              paddingVertical: 10,
              borderBottomWidth: i === items.length - 1 ? 0 : 1, borderColor: '#f5f5f5',
            }}
          >
            <Text style={{ fontWeight: '500', color: '#333', fontSize: 14 }}>{it.label}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 12, color: '#aaa' }}>
                {it.masteredPct > 0 ? `${it.masteredPct}% ${t('ac_mastered_suffix')}` : '-'}
              </Text>
              <View style={{
                minWidth: 26, alignItems: 'center', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2,
                backgroundColor: isStreet ? '#198754' : '#0d6efd',
              }}>
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{it.count}</Text>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}
