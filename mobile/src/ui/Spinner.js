// Spinner — ActivityIndicator thémé. `center` l'occupe en plein (flex:1).
import { ActivityIndicator, View } from 'react-native';
import { COLORS } from './tokens';

export default function Spinner({ size = 'large', color = COLORS.jiayou, center = false, style }) {
  if (center) {
    return (
      <View style={[{ flex: 1, alignItems: 'center', justifyContent: 'center' }, style]}>
        <ActivityIndicator size={size} color={color} />
      </View>
    );
  }
  return <ActivityIndicator size={size} color={color} style={style} />;
}
