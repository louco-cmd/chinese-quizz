import { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, RefreshControl, ActivityIndicator, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import CtaCard from '../components/duels/CtaCard';
import MentorCard from '../components/teachers/MentorCard';
import MentorFilters from '../components/teachers/MentorFilters';
import JoinClassPopup from '../components/teachers/JoinClassPopup';
import Popup from '../components/Popup';
import { ErrorRetry } from '../components/ErrorRetry';
import { getMentors, getReferral } from '../api';
import { COLORS } from '../theme';

function priceMatches(price, active) {
  if (active === 'any') return true;
  if (price == null) return false;
  if (active === '0-20') return price <= 20;
  if (active === '20-40') return price >= 20 && price <= 40;
  if (active === '40+') return price > 40;
  return true;
}

export default function TeachersScreen() {
  const [mentors, setMentors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const [activeLang, setActiveLang] = useState('');
  const [activePrice, setActivePrice] = useState('any');

  const [showJoin, setShowJoin] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const d = await getMentors();
      setMentors(d.mentors || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const languages = useMemo(() => {
    const set = new Set();
    mentors.forEach((m) => (m.teaching_languages || []).forEach((l) => set.add(l)));
    return [...set].sort();
  }, [mentors]);

  const filtered = mentors.filter((m) =>
    (!activeLang || (m.teaching_languages || []).some((l) => l.toLowerCase() === activeLang.toLowerCase()))
    && priceMatches(m.session_price, activePrice)
  );

  function openInvite() {
    setCopied(false);
    setShowInvite(true);
    if (!inviteLink) getReferral().then((r) => setInviteLink(r.link)).catch(() => {});
  }
  async function copyInvite() {
    if (!inviteLink) return;
    try { await Clipboard.setStringAsync(inviteLink); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* noop */ }
  }

  if (loading) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8f9fa' }}><ActivityIndicator color={COLORS.jiayou} /></View>;
  }
  if (error) {
    return <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}><ErrorRetry error={error} onRetry={load} /></View>;
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <ScrollView
        contentContainerStyle={{ paddingVertical: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={COLORS.jiayou} />}
      >
        <View style={{ width: '100%', maxWidth: 700, alignSelf: 'center', paddingHorizontal: 16 }}>
          {/* CTA : rejoindre une classe + inviter son prof */}
          <View style={{ flexDirection: 'row', gap: 14, marginBottom: 16 }}>
            <CtaCard colors={['#0d6efd', '#0a58ca']} icon="enter" title="Join a class" text="Enter a code" onPress={() => setShowJoin(true)} />
            <CtaCard colors={['#4b5158', '#2b2f36']} icon="person-add" title="Invite your teacher" text="Earn 150 coins" onPress={openInvite} />
          </View>

          {/* Filtres */}
          {mentors.length > 0 && (
            <MentorFilters
              languages={languages}
              activeLang={activeLang} onLang={setActiveLang}
              activePrice={activePrice} onPrice={setActivePrice}
            />
          )}

          {/* Liste des mentors */}
          {mentors.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <Text style={{ fontSize: 40 }}>🧑‍🏫</Text>
              <Text style={{ color: COLORS.muted, marginTop: 8 }}>No teachers listed yet. Check back soon!</Text>
            </View>
          ) : filtered.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 30 }}>
              <Ionicons name="search" size={34} color={COLORS.muted} />
              <Text style={{ color: COLORS.muted, marginTop: 8, fontSize: 13 }}>No teacher matches these filters.</Text>
            </View>
          ) : (
            filtered.map((m) => <MentorCard key={m.id} mentor={m} />)
          )}
        </View>
      </ScrollView>

      <JoinClassPopup visible={showJoin} onClose={() => setShowJoin(false)} onJoined={load} />

      {/* Invite your teacher (référence → 150 coins) */}
      <Popup visible={showInvite} onClose={() => setShowInvite(false)} maxWidth={380}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 }}>Invite your teacher</Text>
        <Text style={{ fontSize: 14, color: COLORS.muted, lineHeight: 20, marginBottom: 16 }}>
          Share Jiayou with your teacher. When they join, you earn 150 coins.
        </Text>
        <View style={{ backgroundColor: '#f8f9fa', borderWidth: 1, borderColor: '#e3e8f7', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 20 }}>
          <Text style={{ fontSize: 13, color: inviteLink ? '#1a1a2e' : '#adb5bd' }} numberOfLines={1}>
            {inviteLink || 'Generating your link…'}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Pressable onPress={() => setShowInvite(false)} style={{ flex: 1, backgroundColor: '#f1f3f5', borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}>
            <Text style={{ color: COLORS.muted, fontWeight: '700' }}>Close</Text>
          </Pressable>
          <Pressable onPress={copyInvite} disabled={!inviteLink} style={{ flex: 1, backgroundColor: copied ? COLORS.success : COLORS.jiayou, borderRadius: 12, paddingVertical: 13, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6, opacity: inviteLink ? 1 : 0.6 }}>
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '700' }}>{copied ? 'Copied!' : 'Copy my link'}</Text>
          </Pressable>
        </View>
      </Popup>
    </View>
  );
}
