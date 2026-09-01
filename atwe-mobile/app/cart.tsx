import { useState } from 'react';
import {
  View, ScrollView, Pressable, ActivityIndicator, RefreshControl, Alert, StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { GlassIcon } from '@/components/Glass';
import { useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { ChromeButton, ChromeBar, useFloatingChrome } from '@/components/Chrome';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { CheckoutSheet } from '@/components/CheckoutSheet';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { money } from '@/api/wallet';
import { useCart, setCartQty, removeFromCart, type Cart, type CartItem } from '@/api/cart';
import { mediaUri } from '@/lib/media';
import { haptics } from '@/lib/haptics';

/**
 * The cart.
 *
 * It is a list of little carts, one per seller, each with its own total and its
 * own Checkout — because an order goes to a single business, so buying from two
 * sellers is genuinely two orders and pretending otherwise would be a lie about
 * what happens. The seller's free-shipping threshold is shown where it can
 * still change a mind: on their group, with how much more it would take.
 */
export default function CartScreen() {
  const { c } = useTheme();
  const router = useRouter();
  const q = useCart();
  const carts = q.data?.carts ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<Cart | null>(null);

  const key = (i: CartItem) => `${i.productId}:${i.variantId ?? 0}`;

  const change = async (i: CartItem, qty: number) => {
    setBusy(key(i));
    haptics.select();
    try {
      if (qty <= 0) await removeFromCart(i.productId, i.variantId);
      else await setCartQty(i.productId, qty, i.variantId);
      await q.refetch();
    } catch (e) {
      haptics.error(); Alert.alert('Cart', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const chrome = useFloatingChrome();

  return (
    <Screen edges={[]}>
      <ChromeBar onLayout={chrome.onLayout}>
        <View style={styles.head}>
          <ChromeButton onPress={() => router.back()} label="Back">
            <Ionicons name="chevron-back" size={22} color={c.text} />
          </ChromeButton>
          <Text variant="headline">Cart</Text>
          <View style={styles.back} />
        </View>
      </ChromeBar>

      {q.isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={[carts.length ? styles.body : styles.emptyWrap, chrome.pad]}
          refreshControl={
            <RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={c.t3} />
          }
        >
          {carts.length === 0 ? (
            <View style={styles.center}>
              <Ionicons name="bag-outline" size={44} color={c.t4} />
              <Text variant="title" tone="t2" style={{ marginTop: 12 }}>Your cart is empty</Text>
              <Text variant="body" tone="t3" style={{ marginTop: 6, textAlign: 'center' }}>
                Things you add from the marketplace show up here.
              </Text>
              <View style={{ marginTop: 20, alignSelf: 'stretch' }}>
                <Button title="Browse the marketplace" kind="primary"
                  onPress={() => router.push('/marketplace')} />
              </View>
            </View>
          ) : (
            carts.map((g) => (
              <View key={g.seller.id} style={[styles.group, { backgroundColor: c.s1 }]}>
                <Pressable
                  style={styles.sellerRow}
                  onPress={() => g.seller.username && router.push(`/user/${g.seller.username}`)}
                >
                  <Avatar name={g.seller.name} avatar={g.seller.avatar}
                    biz={g.seller.accountType === 'business'} size={30} />
                  <Text variant="headline" style={{ flex: 1, marginLeft: 9 }} numberOfLines={1}>
                    {g.seller.name}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={c.t3} />
                </Pressable>

                {g.items.map((i) => (
                  <View key={key(i)} style={styles.item}>
                    {i.image ? (
                      <Image source={{ uri: mediaUri(i.image) }} style={styles.thumb} contentFit="cover" />
                    ) : (
                      <View style={[styles.thumb, { backgroundColor: c.s2 }]} />
                    )}
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Pressable onPress={() => router.push(`/listing/${i.productId}`)}>
                        <Text variant="callout" numberOfLines={2}>{i.name}</Text>
                      </Pressable>
                      {!!i.variantLabel && (
                        <Text variant="caption" tone="t3">{i.variantLabel}</Text>
                      )}
                      {i.soldOut && (
                        <Text variant="caption" tone="danger">Sold out — remove it to check out</Text>
                      )}
                      <View style={styles.qtyRow}>
                        <GlassIcon onPress={() => change(i, i.qty - 1)} size={28}
                          disabled={busy === key(i)}
                          label={i.qty > 1 ? 'One fewer' : 'Remove'}>
                          <Ionicons name={i.qty > 1 ? 'remove' : 'trash-outline'} size={15}
                            color={i.qty > 1 ? c.text : c.danger} />
                        </GlassIcon>
                        <Text variant="callout" style={styles.qtyN}>{i.qty}</Text>
                        <GlassIcon onPress={() => change(i, i.qty + 1)} size={28}
                          disabled={busy === key(i)} label="One more">
                          <Ionicons name="add" size={15} color={c.text} />
                        </GlassIcon>
                        <View style={{ flex: 1 }} />
                        <Text variant="callout" weight="700">{money(i.priceCents * i.qty)}</Text>
                      </View>
                    </View>
                  </View>
                ))}

                <View style={[styles.rule, { backgroundColor: c.bg }]} />
                <View style={styles.totalRow}>
                  <Text variant="body" tone="t2" style={{ flex: 1 }}>Items</Text>
                  <Text variant="body" weight="600">{money(g.totalCents)}</Text>
                </View>
                {g.needsShipping && (
                  <View style={styles.totalRow}>
                    <Text variant="body" tone="t2" style={{ flex: 1 }}>Shipping</Text>
                    <Text variant="body" weight="600">
                      {g.shippingCents ? money(g.shippingCents) : 'Free'}
                    </Text>
                  </View>
                )}
                {!!g.freeShipOverCents && !g.freeShipMet && (
                  <Text variant="caption" tone="t3" style={{ marginTop: 2 }}>
                    {money(g.freeShipOverCents - g.totalCents)} more for free shipping.
                  </Text>
                )}

                <View style={{ marginTop: 12 }}>
                  <Button
                    title={`Check out · ${money(g.totalCents + (g.needsShipping ? g.shippingCents : 0))}`}
                    kind="primary"
                    disabled={g.items.some((i) => i.soldOut)}
                    onPress={() => setCheckout(g)}
                  />
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {!!checkout && (
        <CheckoutSheet
          visible
          onClose={() => setCheckout(null)}
          target={{ kind: 'cart', sellerId: checkout.seller.id }}
          title={`${checkout.items.length} item${checkout.items.length === 1 ? '' : 's'} from ${checkout.seller.name}`}
          sub={checkout.items.map((i) => i.name).join(', ')}
          needsShipping={checkout.needsShipping}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingBottom: 8,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyWrap: { flexGrow: 1 },
  body: { padding: spacing.gutter, paddingBottom: 40, gap: 14 },
  group: { borderRadius: radius.card, padding: 14 },
  sellerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  item: { flexDirection: 'row', marginBottom: 12 },
  thumb: { width: 58, height: 58, borderRadius: radius.sm },
  qtyRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8 },
  qtyN: { minWidth: 20, textAlign: 'center' },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 8 },
  totalRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 2 },
});
