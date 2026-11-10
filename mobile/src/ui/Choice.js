// Checkbox & Radio — cases/boutons de choix (via Ionicons, pas de dépendance).
// RadioGroup gère une sélection unique dans une liste d'options.
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Text from './Text';
import { COLORS } from './tokens';

export function Checkbox({ checked = false, onChange, label, disabled = false, style }) {
  return (
    <Pressable
      disabled={disabled}
      onPress={() => onChange?.(!checked)}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, opacity: disabled ? 0.5 : 1 }, style]}
    >
      <Ionicons
        name={checked ? 'checkbox' : 'square-outline'}
        size={22}
        color={checked ? COLORS.jiayou : COLORS.mutedLight}
      />
      {label ? <Text variant="body">{label}</Text> : null}
    </Pressable>
  );
}

export function Radio({ selected = false, onPress, label, disabled = false, style }) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, opacity: disabled ? 0.5 : 1 }, style]}
    >
      <Ionicons
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={22}
        color={selected ? COLORS.jiayou : COLORS.mutedLight}
      />
      {label ? <Text variant="body">{label}</Text> : null}
    </Pressable>
  );
}

export function RadioGroup({ options = [], value, onChange, gap = 12, style }) {
  return (
    <View style={[{ gap }, style]}>
      {options.map((opt) => {
        const val = opt?.value ?? opt;
        const label = opt?.label ?? opt;
        return <Radio key={String(val)} selected={val === value} label={label} onPress={() => onChange?.(val)} />;
      })}
    </View>
  );
}
