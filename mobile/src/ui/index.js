// Design-system Jiayou — point d'entrée unique.
//   import { Button, Card, Text, Screen, Row, Modal, StatTile } from '../ui';
//
// Voir src/ui/COMPONENTS.md pour le catalogue exhaustif (primitives + mapping des
// composants métier de l'app). Gallery.js affiche tout en preview.

// ── Typographie & actions ───────────────────────────────────────────────────
export { default as Text } from './Text';
export { default as Button } from './Button';
export { default as IconButton } from './IconButton';

// ── Surfaces & layout ───────────────────────────────────────────────────────
export { default as Card } from './Card';
export { default as SectionCard } from './SectionCard';
export { default as Screen } from './Screen';
export { Row, Stack, Spacer, Divider } from './layout';

// ── Saisie & contrôles ──────────────────────────────────────────────────────
export { default as Input } from './Input';
export { default as SegmentedControl } from './SegmentedControl';
export { default as Tabs } from './Tabs';
export { default as Chip } from './Chip';
export { default as Stepper } from './Stepper';
export { Checkbox, Radio, RadioGroup } from './Choice';

// ── Données & feedback ──────────────────────────────────────────────────────
export { default as Badge } from './Badge';
export { default as StatTile, StatRow } from './StatTile';
export { default as ProgressBar, SegmentBar } from './ProgressBar';
export { default as KeyValue } from './KeyValue';
export { default as ListItem } from './ListItem';
export { default as Banner } from './Banner';
export { default as EmptyState } from './EmptyState';
export { default as Spinner } from './Spinner';
export { default as Skeleton, SkeletonText } from './Skeleton';

// ── Overlays (composants existants réexportés) ──────────────────────────────
export { default as Modal } from '../components/Popup';   // alias clair
export { default as Popup } from '../components/Popup';
export { default as Sheet } from '../components/BottomSheet';

// ── Réexports existants pour une surface d'import unique ────────────────────
export { default as Toggle } from '../components/Toggle';
export { default as Avatar } from '../components/Avatar';

// ── Tokens ──────────────────────────────────────────────────────────────────
export * as tokens from './tokens';
export { COLORS, radius, spacing, fontSize, fontWeight, tones, SHADOW_CARD, TAB_CLEARANCE } from './tokens';
