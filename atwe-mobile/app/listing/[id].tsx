import { useState } from 'react';
import {
  View,
  ScrollView,
  Pressable,
  ActivityIndicator,
  useWindowDimensions,
  Alert,
  StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { ListingCard } from '@/components/ListingCard';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { useListing, listingPrice, saveListing, KIND_LABEL } from '@/api/marketplace';
import { CheckoutSheet } from '@/components/CheckoutSheet';
import { useCart, setCartQty } from '@/api/cart';
import { mediaUri } from '@/lib/media';
import { useAuth } from '@/auth/AuthProvider';
import { haptics } from '@/lib/haptics';
import { ProductQa } from '@/components/ProductQa';
import { makeOffer } from '@/api/seller';
import { Modal, TextInput } from 'react-native';

/**
 * Listing detail (`GET /api/listings/:id`) — gallery, title, price, seller,
 * description, rating, save-to-wishlist, and buying it: quantity, then a real
 * checkout (delivery address, live totals from the server, wallet or escrow).
 * "Message seller" stays right beside it, because Atwe is chat-coordinated
 * commerce and plenty of purchases still start with a question.
 */
export default function ListingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, radius, spacing } = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { data, isLoading, isError, refetch } = useListing(id);
  const listing = data?.listing;

  const { user } = useAuth();
  const [saved, setSaved] = useState<boolean | null>(null);
  const isSaved = saved ?? listing?.saved ?? false;
  const [qty, setQty] = useState(1);
  const [checkingOut, setCheckingOut] = useState(false);
  const [offering, setOffering] = useState(false);
  // You cannot buy your own listing, and the server says so with a 400 — better
  // to not offer the button than to offer it and refuse.
  /* The listing DETAIL does carry a seller (the server maps it with the join),
     but the type no longer promises one — a shop's own catalogue has none — so
     it is read once and every use goes through this, rather than each site
     assuming. */
  const seller = listing?.seller;
  const mine = !!seller && !!user && seller.id === user.id;
  // A listing with size or colour options needs the picker that is not built
  // yet; sending no variant would be refused, so it goes to chat instead.
  const buyable = !!listing && !mine && listing.active && !listing.soldOut && !listing.hasVariants;
  const cartQ = useCart();
  const [addingToCart, setAddingToCart] = useState(false);
  const inCart = !!listing && (cartQ.data?.carts ?? [])
    .some((g) => g.items.some((i) => i.productId === listing.id));

  const addToCart = async () => {
    if (!listing || addingToCart) return;
    setAddingToCart(true);
    try {
      await setCartQty(listing.id, qty);
      await cartQ.refetch();
    } catch (e) {
      haptics.error(); Alert.alert('Cart', (e as Error).message);
    } finally {
      setAddingToCart(false);
    }
  };

  const toggleSave = async () => {
    if (!listing) return;
    const next = !isSaved;
    setSaved(next);
    haptics.select();
    try {
      await saveListing(listing.id, next);
    } catch {
      setSaved(!next); // revert
    }
  };

  return (
    <Screen edges={['top']}>
      {/* Header */}
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={c.text} />
        </Pressable>
        <Text variant="headline" numberOfLines={1} style={{ flex: 1, textAlign: 'center' }}>
          {listing?.name ?? 'Listing'}
        </Text>
        <Pressable onPress={toggleSave} hitSlop={10} style={styles.back} accessibilityLabel="Save">
          {listing && (
            <Ionicons
              name={isSaved ? 'heart' : 'heart-outline'}
              size={24}
              color={isSaved ? c.like : c.text}
            />
          )}
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : isError || !listing ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">This listing is no longer available.</Text>
          <View style={{ height: 14 }} />
          <Button title="Try again" kind="secondary" onPress={() => refetch()} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {/* Gallery */}
          {listing.images.length > 0 ? (
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              style={{ backgroundColor: c.s2 }}
            >
              {listing.images.map((src, i) => (
                <Image
                  key={i}
                  source={{ uri: mediaUri(src) }}
                  style={{ width, aspectRatio: 1 }}
                  contentFit="cover"
                  transition={120}
                />
              ))}
            </ScrollView>
          ) : (
            <View style={[styles.noImg, { backgroundColor: c.s2 }]}>
              <Ionicons name="pricetag-outline" size={40} color={c.t3} />
            </View>
          )}

          <View style={{ padding: spacing.lg }}>
            {/* Kind + category */}
            <View style={styles.tagRow}>
              <View style={[styles.tag, { backgroundColor: c.accentDim }]}>
                <Text variant="micro" style={{ color: c.accent }}>{KIND_LABEL[listing.kind]}</Text>
              </View>
              {!!listing.category && (
                <View style={[styles.tag, { backgroundColor: c.s2 }]}>
                  <Text variant="micro" tone="t2">{listing.category}</Text>
                </View>
              )}
            </View>

            <Text variant="title" style={{ marginTop: 10 }}>{listing.name}</Text>

            {/* Price + rating */}
            <View style={styles.priceRow}>
              <Text variant="display" weight="800">{listingPrice(listing)}</Text>
              {listing.rating != null && listing.reviewCount > 0 && (
                <View style={styles.rating}>
                  <Ionicons name="star" size={15} color={c.warning} />
                  <Text variant="callout" tone="t2" style={{ marginLeft: 4 }}>
                    {listing.rating.toFixed(1)} · {listing.reviewCount} review{listing.reviewCount === 1 ? '' : 's'}
                  </Text>
                </View>
              )}
            </View>
            {listing.soldOut && (
              <Text variant="callout" tone="danger" style={{ marginTop: 4 }}>Sold out</Text>
            )}
            {listing.kind === 'physical' && !listing.soldOut && typeof listing.stock === 'number' && listing.stock <= 5 && (
              <Text variant="callout" tone="warning" style={{ marginTop: 4 }}>Only {listing.stock} left</Text>
            )}

            {/* Seller */}
            {!!seller && (
              <Pressable
                onPress={() => seller.username && router.push(`/user/${seller.username}`)}
                style={[styles.seller, { backgroundColor: c.s1, borderRadius: radius.card }]}
              >
                <Avatar
                  name={seller.name}
                  avatar={seller.avatar}
                  biz={seller.accountType === 'business'}
                  size={40}
                />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <View style={styles.sellerName}>
                    <Text variant="headline" numberOfLines={1}>{seller.name}</Text>
                    {seller.verified && <VerifiedBadge size={14} />}
                  </View>
                  {seller.username && (
                    <Text variant="caption" tone="t3">@{seller.username}</Text>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={18} color={c.t3} />
              </Pressable>
            )}

            {/* Description */}
            {!!listing.description && (
              <Text variant="body" tone="t2" style={{ marginTop: 16, lineHeight: 22 }}>
                {listing.description}
              </Text>
            )}

            {/* How many */}
            {buyable && (
              <View style={styles.qtyRow}>
                <Text variant="callout" tone="t2" style={{ flex: 1 }}>Quantity</Text>
                <Pressable onPress={() => setQty((n) => Math.max(1, n - 1))} hitSlop={8}
                  style={[styles.qtyBtn, { backgroundColor: c.s1 }]}
                  accessibilityRole="button" accessibilityLabel="One fewer">
                  <Ionicons name="remove" size={18} color={qty > 1 ? c.text : c.t4} />
                </Pressable>
                <Text variant="headline" style={styles.qtyN}>{qty}</Text>
                <Pressable
                  onPress={() => setQty((n) => Math.min(
                    99, typeof listing.stock === 'number' ? Math.max(1, listing.stock) : 99, n + 1,
                  ))}
                  hitSlop={8}
                  style={[styles.qtyBtn, { backgroundColor: c.s1 }]}
                  accessibilityRole="button" accessibilityLabel="One more">
                  <Ionicons name="add" size={18} color={c.text} />
                </Pressable>
              </View>
            )}

            {/* Actions */}
            <View style={{ marginTop: 22, gap: 10 }}>
              {buyable && (
                <>
                  <Button title="Buy now" kind="primary" onPress={() => setCheckingOut(true)} />
                  <Button
                    title={inCart ? 'In your cart' : 'Add to cart'}
                    kind="secondary"
                    loading={addingToCart}
                    disabled={inCart}
                    onPress={addToCart}
                  />
                </>
              )}
              {listing.hasVariants && !mine && (
                <Text variant="caption" tone="t3" style={{ textAlign: 'center' }}>
                  This one comes in options — message the seller to choose.
                </Text>
              )}
              {buyable && (
                <Button
                  title="Make an offer"
                  kind="secondary"
                  onPress={() => { haptics.tap(); setOffering(true); }}
                />
              )}
              {!!seller && (
                <Button
                  title="Message seller"
                  kind={buyable ? 'secondary' : 'primary'}
                  onPress={() => router.push(`/chat/${seller.id}`)}
                />
              )}
              {seller?.accountType === 'business' && !!seller.username && (
                <Button
                  title="Visit store"
                  kind="secondary"
                  onPress={() => router.push(`/user/${seller.username}`)}
                />
              )}
            </View>
          </View>

          {/* Questions buyers asked, answered in public. */}
          <View style={{ paddingHorizontal: spacing.lg }}>
            <ProductQa productId={listing.id} />
          </View>

          {/* More from this seller */}
          {!!listing.moreFromSeller?.length && (
            <View style={{ marginTop: 8 }}>
              <Text variant="headline" style={{ marginHorizontal: spacing.gutter, marginBottom: 10 }}>
                More from {seller?.name ?? 'this seller'}
              </Text>
              {listing.moreFromSeller.map((l) => (
                <ListingCard key={l.id} listing={l} />
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {!!listing && (
        <OfferSheet
          visible={offering}
          onClose={() => setOffering(false)}
          productId={listing.id}
          name={listing.name}
          asking={listing.priceCents}
        />
      )}

      {!!listing && (
        <CheckoutSheet
          visible={checkingOut}
          onClose={() => setCheckingOut(false)}
          target={{ kind: 'buy', productId: listing.id, qty }}
          title={listing.name}
          sub={qty > 1 ? `${qty} × ${listingPrice(listing)}` : seller ? `from ${seller.name}` : undefined}
          needsShipping={listing.kind === 'physical' && !listing.pickup}
        />
      )}
    </Screen>
  );
}

/**
 * Propose a price. Deliberately shows the asking price above the field — an
 * offer with no anchor is a guess, and a wild one just wastes both their time.
 */
function OfferSheet({ visible, onClose, productId, name, asking }: {
  visible: boolean; onClose: () => void; productId: number; name: string; asking: number;
}) {
  const { c, radius, spacing } = useTheme();
  const router = useRouter();
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const cents = Math.round(parseFloat(v.replace(/[^0-9.]/g, '')) * 100);
  const ok = Number.isFinite(cents) && cents > 0;

  const send = async () => {
    setBusy(true);
    try {
      const r = await makeOffer(productId, cents);
      haptics.success();
      setV('');
      onClose();
      router.push(`/offer/${r.offer.id}`);
    } catch (e) { haptics.error(); Alert.alert('Offer', (e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <Screen edges={['top']}>
        <View style={[styles.head, { paddingHorizontal: spacing.gutter }]}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.back} accessibilityLabel="Close">
            <Ionicons name="chevron-down" size={24} color={c.text} />
          </Pressable>
          <Text variant="headline" style={{ flex: 1, textAlign: 'center' }}>Make an offer</Text>
          <View style={styles.back} />
        </View>
        <View style={{ padding: spacing.gutter }}>
          <Text variant="body" tone="t2" numberOfLines={2}>{name}</Text>
          <Text variant="caption" tone="t3" style={{ marginTop: 4 }}>
            Asking {'$'}{(asking / 100).toFixed(2)}
          </Text>
          <Text variant="caption" tone="t3" style={{ marginTop: 20, marginBottom: 8, letterSpacing: 0.6 }}>
            YOUR OFFER
          </Text>
          <TextInput
            value={v} onChangeText={setV}
            placeholder={(asking / 100).toFixed(0)}
            placeholderTextColor={c.t4}
            keyboardType="decimal-pad"
            autoFocus
            accessibilityLabel="Your offer in dollars"
            style={{
              backgroundColor: c.s2, color: c.text, borderRadius: radius.md,
              paddingHorizontal: 14, paddingVertical: 12, fontSize: 16,
            }}
          />
          <Text variant="caption" tone="t3" style={{ marginTop: 10 }}>
            The seller can accept, decline, or come back with their own price.
            Nothing is charged until you both agree.
          </Text>
          <View style={{ height: 20 }} />
          <Button title="Send the offer" onPress={send} loading={busy} disabled={!ok} />
        </View>
      </Screen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  qtyRow: { flexDirection: 'row', alignItems: 'center', marginTop: 18, gap: 10 },
  qtyBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  qtyN: { minWidth: 26, textAlign: 'center' },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 8,
    gap: 4,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  noImg: { width: '100%', aspectRatio: 1.6, alignItems: 'center', justifyContent: 'center' },
  tagRow: { flexDirection: 'row', gap: 8 },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  rating: { flexDirection: 'row', alignItems: 'center' },
  seller: { flexDirection: 'row', alignItems: 'center', padding: 12, marginTop: 18 },
  sellerName: { flexDirection: 'row', alignItems: 'center' },
});
