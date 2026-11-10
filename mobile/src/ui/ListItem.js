// ListItem — ligne de liste standard : leading (avatar/icône) + titre/sous-titre
// + trailing (badge/switch) + chevron optionnel. Pressable si onPress fourni.
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Text from './Text';
import { COLORS } from './tokens';

export default function ListItem({ title, subtitle, leading, trailing, onPress, chevron = false, style, ...rest }) {
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      android_ripple={onPress ? { color: 'rgba(0,0,0,0.06)' } : undefined}
      style={[{
        flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12,
      }, style]}
      {...rest}
    >
      {leading}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="bodyStrong" numberOfLines={1}>{title}</Text>
        {subtitle ? <Text variant="muted" numberOfLines={1} style={{ marginTop: 2 }}>{subtitle}</Text> : null}
      </View>
      {trailing}
      {chevron ? <Ionicons name="chevron-forward" size={18} color={COLORS.mutedLight} /> : null}
    </Pressable>
  );
}
