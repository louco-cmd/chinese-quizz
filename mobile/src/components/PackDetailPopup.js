import { useState, useEffect } from 'react';
import { View, Text, Pressable, ActivityIndicator, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Popup from './Popup';
import { getMarketPack, buyMarketPack, notifyNeedCoins, forgetPack, notifyUpgrade } from '../api';
import { useT } from '../i18n';
import { COLORS } from '../theme';
import CatLoader from './CatLoader';

// Illustration fictive : fond bleu pâle + idéogramme du niveau HSK.
const HSK_GLYPH = { hsk1: '一', hsk2: '二', hsk3: '三', hsk4: '四', hsk5: '五', hsk6: '六' };
export const glyphOf = (k) => HSK_GLYPH[k] || '汉';
export const COVER_BG = '#e8f0ff';
export const COVER_FG = '#5b8def';

// Packs réservés au premium (niveaux HSK avancés) — miroir de PREMIUM_PACK_COVERS
// côté serveur (routes/mobile.js). Repérés par cover_key.
export const PREMIUM_PACK_COVERS = ['hsk4', 'hsk5', 'hsk6'];
export const isPremiumPack = (pack) => PREMIUM_PACK_COVERS.includes(pack?.cover_key);

// Jauge « part déjà possédée », posée en bas à droite de la cover bleue :
// barre remplie à X% + libellé. Rendue seulement si on possède déjà des mots.
export function OwnedProgress({ owned, total }) {
  const { t } = useT();
  if (!total) return null; // visible même à 0 % (indicateur de progression, partout)
  const pct = Math.min(100, Math.round(((owned || 0) / total) * 100));
  return (
    <View style={{ position: 'absolute', right: 8, bottom: 8, alignItems: 'flex-end' }}>
      <Text style={{ fontSize: 10, fontWeight: '800', color: COVER_FG, marginBottom: 3 }}>{pct}% {t('st_owned_gauge')}</Text>
      <View style={{ width: 66, height: 5, borderRadius: 999, backgroundColor: 'rgba(91,141,239,0.28)', overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: '100%', backgroundColor: COVER_FG, borderRadius: 999 }} />
      </View>
    </View>
  );
}

// Ligne d'un mot : deux colonnes justifiées — chinois + pinyin ensemble à
// gauche, anglais aligné à droite.
// La police suit la LANGUE du texte, pas la colonne : le chinois (hanzi) est
// toujours gros/gras (dense, lisible ainsi), l'occidental toujours plus léger —
// sinon un mot anglais en gras à gauche alourdit la popup.
const CJK_RE = /[㐀-鿿豈-﫿]/;
const scriptStyle = (s) => (CJK_RE.test(s || '')
  ? { fontSize: 18, fontWeight: '700', lineHeight: 24 }
  : { fontSize: 14.5, fontWeight: '500', lineHeight: 20 });

export function WordRow({ w, last }) {
  // Verrouillé : on montre le mot proposé (gauche) mais la traduction est masquée
  // (floutée sur web) — teaser avant achat.
  const locked = !!w.locked || (w.english == null);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 11, borderBottomWidth: last ? 0 : 1, borderColor: '#eceef1' }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: '#1a1a2e', ...scriptStyle(w.chinese) }}>{w.chinese}</Text>
        {w.pinyin ? <Text style={{ fontSize: 11.5, color: COLORS.muted, marginTop: 1 }}>{w.pinyin}</Text> : null}
      </View>
      {locked ? (
        // Traduction masquée : barre grise (rendu identique iOS/Android/web) — le
        // `filter: blur` CSS n'existe pas sur natif, d'où une barre "caviardée".
        <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end', gap: 6 }}>
          <View style={{ width: 54, height: 11, borderRadius: 6, backgroundColor: '#e1e5ea' }} />
          <View style={{ width: 34, height: 11, borderRadius: 6, backgroundColor: '#e1e5ea' }} />
        </View>
      ) : (
        <Text style={{ flex: 1, textAlign: 'right', color: '#1a1a2e', ...scriptStyle(w.english) }} numberOfLines={2}>{w.english}</Text>
      )}
    </View>
  );
}

// Popup de détail d'un pack — modèle unique (store + packs achetés) : cover,
// titre, créateur + stats, description, liste de mots (complète si possédé,
// aperçu de 3 sinon), et action (acheter / démarrer un quiz).
//   pack        : résumé du pack sélectionné (id, title, cover_key, price…) ou null → masqué
//   balance     : solde de l'utilisateur (pour le bouton d'achat)
//   onStartQuiz : (pack) => void — affiche "Start a quiz" si possédé
//   onBought    : (packId, { newBalance, wordsAdded }) => void — après achat
export default function PackDetailPopup({ pack, balance, isPremium = false, onClose, onStartQuiz, onBought, onEditPack, onUpgrade, onForgotten }) {
  const { t } = useT();
  const { height: screenH } = useWindowDimensions();
  const [detail, setDetail] = useState(null); // { pack, words?, preview? }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [buying, setBuying] = useState(false);
  const [msg, setMsg] = useState('');
  const [confirmForget, setConfirmForget] = useState(false); // « Forget this pack » (premium)
  const [forgetting, setForgetting] = useState(false);

  useEffect(() => {
    if (!pack) return;
    let alive = true;
    setLoading(true); setDetail(null); setError(''); setMsg(''); setConfirmForget(false); setForgetting(false);
    getMarketPack(pack.id)
      .then((d) => { if (alive) setDetail(d); })
      .catch((e) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [pack]);

  const p = detail?.pack || pack || {};
  const words = detail?.words;
  const preview = detail?.preview;
  const owned = !!(p.owned || p.isMine);
  // Pack premium verrouillé pour un utilisateur gratuit → on propose l'upgrade.
  const premiumLocked = isPremiumPack(p) && !isPremium && !owned && onUpgrade;
  const hasWords = (p.word_count || 0) > 0;
  // Solde inconnu (profil pas encore chargé) → optimiste : on tente l'achat, le
  // backend tranchera (402 → handler global). Solde connu & insuffisant → on
  // ouvrira la popup « gagner des pièces ».
  const affordable = balance == null || balance >= p.price;
  // Bouton cliquable même sans fonds → on ferme la popup pack et on ouvre la
  // popup « comment gagner des pièces » (même commit = swap propre, pas de
  // stacking de modals sur iOS). Sinon le bouton grisé n'apprend rien à l'user.
  const canBuy = !owned && hasWords;
  const buyPress = affordable
    ? buy
    : () => { onClose?.(); notifyNeedCoins({ cost: p.price, balance }); };

  async function buy() {
    setBuying(true); setError('');
    try {
      const d = await buyMarketPack(pack.id);
      setMsg(t('st_added').replace('{n}', d.wordsAdded));
      try { setDetail(await getMarketPack(pack.id)); } catch { /* noop */ }
      onBought?.(pack.id, d);
    } catch (e) { setError(e.message); } finally { setBuying(false); }
  }

  // « Forget this pack » (premium) : retire de la collection tous les mots du pack.
  // Non premium → paywall (swap propre : on ferme la popup puis on ouvre le paywall).
  function onForgetPress() {
    if (!isPremium) { onClose?.(); notifyUpgrade('bulk_delete'); return; }
    setConfirmForget(true);
  }
  async function doForget() {
    setForgetting(true); setError('');
    try {
      const d = await forgetPack(pack.id);
      onForgotten?.(pack.id, d?.deleted || 0);
      setForgetting(false);
      onClose?.();
    } catch (e) {
      setError(e.message || 'Could not remove the words.');
      setForgetting(false);
    }
  }

  const bodyLoading = loading && !detail;
  // Feedback + actions = FOOTER collé en bas du Popup (bouton d'achat toujours
  // visible, ne scrolle pas avec la liste de mots).
  const footerNode = bodyLoading ? null : (
    <View>
      {msg ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#e8f5e9', borderRadius: 12, padding: 12, marginBottom: 10 }}>
          <Ionicons name="checkmark-circle" size={20} color={COLORS.success} />
          <Text style={{ flex: 1, fontSize: 13.5, color: '#1b5e20', fontWeight: '600' }}>{msg}</Text>
        </View>
      ) : null}
      {error ? <Text style={{ color: COLORS.danger, fontSize: 13, fontWeight: '600', marginBottom: 10 }}>{error}</Text> : null}
      {confirmForget ? (
        <View>
          <Text style={{ fontSize: 14, color: '#1a1a2e', lineHeight: 20, marginBottom: 14, textAlign: 'center' }}>
            {t('st_forget_confirm')}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable onPress={() => setConfirmForget(false)} disabled={forgetting}
              style={{ flex: 1, paddingVertical: 13, borderRadius: 999, borderWidth: 2, borderColor: COLORS.line, alignItems: 'center' }}>
              <Text style={{ color: '#444', fontWeight: '700' }}>{t('co_cancel')}</Text>
            </Pressable>
            <Pressable onPress={doForget} disabled={forgetting}
              style={{ flex: 1.3, paddingVertical: 13, borderRadius: 999, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, backgroundColor: COLORS.danger }}>
              {forgetting ? <ActivityIndicator color="#fff" size="small" /> : (
                <>
                  <Ionicons name="trash" size={15} color="#fff" />
                  <Text style={{ color: '#fff', fontWeight: '800' }}>{t('st_forget_pack')}</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      ) : owned ? (
        <View style={{ gap: 10 }}>
          {onStartQuiz ? (
            <Pressable
              onPress={() => onStartQuiz(p)}
              style={{ backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
            >
              <Ionicons name="play" size={16} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{t('st_start_quiz')}</Text>
            </Pressable>
          ) : null}
          {p.isMine && onEditPack ? (
            <Pressable
              onPress={() => onEditPack({ id: p.id, title: p.title, description: p.description, price: p.price, words: words || [] })}
              style={{ borderWidth: 1.5, borderColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 13, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
            >
              <Ionicons name="create-outline" size={16} color={COLORS.jiayou} />
              <Text style={{ color: COLORS.jiayou, fontWeight: '700', fontSize: 15 }}>{t('st_edit_pack')}</Text>
            </Pressable>
          ) : null}
          <Text style={{ textAlign: 'center', color: COLORS.muted, fontWeight: '700', fontSize: 13 }}>
            {p.isMine ? t('st_your_pack') : t('st_in_collection')}
          </Text>
          {!p.isMine ? (
            <Pressable onPress={onForgetPress} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 2 }}>
              <Ionicons name="trash-outline" size={15} color={COLORS.danger} />
              <Text style={{ color: COLORS.danger, fontWeight: '700', fontSize: 13.5 }}>{t('st_forget_pack')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (p.word_count || 0) === 0 ? (
        <View style={{ backgroundColor: '#e9ecef', borderRadius: 999, paddingVertical: 14, alignItems: 'center' }}>
          <Text style={{ color: COLORS.muted, fontWeight: '700' }}>{t('st_coming_soon')}</Text>
        </View>
      ) : premiumLocked ? (
        <Pressable
          onPress={() => { onClose?.(); onUpgrade?.(); }}
          style={{ borderRadius: 999, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, backgroundColor: '#f5b301' }}
        >
          <Ionicons name="star" size={16} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{t('st_upgrade')}</Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={buyPress}
          disabled={buying || !canBuy}
          style={{ borderRadius: 999, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, backgroundColor: affordable ? COLORS.jiayou : '#e9ecef' }}
        >
          {buying ? <ActivityIndicator color="#fff" size="small" /> : (
            <>
              <Ionicons name={affordable ? 'cart' : 'wallet-outline'} size={16} color={affordable ? '#fff' : COLORS.muted} />
              <Text style={{ color: affordable ? '#fff' : COLORS.muted, fontWeight: '700', fontSize: 15 }}>
                {affordable ? t('st_buy_for').replace('{price}', p.price) : t('st_not_enough')}
              </Text>
            </>
          )}
        </Pressable>
      )}
    </View>
  );

  return (
    <Popup visible={!!pack} onClose={onClose} maxWidth={420} maxHeight={Math.round(screenH * 0.8)} footer={footerNode}>
      {loading && !detail ? (
        <View style={{ marginVertical: 30, alignItems: 'center' }}><CatLoader size={90} /></View>
      ) : (
        <View>
          <View style={{ height: 84, borderRadius: 14, backgroundColor: COVER_BG, alignItems: 'center', justifyContent: 'center', marginBottom: 14, overflow: 'hidden' }}>
            <Text style={{ fontSize: 40, fontWeight: '700', color: COVER_FG }}>{glyphOf(p.cover_key)}</Text>
            {isPremiumPack(p) ? (
              <View style={{ position: 'absolute', top: 8, left: 8, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#f5b301', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 }}>
                <Ionicons name="star" size={11} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{t('st_premium_tag')}</Text>
              </View>
            ) : null}
            {!owned ? <OwnedProgress owned={p.owned_words} total={p.word_count} /> : null}
          </View>
          <Text style={{ fontSize: 19, fontWeight: '800', color: '#1a1a2e' }}>{p.title}</Text>
          <Text style={{ fontSize: 13, color: COLORS.muted, marginTop: 2 }}>
            {t('st_by')} {p.creator || '—'} · {p.word_count || 0} {t('st_words')} · {p.sales_count || 0} {t('st_bought')}
          </Text>
          {p.description ? (
            <Text style={{ fontSize: 13.5, color: '#444', marginTop: 10, lineHeight: 19 }}>{p.description}</Text>
          ) : null}

          {words?.length ? (
            <View style={{ marginTop: 14, backgroundColor: '#f8f9fa', borderRadius: 12, padding: 10 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.mutedLight, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{t('st_words_head')} · {words.length}</Text>
              {words.map((w, i) => <WordRow key={w.id} w={w} last={i === words.length - 1} />)}
            </View>
          ) : preview?.length ? (
            <View style={{ marginTop: 14, backgroundColor: '#f8f9fa', borderRadius: 12, padding: 10 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.mutedLight, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{t('st_preview')}</Text>
              {preview.map((w, i) => <WordRow key={w.id} w={w} last={i === preview.length - 1} />)}
            </View>
          ) : null}

        </View>
      )}
    </Popup>
  );
}
