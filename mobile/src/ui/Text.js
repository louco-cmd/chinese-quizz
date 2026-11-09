// Text — typographie unifiée. Remplace les `<Text className="text-[13px] font-semibold text-muted">`
// répétés. Usage : <Text variant="title">…</Text>, <Text variant="muted">…</Text>.
import { Text as RNText } from 'react-native';
import { COLORS, fontSize, fontWeight } from './tokens';

const VARIANTS = {
  display:    { fontSize: fontSize.display,  fontWeight: fontWeight.black,    color: COLORS.ink },
  title:      { fontSize: fontSize.title,    fontWeight: fontWeight.bold,     color: COLORS.ink },
  subtitle:   { fontSize: fontSize.subtitle, fontWeight: fontWeight.semibold, color: COLORS.ink },
  body:       { fontSize: fontSize.body,     fontWeight: fontWeight.regular,  color: COLORS.ink },
  bodyStrong: { fontSize: fontSize.body,     fontWeight: fontWeight.semibold, color: COLORS.ink },
  muted:      { fontSize: fontSize.small,    fontWeight: fontWeight.regular,  color: COLORS.muted },
  caption:    { fontSize: fontSize.caption,  fontWeight: fontWeight.medium,   color: COLORS.mutedLight },
  label:      { fontSize: fontSize.small,    fontWeight: fontWeight.semibold, color: COLORS.muted },
};

export default function Text({ variant = 'body', color, align, weight, style, children, ...rest }) {
  const v = VARIANTS[variant] || VARIANTS.body;
  return (
    <RNText
      style={[v, color && { color }, weight && { fontWeight: weight }, align && { textAlign: align }, style]}
      {...rest}
    >
      {children}
    </RNText>
  );
}

export { VARIANTS as TEXT_VARIANTS };
