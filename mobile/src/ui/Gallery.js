// Gallery — écran de preview (dev) de toute la design-system. Branche-le sur une
// route dev pour voir/valider toutes les primitives d'un coup.
//   import Gallery from '../ui/Gallery';  →  <Gallery />
import { useState } from 'react';
import { View } from 'react-native';
import {
  Screen, Card, Text, Button, Input, Badge, IconButton, ListItem, Spinner,
  SegmentedControl, Row, Stack, Spacer, Divider, Toggle, Avatar, COLORS,
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

      <Section title="Feedback">
        <Card>
          <Row gap={16}>
            <Spinner size="small" />
            <Spinner size="large" />
            <Spacer horizontal size={8} />
            <IconButton icon="heart" color={COLORS.danger} />
            <IconButton icon="share-social" />
          </Row>
        </Card>
      </Section>
    </Screen>
  );
}
