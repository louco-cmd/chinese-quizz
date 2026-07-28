import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, ActivityIndicator, Pressable,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SettingsGroup from '../components/settings/SettingsGroup';
import SettingsRow from '../components/settings/SettingsRow';
import SegmentedPicker from '../components/settings/SegmentedPicker';
import Toggle from '../components/Toggle';
import Popup from '../components/Popup';
import { ErrorRetry } from '../components/ErrorRetry';
import UpdateFooter from '../components/settings/UpdateFooter';
import { getSettings, updateSettings, deleteAccount } from '../api';
import { useT } from '../i18n';
import { COLORS } from '../theme';

export default function SettingsScreen({ onLogout, onOpen, onBack }) {
  const { t, setLang } = useT();
  const { width } = useWindowDimensions();
  const hPad = width >= 992 ? 24 : 16;
  const [s, setS] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      setS(await getSettings());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

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
        <ActivityIndicator color={COLORS.jiayou} />
      </View>
    );
  }
  if (error && !s) {
    return <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}><ErrorRetry error={error} onRetry={load} /></View>;
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
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

          {/* ── Learning ── */}
          <SettingsGroup title={t('set_grp_learning')}>
            <SettingsRow icon="swap-horizontal" label={t('set_direction')} sub={t('set_direction_sub')} column>
              <SegmentedPicker
                value={s.quiz_direction}
                onChange={(v) => patch({ quiz_direction: v })}
                options={[
                  { value: 'en→zh', label: t('set_dir_learn_zh') },
                  { value: 'zh→en', label: t('set_dir_learn_en') },
                ]}
              />
            </SettingsRow>
            <SettingsRow icon="globe-outline" label={t('set_interface')} sub={t('set_interface_sub')} column>
              <SegmentedPicker
                value={s.interface_lang}
                onChange={(v) => { patch({ interface_lang: v }); setLang(v); }}
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'zh', label: '中文' },
                ]}
              />
            </SettingsRow>
            <SettingsRow icon="cloud-upload" iconColor="#0d6efd" iconBg="#e8f0ff" label={t('set_import')} sub={t('set_import_sub')} onPress={() => onOpen?.('import')} />
            <SettingsRow icon="brush" iconColor="#7c3aed" iconBg="#f3e8ff" label={t('set_writing')} sub={t('set_writing_sub')} onPress={() => onOpen?.('writing')} />
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
            <SettingsRow
              icon="eye-off" iconColor="#7c3aed" iconBg="#f3e8ff"
              label={t('set_ghost')} sub={t('set_ghost_sub')}
              right={<Toggle value={s.ghost_mode} onValueChange={(v) => patch({ ghost_mode: v })} />}
            />
          </SettingsGroup>
          {s.ghost_mode && (
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
            <SettingsRow icon="school" iconColor="#0d6efd" iconBg="#e8f0ff" label={t('set_find_teacher')} sub={t('set_find_teacher_sub')} onPress={() => onOpen?.('teachers')} />
            <SettingsRow icon="star" iconColor="#856404" iconBg="#fff3cd" label={t('set_premium')} sub={t('set_premium_sub')} onPress={() => onOpen?.('pricing')} />
          </SettingsGroup>

          {/* ── Getting started ── */}
          <SettingsGroup title={t('set_grp_getting_started')}>
            <SettingsRow icon="play-circle" iconColor={COLORS.jiayou} iconBg="#e8f0ff" label={t('set_replay_tutorial')} sub={t('set_replay_tutorial_sub')} onPress={() => onOpen?.('tutorial')} />
            <SettingsRow icon="sparkles" iconColor="#7c3aed" iconBg="#f3e8ff" label={t('set_redo_onboarding')} sub={t('set_redo_onboarding_sub')} onPress={() => onOpen?.('onboarding')} />
          </SettingsGroup>

          {/* ── Legal & Support ── */}
          <SettingsGroup title={t('set_grp_legal_support')}>
            <SettingsRow icon="document-text" iconColor="#555" iconBg="#f0f0f0" label={t('set_legal')} onPress={() => onOpen?.('legal')} />
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
    </View>
  );
}
