import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import SettingsGroup from '../../components/settings/SettingsGroup';
import SettingsRow from '../../components/settings/SettingsRow';
import Toggle from '../../components/Toggle';
import { getSettings, updateSettings, deleteAccount } from '../../api';
import { Modal, Button } from '../../ui';
import { COLORS } from '../../theme';

// Réglages professeur — miroir de teach-settings.ejs.
export default function TeacherSettingsScreen({ onBack, onLogout, onOpenProfile, onOpenSupport, onOpenLegal, onReplayFlow }) {
  const insets = useSafeAreaInsets();
  const [s, setS] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setS(await getSettings()); } catch { setS({}); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function patch(fields) {
    const prev = s;
    setS((cur) => ({ ...cur, ...fields }));
    try { await updateSettings(fields); } catch { setS(prev); }
  }
  async function doDelete() {
    setDeleting(true);
    try { await deleteAccount(); onLogout(); } catch (e) { setError(e.message || 'Could not delete account.'); setConfirmDelete(false); } finally { setDeleting(false); }
  }

  return (
    <View className="flex-1 bg-surface-page">
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 20, paddingBottom: 20 }}>
        <View style={{ width: '100%', maxWidth: 600, alignSelf: 'center', paddingHorizontal: 16 }}>
          <Pressable onPress={onBack} hitSlop={10} className="flex-row items-center gap-1 mb-3">
            <Ionicons name="chevron-back" size={20} color={COLORS.muted} /><Text className="text-muted text-[14px]">Back</Text>
          </Pressable>

          <SettingsGroup title="Account">
            <SettingsRow icon="person-badge" iconColor={COLORS.jiayou} iconBg="#e8f0ff" label="My teacher profile" sub="Name, intro, languages, price" onPress={onOpenProfile} />
          </SettingsGroup>

          <SettingsGroup title="Notifications">
            <SettingsRow icon="notifications" iconColor="#198754" iconBg="#e8f5e9" label="Push notifications" sub="Get notified about your classes"
              right={<Toggle value={!!s?.notifications_enabled} onValueChange={(v) => patch({ notifications_enabled: v })} />} />
          </SettingsGroup>

          <SettingsGroup title="Learn">
            <SettingsRow icon="play-circle" iconColor={COLORS.jiayou} iconBg="#e8f0ff" label="Replay tutorial" sub="See the teacher walkthrough again" onPress={() => onReplayFlow?.('teacher-tutorial')} />
            <SettingsRow icon="sparkles" iconColor="#7c3aed" iconBg="#f3e8ff" label="Redo onboarding" sub="Update your teacher profile" onPress={() => onReplayFlow?.('onboarding')} />
          </SettingsGroup>

          <SettingsGroup title="Legal & Support">
            <SettingsRow icon="document-text" iconColor="#555" iconBg="#f0f0f0" label="Legal" onPress={onOpenLegal} />
            <SettingsRow icon="help-buoy" iconColor="#555" iconBg="#f0f0f0" label="Help & Support" onPress={onOpenSupport} />
          </SettingsGroup>

          <SettingsGroup title="Danger zone">
            <SettingsRow icon="log-out" danger label="Log out" onPress={() => setConfirmLogout(true)} />
            <SettingsRow icon="trash" danger label="Delete account" onPress={() => setConfirmDelete(true)} />
          </SettingsGroup>
        </View>
      </ScrollView>

      <Modal visible={confirmDelete} onClose={() => setConfirmDelete(false)} maxWidth={400}>
        <Text className="text-[17px] font-bold text-ink mb-2">Delete account?</Text>
        <Text className="text-[14px] text-muted leading-5 mb-5">This permanently deletes your account, classes and data. This cannot be undone.</Text>
        {error ? <Text className="text-danger text-[13px] font-semibold mb-3">{error}</Text> : null}
        <View className="flex-row gap-3">
          <Button title="Cancel" variant="secondary" onPress={() => setConfirmDelete(false)} style={{ flex: 1, justifyContent: 'center' }} />
          <Button title="Delete" variant="danger" loading={deleting} onPress={doDelete} style={{ flex: 1, justifyContent: 'center' }} />
        </View>
      </Modal>

      <Modal visible={confirmLogout} onClose={() => setConfirmLogout(false)} maxWidth={400}>
        <Text className="text-[17px] font-bold text-ink mb-2">Log out?</Text>
        <Text className="text-[14px] text-muted leading-5 mb-5">Are you sure you want to log out?</Text>
        <View className="flex-row gap-3">
          <Button title="Cancel" variant="secondary" onPress={() => setConfirmLogout(false)} style={{ flex: 1, justifyContent: 'center' }} />
          <Button title="Log out" onPress={onLogout} style={{ flex: 1, justifyContent: 'center' }} />
        </View>
      </Modal>
    </View>
  );
}
