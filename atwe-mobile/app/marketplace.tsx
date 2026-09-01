import { useEffect, useState } from 'react';
import {
  View,
  FlatList,
  Pressable,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { ListingCard } from '@/components/ListingCard';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, radius } from '@/theme/tokens';
import { useMarketplace, KIND_LABEL, type ListingKind } from '@/api/marketplace';
import { useCart, cartCount } from '@/api/cart';
import { HapticInput } from '@/components/HapticInput';

const KINDS: (ListingKind | null)[] = [null, 'physical', 'digital', 'service', 'rental'];

/**
 * Marketplace — browse & search listings (`GET /api/marketplace`). Mirrors the
 * web `acOpenMarketplace`: a search field, kind tabs, and post-style listing
 * cards that open the detail. Best-Match ranking + Sponsored slots are the
 * server's job; the client just renders what it serves.
 */
export default function Marketplace() {
  const { c } = useTheme();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [kind, setKind] = useState<ListingKind | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isLoading, isError, refetch, isRefetching } = useMarketplace(dq, kind);
  const listings = data?.listings ?? [];
  const count = cartCount(useCart().data?.carts);

  return (
    <Screen edges={['top']}>
      {/* Header */}
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={c.text} />
        </Pressable>
        <Text variant="headline">Marketplace</Text>
        <Pressable onPress={() => router.push('/cart')} hitSlop={10} style={styles.back}
          accessibilityRole="button"
          accessibilityLabel={count ? `Cart, ${count} item${count === 1 ? '' : 's'}` : 'Cart'}>
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

      {/* Search */}
      <View style={{ paddingHorizontal: spacing.gutter }}>
        <View style={[styles.search, { backgroundColor: c.s2 }]}>
          <Ionicons name="search" size={18} color={c.t3} />
          <HapticInput
            value={q}
            onChangeText={setQ}
            placeholder="Search products & services"
            placeholderTextColor={c.t3}
            style={[styles.searchInput, { color: c.text }]}
            returnKeyType="search"
            autoCorrect={false}
            accessibilityLabel="Search the marketplace"
          />
          {q.length > 0 && (
            <Pressable onPress={() => setQ('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={c.t3} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Kind tabs */}
      <FlatList
        horizontal
        data={KINDS}
        keyExtractor={(k) => k ?? 'all'}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: spacing.gutter, gap: 8, paddingVertical: 12 }}
        style={styles.rowStrip}
        renderItem={({ item }) => {
          const active = kind === item;
          return (
            <Pressable
              onPress={() => setKind(item)}
              style={[
                styles.chip,
                { backgroundColor: active ? c.primary : c.s2 },
              ]}
            >
              <Text variant="callout" style={{ color: active ? c.onPrimary : c.t2 }}>
                {item ? KIND_LABEL[item] : 'All'}
              </Text>
            </Pressable>
          );
        }}
      />

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.accent} />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">Couldn't load the marketplace.</Text>
          <View style={{ height: 14 }} />
          <Button title="Try again" kind="secondary" onPress={() => refetch()} />
        </View>
      ) : (
        <FlatList
          data={listings}
          keyExtractor={(l) => String(l.id)}
          renderItem={({ item }) => <ListingCard listing={item} />}
          contentContainerStyle={listings.length ? { paddingTop: 4, paddingBottom: 120 } : styles.emptyWrap}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.t3} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text variant="title" tone="t2">Nothing found</Text>
              <Text variant="body" tone="t3" style={{ marginTop: 6, textAlign: 'center' }}>
                {dq ? `No listings match "${dq}".` : 'No listings yet.'}
              </Text>
            </View>
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute', top: 4, right: 2,
    minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center',
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    height: 42,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  /* A horizontal strip in a flex column must be told NOT to shrink. `flexGrow:0`
     alone leaves flex-shrink at 1 on the web build, and the list below it took
     the space: the chips' own 8px padding was squashed away and two stacked
     rows visibly overlapped. Measured 24.3px tall against 35px of content. */
  rowStrip: { flexGrow: 0, flexShrink: 0 },
  chip: { paddingHorizontal: spacing.gutter, paddingVertical: 8, borderRadius: 999 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyWrap: { flexGrow: 1 },
});
