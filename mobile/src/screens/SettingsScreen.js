import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, ActivityIndicator, Pressable,
  useWindowDimensions,
} from 'react-native';
import SettingsGroup from '../components/settings/SettingsGroup';
import SettingsRow from '../components/settings/SettingsRow';
import SegmentedPicker from '../components/settings/SegmentedPicker';
import Toggle from '../components/Toggle';
import Popup from '../components/Popup';
import { ErrorRetry } from '../components/ErrorRetry';
import { getSettings, updateSettings, deleteAccount } from '../api';
import { useT } from '../i18n';
import { COLORS } from '../theme';

export default function SettingsScreen({ onLogout, onOpen }) {
  const { setLang } = useT();
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
      <ScrollView contentContainerStyle={{ paddingVertical: 20 }}>
        <View style={{ width: '100%', maxWidth: 600, alignSelf: 'center', paddingHorizontal: hPad }}>

          {/* ── Learning ── */}
          <SettingsGroup title="Learning">
            <SettingsRow icon="swap-horizontal" label="Learning direction" sub="What you want to practice" column>
              <SegmentedPicker
                value={s.quiz_direction}
                onChange={(v) => patch({ quiz_direction: v })}
                options={[
                  { value: 'en→zh', label: 'I learn Chinese' },
                  { value: 'zh→en', label: 'I learn English' },
                ]}
              />
            </SettingsRow>
            <SettingsRow icon="globe-outline" label="Interface language" sub="Language of the app" column>
              <SegmentedPicker
                value={s.interface_lang}
                onChange={(v) => { patch({ interface_lang: v }); setLang(v); }}
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'zh', label: '中文' },
                ]}
              />
            </SettingsRow>
            <SettingsRow icon="cloud-upload" iconColor="#0d6efd" iconBg="#e8f0ff" label="Import words" sub="Paste a list from Notes, Pleco, CSV…" onPress={() => onOpen?.('import')} />
          </SettingsGroup>

          {/* ── Notifications ── */}
          <SettingsGroup title="Notifications">
            <SettingsRow
              icon="notifications" iconColor="#198754" iconBg="#e8f5e9"
              label="Duel notifications" sub="Get notified about duels"
              right={<Toggle value={s.notifications_enabled} onValueChange={(v) => patch({ notifications_enabled: v })} />}
            />
            <SettingsRow
              icon="journal" label="Word review" sub="Reminders to review your words"
              right={<Toggle value={s.word_review_enabled} onValueChange={(v) => patch({ word_review_enabled: v })} />}
            />
          </SettingsGroup>

          {/* ── Privacy ── */}
          <SettingsGroup title="Privacy">
            <SettingsRow
              icon="eye-off" iconColor="#7c3aed" iconBg="#f3e8ff"
              label="Ghost mode" sub="Hide from leaderboard & duel search"
              right={<Toggle value={s.ghost_mode} onValueChange={(v) => patch({ ghost_mode: v })} />}
            />
          </SettingsGroup>
          {s.ghost_mode && (
            <View style={{
              backgroundColor: '#fff8e1', borderWidth: 1, borderColor: '#ffe082', borderRadius: 12,
              padding: 12, marginTop: -12, marginBottom: 24,
            }}>
              <Text style={{ color: '#7c5800', fontSize: 12.5 }}>
                You're invisible: others can't find you in the leaderboard or duel search.
              </Text>
            </View>
          )}

          {/* ── Account ── */}
          <SettingsGroup title="Account">
            <SettingsRow icon="school" iconColor="#0d6efd" iconBg="#e8f0ff" label="Find a teacher" sub="Browse mentors & join a class" onPress={() => onOpen?.('teachers')} />
            <SettingsRow icon="star" iconColor="#856404" iconBg="#fff3cd" label="Go Premium" sub="Unlock all features" onPress={() => onOpen?.('pricing')} />
          </SettingsGroup>

          {/* ── Getting started ── */}
          <SettingsGroup title="Getting started">
            <SettingsRow icon="play-circle" iconColor={COLORS.jiayou} iconBg="#e8f0ff" label="Replay tutorial" sub="See the app walkthrough again" onPress={() => onOpen?.('tutorial')} />
            <SettingsRow icon="sparkles" iconColor="#7c3aed" iconBg="#f3e8ff" label="Redo onboarding" sub="Update your profile & preferences" onPress={() => onOpen?.('onboarding')} />
          </SettingsGroup>

          {/* ── Legal & Support ── */}
          <SettingsGroup title="Legal & Support">
            <SettingsRow icon="document-text" iconColor="#555" iconBg="#f0f0f0" label="Legal" onPress={() => onOpen?.('legal')} />
            <SettingsRow icon="help-buoy" iconColor="#555" iconBg="#f0f0f0" label="Help & Support" onPress={() => onOpen?.('support')} />
          </SettingsGroup>

          {/* ── Danger zone ── */}
          <SettingsGroup title="Danger zone">
            <SettingsRow icon="log-out" danger label="Log out" onPress={() => setConfirmLogout(true)} />
            <SettingsRow icon="trash" danger label="Delete account" onPress={() => setConfirmDelete(true)} />
          </SettingsGroup>

        </View>
      </ScrollView>

      {/* Confirmation de suppression */}
      <Popup visible={confirmDelete} onClose={() => setConfirmDelete(false)} maxWidth={400}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 }}>Delete account?</Text>
        <Text style={{ fontSize: 14, color: COLORS.muted, marginBottom: 20, lineHeight: 20 }}>
          This permanently deletes your account, words and progress. This cannot be undone.
        </Text>
        {error ? <Text style={{ color: COLORS.danger, fontSize: 13, marginBottom: 12, fontWeight: '600' }}>{error}</Text> : null}
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Pressable onPress={() => setConfirmDelete(false)} style={{ flex: 1, backgroundColor: '#f1f3f5', borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}>
            <Text style={{ color: COLORS.muted, fontWeight: '700' }}>Cancel</Text>
          </Pressable>
          <Pressable onPress={doDelete} disabled={deleting} style={{ flex: 1, backgroundColor: COLORS.danger, borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}>
            {deleting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Delete</Text>}
          </Pressable>
        </View>
      </Popup>

      {/* Confirmation de déconnexion */}
      <Popup visible={confirmLogout} onClose={() => setConfirmLogout(false)} maxWidth={400}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 }}>Log out?</Text>
        <Text style={{ fontSize: 14, color: COLORS.muted, marginBottom: 20, lineHeight: 20 }}>
          Are you sure you want to log out?
        </Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Pressable onPress={() => setConfirmLogout(false)} style={{ flex: 1, backgroundColor: '#f1f3f5', borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}>
            <Text style={{ color: COLORS.muted, fontWeight: '700' }}>Cancel</Text>
          </Pressable>
          <Pressable onPress={onLogout} style={{ flex: 1, backgroundColor: COLORS.jiayou, borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Log out</Text>
          </Pressable>
        </View>
      </Popup>
    </View>
  );
}
