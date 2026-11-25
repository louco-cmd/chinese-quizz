// Version WEB (et fallback) : pas d'achat in-app, le web garde Stripe.
export function configurePurchases() {}
export async function isPremiumActive() { return false; }
export async function buyPremium() { throw new Error('In-app purchase is only available in the app.'); }
export async function restorePurchases() { return false; }
export const purchasesAvailable = () => false;
export const isTestStore = () => false;
export function onPremiumChange() { return () => {}; }
export async function getPremiumPlans() { return []; }
export function yearlySavingPct() { return null; }
// Teacher Pro — mêmes no-op côté web (le web garde Stripe / « bientôt »).
export async function getTeacherProPlans() { return []; }
export async function isTeacherProActive() { return false; }
export async function buyTeacherPro() { throw new Error('In-app purchase is only available in the app.'); }
export function onTeacherProChange() { return () => {}; }
