import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ContributionsHeatmap from './ContributionsHeatmap';
import { flagEmoji } from './EditProfilePopup';

// Hero bleu de la page account : identité (icône + nom, puis phrase d'accroche +
// pays), heatmap de quiz pleine largeur, avec le compteur de jours de pratique
// aligné à gauche face à la légende Less/More, puis courbe vers le corps clair.
export default function AccountHero({ name, tagline, country, year, activeDays, contributions, hPad = 16 }) {
  const flag = flagEmoji(country);
  return (
    <View style={{ backgroundColor: '#0d6efd', paddingTop: 20, paddingBottom: 40 }}>
      {/* Contenu centré et borné à 1200px comme .account-layout de l'EJS */}
      <View style={{ width: '100%', maxWidth: 1200, alignSelf: 'center', paddingHorizontal: hPad }}>
        {/* Identité : icône + nom */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <Ionicons name="person-circle" size={40} color="#fff" />
          <Text numberOfLines={1} style={{ color: '#fff', fontWeight: '800', fontSize: 24, flexShrink: 1 }}>
            {name || 'User'}
          </Text>
        </View>

        {/* Phrase d'accroche + pays */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
          <Text
            numberOfLines={2}
            style={{ color: 'rgba(255,255,255,0.9)', fontSize: 14, fontStyle: 'italic', flexShrink: 1 }}
          >
            “{tagline || 'Learning Chinese!'}”
          </Text>
          {flag ? <Text style={{ fontSize: 24 }}>{flag}</Text> : null}
        </View>

        <ContributionsHeatmap
          contributions={contributions}
          year={year}
          footerLeft={`${activeDays} ${activeDays === 1 ? 'day' : 'days'} of practice in ${year}`}
        />
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
