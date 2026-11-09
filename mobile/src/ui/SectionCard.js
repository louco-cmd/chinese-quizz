// SectionCard — Card titrée avec en-tête (titre + action optionnelle à droite).
// Couvre les *SectionCard / SettingsGroup / cartes titrées de l'app.
import { View } from 'react-native';
import Text from './Text';
import Card from './Card';

export default function SectionCard({ title, subtitle, right, icon, children, padding = 16, flat, style, bodyStyle }) {
  return (
    <Card padding={padding} flat={flat} style={style}>
      {(title || right) ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: subtitle ? 2 : 12 }}>
          {icon}
          <View style={{ flex: 1, minWidth: 0 }}>
            {title ? <Text variant="subtitle">{title}</Text> : null}
            {subtitle ? <Text variant="muted" style={{ marginTop: 2 }}>{subtitle}</Text> : null}
          </View>
          {right}
        </View>
      ) : null}
      {subtitle && (title || right) ? <View style={{ height: 10 }} /> : null}
      <View style={bodyStyle}>{children}</View>
    </Card>
  );
}
