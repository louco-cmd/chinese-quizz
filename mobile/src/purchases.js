// Version WEB (et fallback) : pas d'achat in-app, le web garde Stripe.
export function configurePurchases() {}
export async function isPremiumActive() { return false; }
export async function buyPremium() { throw new Error('In-app purchase is only available in the app.'); }
export async function restorePurchases() { return false; }
export const purchasesAvailable = () => false;
