import { View } from 'react-native';

// Anneau de progression 0–100 % en React Native pur — AUCUNE dépendance native
// (pas de react-native-svg) → livrable par OTA. Technique des deux demi-disques
// masqués (overflow:hidden sur chaque moitié) que l'on fait pivoter autour du
// centre du cercle via translateX → rotate → translateX, puis un disque central
// qui « creuse » le plein pour ne laisser que l'épaisseur de l'anneau.
export default function KnowledgeRing({
  size = 78,
  stroke = 7,
  pct = 0,
  color = '#0d6efd',
  track = '#e9ecef',
  inner = '#fff',
  children,
}) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const radius = size / 2;
  const rightRotate = `${p >= 50 ? 180 : p * 3.6}deg`;
  const leftRotate = `${p >= 50 ? (p - 50) * 3.6 : 0}deg`;
  const innerSize = size - stroke * 2;

  const wrap = { position: 'absolute', top: 0, width: radius, height: size, overflow: 'hidden' };
  const disc = { position: 'absolute', top: 0, width: radius, height: size };

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: track,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {/* moitié gauche du cadre : porte les premiers 0–180° de progression */}
      <View style={[wrap, { left: 0 }]}>
        <View
          style={[disc, {
            left: radius,
            borderTopRightRadius: radius,
            borderBottomRightRadius: radius,
            backgroundColor: color,
            transform: [{ translateX: -radius / 2 }, { rotate: rightRotate }, { translateX: radius / 2 }],
          }]}
        />
      </View>
      {/* moitié droite du cadre : révélée au-delà de 50 % */}
      <View style={[wrap, { left: radius }]}>
        <View
          style={[disc, {
            left: -radius,
            borderTopLeftRadius: radius,
            borderBottomLeftRadius: radius,
            backgroundColor: p >= 50 ? color : track,
            transform: [{ translateX: radius / 2 }, { rotate: leftRotate }, { translateX: -radius / 2 }],
          }]}
        />
      </View>
      {/* disque central → transforme les demi-disques pleins en anneau */}
      <View
        style={{
          width: innerSize,
          height: innerSize,
          borderRadius: innerSize / 2,
          backgroundColor: inner,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {children}
      </View>
    </View>
  );
}
