import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Keyboard, Platform, AppState, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Avatar from '../ui/Avatar';
import CatLoader from '../components/CatLoader';
import { ErrorRetry } from '../components/ErrorRetry';
import useAndroidBack from '../useAndroidBack';
import { getConversations, openConversation, getMessages, sendMessage } from '../api';
import { COLORS, SHADOW_CARD } from '../theme';

const POLL_MS = 5000; // rafraîchit le thread OUVERT seulement (0 compute au repos)

function timeShort(iso) {
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}
function dayShort(iso) {
  try {
    const d = new Date(iso), now = new Date();
    if (d.toDateString() === now.toDateString()) return timeShort(iso);
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  } catch { return ''; }
}

// ── Liste des conversations + contacts autorisés ────────────────────────────
function ConversationList({ onOpen, onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setData(await getConversations()); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error && !data) return <ErrorRetry error={error} onRetry={load} />;
  if (!data) return <View className="flex-1 items-center justify-center"><CatLoader size={100} /></View>;

  const { conversations = [], contacts = [] } = data;
  const empty = conversations.length === 0 && contacts.length === 0;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
      <View style={{ width: '100%', maxWidth: 720, alignSelf: 'center' }}>
        <Pressable onPress={onBack} hitSlop={10} className="flex-row items-center gap-1 mb-3">
          <Ionicons name="chevron-back" size={20} color={COLORS.muted} /><Text className="text-muted text-[14px]">Back</Text>
        </Pressable>
        <Text className="text-ink font-extrabold text-[22px] mb-4">Messages</Text>

        {empty ? (
          <View className="items-center py-16">
            <Ionicons name="chatbubbles-outline" size={34} color="#c4c9d0" />
            <Text className="text-muted mt-2 text-[13.5px] text-center">No one to message yet.{'\n'}Book a trial or join a class first.</Text>
          </View>
        ) : null}

        {conversations.map((c) => (
          <Pressable key={`c${c.id}`} onPress={() => onOpen({ id: c.id, peer: { id: c.peer_id, name: c.peer_name, avatar_icon: c.peer_avatar, avatar_color: c.peer_color } })}
            className="bg-white rounded-2xl px-4 py-3 mb-2.5 flex-row items-center gap-3 active:opacity-90" style={SHADOW_CARD}>
            <Avatar icon={c.peer_avatar} color={c.peer_color} name={c.peer_name} size={44} />
            <View className="flex-1 min-w-0">
              <View className="flex-row items-center justify-between">
                <Text className="text-ink font-extrabold text-[15px] shrink" numberOfLines={1}>{c.peer_name || 'User'}</Text>
                <Text className="text-muted-light text-[11px] ml-2">{c.last_message_at ? dayShort(c.last_message_at) : ''}</Text>
              </View>
              <Text className={`text-[12.5px] mt-0.5 ${c.unread ? 'text-ink font-semibold' : 'text-muted-light'}`} numberOfLines={1}>{c.last_body || ''}</Text>
            </View>
            {c.unread ? <View className="rounded-full min-w-[20px] h-5 px-1.5 items-center justify-center" style={{ backgroundColor: COLORS.jiayou }}><Text className="text-white font-bold text-[11px]">{c.unread}</Text></View> : null}
          </Pressable>
        ))}

        {contacts.length ? (
          <>
            <Text className="text-muted-light font-bold text-[11.5px] uppercase mt-4 mb-2" style={{ letterSpacing: 0.5 }}>Start a conversation</Text>
            {contacts.map((p) => (
              <Pressable key={`p${p.id}`} onPress={() => onOpen({ id: null, peer: { id: p.id, name: p.name, avatar_icon: p.avatar_icon, avatar_color: p.avatar_color } })}
                className="bg-white rounded-2xl px-4 py-3 mb-2.5 flex-row items-center gap-3 active:opacity-90" style={SHADOW_CARD}>
                <Avatar icon={p.avatar_icon} color={p.avatar_color} name={p.name} size={44} />
                <Text className="text-ink font-bold text-[15px] flex-1" numberOfLines={1}>{p.name || 'User'}</Text>
                <Ionicons name="create-outline" size={18} color={COLORS.jiayou} />
              </Pressable>
            ))}
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}

// ── Fil de discussion (thread) : messages + saisie, polling pendant qu'il est ouvert
function Thread({ conv, onBack }) {
  const insets = useSafeAreaInsets();
  const [convId, setConvId] = useState(conv.id);
  const [peer, setPeer] = useState(conv.peer || null); // peut être null si ouvert via notif (id seul)
  const [messages, setMessages] = useState([]);
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [lift, setLift] = useState(0); // px pour soulever l'input au-dessus du clavier
  const scrollRef = useRef(null);
  const rootRef = useRef(null);
  const lastIdRef = useRef(0);

  const scrollToEnd = () => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);

  // Fait flotter l'input pile au-dessus du clavier, sans supposer le mode clavier
  // ni la présence d'une TabBar sous le thread.
  //  • Natif : on soulève du chevauchement = (bas du thread) − (haut du clavier,
  //    screenY). Le bas du root est stable (le padding est interne).
  //  • Web/PWA : pas d'events Keyboard → on mesure via visualViewport la zone du
  //    bas couverte par le clavier logiciel.
  useEffect(() => {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined' || !window.visualViewport) return undefined;
      const vv = window.visualViewport;
      const onResize = () => {
        const covered = Math.max(0, (window.innerHeight || 0) - vv.height - vv.offsetTop);
        setLift(covered);
        scrollToEnd();
      };
      vv.addEventListener('resize', onResize);
      vv.addEventListener('scroll', onResize);
      onResize();
      return () => { vv.removeEventListener('resize', onResize); vv.removeEventListener('scroll', onResize); };
    }
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e) => {
      const kbTop = e?.endCoordinates?.screenY;
      const node = rootRef.current;
      if (!node || kbTop == null) { scrollToEnd(); return; }
      requestAnimationFrame(() => {
        node.measureInWindow((x, y, w, h) => {
          const over = (y + h) - kbTop; // combien le clavier recouvre le thread
          setLift(over > 0 ? over + 8 : 0); // +8 px de marge pour ne pas coller au clavier
          scrollToEnd();
        });
      });
    };
    const onHide = () => setLift(0);
    const s1 = Keyboard.addListener(showEvt, onShow);
    const s2 = Keyboard.addListener(hideEvt, onHide);
    return () => { s1.remove(); s2.remove(); };
  }, []);

  // Première charge : ouvre la conversation si besoin, puis récupère les messages.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let id = conv.id;
        if (!id) { const r = await openConversation(conv.peer.id); id = r.id; }
        if (!alive) return;
        setConvId(id);
        const r = await getMessages(id, 0);
        if (!alive) return;
        setMe(r.me);
        if (r.peer) setPeer(r.peer); // peer renvoyé par le thread (cas « ouvert par id seul »)
        setMessages(r.messages || []);
        lastIdRef.current = (r.messages || []).reduce((mx, m) => Math.max(mx, m.id), 0);
        scrollToEnd();
      } catch (e) { if (alive) setError(e.message); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [conv.id, conv.peer?.id]);

  // Polling des nouveaux messages (après lastId) pendant que le thread est ouvert
  // et l'app active. Aucune requête au repos / app en arrière-plan.
  useEffect(() => {
    if (!convId) return undefined;
    let timer = null;
    const tick = async () => {
      try {
        const r = await getMessages(convId, lastIdRef.current);
        const fresh = r.messages || [];
        if (fresh.length) {
          lastIdRef.current = fresh.reduce((mx, m) => Math.max(mx, m.id), lastIdRef.current);
          setMessages((cur) => {
            const seen = new Set(cur.map((m) => m.id));
            const add = fresh.filter((m) => !seen.has(m.id));
            return add.length ? [...cur, ...add] : cur;
          });
          scrollToEnd();
        }
      } catch { /* silencieux : on retentera au prochain tick */ }
    };
    const start = () => { if (!timer) timer = setInterval(tick, POLL_MS); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    start();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') { tick(); start(); } else stop(); });
    return () => { stop(); sub.remove(); };
  }, [convId]);

  async function send() {
    const body = text.trim();
    if (!body || sending || !convId) return;
    setSending(true);
    setText('');
    // Message optimiste (id temporaire négatif).
    const tmp = { id: -Date.now(), sender_id: me, body, created_at: new Date().toISOString(), _pending: true };
    setMessages((cur) => [...cur, tmp]);
    scrollToEnd();
    try {
      const r = await sendMessage(convId, body);
      const real = r.message;
      lastIdRef.current = Math.max(lastIdRef.current, real.id);
      setMessages((cur) => cur.map((m) => (m.id === tmp.id ? real : m)));
    } catch (e) {
      setMessages((cur) => cur.filter((m) => m.id !== tmp.id));
      setText(body); // on rend le texte pour réessayer
      setError(e.message);
      setTimeout(() => setError(''), 2500);
    } finally { setSending(false); }
  }

  return (
    // paddingBottom = chevauchement mesuré du clavier (voir effet plus haut) → l'input
    // flotte pile au-dessus du clavier, quelles que soient la TabBar et les insets.
    <View ref={rootRef} style={{ flex: 1, minHeight: 0, paddingBottom: lift }}>
      {/* En-tête du fil */}
      <View className="flex-row items-center gap-3 px-4 py-2.5 bg-white border-b border-line-soft" style={{ flexShrink: 0 }}>
        <Pressable onPress={onBack} hitSlop={10}><Ionicons name="chevron-back" size={22} color={COLORS.ink} /></Pressable>
        <Avatar icon={peer?.avatar_icon} color={peer?.avatar_color} name={peer?.name} size={34} />
        <Text className="text-ink font-extrabold text-[16px] flex-1" numberOfLines={1}>{peer?.name || 'User'}</Text>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center"><CatLoader size={90} /></View>
      ) : (
        <ScrollView ref={scrollRef} className="flex-1 bg-surface-page" style={{ minHeight: 0 }} contentContainerStyle={{ padding: 14, paddingBottom: 18 }} onContentSizeChange={scrollToEnd}>
          {messages.length === 0 ? (
            <Text className="text-muted-light text-[12.5px] text-center mt-10">Say hello 👋</Text>
          ) : messages.map((m) => {
            const mine = m.sender_id === me;
            return (
              <View key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', marginBottom: 8 }}>
                <View style={{ backgroundColor: mine ? COLORS.jiayou : '#fff', borderRadius: 16, borderBottomRightRadius: mine ? 4 : 16, borderBottomLeftRadius: mine ? 16 : 4, paddingHorizontal: 12, paddingVertical: 8, opacity: m._pending ? 0.6 : 1, ...SHADOW_CARD }}>
                  <Text style={{ color: mine ? '#fff' : COLORS.ink, fontSize: 14.5, lineHeight: 20 }}>{m.body}</Text>
                </View>
                <Text style={{ fontSize: 10, color: COLORS.mutedLight, marginTop: 2, alignSelf: mine ? 'flex-end' : 'flex-start' }}>{timeShort(m.created_at)}</Text>
              </View>
            );
          })}
        </ScrollView>
      )}

      {error ? <Text className="text-danger text-[12px] text-center py-1">{error}</Text> : null}

      {/* Barre de saisie */}
      <View className="flex-row items-end gap-2 px-3 pt-2 bg-white border-t border-line-soft" style={{ flexShrink: 0, paddingBottom: lift > 0 ? 6 : Math.max(insets.bottom, 8) }}>
        <TextInput
          value={text} onChangeText={setText} placeholder="Message…" placeholderTextColor={COLORS.mutedLight}
          multiline maxLength={2000}
          className="flex-1 bg-surface-page rounded-2xl px-3.5 py-2.5 text-[15px] text-ink"
          style={{ maxHeight: 120 }}
        />
        <Pressable onPress={send} disabled={sending || !text.trim()} className="rounded-full items-center justify-center" style={{ width: 42, height: 42, backgroundColor: text.trim() ? COLORS.jiayou : '#c4c9d0' }}>
          {sending ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="send" size={18} color="#fff" />}
        </Pressable>
      </View>
    </View>
  );
}

export default function MessagesScreen({ onBack, initialConvId = null, onInitialConsumed }) {
  const [open, setOpen] = useState(initialConvId ? { id: initialConvId, peer: null } : null); // { id, peer } | null

  // Ouverture directe d'un fil depuis une notif « message » (id seul, peer chargé
  // ensuite par le thread). Consommé une fois pour ne pas rouvrir au retour.
  useEffect(() => {
    if (initialConvId) { setOpen({ id: initialConvId, peer: null }); onInitialConsumed?.(); }
  }, [initialConvId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Retour matériel Android : fil ouvert → revient à la liste ; liste → parent
  // (jamais quitter l'app). Monté après le handler global → passe avant lui.
  useAndroidBack(() => {
    if (open) { setOpen(null); return true; }
    onBack?.(); return true;
  }, true, [open]);

  if (open) return <Thread conv={open} onBack={() => setOpen(null)} />;
  return (
    <View className="flex-1 bg-surface-page">
      <ConversationList onOpen={setOpen} onBack={onBack} />
    </View>
  );
}
