import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ContributionsHeatmap from './ContributionsHeatmap';
import { flagEmoji } from './EditProfilePopup';
import Avatar from '../Avatar';
import { useT } from '../../i18n';

// Hero bleu de la page account : identité (icône + nom + pays, puis phrase
// d'accroche) à gauche, bouton Edit à droite, puis heatmap pleine largeur avec
// le compteur de jours à gauche face à la légende Less/More.
// Pill de stat (fond translucide clair) : emoji + nombre gras + label sur UNE
// ligne. `flex:1` → les deux pills se partagent la largeur, sans expansion verticale.
function StatPill({ emoji, value, label }) {
  return (
    <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.4)', borderRadius: 999, paddingVertical: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
      <Text numberOfLines={1} style={{ color: 'rgba(26,26,46,0.75)', fontSize: 13 }}>
        {emoji} <Text style={{ color: '#0b1b3a', fontWeight: '800' }}>{value}</Text> {label}
      </Text>
    </View>
  );
}

export default function AccountHero({ name, tagline, country, avatarIcon, avatarColor, year, activeDays, restDays = 0, contributions, hPad = 16, onEdit }) {
  const { t } = useT();
  const flag = flagEmoji(country);
  return (
    <View style={{ backgroundColor: '#0d6efd', paddingTop: 20, paddingBottom: 18 }}>
      {/* Contenu centré et borné à 1200px comme .account-layout de l'EJS */}
      <View style={{ width: '100%', maxWidth: 1200, alignSelf: 'center', paddingHorizontal: hPad }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
          {/* Identité : icône à gauche, colonne nom+phrase à droite (phrase
              alignée sous le nom, en face de l'icône). */}
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Avatar icon={avatarIcon} color={avatarColor} name={name} size={44} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text numberOfLines={1} style={{ color: '#fff', fontWeight: '800', fontSize: 24, flexShrink: 1 }}>
                  {name || t('ac_user')}
                </Text>
                {flag ? <Text style={{ fontSize: 22 }}>{flag}</Text> : null}
              </View>
              <Text
                numberOfLines={2}
                style={{ color: '#fff', fontSize: 14, fontStyle: 'italic', fontWeight: '600', marginTop: 6 }}
              >
                “{tagline || t('ac_default_tagline')}”
              </Text>
            </View>
          </View>

          {/* Bouton Edit, centré verticalement avec l'identité */}
          <Pressable
            onPress={onEdit}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 6,
              backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999,
              paddingVertical: 8, paddingHorizontal: 14,
            }}
          >
            <Ionicons name="pencil" size={14} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{t('ah_edit')}</Text>
          </Pressable>
        </View>

        <ContributionsHeatmap
          contributions={contributions}
          year={year}
        />

        {/* Sentiment de progrès : apprentissage ET repos en deux pills pleine
            largeur (une ligne), sans culpabilité (anti-streak). */}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <StatPill emoji="🌱" value={activeDays} label={t('ah_pill_learning')} />
          <StatPill emoji="☕" value={restDays} label={t('ah_pill_rest')} />
        </View>
      </View>
    </View>
  );
}
