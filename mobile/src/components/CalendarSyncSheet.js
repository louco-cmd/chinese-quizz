import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, Alert, Platform, Linking, ActivityIndicator } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet from '../ui/BottomSheet';
import { getCalFeed, rotateCalFeed } from '../api';
import { COLORS } from '../theme';

// Feuille « Synchroniser avec mon calendrier » : abonnement .ics (sens unique).
// L'utilisateur colle l'URL une fois dans Google / Apple / Outlook → ses cours
// Jiayou apparaissent et se mettent à jour tout seuls (rafraîchi par le provider).
export default function CalendarSyncSheet({ visible, onClose }) {
  const [feed, setFeed] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { setFeed(await getCalFeed()); }
    catch (e) { setErr(e.message || 'Could not load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (visible && !feed) load(); }, [visible, feed, load]);

  async function copy() {
    if (!feed?.url) return;
    try { await Clipboard.setStringAsync(feed.url); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* noop */ }
  }
  async function open(url) {
    try { await Linking.openURL(url); }
    catch { Alert.alert('Calendar', 'Could not open. The link was copied — paste it in your calendar app.'); copy(); }
  }
  function regenerate() {
    Alert.alert(
      'Regenerate link?',
      'The old link will stop working. You will need to re-add the new link in your calendar apps.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Regenerate', style: 'destructive', onPress: async () => {
          setRotating(true);
          try { setFeed(await rotateCalFeed()); setCopied(false); }
          catch (e) { Alert.alert('Calendar', e.message || 'Could not regenerate'); }
          finally { setRotating(false); }
        } },
      ]
    );
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeightRatio={0.92}>
      <Text style={{ fontSize: 19, fontWeight: '800', color: COLORS.ink, textAlign: 'center' }}>
        Sync with my calendar
      </Text>
      <Text style={{ fontSize: 12.5, color: COLORS.muted, textAlign: 'center', marginTop: 4, marginBottom: 16, paddingHorizontal: 8 }}>
        Add this private link once to Google, Apple or Outlook — your Jiayou lessons will appear and stay up to date automatically.
      </Text>

      {loading ? (
        <View style={{ paddingVertical: 24, alignItems: 'center' }}><ActivityIndicator color={COLORS.jiayou} /></View>
      ) : err ? (
        <View style={{ paddingVertical: 16, alignItems: 'center' }}>
          <Text style={{ color: COLORS.danger, fontSize: 13, marginBottom: 10 }}>{err}</Text>
          <Pressable onPress={load}><Text style={{ color: COLORS.jiayou, fontWeight: '700' }}>Retry</Text></Pressable>
        </View>
      ) : feed ? (
        <>
          {/* URL + copier */}
          <Pressable
            onPress={copy}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#f4f6f9', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: COLORS.line }}
          >
            <Text style={{ flex: 1, fontSize: 12, color: COLORS.muted }} numberOfLines={1}>{feed.url}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={COLORS.jiayou} />
              <Text style={{ color: COLORS.jiayou, fontWeight: '800', fontSize: 12.5 }}>{copied ? 'Copied' : 'Copy'}</Text>
            </View>
          </Pressable>

          {/* Boutons providers */}
          <View style={{ marginTop: 14, gap: 10 }}>
            <ProviderRow icon="logo-google" label="Add to Google Calendar"
              sub="Link copied — paste it if the page asks for a URL"
              onPress={() => { copy(); open(feed.google); }} />
            <ProviderRow icon="logo-apple" label="Add to Apple Calendar" onPress={() => open(feed.webcal)} />
            <ProviderRow icon="mail-outline" label="Outlook / Microsoft"
              sub="Copy the link, then: Add calendar → Subscribe from web"
              onPress={copy} />
          </View>

          <Pressable onPress={regenerate} disabled={rotating} style={{ marginTop: 18, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="refresh" size={14} color={COLORS.mutedLight} />
            <Text style={{ color: COLORS.mutedLight, fontWeight: '700', fontSize: 12.5 }}>{rotating ? 'Regenerating…' : 'Regenerate link'}</Text>
          </Pressable>
        </>
      ) : null}
    </BottomSheet>
  );
}

function ProviderRow({ icon, label, sub, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 12, padding: 13, borderWidth: 1, borderColor: COLORS.line }}
    >
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: '#eef2f7', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={18} color={COLORS.ink} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.ink }}>{label}</Text>
        {sub ? <Text style={{ fontSize: 11, color: COLORS.mutedLight, marginTop: 1 }}>{sub}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={COLORS.mutedLight} />
    </Pressable>
  );
}
