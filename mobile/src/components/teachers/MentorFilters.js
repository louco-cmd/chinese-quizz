import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SHADOW_CARD } from '../../theme';

const PRICES = [
  { value: 'any', label: 'Any price' },
  { value: '0-20', label: '≤ €20' },
  { value: '20-40', label: '€20–40' },
  { value: '40+', label: '€40+' },
];

function Chip({ label, active, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1.5,
        borderColor: active ? COLORS.jiayou : '#e2e6ea', backgroundColor: active ? '#e8f0ff' : '#fff',
      }}
    >
      <Text style={{ color: active ? COLORS.jiayou : '#555', fontWeight: '600', fontSize: 12.5 }}>{label}</Text>
    </Pressable>
  );
}

function Section({ icon, title, children }) {
  return (
    <View>
      <Text style={{ fontSize: 12.5, fontWeight: '600', color: '#555', marginBottom: 8 }}>
        <Ionicons name={icon} size={12} color="#555" />  {title}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>
    </View>
  );
}

// Carte de filtres : langue enseignée + prix par session (comme .filter-card EJS).
export default function MentorFilters({ languages, activeLang, onLang, activePrice, onPrice }) {
  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 16, gap: 14, ...SHADOW_CARD }}>
      <Section icon="language" title="Language taught">
        <Chip label="All" active={!activeLang} onPress={() => onLang('')} />
        {languages.map((l) => <Chip key={l} label={l} active={activeLang === l} onPress={() => onLang(l)} />)}
      </Section>
      <View style={{ height: 1, backgroundColor: '#f0f0f0' }} />
      <Section icon="cash-outline" title="Price per session">
        {PRICES.map((p) => <Chip key={p.value} label={p.label} active={activePrice === p.value} onPress={() => onPrice(p.value)} />)}
      </Section>
    </View>
  );
}
