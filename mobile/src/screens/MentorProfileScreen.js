import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, Linking, useWindowDimensions, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import CatLoader from '../components/CatLoader';
import { ErrorRetry } from '../components/ErrorRetry';
import { getMentor } from '../api';
import { COLORS, SHADOW_CARD, TAB_CLEARANCE } from '../theme';

const CURRENCY = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF', CNY: '¥', JPY: '¥', CAD: 'C$', AUD: 'A$', SGD: 'S$', HKD: 'HK$' };
function money(p, c) {
  if (p == null) return null;
  const sym = CURRENCY[c] || c || '€';
  const amount = Number.isInteger(Number(p)) ? String(p) : Number(p).toFixed(2);
  return sym.length > 1 ? `${sym} ${amount}` : `${sym}${amount}`;
}
function initials(name) {
  return (name || 'T').trim().split(/\s+/).slice(0, 2).map((s) => s[0] || '').join('').toUpperCase() || 'T';
}

// URL d'embed pour YouTube / Bilibili / Vimeo (sinon null → fallback bouton).
function toEmbedUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host.includes('youtu.be')) { const id = u.pathname.slice(1); return id ? `https://www.youtube.com/embed/${id}` : null; }
    if (host.includes('youtube.com')) {
      const v = u.searchParams.get('v'); if (v) return `https://www.youtube.com/embed/${v}`;
      const sh = u.pathname.match(/\/shorts\/([^/?]+)/); if (sh) return `https://www.youtube.com/embed/${sh[1]}`;
      if (u.pathname.startsWith('/embed/')) return url;
      return null;
    }
    if (host.includes('bilibili.com')) { const m = u.pathname.match(/\/video\/(BV[\w]+)/i); return m ? `https://player.bilibili.com/player.html?bvid=${m[1]}&autoplay=0` : null; }
    if (host.includes('vimeo.com')) { const m = u.pathname.match(/\/(\d+)/); return m ? `https://player.vimeo.com/video/${m[1]}` : null; }
    return null;
  } catch { return null; }
}

// Player : iframe sur le web ; sinon bouton d'ouverture (natif ou hôte non embeddable).
function VideoEmbed({ url }) {
  const embed = toEmbedUrl(url);
  if (Platform.OS === 'web' && embed) {
    return React.createElement('iframe', {
      src: embed, allowFullScreen: true, title: 'Presentation', loading: 'lazy',
      style: { width: '100%', aspectRatio: '16 / 9', minHeight: 200, border: 'none', borderRadius: 12, display: 'block' },
    });
  }
  return (
    <Pressable onPress={() => Linking.openURL(url)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#1a1a2e', borderRadius: 12, paddingVertical: 15 }}>
      <Ionicons name="play-circle" size={20} color="#fff" />
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>Watch presentation video</Text>
    </Pressable>
  );
}
function StatTile({ icon, value, label, accent }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', backgroundColor: '#f6f8fb', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 4 }}>
      <Ionicons name={icon} size={18} color={accent || COLORS.jiayou} />
      <Text style={{ fontSize: 19, fontWeight: '800', color: '#1a1a2e', marginTop: 4 }}>{value}</Text>
      <Text style={{ fontSize: 10, color: COLORS.mutedLight, textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 1, textAlign: 'center' }}>{label}</Text>
    </View>
  );
}

export default function MentorProfileScreen({ id, initial, onBack }) {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const [m, setM] = useState(initial || null);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { const r = await getMentor(id); setM(r.mentor); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const Back = (
    <Pressable onPress={onBack} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 14 }}>
      <Ionicons name="chevron-back" size={20} color={COLORS.jiayou} />
      <Text style={{ color: COLORS.jiayou, fontWeight: '600' }}>Teachers</Text>
    </Pressable>
  );

  if (loading && !m) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8f9fa' }}><CatLoader size={110} /></View>;
  if (error && !m) return <View style={{ flex: 1, backgroundColor: '#f8f9fa', padding: 16 }}>{Back}<ErrorRetry error={error} onRetry={load} /></View>;

  const teaches = (m.teaching_languages || []).join(', ');
  const links = m.links || (m.link ? [m.link] : []);

  // ── Colonne gauche : identité + stats + CTA ─────────────────────────────────
  const left = (
    <View style={{ backgroundColor: '#fff', borderRadius: 18, padding: 20, ...SHADOW_CARD }}>
      <View style={{ alignItems: 'center' }}>
        <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: '#e3f0ff', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: COLORS.jiayou, fontWeight: '800', fontSize: 24 }}>{initials(m.name)}</Text>
        </View>
        <Text style={{ fontSize: 20, fontWeight: '800', color: '#1a1a2e', marginTop: 12, textAlign: 'center' }}>{m.name || 'Teacher'}</Text>
        {teaches ? (
          <Text style={{ fontSize: 13, color: '#7a8aa8', marginTop: 3, textAlign: 'center' }}>
            <Ionicons name="language" size={12} color="#7a8aa8" />  Teaches {teaches}
          </Text>
        ) : null}
        {m.session_price != null ? (
          <View style={{ backgroundColor: '#e8f0ff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, marginTop: 10 }}>
            <Text style={{ color: COLORS.jiayou, fontSize: 13, fontWeight: '800' }}>{money(m.session_price, m.session_currency)} / session</Text>
          </View>
        ) : null}
      </View>

      {/* Stats */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 18 }}>
        <StatTile icon="people" value={m.student_count ?? 0} label="Students" />
        <StatTile icon="school" value={m.courses_given ?? 0} label="Courses given" />
        <StatTile icon="star" accent="#f5b301" value={m.rating != null ? m.rating : '—'} label={m.rating_count ? `Rating (${m.rating_count})` : 'Rating'} />
      </View>

      {/* Book a trial class (inactif pour l'instant) */}
      <Pressable disabled style={{ backgroundColor: COLORS.jiayou, borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 18, opacity: 0.5 }}>
        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>Book a trial class</Text>
      </Pressable>
      <Text style={{ fontSize: 11.5, color: COLORS.mutedLight, textAlign: 'center', marginTop: 6 }}>Coming soon</Text>
    </View>
  );

  // ── Colonne droite : description + détails ──────────────────────────────────
  const right = (
    <View style={{ backgroundColor: '#fff', borderRadius: 18, padding: 20, ...SHADOW_CARD }}>
      {m.presentation_video ? (
        <View style={{ marginBottom: 18 }}>
          <Text style={{ fontSize: 16, fontWeight: '800', color: '#1a1a2e', marginBottom: 8 }}>Presentation</Text>
          <VideoEmbed url={m.presentation_video} />
        </View>
      ) : null}
      <Text style={{ fontSize: 16, fontWeight: '800', color: '#1a1a2e', marginBottom: 8 }}>About</Text>
      <Text style={{ fontSize: 14.5, color: '#495267', lineHeight: 21 }}>{m.mentor_bio || 'This teacher hasn’t written a description yet.'}</Text>

      {m.languages_spoken ? (
        <View style={{ marginTop: 18 }}>
          <Text style={{ fontSize: 13, fontWeight: '800', color: '#1a1a2e', marginBottom: 4 }}>Languages spoken</Text>
          <Text style={{ fontSize: 14, color: '#495267' }}>{m.languages_spoken}</Text>
        </View>
      ) : null}
      {m.years_experience != null ? (
        <View style={{ marginTop: 16 }}>
          <Text style={{ fontSize: 13, fontWeight: '800', color: '#1a1a2e', marginBottom: 4 }}>Experience</Text>
          <Text style={{ fontSize: 14, color: '#495267' }}>{m.years_experience} year{m.years_experience === 1 ? '' : 's'}</Text>
        </View>
      ) : null}
      {links.length ? (
        <View style={{ marginTop: 16 }}>
          <Text style={{ fontSize: 13, fontWeight: '800', color: '#1a1a2e', marginBottom: 6 }}>Where to find me</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {links.filter((l) => l && l.url).map((l, i) => (
              <Pressable key={i} onPress={() => Linking.openURL(l.url)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#f6f8fb', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 }}>
                <Text style={{ color: '#495057', fontWeight: '700', fontSize: 13 }}>{l.label || 'Link'}</Text>
                <Ionicons name="open-outline" size={13} color="#495057" />
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: TAB_CLEARANCE }}>
        <View style={{ width: '100%', maxWidth: wide ? 1000 : 640, alignSelf: 'center' }}>
          {Back}
          {wide ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 24 }}>
              <View style={[{ width: 320 }, Platform.OS === 'web' ? { position: 'sticky', top: 16 } : null]}>{left}</View>
              <View style={{ flex: 1 }}>{right}</View>
            </View>
          ) : (
            <>
              <View style={{ marginBottom: 16 }}>{left}</View>
              {right}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
