import { Platform, NativeModules } from 'react-native';

// Clés publiques RevenueCat (par plateforme). Fournies via EAS env, comme le
// client Google. Sans clé → tout no-op (l'app ne casse pas).
// Une clé `test_...` cible le Test Store RevenueCat : achats simulés, aucun
// produit Play requis. Une clé `goog_...` cible le vrai Play Billing.
const ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY || '';
const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY || '';
// Identifiant de l'entitlement tel que configuré dans RevenueCat (l'IDENTIFIANT,
// pas le nom affiché). Surchargable par env sans retoucher au code.
const ENTITLEMENT = process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT || 'premium';

const rawKey = () => (Platform.OS === 'ios' ? IOS_KEY : ANDROID_KEY);

// ⚠️ Une clé `test_` (Test Store) est REFUSÉE par le SDK dans un build release :
// il affiche « Wrong API Key » et ferme l'app pour protéger les achats de test.
// On l'ignore donc hors développement → l'app retombe proprement sur Stripe au
// lieu de crasher. Le Test Store ne s'utilise qu'avec un build de dev.
const apiKey = () => {
  const k = rawKey();
  if (k.startsWith('test_') && !__DEV__) return '';
  return k;
};

// Clé de test → achats simulés : on le signale dans l'UI pour ne pas croire à une vraie vente.
export const isTestStore = () => apiKey().startsWith('test_');

// Charge le SDK à la demande et de façon PROTÉGÉE. Crucial pour l'OTA : un build
// livré AVANT le rebuild n'a pas le module natif → l'import top-level crasherait
// au démarrage. Ici on ne require qu'une fois la clé présente, dans un try/catch.
// Le SDK lit `NativeModules.RNPurchases`, qui vaut simplement `undefined` (sans
// lever d'erreur) quand le natif n'est pas dans le build → on le teste nous-mêmes,
// sinon un require() « réussi » nous donnerait un SDK inutilisable.
const nativeReady = () => { try { return !!NativeModules.RNPurchases; } catch { return false; } };

function RC() {
  if (!apiKey() || !nativeReady()) return null;
  try { return require('react-native-purchases').default; } catch { return null; }
}

// Achat in-app réellement utilisable ? Il faut la clé ET le module natif présent
// dans CE build. Un build antérieur au rebuild reçoit le même bundle OTA (même
// runtimeVersion) mais n'a pas le natif : il doit retomber sur Stripe, pas se
// retrouver avec un bouton d'achat mort.
export const purchasesAvailable = () => !!RC();

let configured = false;

// Configure RevenueCat en liant l'achat à l'utilisateur backend (appUserID = id).
// → le webhook RevenueCat renvoie cet id comme app_user_id pour créditer le compte.
export function configurePurchases(userId) {
  const P = RC();
  if (!P || !userId) return;
  try {
    if (!configured) {
      // Logs verbeux en dev / Test Store : indispensable pour diagnostiquer une
      // offering vide ou un entitlement mal nommé.
      if (__DEV__ || isTestStore()) {
        try { P.setLogLevel(require('react-native-purchases').LOG_LEVEL.DEBUG); } catch {}
      }
      P.configure({ apiKey: apiKey(), appUserID: String(userId) });
      configured = true;
    } else {
      P.logIn(String(userId)).catch(() => {});
    }
  } catch { /* module natif absent */ }
}

// L'entitlement premium est-il actif côté RevenueCat (source immédiate pour l'UI).
export async function isPremiumActive() {
  const P = RC();
  if (!P) return false;
  try {
    const info = await P.getCustomerInfo();
    return !!info?.entitlements?.active?.[ENTITLEMENT];
  } catch { return false; }
}

// S'abonne aux changements d'entitlement (achat, renouvellement, expiration) sans
// re-interroger. Renvoie une fonction de désabonnement (no-op si indisponible).
export function onPremiumChange(cb) {
  const P = RC();
  if (!P) return () => {};
  try {
    const listener = (info) => cb(!!info?.entitlements?.active?.[ENTITLEMENT]);
    P.addCustomerInfoUpdateListener(listener);
    return () => { try { P.removeCustomerInfoUpdateListener(listener); } catch {} };
  } catch { return () => {}; }
}

// Normalise un package RevenueCat pour l'UI. Le prix vient TOUJOURS du store
// (priceString localisé) — jamais de prix codé en dur : c'est une exigence des
// stores et ça gère devise + i18n gratuitement.
function toPlan(pkg) {
  const type = pkg?.packageType;
  const annual = type === 'ANNUAL' || /year|annual/i.test(pkg?.identifier || '');
  return {
    id: pkg.identifier,
    pkg,
    annual,
    label: annual ? 'Yearly' : type === 'MONTHLY' ? 'Monthly' : pkg.identifier,
    priceString: pkg?.product?.priceString || '',
    price: pkg?.product?.price ?? null,
    period: annual ? 'per year' : 'per month',
  };
}

// Offres disponibles (offering "current" du dashboard). [] si rien de configuré.
// Mensuel d'abord, annuel ensuite.
export async function getPremiumPlans() {
  const P = RC();
  if (!P) return [];
  try {
    const offerings = await P.getOfferings();
    const pkgs = offerings?.current?.availablePackages || [];
    return pkgs.map(toPlan).sort((a, b) => Number(a.annual) - Number(b.annual));
  } catch { return []; }
}

// Économie de l'annuel vs 12 × mensuel (ex. 33 → "Save 33%"), ou null.
export function yearlySavingPct(plans) {
  const m = plans.find((p) => !p.annual)?.price;
  const y = plans.find((p) => p.annual)?.price;
  if (!m || !y) return null;
  const pct = Math.round((1 - y / (m * 12)) * 100);
  return pct > 0 ? pct : null;
}

// Achète un plan précis. `plan` vient de getPremiumPlans() ; sans argument on
// retombe sur le 1er package de l'offering (compat ascendante).
export async function buyPremium(plan) {
  const P = RC();
  if (!P) throw new Error('In-app purchase is not available.');
  let pkg = plan?.pkg;
  if (!pkg) {
    const offerings = await P.getOfferings();
    pkg = offerings?.current?.availablePackages?.[0];
  }
  if (!pkg) throw new Error('No subscription offer available right now.');
  const { customerInfo } = await P.purchasePackage(pkg);
  return !!customerInfo?.entitlements?.active?.[ENTITLEMENT];
}

// Restaure un achat (changement d'appareil).
export async function restorePurchases() {
  const P = RC();
  if (!P) return false;
  const info = await P.restorePurchases();
  return !!info?.entitlements?.active?.[ENTITLEMENT];
}
