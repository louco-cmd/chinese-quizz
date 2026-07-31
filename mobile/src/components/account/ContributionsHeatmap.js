import { useState } from 'react';
import { View, Text } from 'react-native';
import { useT } from '../../i18n';

// Échelle INVERSÉE (plus de quiz = plus blanc, sur fond bleu), comme l'EJS.
export const LEVEL_BG = [
  'rgba(255,255,255,0.12)',
  'rgba(255,255,255,0.32)',
  'rgba(255,255,255,0.52)',
  'rgba(255,255,255,0.75)',
  '#ffffff',
];

function level(count) {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

function daysUpToToday(year) {
  const out = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(year, 0, 1);
  while (d <= today) {
    out.push(d.toISOString().split('T')[0]);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// Grille de contributions qui remplit toute la largeur disponible (carrés carrés).
// On mesure la largeur, on calcule un nombre entier de colonnes et une taille de
// carré ENTIÈRE, puis on laisse `gap` gérer l'espacement (pas de marges par case,
// qui désynchronisaient le flex-wrap et faisaient se chevaucher les cases).
export default function ContributionsHeatmap({ contributions, year, gap = 3, minSquare = 11, footerLeft }) {
  const { t } = useT();
  const [width, setWidth] = useState(0);
  const map = {};
  (contributions || []).forEach((c) => { map[c.date] = c.count; });
  const days = daysUpToToday(year);

  const cols = width > 0 ? Math.max(7, Math.floor((width + gap) / (minSquare + gap))) : 0;
  // Taille ENTIÈRE pour éviter les arrondis sub-pixel qui décalent les lignes.
  const size = cols > 0 ? Math.floor((width - gap * (cols - 1)) / cols) : minSquare;
  // Largeur réellement occupée : on cale le conteneur dessus pour éviter tout débord.
  const usedWidth = cols > 0 ? cols * size + gap * (cols - 1) : 0;

  return (
    <View>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {cols > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap, width: usedWidth }}>
            {days.map((date) => (
              <View
                key={date}
                style={{
                  width: size, height: size, borderRadius: 2,
                  backgroundColor: LEVEL_BG[level(map[date] || 0)],
                }}
              />
            ))}
          </View>
        )}
      </View>

      {/* Pied : compteur de jours à gauche, légende Less/More à droite */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, gap: 8 }}>
        <Text numberOfLines={1} style={{ color: '#fff', fontSize: 12, fontWeight: '600', flexShrink: 1 }}>
          {footerLeft || ''}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11 }}>{t('ah_less')}</Text>
          {LEVEL_BG.map((bg, i) => (
            <View key={i} style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: bg }} />
          ))}
          <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11 }}>{t('ah_more')}</Text>
        </View>
      </View>
    </View>
  );
}
