import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PackMarket from '../components/PackMarket';
import { COLORS } from '../theme';

// JiaStore : hero + marketplace de packs (grille + achat via PackMarket).
export default function StoreScreen({ onBack }) {
  const Hero = (
    <View style={{ backgroundColor: COLORS.jiayou, paddingTop: 16, paddingBottom: 20, paddingHorizontal: 16 }}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 10 }}>
          <Ionicons name="chevron-back" size={20} color="rgba(255,255,255,0.9)" />
          <Text style={{ color: 'rgba(255,255,255,0.9)', fontWeight: '600' }}>Back</Text>
        </Pressable>
      ) : null}
      <Text style={{ color: '#fff', fontSize: 24, fontWeight: '800' }}>JiaStore</Text>
      <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 2 }}>Word packs to grow your vocabulary</Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      {Hero}
      <PackMarket />
    </View>
  );
}
