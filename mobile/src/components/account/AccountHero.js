import { View, Text } from 'react-native';
import ContributionsHeatmap from './ContributionsHeatmap';

// Hero bleu de la page account (façon wallet EJS) : salutation à gauche,
// heatmap de quiz pleine largeur, puis courbe arrondie vers le corps clair.
export default function AccountHero({ name, year, activeDays, contributions, hPad = 16 }) {
  const first = (name || 'User').split(' ')[0];
  return (
    <View style={{ backgroundColor: '#0d6efd', paddingTop: 20, paddingBottom: 40 }}>
      {/* Contenu centré et borné à 1200px comme .account-layout de l'EJS */}
      <View style={{ width: '100%', maxWidth: 1200, alignSelf: 'center', paddingHorizontal: hPad }}>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          style={{ color: '#fff', fontWeight: '700', fontSize: 16, marginBottom: 14 }}
        >
          Hello {first}, {activeDays} days of practice in {year}
        </Text>
        <ContributionsHeatmap contributions={contributions} year={year} />
      </View>

      {/* Courbe arrondie qui fait la jonction avec le corps clair */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute', left: 0, right: 0, bottom: -1, height: 24,
          backgroundColor: '#f8f9fa', borderTopLeftRadius: 24, borderTopRightRadius: 24,
        }}
      />
    </View>
  );
}
