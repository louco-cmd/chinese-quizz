import { useState } from 'react';
import { View, Text, ScrollView, Pressable, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SHADOW_CARD } from '../theme';

// FAQ reprise de la page support de l'app (views/support.ejs).
const SECTIONS = [
  {
    label: 'Getting started',
    items: [
      { q: 'What is Jiayou?', a: 'Jiayou (加油！) is a Chinese vocabulary learning app. You build your own word collection, practice with quizzes (pinyin or characters), challenge friends to real-time duels, and track your progress through the HSK levels.' },
      { q: 'How do I add words to my collection?', a: "From the Add Word page, type a Chinese character or a word in the search box. If the word exists in our database it will appear — confirm to add it. Each word costs 3 coins. You can also add custom words if the word isn't found." },
      { q: 'How do I earn coins?', a: 'You earn coins by completing quizzes. The better your score, the more coins you receive (up to 5 coins per quiz). You can also win coins by winning duels with a bet.' },
    ],
  },
  {
    label: 'Subscription',
    items: [
      { q: "What's the difference between Free and Premium?", a: "The Free plan lets you add words, take quizzes, and play duels with daily limits. Premium removes all limits, unlocks all HSK word packs, and gives you priority features as they're released." },
      { q: 'How do I subscribe to Premium?', a: 'Tap the FREE badge in the header, or go to Settings → Go Premium. You’ll be taken to jiayou.fr to complete the payment securely via Stripe.' },
      { q: 'How do I cancel or manage my subscription?', a: 'Go to Settings → Manage subscription. You’ll be redirected to the Stripe billing portal where you can cancel, update your payment method, or download invoices. Your Premium access remains active until the end of the current billing period.' },
      { q: "I paid but I'm still on the Free plan.", a: 'Please wait up to 60 seconds — the confirmation page polls automatically. If your plan still shows Free after a few minutes, try logging out and back in. If the issue persists, contact us at info@jiayou.fr with your email address.' },
    ],
  },
  {
    label: 'Duels',
    items: [
      { q: 'How do duels work?', a: 'Challenge another player by searching their username. Both players answer the same set of words independently. The player with the highest score wins. You can optionally bet coins — the winner takes both bets.' },
      { q: 'Will I be notified when I receive a duel?', a: "Yes — enable Duel notifications in Settings. You'll receive a push notification when someone challenges you and when a duel result is available." },
    ],
  },
  {
    label: 'Account & privacy',
    items: [
      { q: 'How do I delete my account?', a: 'Go to Settings → Delete account. This permanently removes all your data including your word collection, quiz history, and coins. This action cannot be undone.' },
      { q: 'What data do you collect?', a: "We collect only what's necessary to run the service: your email address, name (from Google login or registration), and your in-app activity (words, quiz scores, duels). We never sell your data. Full details are in our Privacy Policy." },
    ],
  },
];

function FaqItem({ q, a, last }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ borderBottomWidth: last ? 0 : 1, borderColor: '#f0f0f0' }}>
      <Pressable onPress={() => setOpen((o) => !o)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 }}>
        <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: '#1d1d1f', paddingRight: 10 }}>{q}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.muted} />
      </Pressable>
      {open ? <Text style={{ fontSize: 13.5, color: '#6c757d', lineHeight: 20, paddingBottom: 14 }}>{a}</Text> : null}
    </View>
  );
}

export default function SupportScreen({ onBack }) {
  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
        {/* Hero */}
        <View style={{ backgroundColor: COLORS.jiayou, paddingTop: 16, paddingBottom: 40, paddingHorizontal: 16 }}>
          {onBack ? (
            <Pressable onPress={onBack} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 10 }}>
              <Ionicons name="chevron-back" size={20} color="rgba(255,255,255,0.9)" />
              <Text style={{ color: 'rgba(255,255,255,0.9)', fontWeight: '600' }}>Back</Text>
            </Pressable>
          ) : null}
          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 34 }}>❓</Text>
            <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 4 }}>Help & FAQ</Text>
          </View>
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 24, backgroundColor: '#f8f9fa', borderTopLeftRadius: 24, borderTopRightRadius: 24 }} />
        </View>

        <View style={{ width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 16, marginTop: 16 }}>
          {SECTIONS.map((s) => (
            <View key={s.label} style={{ marginBottom: 20 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>{s.label}</Text>
              <View style={{ backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 16, ...SHADOW_CARD }}>
                {s.items.map((it, i) => <FaqItem key={i} q={it.q} a={it.a} last={i === s.items.length - 1} />)}
              </View>
            </View>
          ))}

          {/* Contact */}
          <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 22, alignItems: 'center', ...SHADOW_CARD }}>
            <Text style={{ fontSize: 30 }}>✉️</Text>
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#1a1a2e', marginTop: 8 }}>Still need help?</Text>
            <Text style={{ fontSize: 13, color: COLORS.muted, textAlign: 'center', marginTop: 6, marginBottom: 16 }}>
              Can't find what you're looking for? Send us a message and we'll get back to you.
            </Text>
            <Pressable onPress={() => Linking.openURL('mailto:info@jiayou.fr')} style={{ backgroundColor: COLORS.jiayou, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="mail" size={16} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '700' }}>Contact support</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
