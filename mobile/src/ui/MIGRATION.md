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

## État — ✅ tous les écrans migrés (2026-11-09)

Toute l'app passe désormais par les primitives pour ses éléments standards
(boutons, champs, stats, jauges, pills, popups). Ne restent volontairement
**feature-specific** (comme KnowledgeRing/TabBar) que les rendus vraiment uniques :
CrackOverlay (duel défaite), médailles de classement, search-pill + clear (Store/
AddWord/Collection), FAB, StatTile remplie, calendrier prof, grille de collection,
HanziQuiz/écriture, sélecteurs de cover/swatches, CtaCard (dégradés de marque),
shells de navigation (TeacherHome, VideoCall).

Légende : ✅ migré & en prod · ⬜ à faire · ⏸️ différé (gros/risqué, pass dédié) · 🪶 mapping fin (bespoke, rien ne mappe fidèlement sans redesign) · ➖ pas de migration utile

### Flux apprenant (prioritaire)
| Écran | L. | État | Notes |
|---|---|---|---|
| DuelsScreen | 312 | ✅ | 1re migration ; `valueColor` ajouté à StatTile |
| QuizScreen | 254 | ✅ | ProgressBar packs, EmptyState |
| AccountScreen | 274 | ✅ | StatTriplet→StatRow/StatTile ; share popup→Modal/Button ; MasteryBar gardé |
| SettingsScreen | 418 | ✅ | pills→Badge ; popups confirm→Modal/Button ; SettingsRow/Group gardés |
| StoreScreen | 161 | ✅ | tri→Chip solid ; search-pill+clear & FAB feature-specific gardés |
| BankScreen | 213 | ✅ | résumé mois Pill→StatTile (`valueSize` ajouté) ; hero/TxRow gardés |
| PricingScreen | 379 | ✅ | CTA premium → Button loading ; cartes de prix bespoke gardées |
| TrophiesScreen | 132 | ✅ | jauge→ProgressBar ; rows bespoke gardés |
| UserProfileScreen | 190 | ✅ | 2 rangées Stat→StatTile ; Challenge→Button ; MasteryGauge gardé |
| SupportScreen | 98 | ✅ | CTA contact → Button ; FAQ statique gardée |
| TeachersScreen | 168 | ✅ | invite popup → Modal+Button ; MentorCard/Filters gardés |
| CoursePage | 119 | ✅ | « Practice » → Button loading |
| LeaderboardScreen | 113 | ✅ | shell→Screen ; rangées médailles feature-specific gardées |
| MyClassesScreen | 98 | ✅ | pill ended→Badge |
| DuelDetailScreen | 309 | ✅ | rematch→Button (textNumberOfLines ajouté) ; verre brisé/VS gardés |
| ImportWordsScreen | 341 | ✅ | preview/done/import→Button (disabled standard) |
| StudentAgendaScreen | 137 | ✅ | join/cancel/book→Button sm |
| MentorProfileScreen | 321 | ✅ | book-trial+confirm→Button ; StatTile rempli gardé |
| MyTeacherScreen | 425 | ✅ | BookBtn/rate/leave→Button ; comment→Input ; weeks→Chip solid |
| LegalScreen | 96 | ➖ | texte légal statique |
| CollectionScreen | 1085 | ✅ | 6 popups→Modal ; bulk/edit/delete→Button ; grille/recherche bespoke |
| AddWordScreen | 805 | ✅ | results popup→Modal ; capture/save→Button ; barres de recherche bespoke |
| CreatePackScreen | 482 | ✅ | lang chips→Chip solid ; CTAs→Button ; popups→Modal |
| QuizPlayScreen | 548 | ✅ | submit/restart/exit/result→Button ; rendu du quiz intact |
| DuelPlayScreen | 426 | ✅ | submit→Button ; leave popup→Modal ; rendu intact |
| WritingPracticeScreen | 266 | ✅ | result CTAs→Button ; HanziQuiz intact |

### Auth / plein écran (SafeArea propre — garder le shell, migrer seulement boutons/textes)
| Écran | L. | État | Notes |
|---|---|---|---|
| LoginScreen | 285 | ✅ | CTAs→Button ; champs verrouillés/œil/parrainage gardés |
| ForgotPasswordScreen | 73 | ✅ | CTAs→Button ; champ→Input |
| ResetPasswordScreen | 102 | ✅ | CTAs→Button ; champs→Input |
| WelcomePremiumScreen | 73 | ✅ | CTAs→Button |
| TutorialScreen | 147 | ✅ | CTA Start→Button ; flèches carrousel gardées |
| OnboardingScreen | 697 | ✅ | PrimaryButton→Button ; champs/segmented/CtaCard gardés |
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
| teacher/TeacherTutorialScreen | 107 | ✅ | CTA Done→Button ; flèches gardées |
| teacher/TeacherHome | 187 | ➖ | shell de navigation (header + tab bar), rien à migrer |
| teacher/TeacherAgendaScreen | 739 | ✅ | CTAs de modes→Button ; calendrier/chips d'heure/delete rouge-outline gardés |

## Journal
- 2026-11-09 : DuelsScreen, QuizScreen migrés & en prod (OTA). StatTile `valueColor` ajouté.
- 2026-11-09 : AccountScreen, SettingsScreen, BankScreen, TrophiesScreen migrés & en prod (OTA).
  StatTile `valueSize` ajouté ; Badge réutilisé (pills).
- 2026-11-09 : Pricing, UserProfile, Support, Teachers, CoursePage + prof (Dashboard, Class, Task,
  Settings, Profile, EndCourse, CreateTaskPopup) migrés & en prod (OTA).
- 2026-11-09 : objectif 100 % component. Auth (Login/Forgot/Reset/WelcomePremium/Tutorial),
  MentorProfile, MyTeacher, TeacherTutorial migrés. Lib enrichie : Chip `variant='solid'` +
  Button `textNumberOfLines`. Écrans 🪶 ramenés dans la lib (Store tri→Chip solid, MyClasses
  pill→Badge, StudentAgenda pills→Button, ImportWords CTAs→Button, DuelDetail rematch→Button,
  Leaderboard shell→Screen). Éléments vraiment spécifiques (verre brisé, médailles, search-pill,
  FAB, StatTile rempli) laissés feature-specific, comme KnowledgeRing/TabBar/CrackOverlay.
  Restent : gros écrans cœur ⏸️ (Collection, AddWord, CreatePack, QuizPlay, DuelPlay, Writing,
  Onboarding, TeacherAgenda).
- 2026-11-09 : **100 % atteint.** Gros écrans migrés (CreatePack, QuizPlay, DuelPlay, Writing,
  Onboarding, TeacherAgenda, AddWord, Collection). Chaque écran utilise les primitives pour ses
  éléments standards ; rendus vraiment uniques laissés feature-specific (voir en-tête). Règle
  permanente : nouvel écran → primitives d'abord ; besoin récurrent non couvert → l'ajouter à la lib.
