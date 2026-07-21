import { Platform } from 'react-native';

// Clés publiques RevenueCat (par plateforme). Fournies via EAS env, comme le
// client Google. Sans clé → tout no-op (l'app ne casse pas).
const ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY || '';
const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY || '';
const ENTITLEMENT = 'premium'; // identifiant de l'entitlement configuré dans RevenueCat

const apiKey = () => (Platform.OS === 'ios' ? IOS_KEY : ANDROID_KEY);
export const purchasesAvailable = () => !!apiKey();

// Charge le SDK à la demande et de façon PROTÉGÉE. Crucial pour l'OTA : un build
// livré AVANT le rebuild n'a pas le module natif → l'import top-level crasherait
// au démarrage. Ici on ne require qu'une fois la clé présente, dans un try/catch.
function RC() {
  if (!purchasesAvailable()) return null;
  try { return require('react-native-purchases').default; } catch { return null; }
}

let configured = false;

// Configure RevenueCat en liant l'achat à l'utilisateur backend (appUserID = id).
// → le webhook RevenueCat renvoie cet id comme app_user_id pour créditer le compte.
export function configurePurchases(userId) {
  const P = RC();
  if (!P || !userId) return;
  try {
    if (!configured) {
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

// Achète l'abonnement premium (1er package de l'offering courant). true si actif.
export async function buyPremium() {
  const P = RC();
  if (!P) throw new Error('In-app purchase is not available.');
  const offerings = await P.getOfferings();
  const pkg = offerings?.current?.availablePackages?.[0];
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
