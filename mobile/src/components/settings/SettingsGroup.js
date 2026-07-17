import { View, Text } from 'react-native';
import { Children } from 'react';
import { SHADOW_CARD } from '../../theme';

// Groupe de réglages : titre en petites capitales + carte blanche arrondie
// contenant des SettingsRow séparées par un filet (comme .settings-group EJS).
export default function SettingsGroup({ title, children }) {
  const rows = Children.toArray(children);
  return (
    <View style={{ marginBottom: 24 }}>
      <Text style={{
        fontSize: 11, fontWeight: '700', color: '#888', textTransform: 'uppercase',
        letterSpacing: 0.6, paddingHorizontal: 16, paddingBottom: 6,
      }}>
        {title}
      </Text>
      <View style={{ backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', ...SHADOW_CARD }}>
        {rows.map((row, i) => (
          <View key={i} style={i > 0 ? { borderTopWidth: 1, borderColor: '#f0f0f0' } : null}>
            {row}
          </View>
        ))}
      </View>
    </View>
  );
}
