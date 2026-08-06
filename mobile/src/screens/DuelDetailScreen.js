import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, Platform, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ErrorRetry } from '../components/ErrorRetry';
import Avatar from '../components/Avatar';
import { getDuel } from '../api';
import { useT } from '../i18n';
import useAndroidBack from '../useAndroidBack';
import { COLORS, SHADOW_CARD, TAB_CLEARANCE } from '../theme';
import CatLoader from '../components/CatLoader';

const DEFEAT = '#c0392b';
const DEFEAT_BG = '#fbeceb'; // fond de page teinté rouge clair

// Verre brisé (état défaite) : fêlures qui rayonnent d'un point d'impact unique
// (transformOrigin = sommet de chaque trait) + éclat central + branches courtes.
const IMPACT_Y = 30;
const MAIN_CRACKS = [
  { angle: 3, len: 210, w: 2.4, o: 0.24 },
  { angle: -14, len: 185, w: 1.9, o: 0.22 },
  { angle: 20, len: 165, w: 1.6, o: 0.2 },
  { angle: -33, len: 150, w: 1.3, o: 0.18 },
  { angle: 44, len: 130, w: 1.1, o: 0.16 },
  { angle: -55, len: 115, w: 1, o: 0.15 },
  { angle: 66, len: 95, w: 0.9, o: 0.13 },
  { angle: -78, len: 90, w: 0.8, o: 0.12 },
  { angle: 92, len: 70, w: 0.7, o: 0.1 },
];
// Petites fêlures secondaires détachées (donnent l'effet d'éclats).
const SHARDS = [
  { top: 120, left: '42%', angle: 28, len: 46, w: 0.8, o: 0.12 },
  { top: 150, left: '60%', angle: -36, len: 40, w: 0.8, o: 0.11 },
  { top: 96, left: '66%', angle: 54, len: 34, w: 0.7, o: 0.1 },
];
function CrackOverlay() {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
      {/* Éclat au point d'impact */}
      <View style={{ position: 'absolute', top: IMPACT_Y - 10, left: '50%', marginLeft: -10, width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: 'rgba(255,255,255,0.28)' }} />
      <View style={{ position: 'absolute', top: IMPACT_Y - 3, left: '50%', marginLeft: -3, width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.4)' }} />
      {/* Fêlures rayonnantes */}
      {MAIN_CRACKS.map((c, i) => (
        <View key={i} style={{
          position: 'absolute', top: IMPACT_Y, left: '50%', width: c.w, height: c.len,
          backgroundColor: '#fff', opacity: c.o, transform: [{ rotate: `${c.angle}deg` }], transformOrigin: 'top center',
        }} />
      ))}
      {/* Éclats détachés */}
      {SHARDS.map((c, i) => (
        <View key={`s${i}`} style={{
          position: 'absolute', top: c.top, left: c.left, width: c.w, height: c.len,
          backgroundColor: '#fff', opacity: c.o, transform: [{ rotate: `${c.angle}deg` }], transformOrigin: 'top center',
        }} />
      ))}
    </View>
  );
}

// Avatar rond du bloc VS.
function VsAvatar({ winner, icon, color, name }) {
  // Avatar choisi si présent ; sinon rond translucide blanc (sur fond bleu).
  if (icon) {
    return <View style={{ marginBottom: 10 }}><Avatar icon={icon} color={color} name={name} size={52} /></View>;
  }
  return (
    <View style={{
      width: 52, height: 52, borderRadius: 26, alignSelf: 'center', marginBottom: 10,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: winner ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.2)',
    }}>
      <Ionicons name="person" size={24} color="#fff" />
    </View>
  );
}

function VsPlayer({ name, score, winner, loser, icon, color }) {
  const { t } = useT();
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <VsAvatar winner={winner} icon={icon} color={color} name={name} />
      <Text numberOfLines={1} style={{ maxWidth: 110, fontSize: 13.5, fontWeight: '600', color: '#fff', opacity: 0.9, marginBottom: 6 }}>
        {name}
      </Text>
      <Text style={{ fontSize: 42, fontWeight: '800', lineHeight: 44, letterSpacing: -1, color: '#fff', opacity: winner ? 1 : loser ? 0.55 : 0.85 }}>
        {score !== null && score !== undefined ? score : '—'}
      </Text>
      {winner ? (
        <View style={{ marginTop: 6, backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 2 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: '#fff' }}>🏆 {t('dd_winner')}</Text>
        </View>
      ) : null}
    </View>
  );
}

function WordRow({ word, last }) {
  const { t } = useT();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: last ? 0 : 1, borderColor: '#f5f5f5' }}>
      <Text style={{ fontSize: 22, fontWeight: '500', color: '#1d1d1f', minWidth: 48, textAlign: 'center' }}>{word.chinese}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        {word.pinyin ? <Text style={{ fontSize: 12.5, color: COLORS.jiayou, fontWeight: '600' }}>{word.pinyin}</Text> : null}
        <Text numberOfLines={1} style={{ fontSize: 14, color: '#1d1d1f', fontWeight: '500' }}>{word.english || ''}</Text>
        {word.description ? <Text numberOfLines={1} style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>{word.description}</Text> : null}
      </View>
      {word.hsk ? (
        <View style={{ backgroundColor: '#e8f0fe', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.jiayou }}>HSK {word.hsk}</Text>
        </View>
      ) : (
        <View style={{ backgroundColor: '#f0f0f0', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: '#888' }}>{t('qz_street')}</Text>
        </View>
      )}
    </View>
  );
}

// Détail d'un duel terminé (miroir de duel-detail.ejs). `onRematch({id,name})`
// ouvre le popup de défi pré-rempli avec l'adversaire.
// Ligne de détail (colonne gauche desktop).
function DetailRow({ icon, label, value, last }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderBottomWidth: last ? 0 : 1, borderColor: '#f2f4f7' }}>
      <Ionicons name={icon} size={16} color={COLORS.jiayou} />
      <Text style={{ flex: 1, marginLeft: 10, fontSize: 13.5, color: COLORS.muted }}>{label}</Text>
      <Text style={{ fontSize: 13.5, fontWeight: '700', color: '#1d1d1f' }}>{value}</Text>
    </View>
  );
}

export default function DuelDetailScreen({ duelId, onBack, onRematch, onDefeat }) {
  const { t } = useT();
  useAndroidBack(() => { onBack(); return true; }, true, [onBack]);
  const { width } = useWindowDimensions();
  const isDesktop = width >= 992;
  const [duel, setDuel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setDuel(await getDuel(duelId));
    } catch (e) {
      setError(e.message || t('dd_could_not_load'));
    } finally {
      setLoading(false);
    }
  }, [duelId]);

  useEffect(() => { load(); }, [load]);

  // Remonte l'état "défaite" à l'app (header + fond rouge) ; réinitialise en sortie.
  useEffect(() => {
    onDefeat?.(duel?.result === 'lost');
  }, [duel, onDefeat]);
  useEffect(() => () => onDefeat?.(false), [onDefeat]);

  if (loading) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.page }}><CatLoader size={110} /></View>;
  }
  if (error) {
    return <View style={{ flex: 1, backgroundColor: COLORS.page }}><ErrorRetry error={error} onRetry={load} /></View>;
  }

  const iWon = duel.result === 'won';
  const theyWon = duel.result === 'lost';
  const isTie = duel.result === 'draw';
  const chip = iWon ? { bg: 'rgba(255,255,255,0.28)', fg: '#fff', label: `🏆 ${t('du_won')}` }
    : theyWon ? { bg: 'rgba(0,0,0,0.25)', fg: 'rgba(255,255,255,0.85)', label: `😵 ${t('du_lost')}` }
    : isTie ? { bg: 'rgba(255,255,255,0.2)', fg: '#fff', label: `🤝 ${t('du_draw')}` }
    : { bg: '#ffc107', fg: '#333', label: (duel.status || 'pending').replace('_', ' ') };

  const heroBg = theyWon ? DEFEAT : COLORS.jiayou;
  const pageBg = theyWon ? DEFEAT_BG : COLORS.page;
  const words = duel.words || [];
  const completed = duel.status === 'completed' && onRematch;

  const details = [
    { icon: 'shuffle', label: t('dd_mode'), value: duel.duel_type === 'classic' ? t('dd_random') : t('dd_aa_match') },
    { icon: 'help-circle', label: t('dd_quiz_type'), value: duel.quiz_type === 'pinyin' ? t('qz_pinyin') : t('qz_characters') },
    { icon: 'list', label: t('dd_words'), value: String(words.length) },
    ...(duel.bet_amount > 0 ? [{ icon: 'cash', label: t('dd_bet'), value: `${duel.bet_amount}₵` }] : []),
  ];

  const rematchBtn = completed ? (
    <Pressable
      onPress={() => onRematch({ id: duel.opponent_id, name: duel.opponent_name })}
      style={{ backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
    >
      <Ionicons name="repeat" size={17} color="#fff" />
      <Text style={{ color: '#fff', fontSize: 14.5, fontWeight: '700' }} numberOfLines={1}>{t('dd_rematch_with').replace('{name}', duel.opponent_name)}</Text>
    </Pressable>
  ) : null;

  // Carte "Match details" (utilisée en desktop ET en mobile).
  const detailsCard = (
    <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 16, ...SHADOW_CARD }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.muted, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4 }}>{t('dd_match_details')}</Text>
      {details.map((d, i) => <DetailRow key={d.label} icon={d.icon} label={d.label} value={d.value} last={i === details.length - 1} />)}
      {rematchBtn ? <View style={{ marginTop: 14 }}>{rematchBtn}</View> : null}
    </View>
  );

  const wordsCard = (
    <>
      <View style={{ backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', ...SHADOW_CARD }}>
        {words.length > 0 ? (
          words.map((w, i) => <WordRow key={i} word={w} last={i === words.length - 1} />)
        ) : (
          <View style={{ paddingVertical: 40, paddingHorizontal: 24, alignItems: 'center' }}>
            <Ionicons name="file-tray-outline" size={38} color="#bbb" />
            <Text style={{ color: '#bbb', marginTop: 10 }}>{t('dd_no_words')}</Text>
          </View>
        )}
      </View>
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: pageBg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: TAB_CLEARANCE }}>
        {/* ── Hero ── */}
        <View style={{ backgroundColor: heroBg, paddingTop: 28, paddingBottom: 52, paddingHorizontal: 24, overflow: 'hidden' }}>
          {theyWon ? <CrackOverlay /> : null}

          {/* Retour */}
          <Pressable onPress={onBack} hitSlop={10} style={{ position: 'absolute', top: 20, left: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
            <Ionicons name="arrow-back" size={20} color="rgba(255,255,255,0.9)" />
          </Pressable>

          {/* Contenu du hero contraint (évite l'étirement sur grand écran) */}
          <View style={{ width: '100%', maxWidth: 520, alignSelf: 'center' }}>
            <View style={{ alignItems: 'center', marginBottom: 20 }}>
              <View style={{ backgroundColor: chip.bg, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 3 }}>
                <Text style={{ fontSize: 11.5, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', color: chip.fg }}>{chip.label}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
              <VsPlayer name={duel.my_name} icon={duel.my_avatar_icon} color={duel.my_avatar_color} score={duel.my_score} winner={iWon} loser={theyWon} />
              <Text style={{ paddingHorizontal: 16, fontSize: 12, fontWeight: '700', color: '#fff', opacity: 0.5, letterSpacing: 1 }}>VS</Text>
              <VsPlayer name={duel.opponent_name} icon={duel.opponent_avatar_icon} color={duel.opponent_avatar_color} score={duel.opp_score} winner={theyWon} loser={iWon} />
            </View>
          </View>
        </View>

        {/* ── Contenu ── */}
        <View style={{ width: '100%', maxWidth: isDesktop ? 1000 : 560, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 16 }}>
          {isDesktop ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 24 }}>
              {/* Colonne gauche : détails + rematch (sticky) */}
              <View style={[{ flex: 4 }, Platform.OS === 'web' ? { position: 'sticky', top: 16 } : null]}>{detailsCard}</View>
              {/* Colonne droite : mots */}
              <View style={{ flex: 8 }}>{wordsCard}</View>
            </View>
          ) : (
            <>
              <View style={{ marginBottom: 18 }}>{detailsCard}</View>
              {wordsCard}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
