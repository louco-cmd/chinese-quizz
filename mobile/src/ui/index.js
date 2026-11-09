// Design-system Jiayou — point d'entrée unique.
//   import { Button, Card, Text, Screen, Row } from '../ui';
//
// Primitives : Text, Button, Card, Screen, Input, Badge, IconButton, ListItem,
// Spinner, SegmentedControl, Row/Stack/Spacer/Divider, + Toggle/Avatar (réexportés
// depuis components pour une surface d'import unique). Tokens via `tokens`.
export { default as Text } from './Text';
export { default as Button } from './Button';
export { default as Card } from './Card';
export { default as Screen } from './Screen';
export { default as Input } from './Input';
export { default as Badge } from './Badge';
export { default as IconButton } from './IconButton';
export { default as ListItem } from './ListItem';
export { default as Spinner } from './Spinner';
export { default as SegmentedControl } from './SegmentedControl';
export { Row, Stack, Spacer, Divider } from './layout';

// Composants existants réexportés pour l'unité d'import.
export { default as Toggle } from '../components/Toggle';
export { default as Avatar } from '../components/Avatar';

// Tokens (couleurs, espacement, radius, typo, ombres).
export * as tokens from './tokens';
export { COLORS, radius, spacing, fontSize, fontWeight, tones, SHADOW_CARD, TAB_CLEARANCE } from './tokens';
