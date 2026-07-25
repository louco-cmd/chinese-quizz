// Garde anti-spam pour la création de comptes. Tout est côté serveur : aucune
// dépendance externe (pas de CAPTCHA Google, bloqué en Chine où se trouve notre
// public) et aucun changement d'app nécessaire — un déploiement Render suffit.
const rateLimit = require('express-rate-limit');

// Limite stricte, SPÉCIFIQUE à l'inscription : un humain ne crée quasi jamais
// plus de quelques comptes par heure depuis une même IP. La limite globale /api
// (200/min) est bien trop lâche pour ça.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,           // 1 heure
  max: 6,                             // 6 nouveaux comptes / IP / heure
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many accounts created from this network. Try again later.' },
});

// Domaines jetables / de test : signature nette des bots (@example.com de la
// capture, adresses temporaires). Liste courte des plus courants ; extensible.
const BLOCKED_DOMAINS = new Set([
  'example.com', 'example.org', 'example.net', 'test.com', 'test.test',
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.info', '10minutemail.com',
  'tempmail.com', 'temp-mail.org', 'throwawaymail.com', 'yopmail.com', 'trashmail.com',
  'sharklasers.com', 'getnada.com', 'maildrop.cc', 'dispostable.com', 'fakeinbox.com',
  'mvrht.com', 'discard.email', 'mailnesia.com', 'spam4.me', 'tmpmail.org',
]);

// Valide un email pour l'inscription. Renvoie { ok } ou { ok:false, reason }.
function validateSignupEmail(raw) {
  const email = String(raw || '').toLowerCase().trim();
  // Format basique : un @ , un domaine avec point, pas d'espace.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, reason: 'Please enter a valid email address.' };
  const domain = email.split('@')[1];
  if (BLOCKED_DOMAINS.has(domain)) return { ok: false, reason: 'This email domain is not allowed.' };
  return { ok: true, email };
}

module.exports = { registerLimiter, validateSignupEmail, BLOCKED_DOMAINS };
