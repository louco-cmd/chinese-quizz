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

// ✅ INTERRUPTEUR MAÎTRE — feature ACTIVE. La revue in-app s'ouvre sur un vrai
// moment positif (throttlée par l'appli ET par l'OS). Sur le binaire 1.1.3 actuel
// (sans le module natif) elle reste dormante ; elle devient effective dès le
// prochain build natif embarquant `expo-store-review`. Repasser à `false` la coupe
// partout, instantanément, par OTA.
const REVIEW_PROMPT_ENABLED = true;

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

// `expo-store-review` est de nouveau dans les dépendances (expo ≥ 57.0.13 corrige
// le bug SceneGeometry qui cassait le build 1.1.3). Chargement LAZY en try/catch :
// sur un build qui N'EMBARQUE PAS encore le module natif (binaire 1.1.3 actuel),
// l'appel natif échoue et tout retombe en no-op (cf. garde-fous plus bas) → aucune
// popup, aucun crash. La revue in-app s'active pleinement au PROCHAIN build natif.
function nativeStoreReview() {
  if (isWeb) return null;
  // ⚠️ On NE require PAS expo-store-review tant que son module natif n'est pas dans
  // le build : sur la New Architecture ce require peut CRASHER EN DUR (non
  // rattrapable par try/catch), comme vu avec react-native-view-shot. On teste
  // d'abord la présence du natif via requireOptionalNativeModule (qui ne throw pas
  // et ne charge pas la lib). Sur le binaire actuel → null → dormant, aucun crash.
  try {
    const core = require('expo-modules-core');
    const present = typeof core.requireOptionalNativeModule === 'function'
      ? !!core.requireOptionalNativeModule('ExpoStoreReview')
      : !!(core.NativeModulesProxy && core.NativeModulesProxy.ExpoStoreReview);
    if (!present) return null;
    return require('expo-store-review');
  } catch { return null; }
}

// Conditions de déclenchement. L'OS throttle DÉJÀ agressivement `requestReview`
// (Apple ~3/an, Google idem) ; ce garde-fou applicatif évite juste d'appeler
// l'API trop tôt ou trop souvent, et cible un VRAI moment positif.
const MIN_POSITIVE_MOMENTS = 3;                        // au moins 3 bons moments avant de demander
const COOLDOWN_MS = 120 * 24 * 60 * 60 * 1000;         // 120 jours entre deux demandes
const DEFAULT_MIN_SCORE_RATIO = 0.6;                   // quiz « réussi » = ≥ 60 %

// ── Pré-prompt en deux temps ────────────────────────────────────────────────
// On N'ouvre PAS la feuille native directement : d'abord un petit sheet maison
// « Tu aimes Jiayou ? ». Seuls les gens CONTENTS (😍) déclenchent la vraie
// notation store → on ne gaspille pas le quota rare (Apple ~3/an) sur des avis
// tièdes, et on intercepte le mécontentement en privé (mailto support). C'est le
// standard du secteur pour maximiser les notes 4-5★.
//
// App.js enregistre un handler via setReviewPromptHandler ; quand les conditions
// sont réunies, registerPositiveMoment appelle ce handler qui affiche le sheet.
let _showPrePrompt = null;
export function setReviewPromptHandler(fn) { _showPrePrompt = typeof fn === 'function' ? fn : null; }

// Ouvre la VRAIE feuille de notation in-app native (chemin 😍 du sheet). No-op
// silencieux si le module/OS ne la propose pas. Renvoie true si on l'a ouverte.
export async function requestNativeReview() {
  try {
    const SR = nativeStoreReview();
    if (!SR) return false;
    await SR.requestReview();
    return true;
  } catch { return false; }
}

// À appeler sur un MOMENT POSITIF (quiz réussi, duel gagné…). Incrémente un
// compteur et, une fois les conditions réunies, AFFICHE le pré-prompt (pas la
// feuille native directement). `scoreRatio` (0..1) qualifie la positivité du
// moment ; en dessous du seuil on ne compte même pas l'évènement (jamais d'avis
// après un échec).
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
    // Inutile de demander « tu aimes ? » si on n'a rien à ouvrir derrière.
    let available = true;
    try {
      if (typeof SR.isAvailableAsync === 'function') available = await SR.isAvailableAsync();
      else if (typeof SR.hasAction === 'function') available = await SR.hasAction();
    } catch { available = false; }
    if (!available) return;

    // On marque la demande MAINTENANT : même si l'utilisateur ferme le pré-prompt,
    // on ne le re-sollicitera pas avant le cooldown (pas de harcèlement).
    await writeFlag(ASKED_AT_KEY, String(Date.now()));

    if (_showPrePrompt) _showPrePrompt();              // → App.js affiche le sheet
    else await SR.requestReview();                     // repli : pas de handler → feuille native directe
  } catch {
    /* silencieux : la revue est un bonus, elle ne doit JAMAIS bloquer ni crasher */
  }
}
