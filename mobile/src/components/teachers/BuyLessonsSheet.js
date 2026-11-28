import { useState, useEffect } from 'react';
import { View, Text, Pressable, Linking, Platform } from 'react-native';
import BottomSheet from '../../ui/BottomSheet';
import { Button } from '../../ui';
import { COLORS } from '../../theme';
import { buyLessonPackage } from '../../api';

// Rail B = mono-devise EUR.
function eur(n) { const v = Number(n); return Number.isInteger(v) ? `${v}€` : `${v.toFixed(2)}€`; }
// Origine de retour Stripe (allowlistée côté serveur). Web dev → localhost:8081.
function returnOrigin() {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return 'https://app.jiayou.fr';
}

// Sheet d'achat de crédits de cours : presets 1/5/10, prix = N × prix/heure (EUR).
// `info` = payload de getTeacherCredits : { paidEnabled, unitPrice, balance, packSizes }.
export default function BuyLessonsSheet({ teacherId, teacherName, info, visible, onClose, onBought }) {
  const packs = info?.packSizes || [1, 5, 10];
  const unit = info?.unitPrice;
  const [sel, setSel] = useState(packs[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (visible) { setSel(packs[0]); setErr(''); } }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = unit != null ? unit * sel : null;
  async function go() {
    setBusy(true); setErr('');
    try {
      const { url } = await buyLessonPackage(teacherId, sel, returnOrigin());
      await Linking.openURL(url);
      onBought?.(); onClose?.();
    } catch (e) { setErr(e.message || 'Could not start checkout'); }
    finally { setBusy(false); }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeightRatio={0.62}>
      <Text style={{ fontSize: 18, fontWeight: '800', color: '#1a1a2e', textAlign: 'center' }}>Buy lessons</Text>
      <Text style={{ fontSize: 13, color: '#7a8aa8', textAlign: 'center', marginTop: 4, marginBottom: 16 }}>
        1-hour lessons with {teacherName || 'this teacher'}{unit != null ? ` · ${eur(unit)}/h` : ''}
      </Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {packs.map((n) => {
          const on = sel === n;
          return (
            <Pressable key={n} onPress={() => setSel(n)} style={{ flex: 1, alignItems: 'center', paddingVertical: 16, borderRadius: 14, borderWidth: 2, borderColor: on ? COLORS.jiayou : '#e3e8ef', backgroundColor: on ? COLORS.jiayouSoft : '#fff' }}>
              <Text style={{ fontSize: 22, fontWeight: '800', color: on ? COLORS.jiayou : '#1a1a2e' }}>{n}</Text>
              <Text style={{ fontSize: 11, color: on ? COLORS.jiayou : COLORS.mutedLight, fontWeight: '700', textTransform: 'uppercase', marginTop: 2 }}>lesson{n > 1 ? 's' : ''}</Text>
              {unit != null ? <Text style={{ fontSize: 12.5, color: '#1a1a2e', fontWeight: '700', marginTop: 6 }}>{eur(unit * n)}</Text> : null}
            </Pressable>
          );
        })}
      </View>
      {err ? <Text style={{ color: COLORS.danger, fontSize: 13, fontWeight: '600', marginTop: 12, textAlign: 'center' }}>{err}</Text> : null}
      <Button onPress={go} loading={busy} icon="card" title={total != null ? `Pay ${eur(total)}` : 'Continue to payment'} fullWidth style={{ marginTop: 18 }} />
      <Text style={{ fontSize: 11, color: COLORS.mutedLight, textAlign: 'center', marginTop: 10 }}>
        Credits valid 30 days. You pay now; your teacher is paid after each completed lesson.
      </Text>
    </BottomSheet>
  );
}
