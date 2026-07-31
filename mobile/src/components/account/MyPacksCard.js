import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, ActivityIndicator, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AccountCard from './AccountCard';
import Popup from '../Popup';
import { getMyPacks, updatePack, deletePack } from '../../api';
import { useT } from '../../i18n';
import { COLORS } from '../../theme';

const inputStyle = {
  backgroundColor: '#fff', borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.line,
  paddingHorizontal: 14, paddingVertical: 10, fontSize: 15,
};

export default function MyPacksCard({ onNavigate }) {
  const { t: tr } = useT();
  const [packs, setPacks] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ title: '', description: '', price: '' });
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { const d = await getMyPacks(); setPacks(d.packs || []); } catch { setPacks([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function openEdit(p) {
    setForm({ title: p.title, description: p.description || '', price: String(p.price) });
    setError(''); setConfirmDel(false); setEditing(p);
  }

  async function save() {
    setBusy(true); setError('');
    try {
      await updatePack(editing.id, { title: form.title.trim(), description: form.description.trim(), price: parseInt(form.price, 10) });
      await load(); setEditing(null);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError('');
    try { await deletePack(editing.id); await load(); setEditing(null); }
    catch (e) { setError(e.message); setBusy(false); }
  }

  // Pas de packs → on n'affiche pas la section (création depuis le JiaStore).
  if (packs !== null && packs.length === 0) return null;

  return (
    <AccountCard icon="pricetags-outline" title={tr('ac_my_packs')} actionLabel={tr('ac_create_pack')} onPress={() => onNavigate?.('create-pack')}>
      {packs === null ? (
        <ActivityIndicator color={COLORS.jiayou} style={{ marginVertical: 12 }} />
      ) : (
        packs.map((p, i) => (
          <Pressable
            key={p.id}
            onPress={() => openEdit(p)}
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: i === packs.length - 1 ? 0 : 1, borderColor: '#f2f2f4' }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#1a1a2e' }} numberOfLines={1}>{p.title}</Text>
              <Text style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>
                {p.word_count} {tr('st_words')} · {p.sales_count || 0} {tr('mp_sold')} · {p.price} ₵
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.mutedLight} />
          </Pressable>
        ))
      )}

      {/* ── Popup éditer / supprimer ── */}
      <Popup visible={!!editing} onClose={() => { if (!busy) setEditing(null); }} maxWidth={440}>
        {confirmDel ? (
          <View>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 }}>{tr('mp_delete_title')}</Text>
            <Text style={{ fontSize: 14, color: COLORS.muted, marginBottom: 20, lineHeight: 20 }}>
              {tr('mp_delete_body').replace('{title}', editing?.title || '')}
            </Text>
            {error ? <Text style={{ color: COLORS.danger, fontSize: 13, marginBottom: 12, fontWeight: '600' }}>{error}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Pressable onPress={() => setConfirmDel(false)} style={{ flex: 1, backgroundColor: '#f1f3f5', borderRadius: 999, paddingVertical: 13, alignItems: 'center' }}>
                <Text style={{ color: COLORS.muted, fontWeight: '700' }}>{tr('common_cancel')}</Text>
              </Pressable>
              <Pressable onPress={remove} disabled={busy} style={{ flex: 1, backgroundColor: COLORS.danger, borderRadius: 999, paddingVertical: 13, alignItems: 'center' }}>
                {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>{tr('common_delete')}</Text>}
              </Pressable>
            </View>
          </View>
        ) : (
          <View>
            <Text style={{ fontSize: 18, fontWeight: '800', color: '#1a1a2e', marginBottom: 16 }}>{tr('st_edit_pack')}</Text>
            <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.muted, marginBottom: 4 }}>{tr('mp_title')}</Text>
            <TextInput value={form.title} onChangeText={(t) => setForm((f) => ({ ...f, title: t }))} maxLength={80} style={{ ...inputStyle, marginBottom: 12 }} />
            <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.muted, marginBottom: 4 }}>{tr('mp_description')}</Text>
            <TextInput value={form.description} onChangeText={(t) => setForm((f) => ({ ...f, description: t }))} maxLength={300} multiline style={{ ...inputStyle, minHeight: 64, textAlignVertical: 'top', marginBottom: 12 }} />
            <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.muted, marginBottom: 4 }}>{tr('mp_price')}</Text>
            <TextInput value={form.price} onChangeText={(t) => setForm((f) => ({ ...f, price: t.replace(/[^0-9]/g, '') }))} keyboardType="number-pad" style={{ ...inputStyle, width: 120, marginBottom: 8 }} />
            <Text style={{ fontSize: 12, color: COLORS.mutedLight, marginBottom: 16 }}>{tr('mp_words_note')}</Text>
            {error ? <Text style={{ color: COLORS.danger, fontSize: 13, marginBottom: 12, fontWeight: '600' }}>{error}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Pressable onPress={() => setConfirmDel(true)} style={{ paddingVertical: 13, paddingHorizontal: 14, borderRadius: 999, borderWidth: 2, borderColor: '#f3d0d0', alignItems: 'center', flexDirection: 'row', gap: 6 }}>
                <Ionicons name="trash" size={16} color={COLORS.danger} />
                <Text style={{ color: COLORS.danger, fontWeight: '700' }}>{tr('common_delete')}</Text>
              </Pressable>
              <Pressable onPress={save} disabled={busy || !form.title.trim()} style={{ flex: 1, backgroundColor: form.title.trim() ? COLORS.jiayou : '#e9ecef', borderRadius: 999, paddingVertical: 13, alignItems: 'center' }}>
                {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: form.title.trim() ? '#fff' : COLORS.muted, fontWeight: '700' }}>{tr('common_save')}</Text>}
              </Pressable>
            </View>
          </View>
        )}
      </Popup>
    </AccountCard>
  );
}
