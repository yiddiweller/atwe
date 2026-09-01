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
import * as Haptics from 'expo-haptics';
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
  // You cannot buy your own listing, and the server says so with a 400 — better
  // to not offer the button than to offer it and refuse.
  const mine = !!listing && !!user && listing.seller.id === user.id;
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await setCartQty(listing.id, qty);
      await cartQ.refetch();
    } catch (e) {
      Alert.alert('Cart', (e as Error).message);
    } finally {
      setAddingToCart(false);
    }
  };

  const toggleSave = async () => {
    if (!listing) return;
    const next = !isSaved;
    setSaved(next);
    Haptics.selectionAsync().catch(() => {});
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
            <Pressable
              onPress={() => listing.seller.username && router.push(`/user/${listing.seller.username}`)}
              style={[styles.seller, { backgroundColor: c.s1, borderRadius: radius.card }]}
            >
              <Avatar
                name={listing.seller.name}
                avatar={listing.seller.avatar}
                biz={listing.seller.accountType === 'business'}
                size={40}
              />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <View style={styles.sellerName}>
                  <Text variant="headline" numberOfLines={1}>{listing.seller.name}</Text>
                  {listing.seller.verified && <VerifiedBadge size={14} />}
                </View>
                {listing.seller.username && (
                  <Text variant="caption" tone="t3">@{listing.seller.username}</Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={18} color={c.t3} />
            </Pressable>

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
              <Button
                title="Message seller"
                kind={buyable ? 'secondary' : 'primary'}
                onPress={() => router.push(`/chat/${listing.seller.id}`)}
              />
              {listing.seller.accountType === 'business' && listing.seller.username && (
                <Button
                  title="Visit store"
                  kind="secondary"
                  onPress={() => router.push(`/user/${listing.seller.username}`)}
                />
              )}
            </View>
          </View>

          {/* More from this seller */}
          {!!listing.moreFromSeller?.length && (
            <View style={{ marginTop: 8 }}>
              <Text variant="headline" style={{ marginHorizontal: spacing.gutter, marginBottom: 10 }}>
                More from {listing.seller.name}
              </Text>
              {listing.moreFromSeller.map((l) => (
                <ListingCard key={l.id} listing={l} />
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {!!listing && (
        <CheckoutSheet
          visible={checkingOut}
          onClose={() => setCheckingOut(false)}
          target={{ kind: 'buy', productId: listing.id, qty }}
          title={listing.name}
          sub={qty > 1 ? `${qty} × ${listingPrice(listing)}` : `from ${listing.seller.name}`}
          needsShipping={listing.kind === 'physical' && !listing.pickup}
        />
      )}
    </Screen>
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
