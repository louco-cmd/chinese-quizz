import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PackMarket from '../components/PackMarket';
import { COLORS } from '../theme';

// JiaStore : hero + marketplace de packs (grille + achat via PackMarket).
export default function StoreScreen({ onBack, onCreate }) {
  const Hero = (
    <View style={{ backgroundColor: COLORS.jiayou, paddingTop: 16, paddingBottom: 20, paddingHorizontal: 16 }}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 10 }}>
          <Ionicons name="chevron-back" size={20} color="rgba(255,255,255,0.9)" />
          <Text style={{ color: 'rgba(255,255,255,0.9)', fontWeight: '600' }}>Back</Text>
        </Pressable>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#fff', fontSize: 24, fontWeight: '800' }}>JiaStore</Text>
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 2 }}>Word packs to grow your vocabulary</Text>
        </View>
        {onCreate ? (
          <Pressable
            onPress={onCreate}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 }}
          >
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Sell a pack</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      {Hero}
      <PackMarket />
    </View>
  );
}
