import { useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { PageHeader } from '@/components/PageHeader';
import { chromePad } from '@/components/Chrome';
import { CheckoutSheet } from '@/components/CheckoutSheet';
import { useTheme } from '@/theme/ThemeProvider';
import { useOffer, respondToOffer, cancelOffer } from '@/api/seller';
import { offerState } from '../offers';
import { money } from '@/api/wallet';
import { mediaUri } from '@/lib/media';
import { haptics } from '@/lib/haptics';
import { SheetGlass } from '@/components/Glass';

/**
 * One offer. Whose move it is decides what the screen offers — the server works
 * that out (`myTurn`) rather than the phone inferring it from the status and
 * who is looking, which is the kind of thing that drifts.
 */
export default function OfferDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, radius, spacing } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useOffer(id);
  const o = data?.offer;
  const [busy, setBusy] = useState<string | null>(null);
  const [countering, setCountering] = useState(false);
  const [paying, setPaying] = useState(false);

  const bump = () => qc.invalidateQueries({ queryKey: ['offers'] });

  const act = async (action: 'accept' | 'decline', amountCents?: number) => {
    if (!o) return;
    setBusy(action);
    try { await respondToOffer(o.id, action, amountCents); haptics.success(); bump(); refetch(); }
    catch (e) { haptics.error(); Alert.alert('Offer', (e as Error).message); }
    finally { setBusy(null); }
  };

  const withdraw = () => {
    if (!o) return;
    Alert.alert('Withdraw this offer?', '', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Withdraw', style: 'destructive', onPress: async () => {
          setBusy('cancel');
          try { await cancelOffer(o.id); haptics.success(); bump(); router.back(); }
          catch (e) { haptics.error(); Alert.alert('Offer', (e as Error).message); }
          finally { setBusy(null); }
        },
      },
    ]);
  };

  const st = o ? offerState(o) : null;
  const other = o ? (o.iAmBuyer ? o.seller : o.buyer) : null;
  const open = o?.status === 'pending' || o?.status === 'countered';

  return (
    <Screen edges={[]}>
      <PageHeader title="Offer" />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : isError || !o ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">This offer is not available.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[{ padding: spacing.gutter, paddingBottom: 60 }, chromePad.header]}>
          <View style={[styles.hero, { backgroundColor: c.s1, borderRadius: radius.card }]}>
            <Text variant="caption" tone="t3">
              {o.iAmBuyer ? 'YOU OFFERED' : 'THEY OFFERED'}
            </Text>
            <Text variant="display" weight="800" style={{ marginTop: 4 }}>{money(o.amountCents)}</Text>
            {!!st && <Text variant="callout" tone={st.tone} style={{ marginTop: 4 }}>{st.label}</Text>}
            <Text variant="caption" tone="t3" style={{ marginTop: 6 }}>
              Asking price {money(o.product.priceCents)}
            </Text>
          </View>

          <Pressable
            onPress={() => router.push(`/listing/${o.productId}`)}
            style={[styles.item, { backgroundColor: c.s1, borderRadius: radius.card }]}
          >
            {o.product.image ? (
              <Image source={{ uri: mediaUri(o.product.image) }}
                style={[styles.thumb, { backgroundColor: c.s2, borderRadius: radius.md }]}
                contentFit="cover" transition={120} />
            ) : (
              <View style={[styles.thumb, { backgroundColor: c.s2, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' }]}>
                <Ionicons name="pricetag-outline" size={18} color={c.t3} />
              </View>
            )}
            <Text variant="headline" style={{ flex: 1, marginLeft: 12 }} numberOfLines={2}>
              {o.product.name}
            </Text>
            <Ionicons name="chevron-forward" size={17} color={c.t3} />
          </Pressable>

          {!!other && (
            <View style={[styles.who, { backgroundColor: c.s1, borderRadius: radius.card }]}>
              <Avatar name={other.name} avatar={other.avatar} biz={other.accountType === 'business'} size={38} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text variant="headline" numberOfLines={1}>{other.name}</Text>
                {other.username && <Text variant="caption" tone="t3">@{other.username}</Text>}
              </View>
            </View>
          )}

          <View style={{ marginTop: 24, gap: 10 }}>
            {/* Only the side whose turn it is can move. The server enforces it;
                showing the buttons anyway would just produce a refusal. */}
            {open && o.myTurn && (
              <>
                <Button title={`Accept ${money(o.amountCents)}`} onPress={() => act('accept')}
                  loading={busy === 'accept'} />
                <Button title="Counter with a different price" kind="secondary"
                  onPress={() => { haptics.tap(); setCountering(true); }} />
                <Button title="Decline" kind="danger" onPress={() => act('decline')}
                  loading={busy === 'decline'} />
              </>
            )}
            {open && !o.myTurn && (
              <>
                <Text variant="callout" tone="t3" style={{ textAlign: 'center' }}>
                  Waiting for {other?.name ?? 'them'}.
                </Text>
                <Button title="Withdraw" kind="secondary" onPress={withdraw} loading={busy === 'cancel'} />
              </>
            )}
            {o.canPay && (
              <Button title={`Pay ${money(o.amountCents)}`} onPress={() => setPaying(true)} />
            )}
            {o.status === 'paid' && (
              <Button title="View the order" kind="secondary" onPress={() => router.push('/orders')} />
            )}
          </View>
        </ScrollView>
      )}

      {!!o && (
        <>
          <CounterSheet
            visible={countering}
            asking={o.product.priceCents}
            current={o.amountCents}
            onClose={() => setCountering(false)}
            onCounter={async (cents) => {
              setCountering(false);
              setBusy('counter');
              try { await respondToOffer(o.id, 'counter', cents); haptics.success(); bump(); refetch(); }
              catch (e) { haptics.error(); Alert.alert('Offer', (e as Error).message); }
              finally { setBusy(null); }
            }}
          />
          <CheckoutSheet
            visible={paying}
            onClose={() => setPaying(false)}
            target={{ kind: 'offer', offerId: o.id, amountCents: o.amountCents }}
            title={o.product.name}
            sub={`at the ${money(o.amountCents)} you agreed`}
            needsShipping={o.product.kind === 'physical'}
          />
        </>
      )}
    </Screen>
  );
}

function CounterSheet({ visible, asking, current, onClose, onCounter }: {
  visible: boolean;
  asking: number;
  current: number;
  onClose: () => void;
  onCounter: (cents: number) => void;
}) {
  const { c, radius, spacing } = useTheme();
  const [v, setV] = useState('');
  const cents = Math.round(parseFloat(v.replace(/[^0-9.]/g, '')) * 100);
  const ok = Number.isFinite(cents) && cents > 0 && cents !== current;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}><SheetGlass>
      <Screen edges={[]}>
        <PageHeader title="Counter" />
        <View style={{ padding: spacing.gutter }}>
          <Text variant="body" tone="t2">
            They offered {money(current)}. The asking price is {money(asking)}.
          </Text>
          <Text variant="caption" tone="t3" style={{ marginTop: 18, marginBottom: 8, letterSpacing: 0.6 }}>
            YOUR PRICE
          </Text>
          <TextInput
            value={v} onChangeText={setV}
            placeholder={(asking / 100).toFixed(0)}
            placeholderTextColor={c.t4}
            keyboardType="decimal-pad"
            autoFocus
            accessibilityLabel="Your counter price in dollars"
            style={{
              backgroundColor: c.s2, color: c.text, borderRadius: radius.pill,
              paddingHorizontal: 16, paddingVertical: 12, fontSize: 16,
            }}
          />
          <View style={{ height: 20 }} />
          <Button title="Send the counter" onPress={() => { onCounter(cents); setV(''); }} disabled={!ok} />
        </View>
      </Screen>
    </SheetGlass></Modal>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  hero: { padding: 20 },
  item: { flexDirection: 'row', alignItems: 'center', padding: 12, marginTop: 16 },
  thumb: { width: 46, height: 46 },
  who: { flexDirection: 'row', alignItems: 'center', padding: 12, marginTop: 12 },
});
