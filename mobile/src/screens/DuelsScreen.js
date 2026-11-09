import { useEffect, useState, useCallback } from 'react';
import {
  View, Pressable, Platform, RefreshControl, useWindowDimensions,
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
import { ErrorRetry } from '../components/ErrorRetry';
import { getDuels, getLeaderboard, getReferral, resendVerification } from '../api';
import { useT } from '../i18n';
import CatLoader from '../components/CatLoader';
// Design-system : surface d'import unique (cf. src/ui/COMPONENTS.md).
import { Screen, Text, Button, Row, Modal, COLORS } from '../ui';

// Ligne « liste vide » dans une carte à liste collée (noBodyPad).
function Empty({ text }) {
  return <Text variant="muted" style={{ paddingHorizontal: 18, paddingVertical: 14 }}>{text}</Text>;
}

// En dessous de ce nombre de mots, un duel n'a pas d'intérêt : on invite l'user
// à étoffer sa collection (capture / pack) — même logique que le quiz.
const MIN_DUEL_WORDS = 10;

export default function DuelsScreen({ onDefeat, emailVerified, onCapture, onOpenStore, initialDetailDuelId, onDeepLinkConsumed, onActivityDone }) {
  const { t } = useT();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 992;

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
  const [inviteCode, setInviteCode] = useState('');
  const [copied, setCopied] = useState(false);       // code copié
  const [copiedLink, setCopiedLink] = useState(false); // lien copié (option secondaire)
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [playingDuel, setPlayingDuel] = useState(null); // id du duel en cours de jeu
  const [detailDuel, setDetailDuel] = useState(null); // id du duel dont on voit le détail

  function openInvite() {
    setCopied(false); setCopiedLink(false);
    setShowInvite(true);
    if (!inviteCode) getReferral().then((r) => { setInviteCode(r.code); setInviteLink(r.link); }).catch(() => {});
  }

  async function copyInviteCode() {
    if (!inviteCode) return;
    try {
      await Clipboard.setStringAsync(inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }

  async function copyInviteLink() {
    if (!inviteLink) return;
    try {
      await Clipboard.setStringAsync(inviteLink);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
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

  // Deep-link depuis une notification « résultat de duel » : ouvre directement le
  // détail du duel ciblé, puis consomme le lien (évite de le rouvrir au re-render).
  useEffect(() => {
    if (initialDetailDuelId) {
      setDetailDuel(Number(initialDetailDuelId));
      onDeepLinkConsumed?.();
    }
  }, [initialDetailDuelId, onDeepLinkConsumed]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.page }}>
        <CatLoader size={110} />
      </View>
    );
  }
  if (error && !data) {
    return <View style={{ flex: 1, backgroundColor: COLORS.page }}><ErrorRetry error={error} onRetry={load} /></View>;
  }

  if (playingDuel) {
    return <DuelPlayScreen duelId={playingDuel} onExit={() => { setPlayingDuel(null); load(); onActivityDone?.(); }} />;
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
      <Row gap={14} align="stretch" style={{ marginBottom: 14 }}>
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
      </Row>

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
    <View style={{ flex: 1, backgroundColor: COLORS.page }}>
      {/* edges=[] : l'écran est monté SOUS le Header de l'app, qui gère déjà le
          safe-area du haut — on ne le réapplique pas ici (sinon double padding). */}
      <Screen
        edges={[]}
        maxWidth={1200}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={COLORS.jiayou} />}
      >
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
      </Screen>

      <StartDuelPopup
        visible={!!duelPopup}
        presetOpponent={duelPopup?.opponent}
        onClose={() => setDuelPopup(null)}
        onCreated={load}
      />

      {/* Gate : collection < 10 mots → on explique + on oriente vers capture/pack. */}
      <Modal visible={needWords} onClose={() => setNeedWords(false)} maxWidth={420}>
        <View style={{ alignItems: 'center', marginBottom: 6 }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#eef4ff', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <Ionicons name="library" size={30} color={COLORS.jiayou} />
          </View>
          <Text variant="subtitle" align="center">{t('qz_need_words_title')}</Text>
          <Text variant="muted" align="center" style={{ lineHeight: 20, marginTop: 8 }}>{t('du_need_words_body')}</Text>
        </View>

        <Button
          title={t('qz_need_words_capture')}
          icon="add-circle"
          fullWidth
          onPress={() => { setNeedWords(false); onCapture?.(); }}
          style={{ marginTop: 14 }}
        />
        {/* Action secondaire « boutique » — violet de marque (hors variantes lib). */}
        <Pressable
          onPress={() => { setNeedWords(false); onOpenStore?.(); }}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10, paddingVertical: 14, borderRadius: 999, borderWidth: 1.5, borderColor: '#e0d3f2', backgroundColor: '#faf7ff' }}
        >
          <Ionicons name="storefront" size={16} color="#7828a7" />
          <Text weight="700" color="#7828a7" style={{ fontSize: 15 }}>{t('qz_need_words_buy')}</Text>
        </Pressable>
      </Modal>

      {/* Invite a friend */}
      <Modal visible={showInvite} onClose={() => setShowInvite(false)} maxWidth={380}>
        {emailVerified === false ? (
          /* Compte non vérifié : le parrainage ne rapporterait rien → on montre
             clairement l'état "vérifie ton email" au lieu du lien (pas d'échec silencieux). */
          <>
            <View style={{ alignItems: 'center', marginBottom: 6 }}>
              <Ionicons name="mail-unread-outline" size={40} color={COLORS.jiayou} />
            </View>
            <Text variant="subtitle" align="center" style={{ marginBottom: 8 }}>{t('du_invite_verify_title')}</Text>
            <Text variant="muted" align="center" style={{ lineHeight: 20, marginBottom: 20 }}>
              {vState === 'sent' ? t('verify_sent') : t('du_invite_verify_body')}
            </Text>
            <Row gap={12}>
              <Button title={t('common_close')} variant="secondary" onPress={() => setShowInvite(false)} style={{ flex: 1, justifyContent: 'center' }} />
              <Button
                title={vState === 'sent' ? t('du_copied') : t('verify_resend')}
                loading={vState === 'sending'}
                disabled={vState !== 'idle'}
                onPress={async () => {
                  if (vState !== 'idle') return;
                  setVState('sending');
                  try { await resendVerification(); setVState('sent'); } catch { setVState('idle'); }
                }}
                style={{ flex: 1, justifyContent: 'center' }}
              />
            </Row>
          </>
        ) : (
          <>
            <Text variant="subtitle" style={{ marginBottom: 8 }}>{t('du_invite')}</Text>
            <Text variant="muted" style={{ lineHeight: 20, marginBottom: 16 }}>
              {t('du_invite_code_body')}
            </Text>

            {/* Code de parrainage — mis en avant (l'ami le saisit à l'inscription) */}
            <View style={{ backgroundColor: COLORS.page, borderWidth: 1, borderColor: '#e3e8f7', borderRadius: 12, paddingVertical: 16, paddingHorizontal: 14, marginBottom: 16, alignItems: 'center' }}>
              <Text style={{ fontSize: 26, fontWeight: '800', letterSpacing: 4, color: inviteCode ? COLORS.ink : COLORS.mutedLight }}>
                {inviteCode || '·······'}
              </Text>
            </View>

            <Row gap={12}>
              <Button title={t('common_close')} variant="secondary" onPress={() => setShowInvite(false)} style={{ flex: 1, justifyContent: 'center' }} />
              <Button
                title={copied ? t('du_copied') : t('du_copy_code')}
                icon={copied ? 'checkmark' : 'copy-outline'}
                disabled={!inviteCode}
                onPress={copyInviteCode}
                style={[{ flex: 1, justifyContent: 'center' }, copied && { backgroundColor: COLORS.success }]}
              />
            </Row>

            {/* Option secondaire : partager plutôt un lien d'invitation */}
            <Button
              variant="ghost"
              title={copiedLink ? t('du_copied') : t('du_copy_link_alt')}
              onPress={copyInviteLink}
              disabled={!inviteLink}
              fullWidth
              style={{ marginTop: 4 }}
              textStyle={{ fontSize: 13, fontWeight: '600', color: copiedLink ? COLORS.success : COLORS.jiayou }}
            />
          </>
        )}
      </Modal>
    </View>
  );
}
