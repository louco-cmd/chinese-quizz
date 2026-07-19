// Client API mobile.
// ⚠️ En natif, "localhost" = le téléphone, PAS ton Mac. Mets l'IP LAN de ta
// machine (téléphone + Mac sur le même Wi-Fi), ou l'URL de prod.
//   macOS : ipconfig getifaddr en0   →  ex. http://192.168.1.20:3000
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// Résolution de l'URL de l'API :
//  1. EXPO_PUBLIC_API_BASE (défini au build) l'emporte toujours → prod / natif.
//  2. Web servi par Express (same-origin) → '' : les requêtes partent en /api/…
//  3. Web en dev (expo start --web sur localhost) → localhost:3000.
//  4. Natif en dev → IP LAN du Mac (`ipconfig getifaddr en0`).
const ENV_BASE = process.env.EXPO_PUBLIC_API_BASE;
const isLocalhostWeb =
  Platform.OS === 'web' &&
  typeof location !== 'undefined' &&
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1');

export const API_BASE =
  ENV_BASE != null && ENV_BASE !== ''
    ? ENV_BASE
    : Platform.OS === 'web'
      ? (isLocalhostWeb ? 'http://localhost:3000' : '') // same-origin en prod
      : 'http://192.168.1.3:3000';

const TOKEN_KEY = 'jiayou_token';
const isWeb = Platform.OS === 'web';

// Stockage du token : SecureStore en natif, localStorage sur web
// (SecureStore n'existe pas dans le navigateur).
export async function getToken() {
  if (isWeb) return typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token) {
  if (isWeb) {
    if (typeof localStorage === 'undefined') return;
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
    return;
  }
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data; // ex. { missing: [...] } pour la création de pack
    throw err;
  }
  return data;
}

export function login(email, password) {
  return request('/api/auth/token', { method: 'POST', body: { email, password }, auth: false });
}

// Email-first : renvoie { step: 'signup' | 'login' | 'google_only' }.
export function checkEmail(email) {
  return request('/api/auth/check-email', { method: 'POST', body: { email }, auth: false });
}

// Création d'un compte email/mot de passe → { token, user }.
export function register(email, password) {
  return request('/api/auth/register', { method: 'POST', body: { email, password }, auth: false });
}

// ── Réinitialisation de mot de passe (endpoints web, sans session) ───────────
export function forgotPassword(email) {
  return request('/auth/forgot-password', { method: 'POST', body: { email }, auth: false });
}
export function verifyResetToken(token) {
  return request(`/auth/verify-reset-token?token=${encodeURIComponent(token)}`, { auth: false });
}
export function resetPassword(token, newPassword) {
  return request('/auth/reset-password', { method: 'POST', body: { token, newPassword }, auth: false });
}

export function loginWithGoogle(idToken) {
  return request('/api/auth/google-token', { method: 'POST', body: { id_token: idToken }, auth: false });
}

// Client ID Google (le MÊME web client ID que le backend GOOGLE_CLIENT_ID,
// sinon l'audience du token ne matche pas). Exposé à l'app via EXPO_PUBLIC_*.
export const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || '';

export function getMe() {
  return request('/api/m/me');
}

// ── Plateforme professeur (JWT) ──────────────────────────────────────────────
export function teacherOverview() { return request('/api/m/teacher/overview'); }
export function teacherClasses() { return request('/api/m/teacher/classes'); }
export function teacherCreateClass(name) { return request('/api/m/teacher/classes', { method: 'POST', body: { name } }); }
export function teacherClass(id) { return request(`/api/m/teacher/classes/${id}`); }
export function teacherDeleteClass(id) { return request(`/api/m/teacher/classes/${id}`, { method: 'DELETE' }); }
export function teacherRevokeStudent(classId, studentId) { return request(`/api/m/teacher/classes/${classId}/students/${studentId}/revoke`, { method: 'POST' }); }
export function teacherClassLessons(id) { return request(`/api/m/teacher/classes/${id}/lessons`); }
export function teacherCreateLesson(classId, payload) { return request(`/api/m/teacher/classes/${classId}/lessons`, { method: 'POST', body: payload }); }
export function teacherLessonProgress(lessonId) { return request(`/api/m/teacher/lessons/${lessonId}/progress`); }
export function teacherDeleteLesson(lessonId) { return request(`/api/m/teacher/lessons/${lessonId}`, { method: 'DELETE' }); }
export function teacherLookupWords(words) { return request('/api/m/teacher/mots/lookup', { method: 'POST', body: { words } }); }
export function teacherStudents() { return request('/api/m/teacher/students'); }
export function teacherGetProfile() { return request('/api/m/teacher/profile'); }
export function teacherSaveProfile(payload) { return request('/api/m/teacher/profile', { method: 'POST', body: payload }); }

// Onboarding : sauve le profil (rôle, nom, pays, direction, langue) + marque fini.
// `ref` optionnel = code de parrainage capté côté client.
export function completeOnboarding(payload) {
  return request('/api/m/onboarding', { method: 'POST', body: payload });
}

// Marque le tutoriel comme vu.
export function completeTutorial() {
  return request('/api/m/tutorial-complete', { method: 'POST' });
}

export function getWallet() {
  return request('/api/m/wallet');
}

// ── Red envelopes ──
export function searchUsers(q) {
  return request(`/api/m/users/search?q=${encodeURIComponent(q)}`);
}
export function sendRedEnvelope({ recipientId, amount, message }) {
  return request('/api/m/bank/red-envelope', { method: 'POST', body: { recipientId, amount, message } });
}
export function getUnseenEnvelopes() {
  return request('/api/m/red-envelopes/unseen');
}
export function markEnvelopesSeen() {
  return request('/api/m/red-envelopes/seen', { method: 'POST' });
}

// ── Import en masse ──
export function importPreview(text, direction) {
  return request('/api/m/import/preview', { method: 'POST', body: { text, direction } });
}
export function importCommit(words) {
  return request('/api/m/import/commit', { method: 'POST', body: { words } });
}

// ── JiaStore (marketplace) ──
export function getMarketPacks({ q = '', min = '', max = '', sort = 'recent' } = {}) {
  const qs = new URLSearchParams();
  if (q) qs.set('q', q);
  if (min !== '' && min != null) qs.set('min', String(min));
  if (max !== '' && max != null) qs.set('max', String(max));
  if (sort) qs.set('sort', sort);
  const s = qs.toString();
  return request(`/api/m/market/packs${s ? `?${s}` : ''}`);
}

export function getMarketPack(id) {
  return request(`/api/m/market/packs/${id}`);
}

export function buyMarketPack(id) {
  return request(`/api/m/market/packs/${id}/buy`, { method: 'POST' });
}

export function planPack(text) {
  return request('/api/m/market/packs/plan', { method: 'POST', body: { text } });
}

export function createPack({ title, description, price, text, translations, acquire }) {
  return request('/api/m/market/packs', {
    method: 'POST',
    body: { title, description, price, text, translations, acquire },
  });
}

export function getMyPacks() {
  return request('/api/m/market/my-packs');
}

export function updatePack(id, { title, description, price }) {
  return request(`/api/m/market/packs/${id}`, { method: 'PUT', body: { title, description, price } });
}

export function deletePack(id) {
  return request(`/api/m/market/packs/${id}`, { method: 'DELETE' });
}

export function getCollection() {
  return request('/api/m/collection');
}

export function searchWords(q) {
  return request(`/api/m/search?q=${encodeURIComponent(q)}`);
}

export function getPinyin(cn) {
  return request(`/api/m/pinyin?cn=${encodeURIComponent(cn)}`);
}

export function captureWord(id) {
  return request(`/api/m/words/${id}/capture`, { method: 'POST' });
}

// Crée un nouveau mot (chinese + english requis) et le capture (coûte 3 coins).
export function createWord(fields) {
  return request('/api/m/words', { method: 'POST', body: fields });
}

export function updateWord(id, fields) {
  return request(`/api/m/words/${id}`, { method: 'PUT', body: fields });
}

export function deleteWord(id) {
  return request(`/api/m/words/${id}`, { method: 'DELETE' });
}

export function getCharacter(ch) {
  return request(`/api/m/character/${encodeURIComponent(ch)}`);
}

export function getMentors() {
  return request('/api/m/mentors');
}

export function joinClass(code) {
  return request('/api/m/classes/join', { method: 'POST', body: { code } });
}

// Mentors rejoints + tasks en cours (page account & quiz).
export function getStudentClasses() {
  return request('/api/m/student/classes');
}

export function getLesson(lessonId) {
  return request(`/api/m/student/lessons/${lessonId}`);
}

export function leaveMentor(teacherId) {
  return request(`/api/m/student/mentors/${teacherId}/leave`, { method: 'POST' });
}

export function startTask(lessonId) {
  return request(`/api/m/student/tasks/${lessonId}/start`, { method: 'POST' });
}

export function saveTaskResult(lessonId, score, total) {
  return request(`/api/m/student/tasks/${lessonId}/result`, { method: 'POST', body: { score, total } });
}

export function getAccount() {
  return request('/api/m/account');
}

export function updateAccount(fields) {
  return request('/api/m/account', { method: 'PUT', body: fields });
}

export function getSettings() {
  return request('/api/m/settings');
}

export function updateSettings(fields) {
  return request('/api/m/settings', { method: 'PATCH', body: fields });
}

export function deleteAccount() {
  return request('/api/m/account/delete', { method: 'DELETE' });
}

export function getDuels() {
  return request('/api/m/duels');
}

export function getReferral() {
  return request('/api/m/referral');
}

export function searchDuelPlayers(q) {
  return request(`/api/m/duels/players?q=${encodeURIComponent(q)}`);
}

// Adversaires déjà affrontés (suggestions du popup "Start a duel").
export function getRecentOpponents() {
  return request('/api/m/duels/recent-opponents');
}

export function createDuel(fields) {
  return request('/api/m/duels/create', { method: 'POST', body: fields });
}

export function getDuel(id) {
  return request(`/api/m/duels/${id}`);
}

export function submitDuelScore(id, score) {
  return request(`/api/m/duels/${id}/submit`, { method: 'POST', body: { score } });
}

export function getLeaderboard() {
  return request('/api/m/leaderboard');
}

// Profil public d'un joueur (ouvert depuis le leaderboard).
export function getUserProfile(id) {
  return request(`/api/m/users/${id}`);
}

export function getQuizWords(count = 10) {
  return request(`/api/m/quiz?count=${count}`);
}

// Mots d'un quiz scoré : filtrés par type/nombre/HSK/difficulté, ou liste `ids`
// explicite (quick quiz sur les mots difficiles).
export function getQuizPlayWords({ type = 'pinyin', count = 20, hsk = 'all', difficulty = 'balanced', ids, packId }) {
  if (ids && ids.length) {
    return request(`/api/m/quiz/words?type=${encodeURIComponent(type)}&ids=${encodeURIComponent(ids.join(','))}`);
  }
  if (packId) {
    return request(`/api/m/quiz/words?type=${encodeURIComponent(type)}&count=${count}&packId=${packId}`);
  }
  const qs = `type=${encodeURIComponent(type)}&count=${count}&hsk=${encodeURIComponent(hsk)}&difficulty=${encodeURIComponent(difficulty)}`;
  return request(`/api/m/quiz/words?${qs}`);
}

// Packs entraînables (créés ∪ achetés) pour la section "Train on a pack".
export function getQuizPacks() {
  return request('/api/m/quiz/packs');
}

// Mots difficiles à retravailler (section "Your difficulties").
export function getDifficultWords() {
  return request('/api/m/difficult-words');
}

// Stats de quiz (section "My statistics" de la page quiz).
export function getQuizStats() {
  return request('/api/m/quiz/stats');
}

// Enregistre le quiz (score, résultats par mot) → renvoie les coins gagnés.
export function saveQuiz(payload) {
  return request('/api/m/quiz/save', { method: 'POST', body: payload });
}
