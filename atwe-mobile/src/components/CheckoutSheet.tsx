import { useCallback, useEffect, useState } from 'react';
import {
  Modal, View, ScrollView, Pressable, ActivityIndicator, Alert, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Text } from './Text';
import { Button } from './Button';
import { AddressForm } from './AddressForm';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import {
  useAddresses, addressLine, quote as quoteFor, pay, useAfterPurchase, etaLabel,
  type Address, type Quote, type PayWith, type Target,
} from '@/api/checkout';
import { useWallet, money } from '@/api/wallet';
import { useCart } from '@/api/cart';

/**
 * Checkout for one listing.
 *
 * The order of the screen is the order of the questions: where is it going,
 * what does it cost, how are you paying. The total is never guessed on the
 * phone — it comes from `POST /api/checkout/quote`, the same call the web makes,
 * so what is shown is what will be charged. Shipping and tax only appear when
 * the server actually has them.
 *
 * Two ways to pay, both from the Atwe balance:
 *   Pay now             the seller is credited immediately.
 *   Buy with protection the money is held in escrow until you confirm it
 *                       arrived — the safe way to buy from a stranger.
 * Card payment goes through Stripe Checkout on the web and is not wired up on
 * the phone yet; rather than half-build it, the sheet says plainly that you top
 * the balance up first, and offers the way there.
 */
export function CheckoutSheet({
  visible, onClose, target, title, sub, needsShipping,
}: {
  visible: boolean;
  onClose: () => void;
  /** One listing, or a seller's whole cart. */
  target: Target;
  /** What is being bought, in the buyer's words. */
  title: string;
  sub?: string;
  /** Whether a delivery address is needed. The caller knows — a listing knows
   *  its own kind, and a cart group is told by the server. */
  needsShipping: boolean;
}) {
  const { c } = useTheme();
  const router = useRouter();
  const addrQ = useAddresses();
  const walletQ = useWallet();
  const cartQ = useCart();
  const afterPurchase = useAfterPurchase();

  const [addressId, setAddressId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [rateId, setRateId] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState<PayWith>('protected');
  const [paying, setPaying] = useState(false);
  // ONE id for this purchase, kept across retries — a fresh one per attempt is
  // exactly how a network hiccup turns into two orders.
  const [clientId] = useState(() => `buy-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const addresses = addrQ.data?.addresses ?? [];
  const chosen = addresses.find((a) => a.id === addressId) ?? null;

  // Default to the address already marked default, once they load.
  useEffect(() => {
    if (addressId == null && addresses.length) {
      setAddressId((addresses.find((a) => a.isDefault) ?? addresses[0]).id);
    }
  }, [addresses, addressId]);

  // The target is an object built inline by the caller, so a plain dependency on
  // it would re-run this on every render. Its identity is fully described by
  // these few values.
  const targetKey = JSON.stringify(target);
  const refreshQuote = useCallback(async () => {
    if (!visible) return;
    setQuoting(true);
    try {
      const q = await quoteFor(JSON.parse(targetKey) as Target, { addressId, shipRateId: rateId });
      setQuote(q);
      if (!rateId && q.selectedRateId) setRateId(q.selectedRateId);
    } catch (e) {
      setQuote(null);
      Alert.alert('Checkout', (e as Error).message);
    } finally {
      setQuoting(false);
    }
  }, [visible, targetKey, addressId, rateId]);

  useEffect(() => { refreshQuote(); }, [refreshQuote]);

  const balance = walletQ.data?.balanceCents ?? 0;
  const total = quote?.totalCents ?? 0;
  const short = total > balance;
  const blocked = needsShipping && !chosen;

  const doPay = async () => {
    if (paying || !quote) return;
    setPaying(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      const r = await pay(target, { addressId, shipRateId: rateId, payWith: payMethod, clientId });
      afterPurchase();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onClose();
      Alert.alert(
        r.escrow ? 'Paid — held safely' : 'Order placed',
        r.escrow
          ? 'The money is held until you confirm the item arrived.'
          : 'The seller has been paid and will get it ready.',
        [{ text: 'View order', onPress: () => router.push('/orders') }, { text: 'Done' }],
      );
    } catch (e) {
      // A cart checkout that fails AFTER the order went through is a real state,
      // and it has a tell. The server empties the cart for a seller only on a
      // successful payment, and its "cart is empty" guard runs BEFORE the
      // idempotency claim — so a retry after a dropped response cannot replay
      // the first result, it just refuses. If the cart is now gone, the money
      // moved: say so and point at the order, rather than showing a failure for
      // something that worked.
      if (target.kind === 'cart') {
        const fresh = await cartQ.refetch();
        const stillThere = (fresh.data?.carts ?? []).some((g) => g.seller.id === target.sellerId);
        if (!stillThere) {
          afterPurchase();
          onClose();
          Alert.alert(
            'Already ordered',
            'This one had already gone through. You can see it in your orders.',
            [{ text: 'View orders', onPress: () => router.push('/orders') }, { text: 'Done' }],
          );
          return;
        }
      }
      Alert.alert('Checkout', (e as Error).message);
    } finally {
      setPaying(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.wrap, { backgroundColor: c.bg }]}>
        <View style={[styles.head, { borderBottomColor: c.border }]}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.x}
            accessibilityRole="button" accessibilityLabel="Close checkout">
            <Ionicons name="close" size={24} color={c.text} />
          </Pressable>
          <Text variant="headline">Checkout</Text>
          <View style={styles.x} />
        </View>

        {adding ? (
          <AddressForm
            onCancel={() => setAdding(false)}
            onSaved={(a: Address) => {
              setAdding(false);
              setAddressId(a.id);
              addrQ.refetch();
            }}
          />
        ) : (
          <>
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              {/* What */}
              <View style={[styles.card, { backgroundColor: c.s1 }]}>
                <Text variant="headline" numberOfLines={2}>{title}</Text>
                {!!sub && (
                  <Text variant="caption" tone="t3" style={{ marginTop: 3 }}>{sub}</Text>
                )}
              </View>

              {/* Where */}
              {needsShipping && (
                <>
                  <Text variant="callout" tone="t2" style={styles.label}>Deliver to</Text>
                  {addrQ.isLoading ? (
                    <ActivityIndicator color={c.accent} style={{ marginVertical: 14 }} />
                  ) : (
                    <>
                      {addresses.map((a) => (
                        <Pressable
                          key={a.id}
                          onPress={() => { setAddressId(a.id); setRateId(null); }}
                          style={[styles.pick, { backgroundColor: c.s1 },
                            a.id === addressId && { borderColor: c.accent, borderWidth: 1.5 }]}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: a.id === addressId }}
                        >
                          <Ionicons
                            name={a.id === addressId ? 'radio-button-on' : 'radio-button-off'}
                            size={20} color={a.id === addressId ? c.accent : c.t3}
                          />
                          <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text variant="callout" weight="600">{a.fullName}</Text>
                            <Text variant="caption" tone="t3" numberOfLines={2}>{addressLine(a)}</Text>
                          </View>
                        </Pressable>
                      ))}
                      <Pressable onPress={() => setAdding(true)} style={styles.addRow}
                        accessibilityRole="button" accessibilityLabel="Add a new address">
                        <Ionicons name="add-circle-outline" size={20} color={c.accent} />
                        <Text variant="callout" style={{ color: c.accent, marginLeft: 8 }}>
                          {addresses.length ? 'Add another address' : 'Add a delivery address'}
                        </Text>
                      </Pressable>
                    </>
                  )}
                </>
              )}

              {/* Which shipping — only when the server actually offers a choice */}
              {!!quote?.shippingOptions?.length && quote.shippingOptions.length > 1 && (
                <>
                  <Text variant="callout" tone="t2" style={styles.label}>Shipping</Text>
                  {quote.shippingOptions.map((o) => (
                    <Pressable
                      key={o.id}
                      onPress={() => setRateId(o.id)}
                      style={[styles.pick, { backgroundColor: c.s1 },
                        o.id === rateId && { borderColor: c.accent, borderWidth: 1.5 }]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: o.id === rateId }}
                    >
                      <Ionicons name={o.id === rateId ? 'radio-button-on' : 'radio-button-off'}
                        size={20} color={o.id === rateId ? c.accent : c.t3} />
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text variant="callout">{o.label}</Text>
                        {o.days != null && (
                          <Text variant="caption" tone="t3">about {o.days} days</Text>
                        )}
                      </View>
                      <Text variant="callout" weight="600">{money(o.amountCents)}</Text>
                    </Pressable>
                  ))}
                </>
              )}

              {/* What it costs */}
              <Text variant="callout" tone="t2" style={styles.label}>Total</Text>
              <View style={[styles.card, { backgroundColor: c.s1 }]}>
                {quoting && !quote ? (
                  <ActivityIndicator color={c.accent} />
                ) : quote ? (
                  <>
                    <Line label="Subtotal" value={money(quote.subtotalCents)} />
                    {quote.discountCents > 0 && (
                      <Line label="Discount" value={`−${money(quote.discountCents)}`} tone="repost" />
                    )}
                    {quote.needsShipping && (
                      <Line label="Shipping"
                        value={quote.shippingCents ? money(quote.shippingCents) : 'Free'} />
                    )}
                    {quote.taxCents > 0 && <Line label="Tax" value={money(quote.taxCents)} />}
                    <View style={[styles.rule, { backgroundColor: c.border }]} />
                    <Line label="To pay" value={money(quote.totalCents)} big />
                    {!!quote.eta && !!etaLabel(quote.eta) && (
                      <Text variant="caption" tone="t3" style={{ marginTop: 6 }}>
                        Expected {etaLabel(quote.eta)}
                      </Text>
                    )}
                  </>
                ) : (
                  <Text variant="body" tone="t2">Couldn't price this yet.</Text>
                )}
              </View>

              {/* How */}
              <Text variant="callout" tone="t2" style={styles.label}>Pay with</Text>
              <PayOption
                title="Buy with protection"
                sub="Held until you confirm it arrived"
                icon="shield-checkmark-outline"
                on={payMethod === 'protected'} onPress={() => setPayMethod('protected')}
              />
              <PayOption
                title="Pay now"
                sub="The seller is paid straight away"
                icon="flash-outline"
                on={payMethod === 'balance'} onPress={() => setPayMethod('balance')}
              />
              <Text variant="caption" tone="t3" style={{ marginTop: 8 }}>
                Atwe balance: {money(balance)}
              </Text>
            </ScrollView>

            <View style={[styles.foot, { borderTopColor: c.border }]}>
              {blocked ? (
                <Text variant="caption" tone="t3" style={styles.footNote}>
                  Add a delivery address to continue.
                </Text>
              ) : short ? (
                <Text variant="caption" tone="warning" style={styles.footNote}>
                  {money(total - balance)} short. Top up your balance to pay.
                </Text>
              ) : null}
              {short && !blocked ? (
                <Button title="Top up balance" kind="primary"
                  onPress={() => { onClose(); router.push('/wallet-topup'); }} />
              ) : (
                <Button
                  title={quote ? `Pay ${money(total)}` : 'Pay'}
                  kind="primary"
                  loading={paying}
                  disabled={!quote || blocked || quoting || paying}
                  onPress={doPay}
                />
              )}
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

function Line({ label, value, big, tone }: {
  label: string; value: string; big?: boolean; tone?: 'repost';
}) {
  const { c } = useTheme();
  return (
    <View style={styles.line}>
      <Text variant={big ? 'headline' : 'body'} tone={big ? undefined : 't2'} style={{ flex: 1 }}>
        {label}
      </Text>
      <Text
        variant={big ? 'headline' : 'body'}
        weight={big ? '800' : '600'}
        style={tone === 'repost' ? { color: c.repost } : undefined}
      >
        {value}
      </Text>
    </View>
  );
}

function PayOption({ title, sub, icon, on, onPress }: {
  title: string; sub: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  on: boolean; onPress: () => void;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.pick, { backgroundColor: c.s1 }, on && { borderColor: c.accent, borderWidth: 1.5 }]}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
    >
      <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? c.accent : c.t3} />
      <Ionicons name={icon} size={19} color={c.t2} style={{ marginLeft: 10 }} />
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text variant="callout" weight="600">{title}</Text>
        <Text variant="caption" tone="t3">{sub}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  x: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  body: { padding: spacing.gutter, paddingBottom: 28 },
  label: { marginTop: 18, marginBottom: 8 },
  card: { borderRadius: radius.lg, padding: 14 },
  pick: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: radius.lg, padding: 14, marginBottom: 8,
    borderWidth: 1.5, borderColor: 'transparent',
  },
  addRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4 },
  line: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 8 },
  foot: { padding: spacing.gutter, paddingBottom: 26, borderTopWidth: StyleSheet.hairlineWidth },
  footNote: { marginBottom: 10, textAlign: 'center' },
});
