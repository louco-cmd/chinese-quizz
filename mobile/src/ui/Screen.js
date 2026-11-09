// Screen — enveloppe d'écran standard : SafeArea (haut), scroll optionnel,
// contenu centré (maxWidth web/tablette) et réserve de place pour la TabBar
// flottante (TAB_CLEARANCE) gérée automatiquement.
// Usage : <Screen><Card>…</Card></Screen>  ou  <Screen scroll={false}>…</Screen>
import { View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, TAB_CLEARANCE, CONTENT_MAX_WIDTH } from './tokens';

export default function Screen({
  children, scroll = true, padded = true, center = true, tabBar = true,
  maxWidth = CONTENT_MAX_WIDTH, background = COLORS.page,
  edges = ['top'], contentStyle, style, ...rest
}) {
  const inner = {
    flexGrow: 1,
    width: '100%',
    maxWidth,
    alignSelf: center ? 'center' : 'stretch',
    paddingHorizontal: padded ? 16 : 0,
    paddingTop: padded ? 16 : 0,
    paddingBottom: tabBar ? TAB_CLEARANCE : (padded ? 16 : 0),
  };

  return (
    <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: background }, style]}>
      {scroll ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[inner, contentStyle]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          {...rest}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, inner, contentStyle]} {...rest}>{children}</View>
      )}
    </SafeAreaView>
  );
}
