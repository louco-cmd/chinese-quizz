import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, ActivityIndicator, Pressable,
  useWindowDimensions, Animated, PanResponder, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SettingsGroup from '../components/settings/SettingsGroup';
import SettingsRow from '../components/settings/SettingsRow';
import Toggle from '../components/Toggle';
import Popup from '../components/Popup';
import { ErrorRetry } from '../components/ErrorRetry';
import UpdateFooter from '../components/settings/UpdateFooter';
import { getSettings, getCachedSettings, updateSettings, deleteAccount, getLearningPaths, activateLearningPath } from '../api';
import { useT } from '../i18n';
import { COLORS } from '../theme';
import CatLoader from '../components/CatLoader';
import { LANG_META } from '../langs';
import LearningPathPopup from '../components/settings/LearningPathPopup';

// Petit badge PREMIUM pour les fonctions verrouillées au plan gratuit.
function PremiumPill() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fff3cd', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 }}>
      <Ionicons name="star" size={11} color="#b8860b" />
      <Text style={{ color: '#8a6d00', fontWeight: '800', fontSize: 10.5 }}>PREMIUM</Text>
    </View>
  );
}

// Badge BETA pour les fonctions récentes / en rodage (accessibles à tous).
function BetaPill() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#e7f0ff', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 }}>
      <Ionicons name="flask" size={11} color="#1a6ff7" />
      <Text style={{ color: '#0a4fcf', fontWeight: '800', fontSize: 10.5 }}>BETA</Text>
    </View>
  );
}

export default function SettingsScreen({ onLogout, onOpen, onBack, isPremium = false }) {
  const { t, setLang } = useT();
  const { width } = useWindowDimensions();
  const hPad = width >= 992 ? 24 : 16;

  // Réglages préchargés depuis la page Compte → affichage immédiat, sans spinner.
  const cachedSettings = getCachedSettings();
  const [s, setS] = useState(cachedSettings);
  const [loading, setLoading] = useState(!cachedSettings);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  // Parcours d'apprentissage (multi-langues).
  const [paths, setPaths] = useState(null);
  const [pathPopup, setPathPopup] = useState(null); // { mode:'create'|'edit', path? }
  const [switchingId, setSwitchingId] = useState(null);
  const loadPaths = useCallback(() => {
    getLearningPaths().then((d) => setPaths(d.paths || [])).catch(() => {});
  }, []);
  useEffect(() => { loadPaths(); }, [loadPaths]);

  // Bascule sur un parcours : active côté serveur, suit la langue d'interface,
  // rafraîchit la liste + les réglages (la collection re-scope toute seule).
  async function switchPath(p) {
    if (p.is_active) return;
    setSwitchingId(p.id);
    try {
      const d = await activateLearningPath(p.id);
      if (d?.active?.interface_lang) setLang(d.active.interface_lang);
      const fresh = await getSettings();
      setS(fresh);
      loadPaths();
    } catch { /* silencieux : la liste reste en l'état */ }
    finally { setSwitchingId(null); }
  }
  // Après création/édition d'un parcours : recharge liste + réglages.
  async function onPathSaved() {
    try { const fresh = await getSettings(); setS(fresh); } catch { /* noop */ }
    loadPaths();
  }

  // Slide-in depuis la droite quand le contenu apparaît (façon navigation "push").
  const slideX = useRef(new Animated.Value(width)).current;
  useEffect(() => {
    if (loading) return;
    slideX.setValue(width);
    Animated.timing(slideX, { toValue: 0, duration: 260, useNativeDriver: true }).start();
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Swipe vers la DROITE pour revenir au Compte (comme un "pop" de navigation).
  // On suit le doigt, puis on ferme si le geste dépasse ~1/3 de l'écran ou est
  // rapide, sinon on revient en place. Valeurs fraîches via refs (PanResponder
  // créé une seule fois).
  const onBackRef = useRef(onBack); onBackRef.current = onBack;
  const widthRef = useRef(width); widthRef.current = width;
  const pan = useRef(
    PanResponder.create({
      // On ne prend le geste QUE s'il est nettement horizontal vers la droite
      // → le scroll vertical de la page reste intact. Désactivé sur web (souris).
      onMoveShouldSetPanResponder: (_, g) =>
        Platform.OS !== 'web' && g.dx > 10 && g.dx > Math.abs(g.dy) * 1.6,
      onPanResponderMove: (_, g) => { slideX.setValue(Math.max(0, g.dx)); },
      onPanResponderRelease: (_, g) => {
        const w = widthRef.current;
        if (g.dx > w * 0.33 || g.vx > 0.5) {
          Animated.timing(slideX, { toValue: w, duration: 200, useNativeDriver: true })
            .start(() => onBackRef.current?.());
        } else {
          Animated.spring(slideX, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(slideX, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
      },
    })
  ).current;

  const load = useCallback(async () => {
    setError('');
    try {
      setS(await getSettings());
    } catch (e) {
      // Revalidation en fond échouée mais on a déjà les données cachées → on
      // n'affiche pas l'écran d'erreur (qui remplacerait le contenu).
      if (!cachedSettings) setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [cachedSettings]);

  useEffect(() => { load(); }, [load]);

  // Mise à jour optimiste + persistance ; revert en cas d'échec.
  async function patch(fields) {
    const prev = s;
    setS((cur) => ({ ...cur, ...fields }));
    try {
      await updateSettings(fields);
    } catch {
      setS(prev);
    }
  }

  async function doDelete() {
    setDeleting(true);
    try {
      await deleteAccount();
      onLogout();
    } catch (e) {
      setError(e.message || 'Could not delete account.');
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8f9fa' }}>
        <CatLoader size={110} />
      </View>
    );
  }
  if (error && !s) {
    return <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}><ErrorRetry error={error} onRetry={load} /></View>;
  }

  return (
    <Animated.View {...pan.panHandlers} style={{ flex: 1, backgroundColor: '#f8f9fa', transform: [{ translateX: slideX }] }}>
      {/* En-tête : retour vers la page compte (la barre est masquée ici). */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: hPad, paddingTop: 14, paddingBottom: 6 }}>
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="chevron-back" size={20} color={COLORS.jiayou} />
            <Text style={{ color: COLORS.jiayou, fontWeight: '600' }}>{t('set_back')}</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 32 }}>
        <View style={{ width: '100%', maxWidth: 600, alignSelf: 'center', paddingHorizontal: hPad }}>

          {/* ── Learning paths (parcours multi-langues) ──
              Chaque parcours a sa collection (déjà scindée par mots.lang). La carte
              active en haut ; tap sur un autre parcours = bascule ; tap sur l'actif
              = édition (base + titre, direction verrouillée). */}
          <View style={{ marginBottom: 24 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 16, paddingBottom: 8 }}>
              {t('set_learning_paths')}
            </Text>
            {(paths || []).map((p) => {
              const endo = (c) => (LANG_META[c] || {}).endonym || c;
              const title = p.title || t('lp_learn_label').replace('{lang}', endo(p.learning_lang));
              const sub = `${t('lp_from_label').replace('{lang}', endo(p.native_lang))} · ${t('lp_words').replace('{n}', p.word_count)}`;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => (p.is_active ? setPathPopup({ mode: 'edit', path: p }) : switchPath(p))}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: 14, marginBottom: 10,
                    borderWidth: 1.5, borderColor: p.is_active ? COLORS.jiayou : '#e2e6ea',
                    backgroundColor: p.is_active ? '#e8f0ff' : '#fff',
                  }}
                >
                  <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: p.is_active ? COLORS.jiayou : '#f2f4f6' }}>
                    <Ionicons name="school" size={20} color={p.is_active ? '#fff' : COLORS.muted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ fontSize: 15.5, fontWeight: '800', color: COLORS.ink, flexShrink: 1 }} numberOfLines={1}>{title}</Text>
                      {p.is_active ? (
                        <View style={{ backgroundColor: COLORS.jiayou, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{t('set_path_active')}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={{ fontSize: 12.5, color: COLORS.muted, marginTop: 2 }} numberOfLines={1}>{sub}</Text>
                  </View>
                  {switchingId === p.id
                    ? <ActivityIndicator size="small" color={COLORS.jiayou} />
                    : <Ionicons name={p.is_active ? 'create-outline' : 'chevron-forward'} size={18} color={COLORS.mutedLight} />}
                </Pressable>
              );
            })}
            {/* Free : jusqu'à 2 parcours ; au-delà = premium (paywall). Premium : illimité. */}
            {(() => {
              const canAddPath = isPremium || (paths?.length || 0) < 2;
              return (
                <Pressable
                  onPress={() => (canAddPath ? setPathPopup({ mode: 'create' }) : onOpen?.('pricing'))}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 13, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: COLORS.jiayou, backgroundColor: '#fff' }}
                >
                  <Ionicons name="add" size={20} color={COLORS.jiayou} />
                  <Text style={{ color: COLORS.jiayou, fontWeight: '800', fontSize: 14.5 }}>{t('set_add_path')}</Text>
                  {!canAddPath ? <View style={{ marginLeft: 2 }}><PremiumPill /></View> : null}
                </Pressable>
              );
            })()}
          </View>

          {/* ── Learning (outils du cours) ── */}
          <SettingsGroup title={t('set_grp_learning')}>
            <SettingsRow icon="cloud-upload" iconColor="#0d6efd" iconBg="#e8f0ff" label={t('set_import')} sub={t('set_import_sub')} onPress={() => onOpen?.('import')} />
            <SettingsRow
              icon="brush" iconColor="#7c3aed" iconBg="#f3e8ff" label={t('set_writing')} sub={t('set_writing_sub')}
              onPress={() => onOpen?.('writing')}
              right={<BetaPill />}
            />
          </SettingsGroup>

          {/* ── Notifications ── (un seul flag `notifications_enabled` gate TOUTES
              les push : duels, vente de pack, virements/red envelopes). */}
          <SettingsGroup title={t('set_grp_notifications')}>
            <SettingsRow
              icon="notifications" iconColor="#198754" iconBg="#e8f5e9"
              label={t('set_push')} sub={t('set_push_sub')}
              right={<Toggle value={s.notifications_enabled} onValueChange={(v) => patch({ notifications_enabled: v })} />}
            />
          </SettingsGroup>

          {/* ── Privacy ── */}
          <SettingsGroup title={t('set_grp_privacy')}>
            {isPremium ? (
              <SettingsRow
                icon="eye-off" iconColor="#7c3aed" iconBg="#f3e8ff"
                label={t('set_ghost')} sub={t('set_ghost_sub')}
                right={<Toggle value={s.ghost_mode} onValueChange={(v) => patch({ ghost_mode: v })} />}
              />
            ) : (
              <SettingsRow
                icon="eye-off" iconColor="#7c3aed" iconBg="#f3e8ff"
                label={t('set_ghost')} sub={t('set_ghost_sub')}
                onPress={() => onOpen?.('pricing')}
                right={<PremiumPill />}
              />
            )}
          </SettingsGroup>
          {isPremium && s.ghost_mode && (
            <View style={{
              backgroundColor: '#fff8e1', borderWidth: 1, borderColor: '#ffe082', borderRadius: 12,
              padding: 12, marginTop: -12, marginBottom: 24,
            }}>
              <Text style={{ color: '#7c5800', fontSize: 12.5 }}>
                {t('set_ghost_notice')}
              </Text>
            </View>
          )}

          {/* ── Account ── */}
          <SettingsGroup title={t('set_grp_account')}>
            <SettingsRow icon="school" iconColor="#0d6efd" iconBg="#e8f0ff" label={t('set_find_teacher')} sub={t('set_find_teacher_sub')} onPress={() => onOpen?.('teachers')} right={<BetaPill />} />
            <SettingsRow icon="star" iconColor="#856404" iconBg="#fff3cd" label={t('set_premium')} sub={t('set_premium_sub')} onPress={() => onOpen?.('pricing')} />
          </SettingsGroup>

          {/* ── Getting started ── */}
          <SettingsGroup title={t('set_grp_getting_started')}>
            <SettingsRow icon="play-circle" iconColor={COLORS.jiayou} iconBg="#e8f0ff" label={t('set_replay_tutorial')} sub={t('set_replay_tutorial_sub')} onPress={() => onOpen?.('tutorial')} />
            <SettingsRow icon="sparkles" iconColor="#7c3aed" iconBg="#f3e8ff" label={t('set_redo_onboarding')} sub={t('set_redo_onboarding_sub')} onPress={() => onOpen?.('onboarding')} />
          </SettingsGroup>

          {/* ── Legal & Support ── */}
          <SettingsGroup title={t('set_grp_legal_support')}>
            <SettingsRow icon="document-text" iconColor="#555" iconBg="#f0f0f0" label={t('set_terms')} onPress={() => onOpen?.('terms')} />
            <SettingsRow icon="shield-checkmark" iconColor="#555" iconBg="#f0f0f0" label={t('set_privacy_policy')} onPress={() => onOpen?.('privacy')} />
            <SettingsRow icon="help-buoy" iconColor="#555" iconBg="#f0f0f0" label={t('set_support')} onPress={() => onOpen?.('support')} />
          </SettingsGroup>

          {/* ── Danger zone ── */}
          <SettingsGroup title={t('set_grp_danger')}>
            <SettingsRow icon="log-out" danger label={t('set_logout')} onPress={() => setConfirmLogout(true)} />
            <SettingsRow icon="trash" danger label={t('set_delete')} onPress={() => setConfirmDelete(true)} />
          </SettingsGroup>

          <UpdateFooter />

        </View>
      </ScrollView>

      {/* Confirmation de suppression */}
      <Popup visible={confirmDelete} onClose={() => setConfirmDelete(false)} maxWidth={400}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 }}>{t('set_delete_title')}</Text>
        <Text style={{ fontSize: 14, color: COLORS.muted, marginBottom: 20, lineHeight: 20 }}>
          {t('set_delete_body')}
        </Text>
        {error ? <Text style={{ color: COLORS.danger, fontSize: 13, marginBottom: 12, fontWeight: '600' }}>{error}</Text> : null}
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Pressable onPress={() => setConfirmDelete(false)} style={{ flex: 1, backgroundColor: '#f1f3f5', borderRadius: 999, paddingVertical: 13, alignItems: 'center' }}>
            <Text style={{ color: COLORS.muted, fontWeight: '700' }}>{t('common_cancel')}</Text>
          </Pressable>
          <Pressable onPress={doDelete} disabled={deleting} style={{ flex: 1, backgroundColor: COLORS.danger, borderRadius: 999, paddingVertical: 13, alignItems: 'center' }}>
            {deleting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>{t('common_delete')}</Text>}
          </Pressable>
        </View>
      </Popup>

      {/* Confirmation de déconnexion */}
      <Popup visible={confirmLogout} onClose={() => setConfirmLogout(false)} maxWidth={400}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 }}>{t('set_logout_title')}</Text>
        <Text style={{ fontSize: 14, color: COLORS.muted, marginBottom: 20, lineHeight: 20 }}>
          {t('set_logout_body')}
        </Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Pressable onPress={() => setConfirmLogout(false)} style={{ flex: 1, backgroundColor: '#f1f3f5', borderRadius: 999, paddingVertical: 13, alignItems: 'center' }}>
            <Text style={{ color: COLORS.muted, fontWeight: '700' }}>{t('common_cancel')}</Text>
          </Pressable>
          <Pressable onPress={onLogout} style={{ flex: 1, backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 13, alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>{t('set_logout')}</Text>
          </Pressable>
        </View>
      </Popup>

      {/* Création / édition d'un parcours d'apprentissage */}
      <LearningPathPopup
        visible={!!pathPopup}
        mode={pathPopup?.mode || 'create'}
        path={pathPopup?.path || null}
        onClose={() => setPathPopup(null)}
        onSaved={onPathSaved}
      />
    </Animated.View>
  );
}
