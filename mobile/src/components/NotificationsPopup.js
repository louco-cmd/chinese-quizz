import { View, Text, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Popup from './Popup';
import { COLORS } from '../theme';

const ICONS = {
  duel_new: { icon: 'game-controller', color: '#0d6efd', bg: '#e8f0ff' },
  duel_result: { icon: 'trophy', color: '#b8860b', bg: '#fff3cd' },
  red_envelope: { icon: 'gift', color: '#d4373e', bg: '#fdecef' },
  pack_sold: { icon: 'pricetag', color: '#198754', bg: '#e8f5e9' },
};
const DEFAULT = { icon: 'notifications', color: COLORS.muted, bg: '#eceef1' };

function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

export default function NotificationsPopup({ visible, notifications = [], onClose }) {
  return (
    <Popup visible={visible} onClose={onClose} maxWidth={420}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="notifications" size={20} color={COLORS.jiayou} />
          <Text style={{ fontSize: 18, fontWeight: '800', color: '#1a1a2e' }}>Notifications</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={COLORS.muted} /></Pressable>
      </View>

      {notifications.length ? (
        <ScrollView style={{ maxHeight: 380 }}>
          {notifications.map((n) => {
            const c = ICONS[n.type] || DEFAULT;
            return (
              <View key={n.id} style={{ flexDirection: 'row', gap: 12, paddingVertical: 11, borderBottomWidth: 1, borderColor: '#f2f2f4' }}>
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={c.icon} size={19} color={c.color} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#1a1a2e' }}>{n.title}</Text>
                  {n.body ? <Text style={{ fontSize: 13, color: COLORS.muted, marginTop: 1 }}>{n.body}</Text> : null}
                  <Text style={{ fontSize: 11, color: COLORS.mutedLight, marginTop: 3 }}>{timeAgo(n.created_at)}</Text>
                </View>
                {!n.read ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.jiayou, marginTop: 6 }} /> : null}
              </View>
            );
          })}
        </ScrollView>
      ) : (
        <View style={{ alignItems: 'center', paddingVertical: 30 }}>
          <Ionicons name="notifications-off-outline" size={34} color={COLORS.mutedLight} />
          <Text style={{ color: COLORS.muted, marginTop: 10 }}>No notifications yet.</Text>
        </View>
      )}
    </Popup>
  );
}
