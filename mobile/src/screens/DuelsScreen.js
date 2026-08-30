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
import { getDuels, getLeaderboard, getReferral, resendVerification } from '../api';
import { useT } from '../i18n';
import { COLORS, TAB_CLEARANCE } from '../theme';
import CatLoader from '../components/CatLoader';

function Empty({ text }) {
  return <Text style={{ color: '#adb5bd', paddingHorizontal: 18, paddingVertical: 14 }}>{text}</Text>;
}

// En dessous de ce nombre de mots, un duel n'a pas d'intérêt : on invite l'user
// à étoffer sa collection (capture / pack) — même logique que le quiz.
const MIN_DUEL_WORDS = 10;

export default function DuelsScreen({ onDefeat, emailVerified, onCapture, onOpenStore }) {
  const { t } = useT();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 992;
  const hPad = isDesktop ? 24 : 16;

  const [data, setData] = useState(null);
  const [board, setBoard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [duelPopup, setDuelPopup] = useState(null); // null | { opponent }
  const [needWords, setNeedWords] = useState(false); // gate collection trop petite
  const [showInvite, setShowInvite] = useState(false);
  const [vState, setVState] = useState('idle'); // idle | sending | sent (renvoi email)
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

  // Ouvre le duel si la collection est assez grande, sinon la gate d'explication.
  function openDuel(opponent) {
    if (data && data.words < MIN_DUEL_WORDS) setNeedWords(true);
    else setDuelPopup({ opponent });
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
        <CatLoader size={110} />
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
        onRematch={(opp) => { setDetailDuel(null); openDuel(opp); }}
        onDefeat={onDefeat}
      />
    );
  }

  if (showLeaderboard) {
    return <LeaderboardScreen board={board} onBack={() => setShowLeaderboard(false)} />;
  }

  // ── Blocs réutilisés dans les deux dispositions ──
  const statsCard = (
    <DuelSectionCard icon="stats-chart" title={t('quiz_mystats')} note={t('du_see_ranking')} onPress={() => setShowLeaderboard(true)}>
      <DuelStats wins={data.wins} losses={data.losses} />
    </DuelSectionCard>
  );

  const rightColumn = (
    <>
      <View style={{ flexDirection: 'row', gap: 14, marginBottom: 14 }}>
        <CtaCard
          colors={['#1a7a4a', '#0f5132']}
          icon="flash"
          title={t('du_start')}
          text={t('du_challenge_player')}
          onPress={() => openDuel(null)}
        />
        <CtaCard
          colors={['#4b5158', '#2b2f36']}
          icon="person-add"
          title={t('du_invite')}
          text={t('du_earn_coins')}
          onPress={openInvite}
        />
      </View>

      {data.pending.length > 0 ? (
        <DuelSectionCard icon="time-outline" title={t('du_pending')} noBodyPad>
          {data.pending.map((d, i) => <PendingDuelRow key={d.id} duel={d} last={i === data.pending.length - 1} onPlay={(du) => setPlayingDuel(du.id)} />)}
        </DuelSectionCard>
      ) : null}

      <DuelSectionCard icon="hourglass-outline" title={t('du_recent')} noBodyPad>
        {(!data.recent || data.recent.length === 0)
          ? <Empty text={t('du_no_duels')} />
          : data.recent.map((d, i) => <RecentDuelRow key={d.id} duel={d} last={i === data.recent.length - 1} onPress={(du) => setDetailDuel(du.id)} />)}
      </DuelSectionCard>

      <DuelSectionCard icon="people" title={t('du_rivals')} note={t('du_tap_challenge')} noBodyPad>
        {(!data.bullies || data.bullies.length === 0)
          ? <Empty text={t('du_no_rivals')} />
          : data.bullies.map((p, i) => (
            <PlayerRow key={p.id} player={p} last={i === data.bullies.length - 1} onChallenge={(pl) => openDuel(pl)} />
          ))}
      </DuelSectionCard>
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: 16, paddingBottom: TAB_CLEARANCE }}
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

      {/* Gate : collection < 10 mots → on explique + on oriente vers capture/pack. */}
      <Popup visible={needWords} onClose={() => setNeedWords(false)} maxWidth={420}>
        <View style={{ alignItems: 'center', marginBottom: 6 }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#eef4ff', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <Ionicons name="library" size={30} color={COLORS.jiayou} />
          </View>
          <Text style={{ fontSize: 18, fontWeight: '800', color: '#1a1a2e', textAlign: 'center' }}>{t('qz_need_words_title')}</Text>
          <Text style={{ fontSize: 14, color: COLORS.muted, textAlign: 'center', lineHeight: 20, marginTop: 8 }}>{t('du_need_words_body')}</Text>
        </View>

        <Pressable
          onPress={() => { setNeedWords(false); onCapture?.(); }}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14, paddingVertical: 14, borderRadius: 999, backgroundColor: COLORS.jiayou }}
        >
          <Ionicons name="add-circle" size={18} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{t('qz_need_words_capture')}</Text>
        </Pressable>
        <Pressable
          onPress={() => { setNeedWords(false); onOpenStore?.(); }}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10, paddingVertical: 14, borderRadius: 999, borderWidth: 1.5, borderColor: '#e0d3f2', backgroundColor: '#faf7ff' }}
        >
          <Ionicons name="storefront" size={16} color="#7828a7" />
          <Text style={{ color: '#7828a7', fontWeight: '700', fontSize: 15 }}>{t('qz_need_words_buy')}</Text>
        </Pressable>
      </Popup>

      {/* Invite a friend */}
      <Popup visible={showInvite} onClose={() => setShowInvite(false)} maxWidth={380}>
        {emailVerified === false ? (
          /* Compte non vérifié : le parrainage ne rapporterait rien → on montre
             clairement l'état "vérifie ton email" au lieu du lien (pas d'échec silencieux). */
          <>
            <View style={{ alignItems: 'center', marginBottom: 6 }}>
              <Ionicons name="mail-unread-outline" size={40} color={COLORS.jiayou} />
            </View>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#1a1a2e', textAlign: 'center', marginBottom: 8 }}>{t('du_invite_verify_title')}</Text>
            <Text style={{ fontSize: 14, color: COLORS.muted, lineHeight: 20, textAlign: 'center', marginBottom: 20 }}>
              {vState === 'sent' ? t('verify_sent') : t('du_invite_verify_body')}
            </Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Pressable onPress={() => setShowInvite(false)} style={{ flex: 1, backgroundColor: '#f1f3f5', borderRadius: 999, paddingVertical: 13, alignItems: 'center' }}>
                <Text style={{ color: COLORS.muted, fontWeight: '700' }}>{t('common_close')}</Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  if (vState !== 'idle') return;
                  setVState('sending');
                  try { await resendVerification(); setVState('sent'); } catch { setVState('idle'); }
                }}
                disabled={vState !== 'idle'}
                style={{ flex: 1, backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 13, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6, opacity: vState === 'idle' ? 1 : 0.7 }}
              >
                {vState === 'sending'
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={{ color: '#fff', fontWeight: '700' }}>{vState === 'sent' ? t('du_copied') : t('verify_resend')}</Text>}
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 }}>{t('du_invite')}</Text>
            <Text style={{ fontSize: 14, color: COLORS.muted, lineHeight: 20, marginBottom: 16 }}>
              {t('du_invite_body')}
            </Text>

            {/* Aperçu du lien */}
            <View style={{ backgroundColor: '#f8f9fa', borderWidth: 1, borderColor: '#e3e8f7', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 20 }}>
              <Text style={{ fontSize: 13, color: inviteLink ? '#1a1a2e' : '#adb5bd' }} numberOfLines={1}>
                {inviteLink || t('du_generating_link')}
              </Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Pressable onPress={() => setShowInvite(false)} style={{ flex: 1, backgroundColor: '#f1f3f5', borderRadius: 999, paddingVertical: 13, alignItems: 'center' }}>
                <Text style={{ color: COLORS.muted, fontWeight: '700' }}>{t('common_close')}</Text>
              </Pressable>
              <Pressable
                onPress={copyInviteLink}
                disabled={!inviteLink}
                style={{ flex: 1, backgroundColor: copied ? COLORS.success : COLORS.jiayou, borderRadius: 999, paddingVertical: 13, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6, opacity: inviteLink ? 1 : 0.6 }}
              >
                <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color="#fff" />
                <Text style={{ color: '#fff', fontWeight: '700' }}>{copied ? t('du_copied') : t('du_copy_link')}</Text>
              </Pressable>
            </View>
          </>
        )}
      </Popup>
    </View>
  );
}
