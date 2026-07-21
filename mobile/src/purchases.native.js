import { Platform } from 'react-native';
import Purchases from 'react-native-purchases';

// Clés publiques RevenueCat (par plateforme). Fournies via EAS env, comme le
// client Google. Sans clé, tout no-op → l'app ne casse pas.
const ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY || '';
const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY || '';
const ENTITLEMENT = 'premium'; // identifiant de l'entitlement configuré dans RevenueCat

const apiKey = () => (Platform.OS === 'ios' ? IOS_KEY : ANDROID_KEY);
export const purchasesAvailable = () => !!apiKey();

let configured = false;

// Configure RevenueCat en liant l'achat à l'utilisateur backend (appUserID = id).
// → le webhook RevenueCat renvoie cet id comme app_user_id pour créditer le compte.
export function configurePurchases(userId) {
  if (!purchasesAvailable() || !userId) return;
  try {
    if (!configured) {
      Purchases.configure({ apiKey: apiKey(), appUserID: String(userId) });
      configured = true;
    } else {
      Purchases.logIn(String(userId)).catch(() => {});
    }
  } catch { /* SDK indispo */ }
}

// L'entitlement premium est-il actif côté RevenueCat (source immédiate pour l'UI).
export async function isPremiumActive() {
  try {
    const info = await Purchases.getCustomerInfo();
    return !!info?.entitlements?.active?.[ENTITLEMENT];
  } catch { return false; }
}

// Achète l'abonnement premium (1er package de l'offering courant). true si actif.
export async function buyPremium() {
  if (!purchasesAvailable()) throw new Error('In-app purchase is not available.');
  const offerings = await Purchases.getOfferings();
  const pkg = offerings?.current?.availablePackages?.[0];
  if (!pkg) throw new Error('No subscription offer available right now.');
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  return !!customerInfo?.entitlements?.active?.[ENTITLEMENT];
}

// Restaure un achat (changement d'appareil).
export async function restorePurchases() {
  if (!purchasesAvailable()) return false;
  const info = await Purchases.restorePurchases();
  return !!info?.entitlements?.active?.[ENTITLEMENT];
}
