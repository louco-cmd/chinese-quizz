// Gallery — écran de preview (dev) de toute la design-system. Branche-le sur une
// route dev pour voir/valider toutes les primitives d'un coup.
//   import Gallery from '../ui/Gallery';  →  <Gallery />
import { useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen, Card, SectionCard, Text, Button, Input, Badge, IconButton, ListItem, Spinner,
  SegmentedControl, Row, Stack, Spacer, Divider, Toggle, Avatar, COLORS,
  StatTile, StatRow, ProgressBar, SegmentBar, Banner, EmptyState, Skeleton, SkeletonText,
  Chip, Checkbox, Radio, Tabs, Stepper, KeyValue,
} from './index';

function Section({ title, children }) {
  return (
    <Stack gap={10} style={{ marginBottom: 22 }}>
      <Text variant="caption" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>{title}</Text>
      {children}
    </Stack>
  );
}

export default function Gallery() {
  const [seg, setSeg] = useState('en→zh');
  const [txt, setTxt] = useState('');
  const [on, setOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [chip, setChip] = useState(8);
  const [chk, setChk] = useState(true);
  const [radio, setRadio] = useState('b');
  const [tab, setTab] = useState('overview');
  const [weeks, setWeeks] = useState(8);

  return (
    <Screen>
      <Text variant="display" style={{ marginBottom: 4 }}>UI Kit</Text>
      <Text variant="muted" style={{ marginBottom: 20 }}>Design-system Jiayou — src/ui</Text>

      <Section title="Typography">
        <Card>
          <Stack gap={6}>
            <Text variant="display">Display</Text>
            <Text variant="title">Title</Text>
            <Text variant="subtitle">Subtitle</Text>
            <Text variant="body">Body — le texte courant par défaut.</Text>
            <Text variant="bodyStrong">Body strong</Text>
            <Text variant="muted">Muted — texte secondaire.</Text>
            <Text variant="caption">Caption — tertiaire / légendes.</Text>
            <Text variant="label">Label</Text>
          </Stack>
        </Card>
      </Section>

      <Section title="Buttons">
        <Card>
          <Stack gap={10}>
            <Row gap={8} wrap>
              <Button title="Primary" onPress={() => {}} />
              <Button title="Secondary" variant="secondary" onPress={() => {}} />
              <Button title="Ghost" variant="ghost" onPress={() => {}} />
            </Row>
            <Row gap={8} wrap>
              <Button title="Danger" variant="danger" onPress={() => {}} />
              <Button title="Outline" variant="outline" onPress={() => {}} />
              <Button title="Icon" icon="send" onPress={() => {}} />
            </Row>
            <Row gap={8} wrap>
              <Button title="sm" size="sm" onPress={() => {}} />
              <Button title="md" size="md" onPress={() => {}} />
              <Button title="lg" size="lg" onPress={() => {}} />
            </Row>
            <Button title="Disabled" disabled onPress={() => {}} />
            <Button
              title="Loading on tap"
              loading={busy}
              fullWidth
              onPress={() => { setBusy(true); setTimeout(() => setBusy(false), 1200); }}
            />
          </Stack>
        </Card>
      </Section>

      <Section title="Inputs & controls">
        <Card>
          <Stack gap={14}>
            <Input label="Champ texte" icon="search" placeholder="Rechercher…" value={txt} onChangeText={setTxt} />
            <Input label="Avec erreur" error="Ce champ est requis" placeholder="…" />
            <SegmentedControl options={['en→zh', 'zh→en']} value={seg} onChange={setSeg} />
            <Row justify="space-between">
              <Text variant="body">Toggle</Text>
              <Toggle value={on} onValueChange={setOn} />
            </Row>
          </Stack>
        </Card>
      </Section>

      <Section title="Badges">
        <Card>
          <Row gap={8} wrap>
            <Badge tone="default">default</Badge>
            <Badge tone="primary">primary</Badge>
            <Badge tone="success" icon="checkmark">success</Badge>
            <Badge tone="danger">danger</Badge>
            <Badge tone="warning">warning</Badge>
            <Badge tone="muted">muted</Badge>
          </Row>
        </Card>
      </Section>

      <Section title="List">
        <Card padding={0} style={{ paddingHorizontal: 14 }}>
          <ListItem
            leading={<Avatar name="Louis" icon="rocket" color={COLORS.jiayou} size={38} />}
            title="Louis 高如意" subtitle="Niveau HSK 3 · 1099 ₵" chevron onPress={() => {}}
          />
          <Divider />
          <ListItem
            leading={<IconButton icon="notifications" bg={COLORS.jiayouSoft} color={COLORS.jiayou} />}
            title="Notifications" subtitle="3 non lues" trailing={<Badge tone="danger">3</Badge>} chevron onPress={() => {}}
          />
        </Card>
      </Section>

      <Section title="Stats & progress">
        <SectionCard title="Mes stats" right={<Badge tone="primary">cette semaine</Badge>}>
          <StatRow>
            <StatTile value="634" label="Mots" />
            <StatTile value="128" label="Quiz" delta={12} />
            <StatTile value="9" label="Duels" />
          </StatRow>
          <Spacer size={14} />
          <Text variant="label" style={{ marginBottom: 6 }}>Maîtrise</Text>
          <ProgressBar value={0.68} />
          <Spacer size={10} />
          <SegmentBar segments={[{ value: 40, color: COLORS.success }, { value: 35, color: COLORS.warning }, { value: 25, color: COLORS.line }]} />
        </SectionCard>
      </Section>

      <Section title="Chips, choices, stepper">
        <Card>
          <Stack gap={14}>
            <Row gap={8} wrap>
              {[4, 8, 12].map((n) => <Chip key={n} label={`${n} sem.`} selected={chip === n} onPress={() => setChip(n)} />)}
              <Chip label="Filtre" icon="filter" selected={false} onPress={() => {}} />
            </Row>
            <Checkbox checked={chk} onChange={setChk} label="Recevoir les rappels" />
            <Row gap={20}>
              <Radio selected={radio === 'a'} label="Option A" onPress={() => setRadio('a')} />
              <Radio selected={radio === 'b'} label="Option B" onPress={() => setRadio('b')} />
            </Row>
            <Row justify="space-between">
              <Text variant="body">Semaines récurrentes</Text>
              <Stepper value={weeks} onChange={setWeeks} min={2} max={12} />
            </Row>
          </Stack>
        </Card>
      </Section>

      <Section title="Tabs & key/value">
        <Card>
          <Tabs options={[{ label: 'Aperçu', value: 'overview' }, { label: 'Élèves', value: 'students' }, { label: 'Stats', value: 'stats' }]} value={tab} onChange={setTab} />
          <Spacer size={12} />
          <KeyValue label="Cours" value="Mer. 14h00" icon={<Ionicons name="calendar" size={16} color={COLORS.muted} />} />
          <Divider />
          <KeyValue label="Élève" value="Louis 高如意" />
        </Card>
      </Section>

      <Section title="Banners & empty / loading">
        <Stack gap={12}>
          <Banner tone="warning" title="Email non vérifié" actionLabel="Vérifier" action={() => {}}>Vérifie ton email pour débloquer tout.</Banner>
          <Banner tone="success" onClose={() => {}}>Task envoyée à l'élève ✅</Banner>
          <Card><SkeletonText lines={3} /></Card>
          <Card><EmptyState icon="book-outline" title="Aucun mot" actionLabel="Ajouter un mot" onAction={() => {}}>Ta collection est vide pour l'instant.</EmptyState></Card>
        </Stack>
      </Section>

      <Section title="Feedback">
        <Card>
          <Row gap={16}>
            <Spinner size="small" />
            <Spinner size="large" />
            <Skeleton width={80} height={36} />
            <IconButton icon="heart" color={COLORS.danger} />
            <IconButton icon="share-social" />
          </Row>
        </Card>
      </Section>
    </Screen>
  );
}
