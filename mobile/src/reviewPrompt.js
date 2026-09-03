// Popup « note l'app » via l'API de revue IN-APP native (App Store / Play Store) :
// l'utilisateur note SANS quitter l'app. On passe par `expo-store-review`.
//
// OTA-SAFE / DORMANT : le module natif `expo-store-review` n'existe que sur un
// build qui l'embarque. On le charge en LAZY dans un try/catch → sur le build
// actuel (sans le module) ou sur le web, `nativeStoreReview()` renvoie null et
// TOUT devient un no-op silencieux. Aucun crash, aucun prompt. La feature
// s'ACTIVE d'elle-même au prochain build natif qui inclut la dépendance, puis
// via OTA. Même philosophie que les autres modules dormants (Sentry, Apple).
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// ⛔ INTERRUPTEUR MAÎTRE — laisse la feature DORMANTE même sur un build qui embarque
// `expo-store-review`. Le terrain est prêt (dépendance + code + déclencheurs), mais
// AUCUNE popup ne s'ouvre tant que ce flag est `false`. Pour l'activer plus tard,
// une fois l'interaction peaufinée : passer à `true` → part par simple OTA (pas de
// rebuild, le module natif est déjà dans le binaire). C'est le SEUL point à toucher.
const REVIEW_PROMPT_ENABLED = false;

const isWeb = Platform.OS === 'web';

// Petit stockage local (miroir du token) : SecureStore en natif, localStorage sur
// web. Uniquement des flags non sensibles (compteur + date de dernière demande).
const ASKED_AT_KEY = 'jiayou_review_asked_at';   // timestamp de la dernière demande
const POSITIVE_KEY = 'jiayou_review_positive';   // nb de moments positifs cumulés

async function readFlag(k) {
  try {
    if (isWeb) return typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null;
    return await SecureStore.getItemAsync(k);
  } catch { return null; }
}
async function writeFlag(k, v) {
  try {
    if (isWeb) { if (typeof localStorage !== 'undefined') localStorage.setItem(k, v); return; }
    await SecureStore.setItemAsync(k, v);
  } catch { /* noop */ }
}

// ⚠️ MODULE NATIF VOLONTAIREMENT NON EMBARQUÉ dans le build 1.1.3 : `expo-store-review`
// @57.0.2 exige expo 57.0.13 (il appelle `SceneGeometry.foregroundScene()`, absent de
// expo-modules-core 57.0.12) → la compilation iOS échouait. Comme la feature est de
// toute façon DORMANTE (REVIEW_PROMPT_ENABLED=false), on retire le module de ce build.
// POUR ACTIVER PLUS TARD : (1) aligner expo puis `npx expo install expo-store-review`,
// (2) restaurer le require ci-dessous, (3) passer REVIEW_PROMPT_ENABLED à true.
function nativeStoreReview() {
  return null;
  // if (isWeb) return null;
  // try { return require('expo-store-review'); } catch { return null; }
}

// Conditions de déclenchement. L'OS throttle DÉJÀ agressivement `requestReview`
// (Apple ~3/an, Google idem) ; ce garde-fou applicatif évite juste d'appeler
// l'API trop tôt ou trop souvent, et cible un VRAI moment positif.
const MIN_POSITIVE_MOMENTS = 3;                        // au moins 3 bons moments avant de demander
const COOLDOWN_MS = 120 * 24 * 60 * 60 * 1000;         // 120 jours entre deux demandes
const DEFAULT_MIN_SCORE_RATIO = 0.6;                   // quiz « réussi » = ≥ 60 %

// À appeler sur un MOMENT POSITIF (quiz réussi, duel gagné…). Incrémente un
// compteur et, une fois les conditions réunies, ouvre la revue in-app native.
// `scoreRatio` (0..1) qualifie la positivité du moment ; en dessous du seuil on
// ne compte même pas l'évènement (on ne demande pas d'avis après un échec).
export async function registerPositiveMoment({ scoreRatio = 1, minScoreRatio = DEFAULT_MIN_SCORE_RATIO } = {}) {
  try {
    if (!REVIEW_PROMPT_ENABLED) return;                // interrupteur maître OFF → dormant
    if (!(scoreRatio >= minScoreRatio)) return;        // moment pas assez positif
    const SR = nativeStoreReview();
    if (!SR) return;                                    // build sans le module → dormant

    // Déjà demandé récemment ? (throttle applicatif en plus de celui de l'OS)
    const askedAt = parseInt((await readFlag(ASKED_AT_KEY)) || '0', 10);
    if (askedAt && Date.now() - askedAt < COOLDOWN_MS) return;

    // Assez de bons moments cumulés ?
    const positive = parseInt((await readFlag(POSITIVE_KEY)) || '0', 10) + 1;
    await writeFlag(POSITIVE_KEY, String(positive));
    if (positive < MIN_POSITIVE_MOMENTS) return;

    // L'API in-app review est-elle réellement disponible sur cet appareil/OS ?
    let available = true;
    try {
      if (typeof SR.isAvailableAsync === 'function') available = await SR.isAvailableAsync();
      else if (typeof SR.hasAction === 'function') available = await SR.hasAction();
    } catch { available = false; }
    if (!available) return;

    await SR.requestReview();
    await writeFlag(ASKED_AT_KEY, String(Date.now()));  // ne redemandera pas avant le cooldown
  } catch {
    /* silencieux : la revue est un bonus, elle ne doit JAMAIS bloquer ni crasher */
  }
}
