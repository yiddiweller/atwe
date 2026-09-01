import { View, FlatList, Pressable, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { ListingCard } from '@/components/ListingCard';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { api } from '@/api/client';
import { useCart, cartCount } from '@/api/cart';
import type { Listing } from '@/api/marketplace';

/**
 * One business's shop.
 *
 * The marketplace shows everything from everyone; this is what a single
 * business sells, which is what somebody who came for THEM wants. Sections come
 * from the seller's own categories — a menu's Starters and Mains, a shop's
 * collections — and a shop with none just lists everything, so sections only
 * appear when the seller has actually used them.
 */
export default function Shop() {
  const { c } = useTheme();
  const router = useRouter();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const bid = Number(id);
  const q = useQuery({
    queryKey: ['shop', bid],
    queryFn: () => api.get<{ products: Listing[] }>(`/api/businesses/${bid}/products`),
    enabled: Number.isFinite(bid),
  });
  const products = q.data?.products ?? [];
  const count = cartCount(useCart().data?.carts);

  // Grouped by the seller's own sections, in the order they first appear, with
  // anything uncategorised last.
  const groups: { title: string | null; items: Listing[] }[] = [];
  for (const p of products) {
    const key = p.category || null;
    const g = groups.find((x) => x.title === key);
    if (g) g.items.push(p);
    else groups.push({ title: key, items: [p] });
  }
  groups.sort((a, b) => (a.title === null ? 1 : 0) - (b.title === null ? 1 : 0));
  const sectioned = groups.length > 1 || (groups[0] && groups[0].title !== null);

  return (
    <Screen edges={['top']}>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}
          accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={c.text} />
        </Pressable>
        <Text variant="headline" numberOfLines={1}>{name || 'Shop'}</Text>
        <Pressable onPress={() => router.push('/cart')} hitSlop={10} style={styles.back}
          accessibilityRole="button" accessibilityLabel="Cart">
          <Ionicons name="bag-outline" size={23} color={c.text} />
          {count > 0 && (
            <View style={[styles.badge, { backgroundColor: c.accent }]}>
              <Text variant="micro" style={{ color: c.accentTint }}>
                {count > 99 ? '99+' : count}
              </Text>
            </View>
          )}
        </Pressable>
      </View>

      {q.isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.title ?? '__rest'}
          contentContainerStyle={products.length ? { paddingBottom: 40 } : styles.emptyWrap}
          refreshControl={
            <RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={c.t3} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="storefront-outline" size={44} color={c.t4} />
              <Text variant="title" tone="t2" style={{ marginTop: 12 }}>Nothing for sale yet</Text>
            </View>
          }
          renderItem={({ item: g }) => (
            <View>
              {sectioned && (
                <Text variant="headline" style={styles.section}>
                  {g.title ?? 'Everything else'}
                </Text>
              )}
              {g.items.map((p) => <ListingCard key={p.id} listing={p} />)}
            </View>
          )}
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
  badge: {
    position: 'absolute', top: 4, right: 2,
    minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyWrap: { flexGrow: 1 },
  section: {
    marginHorizontal: spacing.gutter, marginTop: 18, marginBottom: 8,
  },
});
