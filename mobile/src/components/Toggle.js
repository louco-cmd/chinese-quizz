import { Switch } from 'react-native';
import { COLORS } from '../theme';

// Switch thémé bleu, cohérent natif + web. react-native-web ignore la forme
// objet de `trackColor` → on passe aussi `activeTrackColor` (sinon vert par défaut).
export default function Toggle(props) {
  return (
    <Switch
      trackColor={{ false: '#d9dde3', true: COLORS.jiayou }}
      activeTrackColor={COLORS.jiayou}
      thumbColor="#fff"
      activeThumbColor="#fff"
      ios_backgroundColor="#d9dde3"
      {...props}
    />
  );
}
