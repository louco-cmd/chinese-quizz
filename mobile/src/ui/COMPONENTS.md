# Jiayou — Catalogue des composants

Design-system sous `mobile/src/ui/` (tokens + style objects, aucune dépendance
ajoutée). Import unique : `import { Button, Card, Text, Screen } from '../ui'`.
Preview visuelle : `src/ui/Gallery.js`.

---

## 1. Primitives de la lib (`src/ui/`)

### Typographie & actions
| Composant | Props clés | Rôle |
|---|---|---|
| **Text** | `variant` (display·title·subtitle·body·bodyStrong·muted·caption·label), `color`, `align`, `weight` | Toute la typo |
| **Button** | `variant` (primary·secondary·ghost·danger·outline), `size` (sm·md·lg), `loading`, `disabled`, `icon`/`iconRight`, `fullWidth` | Boutons (disabled/loading gérés 1×) |
| **IconButton** | `icon`, `size`, `color`, `bg` | Bouton rond à icône |

### Surfaces & layout
| Composant | Props clés | Rôle |
|---|---|---|
| **Card** | `padding`, `flat` | Surface blanche (radius + ombre) |
| **SectionCard** | `title`, `subtitle`, `right`, `icon` | Card titrée avec action |
| **Screen** | `scroll`, `padded`, `center`, `tabBar`, `maxWidth` | Enveloppe écran (SafeArea + TAB_CLEARANCE) |
| **Row / Stack** | `gap`, `align`, `justify`, `wrap` | Flex horizontal / vertical |
| **Spacer / Divider** | `size`/`horizontal` · — | Espace · trait |

### Saisie & contrôles
| Composant | Props clés | Rôle |
|---|---|---|
| **Input** | `label`, `icon`, `error` + props TextInput | Champ texte |
| **SegmentedControl** | `options`, `value`, `onChange` | Sélecteur « pilule » |
| **Tabs** | `options`, `value`, `onChange` | Onglets soulignés in-page |
| **Chip** | `label`, `selected`, `icon`, `onPress` | Pastille sélectionnable (filtres) |
| **Checkbox / Radio / RadioGroup** | `checked`/`selected`, `onChange`, `options` | Choix |
| **Stepper** | `value`, `onChange`, `min`/`max`/`step` | Compteur −/+ |
| **Toggle** | props Switch | Interrupteur (réexport) |

### Données & feedback
| Composant | Props clés | Rôle |
|---|---|---|
| **Badge** | `tone`, `icon` | Pastille statique |
| **StatTile / StatRow** | `value`, `label`, `icon`, `delta` | Bloc de stat |
| **ProgressBar / SegmentBar** | `value`/`max`, `segments` | Jauge de progression |
| **KeyValue** | `label`, `value` | Ligne label/valeur |
| **ListItem** | `title`, `subtitle`, `leading`, `trailing`, `chevron` | Ligne de liste |
| **Banner** | `tone`, `title`, `action`, `onClose` | Bandeau d'info/alerte inline |
| **EmptyState** | `icon`, `title`, `actionLabel`, `onAction` | Liste vide |
| **Spinner** | `size`, `center` | Chargement |
| **Skeleton / SkeletonText** | `width`, `height`, `lines` | Placeholder de chargement |

### Overlays (réexport des composants existants, déjà solides)
| Composant | Rôle |
|---|---|
| **Modal** / **Popup** | Modal centré (RN Modal, backdrop, clavier, header/footer) — `src/components/Popup.js` |
| **Sheet** | Bottom sheet — `src/components/BottomSheet.js` |

### Divers réexportés
**Avatar** (icône + couleur + nom), **Toggle**.

---

## 2. Composants métier de l'app → primitive à utiliser

Ces composants `src/components/**` et écrans se **reconstruisent/refactorent** sur les primitives :

| Composant existant | Reconstruit avec |
|---|---|
| account/StatTriplet, duels/DuelStats, quiz/QuizStats | **StatTile + StatRow** |
| account/MasteryBar | **ProgressBar / SegmentBar** |
| VerifyEmailBanner | **Banner** |
| ErrorRetry | **EmptyState** (ou **Banner** tone danger) |
| settings/SettingsRow, settings/SettingsGroup | **ListItem** / **KeyValue** dans une **SectionCard** |
| settings/SegmentedPicker | **SegmentedControl** / **Tabs** |
| teachers/MentorFilters | **Chip** |
| account/AccountCard, MyPacksCard, PurchasedPacksCard, duels/DuelSectionCard, CtaCard, quiz/QuizTypeCard, teachers/MentorCard, YourMentorsCard | **SectionCard / Card** + primitives |
| duels/DuelRows, teachers/StudentLessonRows, account/RecentQuizzes, quiz/TaskQuizzes, quiz/DifficultWords | listes de **ListItem** |
| Tous les *Popup / *Sheet (EarnCoins, PackDetail, PremiumLimit, UpdateAvailable, WordCapture, StartDuel, QuizSettings, LearningPath, JoinClass, EditProfile, CreateTask, InstagramPromo, ReviewPrompt, TrophyUnlocked, Notifications, RedEnvelope) | contenu dans **Modal/Sheet** + Button/Card/Text/Input |
| Header, Hero, account/AccountHero | shells : peuvent consommer Text/IconButton/Avatar |

---

## 3. Composants qui RESTENT spécifiques (consomment les primitives, pas remplacés)

Logique métier / rendu spécialisé — on ne les « primitivise » pas, mais ils
utilisent la lib pour leurs boutons/textes/cartes :

- **Quiz / écriture** : HanziQuiz(.native), HanziStroke(.native), hanziWriterLib, CharEvolution, RevealAnswerCard
- **Data-viz** : account/KnowledgeRing, account/ContributionsHeatmap, account/HskStatList *(KnowledgeRing = anneau ; `react-native-svg` n'est pas installé → pas de ProgressRing dans la lib pour éviter un module natif / crash OTA)*
- **Animations / branding** : CatLoader(.native/.web), NavBarLottie(.native/.web)
- **Shells de navigation** : TabBar
- **Auth SDK** : AppleSignIn(.native/.web), GoogleSignIn(.native/.web)

---

## Règle d'or
Nouvel écran → **primitives d'abord**. Écran existant → on remplace les
`style={{…}}` répétés au fil de l'eau. Un besoin récurrent non couvert → on
l'ajoute **ici** (jamais un one-off inline qui se dupliquera).
