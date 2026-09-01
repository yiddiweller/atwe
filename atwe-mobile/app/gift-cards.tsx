import { useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, ActivityIndicator, RefreshControl, Alert, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { PageHeader } from '@/components/PageHeader';
import { Shelf } from '@/components/Shelf';
import { useTheme } from '@/theme/ThemeProvider';
import {
  useGiftCards, buyGiftCard, redeemGiftCard, claimGiftCard, giftCardToWallet, type GiftCard,
} from '@/api/money';
import { money } from '@/api/wallet';
import { haptics } from '@/lib/haptics';

type Shelf3 = 'mine' | 'buy' | 'redeem';

/**
 * Gift cards — a SEPARATE balance from the wallet, on purpose (Apple and Amazon
 * both work this way). A card holds its own money until you move it across.
 *
 * The three things a person actually does here are different enough to be
 * different shelves: look at what I hold, buy one, or type in a code somebody
 * gave me out of band.
 */
export default function GiftCards() {
  const { c, spacing } = useTheme();
  const [shelf, setShelf] = useState<Shelf3>('mine');
  const { data, isLoading, refetch, isRefetching } = useGiftCards();
  const cards = data?.cards ?? [];

  const owned = cards.filter((k) => k.ownedByMe && !k.depleted && k.status === 'active');
  /* A card sent to me but FROZEN would otherwise vanish silently — it is not
     claimable and not owned, so it falls through every other bucket. It gets
     its own group rather than disappearing while somebody waits for it. */
  const waiting = cards.filter((k) => k.claimable);
  const held = cards.filter((k) => k.sentToMe && !k.claimable && !k.ownedByMe && k.status === 'void');
  const sent = cards.filter((k) => k.mine && !k.ownedByMe);
  const spent = cards.filter((k) => k.depleted);

  return (
    <Screen edges={['top']}>
      <PageHeader title="Gift cards" />
      <Shelf
        value={shelf}
        onChange={setShelf}
        options={[
          { key: 'mine', label: 'Your cards' },
          { key: 'buy', label: 'Buy one' },
          { key: 'redeem', label: 'Redeem a code' },
        ]}
      />

      {shelf === 'buy' ? <BuyPane onDone={refetch} /> :
       shelf === 'redeem' ? <RedeemPane onDone={refetch} /> :
       isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.gutter, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.accent} />}
          showsVerticalScrollIndicator={false}
        >
          {cards.length === 0 && (
            <View style={styles.center}>
              <Ionicons name="gift-outline" size={44} color={c.t4} />
              <Text variant="body" tone="t3" style={{ marginTop: 12, textAlign: 'center' }}>
                No gift cards yet. Buy one for somebody, or redeem a code.
              </Text>
            </View>
          )}
          <Section title="Ready to spend" cards={owned} onDone={refetch} />
          <Section title="Sent to you" cards={waiting} onDone={refetch} />
          <Section title="On hold" cards={held} onDone={refetch} />
          <Section title="You sent" cards={sent} onDone={refetch} />
          <Section title="Used up" cards={spent} onDone={refetch} />
        </ScrollView>
      )}
    </Screen>
  );
}

function Section({ title, cards, onDone }: { title: string; cards: GiftCard[]; onDone: () => void }) {
  if (!cards.length) return null;
  return (
    <View style={{ marginBottom: 22 }}>
      <Text variant="caption" tone="t3" style={{ marginBottom: 10, letterSpacing: 0.6 }}>
        {title.toUpperCase()}
      </Text>
      {cards.map((k) => <Card key={k.id} card={k} onDone={onDone} />)}
    </View>
  );
}

function Card({ card, onDone }: { card: GiftCard; onDone: () => void }) {
  const { c, radius } = useTheme();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [showCode, setShowCode] = useState(false);

  const claim = async () => {
    setBusy(true);
    try {
      await claimGiftCard(card.id);
      haptics.success();
      onDone();
    } catch (e) { haptics.error(); Alert.alert('Gift card', (e as Error).message); }
    finally { setBusy(false); }
  };

  const toWallet = () => {
    Alert.alert(
      'Move to your balance',
      `Move ${money(card.balanceCents)} from this card into your Atwe balance?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Move it', onPress: async () => {
            setBusy(true);
            try {
              await giftCardToWallet(card.id, card.balanceCents);
              haptics.success();
              qc.invalidateQueries({ queryKey: ['wallet'] });
              onDone();
            } catch (e) { haptics.error(); Alert.alert('Gift card', (e as Error).message); }
            finally { setBusy(false); }
          },
        },
      ],
    );
  };

  return (
    <View style={[styles.card, { backgroundColor: c.s1, borderRadius: radius.card }]}>
      <View style={styles.cardTop}>
        <Ionicons name="gift" size={20} color={c.accent} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text variant="title" weight="800">{money(card.balanceCents)}</Text>
          {card.balanceCents !== card.amountCents && (
            <Text variant="micro" tone="t3">of {money(card.amountCents)}</Text>
          )}
        </View>
        {card.frozen && (
          <View style={[styles.pill, { backgroundColor: 'rgba(255,187,0,0.14)' }]}>
            <Text variant="micro" tone="warning">On hold</Text>
          </View>
        )}
        {card.companyIssued && !card.frozen && (
          <View style={[styles.pill, { backgroundColor: c.accentDim }]}>
            <Text variant="micro" tone="accent">From Atwe</Text>
          </View>
        )}
        {card.depleted && (
          <View style={[styles.pill, { backgroundColor: c.s2 }]}>
            <Text variant="micro" tone="t3">Used up</Text>
          </View>
        )}
      </View>

      {!!card.message && (
        <Text variant="callout" tone="t2" style={{ marginTop: 8 }}>“{card.message}”</Text>
      )}

      {/* The code is the card. Only show it to whoever can actually use it. */}
      {(card.ownedByMe || card.mine) && (
        <Pressable onPress={() => { haptics.tap(); setShowCode((s) => !s); }} hitSlop={6} style={{ marginTop: 10 }}>
          <Text variant="caption" tone={showCode ? 't2' : 'accent'}>
            {showCode ? card.code : 'Show the code'}
          </Text>
        </Pressable>
      )}

      {card.frozen ? (
        <Text variant="caption" tone="t3" style={{ marginTop: 10 }}>
          This card is on hold while it is looked at. Nothing has been lost.
        </Text>
      ) : card.claimable ? (
        <View style={{ marginTop: 12 }}>
          <Button title="Add to my cards" onPress={claim} loading={busy} />
        </View>
      ) : card.ownedByMe && card.balanceCents > 0 ? (
        <View style={{ marginTop: 12 }}>
          <Button title="Move to my balance" kind="secondary" onPress={toWallet} loading={busy} />
        </View>
      ) : null}
    </View>
  );
}

const PRESETS = [1000, 2500, 5000, 10000];

function BuyPane({ onDone }: { onDone: () => void }) {
  const { c, radius, spacing } = useTheme();
  const qc = useQueryClient();
  const [cents, setCents] = useState(2500);
  const [to, setTo] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [clientId, setClientId] = useState(() => `gc-${Math.random().toString(36).slice(2, 10)}`);

  const buy = async () => {
    setBusy(true);
    try {
      await buyGiftCard({
        amountCents: cents,
        to: to.trim().replace(/^@/, '') || undefined,
        message: msg.trim() || undefined,
        clientId,
      });
      haptics.success();
      qc.invalidateQueries({ queryKey: ['wallet'] });
      setTo(''); setMsg('');
      setClientId(`gc-${Math.random().toString(36).slice(2, 10)}`);
      onDone();
      Alert.alert('Done', to.trim() ? 'The card is on its way.' : 'The card is in Your cards.');
    } catch (e) { haptics.error(); Alert.alert('Gift card', (e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.gutter, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
      <Text variant="caption" tone="t3" style={styles.lbl}>HOW MUCH</Text>
      <View style={styles.amounts}>
        {PRESETS.map((p) => (
          <Pressable
            key={p}
            onPress={() => { haptics.select(); setCents(p); }}
            style={[styles.amt, { backgroundColor: cents === p ? c.primary : c.s2, borderRadius: radius.pill }]}
            accessibilityRole="radio"
            accessibilityState={{ selected: cents === p }}
            accessibilityLabel={money(p)}
          >
            <Text variant="headline" style={{ color: cents === p ? c.onPrimary : c.t2 }}>{money(p)}</Text>
          </Pressable>
        ))}
      </View>

      <Text variant="caption" tone="t3" style={styles.lbl}>WHO IS IT FOR</Text>
      <TextInput
        value={to}
        onChangeText={setTo}
        placeholder="@username — or leave empty to keep it"
        placeholderTextColor={c.t4}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Recipient username"
        style={[styles.input, { backgroundColor: c.s2, color: c.text, borderRadius: radius.md }]}
      />

      <Text variant="caption" tone="t3" style={styles.lbl}>A NOTE</Text>
      <TextInput
        value={msg}
        onChangeText={setMsg}
        placeholder="Happy birthday…"
        placeholderTextColor={c.t4}
        multiline
        accessibilityLabel="Message"
        style={[styles.input, { backgroundColor: c.s2, color: c.text, borderRadius: radius.md, minHeight: 84, textAlignVertical: 'top' }]}
      />

      <Text variant="caption" tone="t3" style={{ marginTop: 14, marginBottom: 14 }}>
        Paid from your Atwe balance. The card holds the money until it is spent or moved.
      </Text>
      <Button title={`Buy a ${money(cents)} card`} onPress={buy} loading={busy} />
    </ScrollView>
  );
}

function RedeemPane({ onDone }: { onDone: () => void }) {
  const { c, radius, spacing } = useTheme();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    try {
      const r = await redeemGiftCard(code.trim());
      haptics.success();
      setCode('');
      onDone();
      Alert.alert('Redeemed', `${money(r.card.balanceCents)} is now on your cards.`);
    } catch (e) { haptics.error(); Alert.alert('Gift card', (e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.gutter }} keyboardShouldPersistTaps="handled">
      <Text variant="caption" tone="t3" style={styles.lbl}>THE CODE</Text>
      <TextInput
        value={code}
        onChangeText={setCode}
        placeholder="GIFT-XXXXXXXXXX"
        placeholderTextColor={c.t4}
        autoCapitalize="characters"
        autoCorrect={false}
        accessibilityLabel="Gift card code"
        style={[styles.input, { backgroundColor: c.s2, color: c.text, borderRadius: radius.md, letterSpacing: 1 }]}
      />
      <View style={{ height: 16 }} />
      <Button title="Redeem" onPress={go} loading={busy} disabled={code.trim().length < 4} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: 40 },
  card: { padding: 16, marginBottom: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  lbl: { marginTop: 18, marginBottom: 8, letterSpacing: 0.6 },
  amounts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  amt: { paddingHorizontal: 18, paddingVertical: 10 },
  input: { paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
});
