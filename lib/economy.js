// Constantes d'économie partagées entre le web (server.js) et l'API mobile
// (routes/mobile.js) pour éviter toute dérive entre les voies d'inscription.

// Solde de coins offert à la création d'un compte, IDENTIQUE quelle que soit la
// voie (web/mobile × email/Google/Apple). Un compte parrainé reçoit en plus le
// bonus d'invité (voir lib/referral.js INVITEE_BONUS), à la vérification.
const SIGNUP_GRANT = 350;

module.exports = { SIGNUP_GRANT };
