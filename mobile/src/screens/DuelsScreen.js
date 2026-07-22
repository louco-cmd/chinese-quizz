import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, RefreshControl, ActivityIndicator, Pressable, Platform, useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import DuelSectionCard from '../components/duels/DuelSectionCard';
import CtaCard from '../components/duels/CtaCard';
import DuelStats from '../components/duels/DuelStats';
import { PendingDuelRow, RecentDuelRow, PlayerRow } from '../components/duels/DuelRows';
import StartDuelPopup from '../components/duels/StartDuelPopup';
import LeaderboardScreen from './LeaderboardScreen';
import DuelPlayScreen from './DuelPlayScreen';
import DuelDetailScreen from './DuelDetailScreen';
import Popup from '../components/Popup';
import { ErrorRetry } from '../components/ErrorRetry';
import { getDuels, getLeaderboard, getReferral } from '../api';
import { COLORS } from '../theme';

function Empty({ text }) {
  return <Text style={{ color: '#adb5bd', paddingHorizontal: 18, paddingVertical: 14 }}>{text}</Text>;
}

export default function DuelsScreen({ onDefeat }) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 992;
  const hPad = isDesktop ? 24 : 16;

  const [data, setData] = useState(null);
  const [board, setBoard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [duelPopup, setDuelPopup] = useState(null); // null | { opponent }
  const [showInvite, setShowInvite] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [playingDuel, setPlayingDuel] = useState(null); // id du duel en cours de jeu
  const [detailDuel, setDetailDuel] = useState(null); // id du duel dont on voit le détail

  function openInvite() {
    setCopied(false);
    setShowInvite(true);
    if (!inviteLink) getReferral().then((r) => setInviteLink(r.link)).catch(() => {});
  }

  async function copyInviteLink() {
    if (!inviteLink) return;
    try {
      await Clipboard.setStringAsync(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }

  const load = useCallback(async () => {
    setError('');
    try {
      const [d, b] = await Promise.all([getDuels(), getLeaderboard()]);
      setData(d);
      setBoard(b.leaderboard || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8f9fa' }}>
        <ActivityIndicator color={COLORS.jiayou} />
      </View>
    );
  }
  if (error && !data) {
    return <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}><ErrorRetry error={error} onRetry={load} /></View>;
  }

  if (playingDuel) {
    return <DuelPlayScreen duelId={playingDuel} onExit={() => { setPlayingDuel(null); load(); }} />;
  }

  if (detailDuel) {
    return (
      <DuelDetailScreen
        duelId={detailDuel}
        onBack={() => setDetailDuel(null)}
        onRematch={(opp) => { setDetailDuel(null); setDuelPopup({ opponent: opp }); }}
        onDefeat={onDefeat}
      />
    );
  }

  if (showLeaderboard) {
    return <LeaderboardScreen board={board} onBack={() => setShowLeaderboard(false)} />;
  }

  // ── Blocs réutilisés dans les deux dispositions ──
  const statsCard = (
    <DuelSectionCard icon="stats-chart" title="My statistics" note="See ranking" onPress={() => setShowLeaderboard(true)}>
      <DuelStats wins={data.wins} losses={data.losses} />
    </DuelSectionCard>
  );

  const rightColumn = (
    <>
      <View style={{ flexDirection: 'row', gap: 14, marginBottom: 14 }}>
        <CtaCard
          colors={['#1a7a4a', '#0f5132']}
          icon="flash"
          title="Start a duel"
          text="Challenge a player"
          onPress={() => setDuelPopup({ opponent: null })}
        />
        <CtaCard
          colors={['#4b5158', '#2b2f36']}
          icon="person-add"
          title="Invite a friend"
          text="Earn 80 coins"
          onPress={openInvite}
        />
      </View>

      {data.pending.length > 0 ? (
        <DuelSectionCard icon="time-outline" title="Pending duels" noBodyPad>
          {data.pending.map((d, i) => <PendingDuelRow key={d.id} duel={d} last={i === data.pending.length - 1} onPlay={(du) => setPlayingDuel(du.id)} />)}
        </DuelSectionCard>
      ) : null}

      <DuelSectionCard icon="hourglass-outline" title="Recent duels" noBodyPad>
        {(!data.recent || data.recent.length === 0)
          ? <Empty text="No duels played yet." />
          : data.recent.map((d, i) => <RecentDuelRow key={d.id} duel={d} last={i === data.recent.length - 1} onPress={(du) => setDetailDuel(du.id)} />)}
      </DuelSectionCard>

      <DuelSectionCard icon="people" title="Your rivals" note="Tap to challenge" noBodyPad>
        {(!data.bullies || data.bullies.length === 0)
          ? <Empty text="No rivals yet — play some bet duels!" />
          : data.bullies.map((p, i) => (
            <PlayerRow key={p.id} player={p} last={i === data.bullies.length - 1} onChallenge={(pl) => setDuelPopup({ opponent: pl })} />
          ))}
      </DuelSectionCard>
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <ScrollView
        contentContainerStyle={{ paddingVertical: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={COLORS.jiayou} />}
      >
        <View style={{ width: '100%', maxWidth: 1200, alignSelf: 'center', paddingHorizontal: hPad }}>
          {isDesktop ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 24 }}>
              <View style={[{ flex: 4 }, Platform.OS === 'web' ? { position: 'sticky', top: 16 } : null]}>
                {statsCard}
              </View>
              <View style={{ flex: 8 }}>{rightColumn}</View>
            </View>
          ) : (
            <>
              {statsCard}
              {rightColumn}
            </>
          )}
        </View>
      </ScrollView>

      <StartDuelPopup
        visible={!!duelPopup}
        presetOpponent={duelPopup?.opponent}
        onClose={() => setDuelPopup(null)}
        onCreated={load}
      />

      {/* Invite a friend */}
      <Popup visible={showInvite} onClose={() => setShowInvite(false)} maxWidth={380}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 }}>Invite a friend</Text>
        <Text style={{ fontSize: 14, color: COLORS.muted, lineHeight: 20, marginBottom: 16 }}>
          Share Jiayou with a friend. When they join, you both earn 80 coins.
        </Text>

        {/* Aperçu du lien */}
        <View style={{ backgroundColor: '#f8f9fa', borderWidth: 1, borderColor: '#e3e8f7', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 20 }}>
          <Text style={{ fontSize: 13, color: inviteLink ? '#1a1a2e' : '#adb5bd' }} numberOfLines={1}>
            {inviteLink || 'Generating your link…'}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Pressable onPress={() => setShowInvite(false)} style={{ flex: 1, backgroundColor: '#f1f3f5', borderRadius: 999, paddingVertical: 13, alignItems: 'center' }}>
            <Text style={{ color: COLORS.muted, fontWeight: '700' }}>Close</Text>
          </Pressable>
          <Pressable
            onPress={copyInviteLink}
            disabled={!inviteLink}
            style={{ flex: 1, backgroundColor: copied ? COLORS.success : COLORS.jiayou, borderRadius: 999, paddingVertical: 13, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6, opacity: inviteLink ? 1 : 0.6 }}
          >
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '700' }}>{copied ? 'Copied!' : 'Copy my link'}</Text>
          </Pressable>
        </View>
      </Popup>
    </View>
  );
}
