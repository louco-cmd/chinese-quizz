// ─────────────────────────────────────────────────────────────────────────────
// Tokens de la design-system Jiayou — SOURCE UNIQUE pour les primitives src/ui.
// Étend src/theme.js (on ré-exporte COLORS/SHADOW_CARD/TAB_CLEARANCE pour rester
// rétro-compatible) et ajoute les échelles (espacement, radius, typo) + les tons
// sémantiques. Doit rester aligné avec tailwind.config.js.
// ─────────────────────────────────────────────────────────────────────────────
import { COLORS, SHADOW_CARD, SHADOW_CARD_FLAT, TAB_CLEARANCE } from '../theme';

export { COLORS, SHADOW_CARD, SHADOW_CARD_FLAT, TAB_CLEARANCE };

// Échelle d'espacement (multiples de 4). Utilise spacing[n] ou directement le px.
export const spacing = { 0: 0, 0.5: 2, 1: 4, 1.5: 6, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 28, 8: 32, 10: 40, 12: 48 };

// Rayons (alignés tailwind : card=16, pill=9999).
export const radius = { sm: 8, md: 12, card: 16, lg: 20, pill: 9999 };

// Échelle typographique (tailles) + graisses.
export const fontSize = { caption: 11, small: 13, body: 15, base: 16, subtitle: 18, title: 22, display: 28 };
export const fontWeight = { regular: '400', medium: '500', semibold: '600', bold: '700', black: '800' };

// Tons sémantiques (fond + texte) pour Badge / états / encarts.
export const tones = {
  default: { bg: COLORS.surfaceAlt, fg: COLORS.ink },
  primary: { bg: COLORS.jiayouSoft, fg: COLORS.jiayouDark },
  success: { bg: '#e8f5e9', fg: COLORS.success },
  danger:  { bg: '#fdecea', fg: COLORS.danger },
  warning: { bg: COLORS.warningBg, fg: '#8a6d00' },
  muted:   { bg: COLORS.lineSoft, fg: COLORS.muted },
};

// Largeur de contenu max (web/tablette) — centrage des écrans.
export const CONTENT_MAX_WIDTH = 720;
