// Stepper — compteur numérique −/+ (quantité, nombre de semaines récurrentes…).
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Text from './Text';
import { COLORS, radius } from './tokens';

export default function Stepper({ value = 0, onChange, min = 0, max = 99, step = 1, style }) {
  const set = (v) => onChange?.(Math.max(min, Math.min(max, v)));
  const Btn = ({ icon, to, disabled }) => (
    <Pressable
      disabled={disabled}
      onPress={() => set(to)}
      style={({ pressed }) => ({ width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surfaceAlt, opacity: disabled ? 0.4 : (pressed ? 0.7 : 1) })}
    >
      <Ionicons name={icon} size={18} color={COLORS.ink} />
    </Pressable>
  );
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 12 }, style]}>
      <Btn icon="remove" to={value - step} disabled={value <= min} />
      <Text variant="subtitle" style={{ minWidth: 28, textAlign: 'center' }}>{value}</Text>
      <Btn icon="add" to={value + step} disabled={value >= max} />
    </View>
  );
}
