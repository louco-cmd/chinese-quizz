// Chargement PARESSEUX de Sentry. Le module natif (RNSentry) n'existe que dans
// les builds qui l'embarquent. Le même bundle JS étant aussi servi en OTA à des
// builds SANS Sentry (build 15 et antérieurs), on require + init en try/catch :
// sur ces builds, Sentry reste un no-op silencieux au lieu de faire planter l'app.
let Sentry = null;
try { Sentry = require('@sentry/react-native'); } catch { Sentry = null; }

// DSN injecté au bundle via EXPO_PUBLIC_SENTRY_DSN (eas.json). Absent → désactivé.
const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

export function initSentry() {
  if (!Sentry || !DSN) return;
  try {
    Sentry.init({
      dsn: DSN,
      // Désactivé en dev (bruit inutile). Actif seulement en build release.
      enabled: !__DEV__,
      // Échantillon de traces de perf (léger). Mettre à 0 pour n'avoir que les crashs.
      tracesSampleRate: 0.1,
    });
  } catch { /* module natif absent (OTA sur ancien build) → on ignore */ }
}

// Enveloppe le composant racine (ErrorBoundary + profiling). Renvoie App inchangé
// si Sentry est indisponible.
export function wrapApp(App) {
  if (!Sentry || !DSN) return App;
  try { return Sentry.wrap(App); } catch { return App; }
}
