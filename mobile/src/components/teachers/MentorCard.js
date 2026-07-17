import { View, Text, Pressable, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SHADOW_CARD } from '../../theme';

const CURRENCY = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF', CNY: '¥', JPY: '¥', CAD: 'C$', AUD: 'A$', SGD: 'S$', HKD: 'HK$' };
function money(p, currency) {
  const n = Number(p);
  const amount = Number.isInteger(n) ? String(n) : n.toFixed(2);
  const sym = CURRENCY[currency] || (currency || '€');
  return sym.length > 1 ? `${sym} ${amount}` : `${sym}${amount}`;
}
function initials(name) {
  return (name || 'T').split(/\s+/).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
}

// Carte mentor : avatar (initiales) + nom bleu + langues enseignées + CTA contact,
// bio, puis pied de carte (prix / session + stats). Calquée sur .mentor-card EJS.
export default function MentorCard({ mentor: m }) {
  const teaches = (m.teaching_languages || []).join(', ') || m.languages_spoken;
  const bits = [`${m.student_count} student${m.student_count === 1 ? '' : 's'}`];
  if (m.task_count != null) bits.push(`${m.task_count} course${m.task_count === 1 ? '' : 's'}`);
  if (m.years_experience != null) bits.push(`${m.years_experience} yr${m.years_experience === 1 ? '' : 's'}`);
  const url = m.link && m.link.url;

  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12, ...SHADOW_CARD }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#e3f0ff', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: COLORS.jiayou, fontWeight: '800', fontSize: 16 }}>{initials(m.name)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: COLORS.jiayou, fontWeight: '800', fontSize: 16 }} numberOfLines={1}>{m.name || 'Teacher'}</Text>
          {teaches ? (
            <Text style={{ color: '#7a8aa8', fontSize: 12.5, marginTop: 2 }} numberOfLines={1}>
              <Ionicons name="language" size={12} color="#7a8aa8" />  Teaches {teaches}
            </Text>
          ) : null}
        </View>
        {url ? (
          <Pressable onPress={() => Linking.openURL(url)} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={{ color: '#495057', fontWeight: '600', fontSize: 13 }}>{m.link.label || 'Contact'}</Text>
            <Ionicons name="open-outline" size={14} color="#495057" />
          </Pressable>
        ) : null}
      </View>

      {m.mentor_bio ? (
        <Text style={{ color: '#495267', fontSize: 13.5, marginTop: 10, lineHeight: 19 }} numberOfLines={3}>{m.mentor_bio}</Text>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        {m.session_price != null ? (
          <View style={{ backgroundColor: '#e8f0ff', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ color: COLORS.jiayou, fontSize: 12.5, fontWeight: '700' }}>{money(m.session_price, m.session_currency)} / session</Text>
          </View>
        ) : null}
        <Text style={{ color: '#8a97ac', fontSize: 12.5, flexShrink: 1 }} numberOfLines={1}>{bits.join(' · ')}</Text>
      </View>
    </View>
  );
}
