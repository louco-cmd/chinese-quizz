import { useState, useEffect } from 'react';
import { getLanguages } from './api';

// Métadonnées de langue pour le cours multilingue. Le backend renvoie déjà le
// terme appris dans `word.chinese` et la traduction native dans `word.english`
// (dérivée du concept) : le frontend n'a besoin que de la langue apprise
// (pinyin/hanzi/voix/types de quiz) et des libellés.

// Base statique (fallback hors-ligne / premier rendu). Enrichie au runtime par
// /api/m/languages (voir loadLanguages) → une nouvelle langue (ex. espagnol)
// apparaît sans toucher au code.
export const LANG_META = {
  zh: { label: 'Chinese', endonym: '中文', hasPinyin: true, tts: 'zh-CN' },
  en: { label: 'English', endonym: 'English', hasPinyin: false, tts: 'en-US' },
  fr: { label: 'French', endonym: 'Français', hasPinyin: false, tts: 'fr-FR' },
  es: { label: 'Spanish', endonym: 'Español', hasPinyin: false, tts: 'es-ES' },
  de: { label: 'German', endonym: 'Deutsch', hasPinyin: false, tts: 'de-DE' },
  it: { label: 'Italian', endonym: 'Italiano', hasPinyin: false, tts: 'it-IT' },
  pt: { label: 'Portuguese', endonym: 'Português', hasPinyin: false, tts: 'pt-PT' },
  ja: { label: 'Japanese', endonym: '日本語', hasPinyin: false, tts: 'ja-JP' },
  ko: { label: 'Korean', endonym: '한국어', hasPinyin: false, tts: 'ko-KR' },
  ru: { label: 'Russian', endonym: 'Русский', hasPinyin: false, tts: 'ru-RU' },
};

// Langues de BASE / d'interface : celles qui ont une traduction de l'UI (i18n).
// On apprend DEPUIS l'une d'elles. Distinct des langues apprenables (dynamiques).
export const INTERFACE_LANGS = ['en', 'zh', 'fr'];

// Fallback statique des langues apprenables (avant le fetch réactif).
export const LEARNABLE = ['zh', 'en', 'fr'];

// ── État réactif des langues apprenables (chargé depuis le backend) ────────────
let _learnable = null;        // null = pas encore chargé → fallback LEARNABLE
let _loading = null;          // promesse en cours (dédup)
const _subs = new Set();      // composants à re-rendre au chargement
const _notify = () => _subs.forEach((fn) => { try { fn(); } catch { /* noop */ } });

// Charge (une fois, ou force) la liste depuis /api/m/languages, fusionne les
// métadonnées serveur dans LANG_META, met à jour la liste apprenable.
export function loadLanguages(force = false) {
  if (_loading && !force) return _loading;
  _loading = getLanguages()
    .then((d) => {
      const list = d?.languages || [];
      if (list.length) {
        list.forEach((l) => {
          LANG_META[l.code] = {
            label: l.name || LANG_META[l.code]?.label || l.code,
            endonym: l.endonym || LANG_META[l.code]?.endonym || l.code,
            hasPinyin: l.has_pinyin != null ? !!l.has_pinyin : !!LANG_META[l.code]?.hasPinyin,
            tts: l.tts || LANG_META[l.code]?.tts,
          };
        });
        _learnable = list.map((l) => l.code);
        _notify();
      }
      return _learnable || LEARNABLE;
    })
    .catch(() => LEARNABLE)
    .finally(() => { _loading = null; });
  return _loading;
}

export const getLearnable = () => _learnable || LEARNABLE;

// Hook : renvoie la liste des langues apprenables (dynamique si chargée, sinon le
// fallback), et déclenche le chargement au montage.
export function useLearnableLangs() {
  const [list, setList] = useState(getLearnable());
  useEffect(() => {
    const update = () => setList(getLearnable());
    _subs.add(update);
    loadLanguages().then(update);
    return () => { _subs.delete(update); };
  }, []);
  return list;
}

// Helpers sûrs. Pour une langue inconnue, on synthétise une entrée neutre (pas de
// pinyin, pas de voix) plutôt que de retomber sur le chinois.
export const langMeta = (code) =>
  LANG_META[code] || { label: code, endonym: code, hasPinyin: false, tts: undefined };
export const langLabel = (code) => langMeta(code).label || code;
export const isZhLearning = (learningLang) => (learningLang || 'zh') === 'zh';
export const ttsFor = (code) => langMeta(code).tts;
