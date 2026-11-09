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

Légende : ✅ migré & en prod · 🔄 en cours · ⬜ à faire · ⏸️ différé (gros/risqué, pass dédié) · ➖ pas de migration utile (déjà propre / spécifique)

### Flux apprenant (prioritaire)
| Écran | L. | État | Notes |
|---|---|---|---|
| DuelsScreen | 312 | ✅ | 1re migration ; `valueColor` ajouté à StatTile |
| QuizScreen | 254 | ✅ | ProgressBar packs, EmptyState |
| AccountScreen | 274 | ✅ | StatTriplet→StatRow/StatTile ; share popup→Modal/Button ; MasteryBar gardé |
| SettingsScreen | 418 | ✅ | pills→Badge ; popups confirm→Modal/Button ; SettingsRow/Group gardés |
| StoreScreen | 161 | ⏸️ | mapping fin : search-pill+clear, chips pleins, FAB bespoke → variantes lib à créer avant |
| BankScreen | 213 | ✅ | résumé mois Pill→StatTile (`valueSize` ajouté) ; hero/TxRow gardés |
| PricingScreen | 379 | ✅ | CTA premium → Button loading ; cartes de prix bespoke gardées |
| TrophiesScreen | 132 | ✅ | jauge→ProgressBar ; rows bespoke gardés |
| LeaderboardScreen | 113 | ⏸️ | mapping fin : rows/medailles bespoke, rien ne mappe fidèlement |
| UserProfileScreen | 190 | ✅ | 2 rangées Stat→StatTile ; Challenge→Button ; MasteryGauge gardé |
| MentorProfileScreen | 321 | ⬜ | |
| MyTeacherScreen | 425 | ⬜ | |
| StudentAgendaScreen | 137 | ⬜ | |
| CoursePage | 119 | ⬜ | |
| MyClassesScreen | 98 | ⏸️ | mapping fin : group cards bespoke |
| SupportScreen | 98 | ✅ | CTA contact → Button ; FAQ statique gardée |
| LegalScreen | 96 | ➖ | texte légal statique, rien à migrer |
| TeachersScreen | 168 | ✅ | invite popup → Modal+Button ; MentorCard/Filters gardés |
| DuelDetailScreen | 309 | ⏸️ | écran-vitrine bespoke (verre brisé/VS) ; rematch=titre long (Button sans numberOfLines) |
| ImportWordsScreen | 341 | ⬜ | |
| TeachersScreen | 168 | ⬜ | MentorCard/MentorFilters → Chip |
| MentorProfileScreen | 321 | ⬜ | |
| MyTeacherScreen | 425 | ⬜ | |
| UserProfileScreen | 190 | ⬜ | |
| StudentAgendaScreen | 137 | ⬜ | |
| TrophiesScreen | 132 | ⬜ | |
| CoursePage | 119 | ⬜ | |
| MyClassesScreen | 98 | ⬜ | |
| SupportScreen | 98 | ⬜ | |
| LegalScreen | 96 | ⬜ | texte statique |
| DuelDetailScreen | 309 | ⬜ | |
| CollectionScreen | 1085 | ⏸️ | énorme ; pass dédié |
| AddWordScreen | 805 | ⏸️ | énorme ; flux cœur ; pass dédié |
| CreatePackScreen | 482 | ⏸️ | |
| ImportWordsScreen | 341 | ⬜ | |
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
| teacher/TeacherDashboardScreen | 208 | ⬜ | |
| teacher/TeacherHome | 187 | ⬜ | shell nav |
| teacher/TeacherClassScreen | 199 | ⬜ | |
| teacher/TeacherProfileScreen | 281 | ⬜ | |
| teacher/TeacherSettingsScreen | 92 | ⬜ | |
| teacher/TeacherTaskScreen | 107 | ⬜ | |
| teacher/TeacherTutorialScreen | 107 | ⬜ | |
| teacher/TeacherAgendaScreen | 739 | ⏸️ | énorme |
| teacher/EndCourseScreen | 358 | ⬜ | |
| teacher/CreateTaskPopup | 183 | ⬜ | popup |

## Journal
- 2026-11-09 : DuelsScreen, QuizScreen migrés & en prod (OTA). StatTile `valueColor` ajouté.
- 2026-11-09 : AccountScreen, SettingsScreen, BankScreen, TrophiesScreen migrés & en prod (OTA).
  StatTile `valueSize` ajouté ; Badge réutilisé (pills). Store/Leaderboard différés (mapping fin).
