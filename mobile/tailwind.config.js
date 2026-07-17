/** @type {import('tailwindcss').Config} */
// Tokens repris de l'EJS (public/css/accountandduels.css :root + couleurs récurrentes des vues).
module.exports = {
  content: ['./App.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Bleu Jiayou (bg-jiayou reste valide via DEFAULT)
        jiayou: {
          DEFAULT: '#0d6efd',
          dark: '#0a58ca',      // hover/pressed
          soft: '#e8f0ff',      // fond d'état actif clair
          container: '#e3f2fd', // conteneur bleu très clair
        },
        // Texte
        ink: {
          DEFAULT: '#1d1d1f',   // presque noir (titres)
          soft: '#202124',
        },
        muted: {
          DEFAULT: '#6c757d',   // texte secondaire
          light: '#8a98b5',     // texte tertiaire
        },
        // Surfaces
        surface: {
          DEFAULT: '#ffffff',   // cartes
          page: '#f8f9fa',      // fond de page
          alt: '#e9ecef',
        },
        // Lignes / bordures
        line: {
          DEFAULT: '#e0e0e0',
          soft: '#f0f0f0',
        },
        // Sémantique
        success: '#198754',
        danger: '#dc3545',
        warning: '#ffc107',
        'warning-bg': '#fff3cd',
      },
      borderRadius: {
        card: '16px',   // cartes EJS
        pill: '9999px', // pastilles / boutons ronds
      },
    },
  },
  plugins: [],
};
