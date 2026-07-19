import { createContext, useContext } from 'react';

// Traductions de l'interface (en / zh). Chaînes chinoises reprises de config/i18n.js.
// Fondation : on ajoute les clés au fur et à mesure qu'on internationalise les écrans.
export const TRANSLATIONS = {
  en: {
    // Navigation
    nav_teachers: 'Teachers',
    nav_store: 'Store',
    nav_collection: 'Collection',
    nav_add: 'Add Word',
    nav_quiz: 'Quiz',
    nav_duels: 'Duels',
    // Quiz
    quiz_mystats: 'My statistics',
    quiz_quizzes: 'Quizzes',
    quiz_avg: 'Avg score',
    quiz_best: 'Best',
    quiz_mastered: 'Mastered',
    quiz_pinyin: 'Quiz Pinyin',
    quiz_pinyin_sub: 'From English to pinyin',
    quiz_chars: 'Quiz characters',
    quiz_chars_sub: 'From English to characters',
    quiz_single: 'Quiz',
    quiz_single_sub: 'Translate the word to English',
  },
  zh: {
    nav_teachers: '老师',
    nav_store: '商店',
    nav_collection: '我的词库',
    nav_add: '添加词汇',
    nav_quiz: '测验',
    nav_duels: '对战',
    quiz_mystats: '我的统计',
    quiz_quizzes: '测验数',
    quiz_avg: '平均分',
    quiz_best: '最佳',
    quiz_mastered: '已掌握',
    quiz_pinyin: '拼音测验',
    quiz_pinyin_sub: '从英语到拼音',
    quiz_chars: '汉字测验',
    quiz_chars_sub: '从英语到汉字',
    quiz_single: '测验',
    quiz_single_sub: '把词翻译成英语',
  },
};

export const LangContext = createContext({ lang: 'en', t: (k) => k, setLang: () => {} });
export function useT() { return useContext(LangContext); }
export function makeT(lang) {
  return (key) => (TRANSLATIONS[lang] && TRANSLATIONS[lang][key]) || TRANSLATIONS.en[key] || key;
}
