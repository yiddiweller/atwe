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
import { useMarketplace, KIND_LABEL, type ListingKind } from '@/api/marketplace';

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

  return (
    <Screen edges={['top']}>
      {/* Header */}
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={c.text} />
        </Pressable>
        <Text variant="headline">Marketplace</Text>
        <View style={styles.back} />
      </View>

      {/* Search */}
      <View style={{ paddingHorizontal: 16 }}>
        <View style={[styles.search, { backgroundColor: c.s2 }]}>
          <Ionicons name="search" size={18} color={c.t3} />
          <TextInput
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
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingVertical: 12 }}
        style={{ flexGrow: 0 }}
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
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyWrap: { flexGrow: 1 },
});
