import { forwardRef } from 'react';
import { View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Avatar from '../components/Avatar';
import { langMeta } from '../langs';

// Carte de progression destinée à être CAPTURÉE puis partagée (image PNG). Taille
// fixe (indépendante de l'écran) pour un rendu stable. Fond dégradé de marque,
// stats clés, pas de streak (cohérent avec le positionnement : on célèbre l'acquis
// et le repos, jamais la pression).
const CARD_W = 340;

function Stat({ value, label }) {
  return (
    <View style={{ width: '50%', paddingVertical: 12, alignItems: 'center' }}>
      <Text style={{ color: '#fff', fontSize: 30, fontWeight: '900' }}>{value}</Text>
      <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12.5, fontWeight: '600', marginTop: 2 }}>{label}</Text>
    </View>
  );
}

const ProgressShareCard = forwardRef(function ProgressShareCard(
  { name, avatarIcon, avatarColor, learningLang = 'zh', nativeLang = 'en',
    words = 0, masteredPct = 0, learningDays = 0, restDays = 0, t },
  ref,
) {
  const tr = t || ((k) => k);
  const learn = langMeta(learningLang);
  const nat = langMeta(nativeLang);
  return (
    <View ref={ref} collapsable={false} style={{ width: CARD_W, borderRadius: 24, overflow: 'hidden' }}>
      <LinearGradient colors={['#1d7cf2', '#0a3fb0']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 24 }}>
        {/* Marque */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 18 }}>
          <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 20, fontWeight: '900' }}>加</Text>
          </View>
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: 0.3 }}>Jiayou</Text>
        </View>

        {/* Identité + paire de langues */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <Avatar icon={avatarIcon} color={avatarColor} name={name} size={48} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: '#fff', fontSize: 20, fontWeight: '800' }}>{name || tr('ac_user')}</Text>
            <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '600', marginTop: 2 }}>
              {learn.endonym} · {tr('sh_from')} {nat.endonym}
            </Text>
          </View>
        </View>

        {/* Stats clés (2×2) */}
        <View style={{ backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 18, flexDirection: 'row', flexWrap: 'wrap', paddingVertical: 4 }}>
          <Stat value={words} label={tr('sh_words')} />
          <Stat value={`${masteredPct}%`} label={tr('sh_mastered')} />
          <Stat value={`🌱 ${learningDays}`} label={tr('ah_pill_learning')} />
          <Stat value={`☕ ${restDays}`} label={tr('ah_pill_rest')} />
        </View>

        {/* Pied de marque */}
        <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: '700', textAlign: 'center', marginTop: 18 }}>
          {tr('sh_tagline')}
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, textAlign: 'center', marginTop: 2 }}>
          app.jiayou.fr
        </Text>
      </LinearGradient>
    </View>
  );
});

export default ProgressShareCard;
