# Migration des écrans vers la design-system (`src/ui`)

Suivi de la bascule des écrans de `style={{…}}` inline vers les primitives de
`src/ui`. **Reprendre ici** à chaque nouvelle session. Voir `COMPONENTS.md` pour
le catalogue des primitives.

## Recette (appliquée à chaque écran)

1. **Shell** : `View + ScrollView + wrapper maxWidth` → `<Screen edges={[]} maxWidth={1200}>`.
   - `edges={[]}` **obligatoire** pour les écrans montés sous le `Header` de l'app
     (App.js `renderScreen()`), qui gère déjà le safe-area du haut → sinon double padding.
   - Les écrans **plein écran** (login, onboarding, visio) gèrent leur propre SafeArea → garder.
   - `refreshControl` / props ScrollView passent via `...rest` sur `<Screen>`.
2. **Stats** (`Cell` inline) → `StatRow` + `StatTile` (prop `valueColor` pour colorer la valeur).
3. **Jauges** (track+fill en Views) → `<ProgressBar>` / `<SegmentBar>`.
4. **Boutons** (`Pressable` + styles `busy ? … : …`) → `<Button>` (variants, `loading`, `disabled` 1×).
5. **Typo** (`<Text style={{fontSize…}}>`) → `<Text variant>` (+ `weight`/`color`/`align`).
6. **Layout** (`flexDirection:'row', gap`) → `<Row>` / `<Stack>` ; rangées de CTA égales → `<Row align="stretch">`.
7. **Popups** → `<Modal>` (= `components/Popup`, via la barre d'export `../ui`) ; `header`/`footer` conservés.
8. **États vides** → `<EmptyState>` ; bandeaux → `<Banner>` ; lignes de liste → `<ListItem>` ; label/valeur → `<KeyValue>`.
9. **Gardé inline volontairement** (hors périmètre lib, commenté dans le code) :
   `CtaCard` (dégradés de marque), CTA « boutique » violets, affichages uniques (code parrainage…),
   data-viz spécifique (KnowledgeRing, heatmap).
10. **Vérif** : `babel.transformFileSync` avec presets `babel-preset-expo` + `nativewind/babel` → doit compiler.
11. **Déploiement** : commit par écran (revert facile) ; push + `eas update --channel production
    --environment production` par checkpoint (~5 écrans).

## État

Légende : ✅ migré & en prod · ⬜ à faire · ⏸️ différé (gros/risqué, pass dédié) · 🪶 mapping fin (bespoke, rien ne mappe fidèlement sans redesign) · ➖ pas de migration utile

### Flux apprenant (prioritaire)
| Écran | L. | État | Notes |
|---|---|---|---|
| DuelsScreen | 312 | ✅ | 1re migration ; `valueColor` ajouté à StatTile |
| QuizScreen | 254 | ✅ | ProgressBar packs, EmptyState |
| AccountScreen | 274 | ✅ | StatTriplet→StatRow/StatTile ; share popup→Modal/Button ; MasteryBar gardé |
| SettingsScreen | 418 | ✅ | pills→Badge ; popups confirm→Modal/Button ; SettingsRow/Group gardés |
| StoreScreen | 161 | 🪶 | search-pill+clear, chips pleins, FAB bespoke → variantes lib à créer avant |
| BankScreen | 213 | ✅ | résumé mois Pill→StatTile (`valueSize` ajouté) ; hero/TxRow gardés |
| PricingScreen | 379 | ✅ | CTA premium → Button loading ; cartes de prix bespoke gardées |
| TrophiesScreen | 132 | ✅ | jauge→ProgressBar ; rows bespoke gardés |
| UserProfileScreen | 190 | ✅ | 2 rangées Stat→StatTile ; Challenge→Button ; MasteryGauge gardé |
| SupportScreen | 98 | ✅ | CTA contact → Button ; FAQ statique gardée |
| TeachersScreen | 168 | ✅ | invite popup → Modal+Button ; MentorCard/Filters gardés |
| CoursePage | 119 | ✅ | « Practice » → Button loading |
| LeaderboardScreen | 113 | 🪶 | rows/médailles bespoke |
| MyClassesScreen | 98 | 🪶 | group cards bespoke |
| DuelDetailScreen | 309 | 🪶 | écran-vitrine (verre brisé/VS) ; rematch=titre long (Button sans numberOfLines) |
| ImportWordsScreen | 341 | 🪶 | boutons désactivés gris bespoke (#e9ecef) + bouton radius-14 |
| StudentAgendaScreen | 137 | 🪶 | petits pills en lignes denses (risque de décalage) |
| LegalScreen | 96 | ➖ | texte légal statique |
| MentorProfileScreen | 321 | ⬜ | à faire |
| MyTeacherScreen | 425 | ⬜ | à faire |
| CollectionScreen | 1085 | ⏸️ | énorme ; pass dédié |
| AddWordScreen | 805 | ⏸️ | énorme ; flux cœur ; pass dédié |
| CreatePackScreen | 482 | ⏸️ | pass dédié |
| QuizPlayScreen | 548 | ⏸️ | moteur de quiz ; risqué |
| DuelPlayScreen | 426 | ⏸️ | moteur de duel ; risqué |
| WritingPracticeScreen | 266 | ⏸️ | natif/hanzi ; risqué |

### Auth / plein écran (SafeArea propre — garder le shell, migrer seulement boutons/textes)
| Écran | L. | État | Notes |
|---|---|---|---|
| LoginScreen | 285 | ⬜ | garder SafeArea |
| OnboardingScreen | 697 | ⏸️ | garder SafeArea ; gros |
| ForgotPasswordScreen | 73 | ⬜ | |
| ResetPasswordScreen | 102 | ⬜ | |
| WelcomePremiumScreen | 73 | ⬜ | |
| TutorialScreen | 147 | ⬜ | |
| VideoCallScreen | 145 | ➖ | plein écran visio spécifique |

### Plateforme prof
| Écran | L. | État | Notes |
|---|---|---|---|
| teacher/TeacherDashboardScreen | 208 | ✅ | « New class » popup → Modal+Button |
| teacher/TeacherClassScreen | 199 | ✅ | Bar→ProgressBar ; delete→Modal+Button |
| teacher/TeacherTaskScreen | 107 | ✅ | progress→ProgressBar ; delete→Modal+Button |
| teacher/TeacherSettingsScreen | 92 | ✅ | popups confirm→Modal+Button |
| teacher/TeacherProfileScreen | 281 | ✅ | publish→Button lg ; currency popup→Modal |
| teacher/EndCourseScreen | 358 | ✅ | Send/Skip→Button ; form bespoke gardé |
| teacher/CreateTaskPopup | 183 | ✅ | wizard 3 étapes : boutons footer→Button ; Modal |
| teacher/TeacherHome | 187 | ⬜ | shell nav (à vérifier) |
| teacher/TeacherTutorialScreen | 107 | ⬜ | à faire |
| teacher/TeacherAgendaScreen | 739 | ⏸️ | énorme ; pass dédié |

## Journal
- 2026-11-09 : DuelsScreen, QuizScreen migrés & en prod (OTA). StatTile `valueColor` ajouté.
- 2026-11-09 : AccountScreen, SettingsScreen, BankScreen, TrophiesScreen migrés & en prod (OTA).
  StatTile `valueSize` ajouté ; Badge réutilisé (pills).
- 2026-11-09 : Pricing, UserProfile, Support, Teachers, CoursePage + prof (Dashboard, Class, Task,
  Settings, Profile, EndCourse, CreateTaskPopup) migrés. Écrans « mapping fin » (🪶) laissés
  bespoke pour ne pas changer le rendu. Restent : MentorProfile, MyTeacher, auth, + gros différés.
