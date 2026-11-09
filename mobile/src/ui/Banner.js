// Banner — notice inline (tone + icône + texte + action/fermeture optionnelles).
// Couvre VerifyEmailBanner et les bandeaux d'info/alerte in-app.
import { View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Text from './Text';
import { radius, tones, COLORS } from './tokens';

const ICONS = { default: 'information-circle', primary: 'information-circle', success: 'checkmark-circle', danger: 'alert-circle', warning: 'warning', muted: 'information-circle' };

export default function Banner({ children, title, tone = 'primary', icon, action, actionLabel, onClose, style }) {
  const t = tones[tone] || tones.primary;
  return (
    <View style={[{
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: t.bg, borderRadius: radius.md, padding: 12,
    }, style]}>
      <Ionicons name={icon || ICONS[tone] || ICONS.default} size={20} color={t.fg} />
      <View style={{ flex: 1, minWidth: 0 }}>
        {title ? <Text variant="bodyStrong" style={{ color: t.fg }}>{title}</Text> : null}
        {children ? <Text variant="muted" style={{ color: t.fg, marginTop: title ? 2 : 0 }}>{children}</Text> : null}
      </View>
      {action && actionLabel ? (
        <Pressable onPress={action} hitSlop={6}><Text variant="label" style={{ color: t.fg }}>{actionLabel}</Text></Pressable>
      ) : null}
      {onClose ? (
        <Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={18} color={t.fg} /></Pressable>
      ) : null}
    </View>
  );
}
