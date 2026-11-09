// Primitives de layout — remplacent les `flexDirection:'row', alignItems:…, gap:…`
// inline. Row (horizontal), Stack (vertical), Spacer (espace), Divider (trait).
import { View } from 'react-native';
import { COLORS } from './tokens';

export function Row({ gap = 8, align = 'center', justify, wrap = false, style, children, ...rest }) {
  return (
    <View
      style={[{ flexDirection: 'row', alignItems: align, justifyContent: justify, gap, flexWrap: wrap ? 'wrap' : 'nowrap' }, style]}
      {...rest}
    >
      {children}
    </View>
  );
}

export function Stack({ gap = 12, align, justify, style, children, ...rest }) {
  return (
    <View
      style={[{ flexDirection: 'column', gap, alignItems: align, justifyContent: justify }, style]}
      {...rest}
    >
      {children}
    </View>
  );
}

export function Spacer({ size = 8, horizontal = false }) {
  return <View style={horizontal ? { width: size } : { height: size }} />;
}

export function Divider({ style }) {
  return <View style={[{ height: 1, backgroundColor: COLORS.line, width: '100%' }, style]} />;
}
