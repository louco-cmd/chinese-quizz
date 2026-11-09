// Button — bouton unifié. Gère variantes, tailles, état loading, disabled et icône
// UNE SEULE FOIS (fini les `backgroundColor: busy ? '#9bb4e8' : COLORS.jiayou` partout).
// Usage : <Button title="Envoyer" onPress={…} loading={busy} icon="send" />
import { Pressable, Text as RNText, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, radius, fontWeight } from './tokens';

const SIZES = {
  sm: { py: 9,  px: 14, font: 14, icon: 16 },
  md: { py: 13, px: 18, font: 15, icon: 18 },
  lg: { py: 16, px: 22, font: 16, icon: 20 },
};

const VARIANTS = {
  primary:   { bg: COLORS.jiayou, fg: '#fff',      pressBg: COLORS.jiayouDark, disabledBg: '#9bb4e8' },
  secondary: { bg: '#eef0f3',     fg: COLORS.ink,  pressBg: '#e2e5ea',         disabledBg: '#f1f2f4', disabledFg: '#aab2bd' },
  ghost:     { bg: 'transparent', fg: COLORS.jiayou, pressBg: COLORS.jiayouSoft },
  danger:    { bg: COLORS.danger, fg: '#fff',      pressBg: '#b52d3a',         disabledBg: '#e9a7ad' },
  outline:   { bg: '#fff',        fg: COLORS.ink,  pressBg: COLORS.page,       border: 1, borderColor: COLORS.line },
};

export default function Button({
  title, children, variant = 'primary', size = 'md',
  loading = false, disabled = false, icon, iconRight, fullWidth = false,
  onPress, style, textStyle, ...rest
}) {
  const v = VARIANTS[variant] || VARIANTS.primary;
  const s = SIZES[size] || SIZES.md;
  const off = disabled || loading;
  const fg = off && v.disabledFg ? v.disabledFg : v.fg;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={off}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        paddingVertical: s.py, paddingHorizontal: s.px, borderRadius: radius.pill,
        backgroundColor: off ? (v.disabledBg || v.bg) : (pressed ? v.pressBg : v.bg),
        borderWidth: v.border || 0, borderColor: v.borderColor,
        opacity: off && !v.disabledBg ? 0.45 : 1,
        width: fullWidth ? '100%' : undefined,
        alignSelf: fullWidth ? 'stretch' : 'flex-start',
      }, style]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={s.icon} color={fg} /> : null}
          <RNText style={[{ color: fg, fontWeight: fontWeight.bold, fontSize: s.font }, textStyle]}>
            {title ?? children}
          </RNText>
          {iconRight ? <Ionicons name={iconRight} size={s.icon} color={fg} /> : null}
        </>
      )}
    </Pressable>
  );
}
