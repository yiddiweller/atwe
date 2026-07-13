import { View, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { useTheme } from '@/theme/ThemeProvider';
import { listingPrice, type Listing } from '@/api/marketplace';

/**
 * Marketplace listing card — post-style (seller header, photo, title, price),
 * mirroring the web `acListingCard`. Tapping opens the listing detail.
 */
export function ListingCard({ listing }: { listing: Listing }) {
  const { c, radius } = useTheme();
  const router = useRouter();
  const s = listing.seller;
  const cover = listing.image || listing.images[0] || null;

  return (
    <Pressable
      onPress={() => router.push(`/listing/${listing.id}`)}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: c.s1, borderRadius: radius.lg, borderColor: c.border },
        pressed && { opacity: 0.9 },
      ]}
    >
      {/* Seller header */}
      <Pressable
        style={styles.head}
        onPress={() => s.username && router.push(`/user/${s.username}`)}
        hitSlop={6}
      >
        <Avatar name={s.name} avatar={s.avatar} biz={s.accountType === 'business'} size={30} />
        <View style={styles.headName}>
          <Text variant="callout" weight="700" numberOfLines={1}>{s.name}</Text>
          {s.verified && <VerifiedBadge size={13} />}
        </View>
        {!!listing.category && (
          <Text variant="micro" tone="t3" numberOfLines={1}>{listing.category}</Text>
        )}
      </Pressable>

      {/* Cover */}
      {cover && (
        <Image
          source={{ uri: cover }}
          style={[styles.cover, { backgroundColor: c.s2 }]}
          contentFit="cover"
          transition={120}
        />
      )}

      {/* Body */}
      <View style={styles.body}>
        <Text variant="headline" numberOfLines={2}>{listing.name}</Text>
        <View style={styles.priceRow}>
          <Text variant="headline" weight="800" style={{ color: c.text }}>
            {listingPrice(listing)}
          </Text>
          {listing.rating != null && listing.reviewCount > 0 && (
            <View style={styles.rating}>
              <Ionicons name="star" size={13} color={c.warning} />
              <Text variant="micro" tone="t2" style={{ marginLeft: 3 }}>
                {listing.rating.toFixed(1)} ({listing.reviewCount})
              </Text>
            </View>
          )}
          {listing.soldOut && (
            <Text variant="micro" tone="danger" style={{ marginLeft: 'auto' }}>Sold out</Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  head: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8 },
  headName: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  cover: { width: '100%', aspectRatio: 1.2 },
  body: { padding: 12, gap: 6 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rating: { flexDirection: 'row', alignItems: 'center' },
});
