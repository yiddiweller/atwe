import { useState } from 'react';
import {
  View,
  ScrollView,
  Pressable,
  ActivityIndicator,
  useWindowDimensions,
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
import { useListing, listingPrice, saveListing, KIND_LABEL } from '@/api/marketplace';

/**
 * Listing detail (`GET /api/listings/:id`) — gallery, title, price, seller,
 * description, rating, save-to-wishlist, and a Message-seller CTA (Atwe is
 * chat-coordinated commerce). "Visit store" deep-links a business storefront.
 * A full in-app checkout (address + wallet/escrow) is a later slice.
 */
export default function ListingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, radius, spacing } = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { data, isLoading, isError, refetch } = useListing(id);
  const listing = data?.listing;

  const [saved, setSaved] = useState<boolean | null>(null);
  const isSaved = saved ?? listing?.saved ?? false;

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
                  source={{ uri: src }}
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
              style={[styles.seller, { backgroundColor: c.s1, borderRadius: radius.lg }]}
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

            {/* Actions */}
            <View style={{ marginTop: 22, gap: 10 }}>
              <Button
                title="Message seller"
                kind="primary"
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
              <Text variant="headline" style={{ marginHorizontal: 16, marginBottom: 10 }}>
                More from {listing.seller.name}
              </Text>
              {listing.moreFromSeller.map((l) => (
                <ListingCard key={l.id} listing={l} />
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
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
