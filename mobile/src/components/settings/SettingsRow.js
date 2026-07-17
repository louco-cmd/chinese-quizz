import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme';

// Ligne de réglage : pastille d'icône colorée + libellé (+ sous-libellé) + zone
// droite (`right`, ex. toggle) ou chevron si cliquable. Calquée sur .settings-row.
export default function SettingsRow({
  icon, iconColor = COLORS.jiayou, iconBg = '#e8f0ff',
  label, sub, right, onPress, danger, column, children,
}) {
  const Wrapper = onPress ? Pressable : View;
  const mainColor = danger ? COLORS.danger : '#1a1a1a';
  return (
    <Wrapper onPress={onPress} style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{
          width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
          backgroundColor: danger ? '#fff0f0' : iconBg,
        }}>
          <Ionicons name={icon} size={19} color={danger ? COLORS.danger : iconColor} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: mainColor }}>{label}</Text>
          {sub ? <Text style={{ fontSize: 12.5, color: '#888', marginTop: 2 }}>{sub}</Text> : null}
        </View>
        {right}
        {onPress && !right ? <Ionicons name="chevron-forward" size={18} color="#c4c4c4" /> : null}
      </View>
      {/* Contenu additionnel sous la ligne (ex. picker de direction) */}
      {column && children ? <View style={{ marginTop: 12 }}>{children}</View> : null}
    </Wrapper>
  );
}
