import { useState } from 'react';
import {
  View, FlatList, Pressable, ActivityIndicator, RefreshControl, Alert, StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { ListingForm } from '@/components/ListingForm';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { money } from '@/api/wallet';
import { useMyListings, updateListing, deleteListing } from '@/api/selling';
import { listingPrice, type Listing } from '@/api/marketplace';
import { mediaUri } from '@/lib/media';

/**
 * What you are selling.
 *
 * The owner's own list, which is a different payload from the public one: it
 * includes HIDDEN listings, because a seller who cannot see what they have
 * taken down cannot put it back. Each row shows what a seller actually checks —
 * price, whether it is live, and whether it has run out.
 */
export default function Sell() {
  const { c } = useTheme();
  const router = useRouter();
  const q = useMyListings();
  const products = q.data?.products ?? [];
  const [editing, setEditing] = useState<Listing | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);

  const toggleActive = async (p: Listing) => {
    setBusy(p.id);
    try {
      await updateListing(p.id, { active: !p.active });
      await q.refetch();
    } catch (e) {
      Alert.alert('Listing', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = (p: Listing) => {
    Alert.alert('Delete this listing?', `"${p.name}" will be gone for good. Orders already placed are not affected.`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          setBusy(p.id);
          try { await deleteListing(p.id); await q.refetch(); }
          catch (e) { Alert.alert('Listing', (e as Error).message); }
          finally { setBusy(null); }
        },
      },
    ]);
  };

  if (creating || editing) {
    return (
      <Screen edges={['top']}>
        <ListingForm
          listing={editing ?? undefined}
          onCancel={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); q.refetch(); }}
        />
      </Screen>
    );
  }

  return (
    <Screen edges={['top']}>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}
          accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={c.text} />
        </Pressable>
        <Text variant="headline">Your listings</Text>
        <Pressable onPress={() => router.push('/sales')} hitSlop={10} style={styles.back}
          accessibilityRole="button" accessibilityLabel="Sales">
          <Ionicons name="stats-chart-outline" size={21} color={c.text} />
        </Pressable>
      </View>

      {q.isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={(p) => String(p.id)}
          contentContainerStyle={products.length ? styles.body : styles.emptyWrap}
          refreshControl={
            <RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={c.t3} />
          }
          ListHeaderComponent={
            products.length ? (
              <Button title="Add a listing" kind="primary" onPress={() => setCreating(true)} />
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="pricetag-outline" size={44} color={c.t4} />
              <Text variant="title" tone="t2" style={{ marginTop: 12 }}>Nothing listed yet</Text>
              <Text variant="body" tone="t3" style={{ marginTop: 6, textAlign: 'center' }}>
                Put something up for sale and it appears in the marketplace.
              </Text>
              <View style={{ marginTop: 20, alignSelf: 'stretch' }}>
                <Button title="Add a listing" kind="primary" onPress={() => setCreating(true)} />
              </View>
            </View>
          }
          renderItem={({ item: p }) => (
            <View style={[styles.card, { backgroundColor: c.s1 }]}>
              <Pressable style={styles.row} onPress={() => router.push(`/listing/${p.id}`)}>
                {p.image ? (
                  <Image source={{ uri: mediaUri(p.image) }} style={styles.thumb} contentFit="cover" />
                ) : (
                  <View style={[styles.thumb, { backgroundColor: c.s2 }]} />
                )}
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text variant="headline" numberOfLines={2}>{p.name}</Text>
                  <Text variant="callout" tone="t2" style={{ marginTop: 2 }}>{listingPrice(p)}</Text>
                  <View style={styles.tags}>
                    {!p.active && <Tag label="Hidden" tone="t3" />}
                    {p.soldOut && <Tag label="Sold out" tone="danger" />}
                    {p.active && !p.soldOut && <Tag label="Live" tone="repost" />}
                    {typeof p.stock === 'number' && !p.soldOut && (
                      <Text variant="caption" tone="t3">{p.stock} left</Text>
                    )}
                  </View>
                </View>
              </Pressable>
              <View style={styles.actions}>
                <Pressable onPress={() => setEditing(p)} hitSlop={6}
                  accessibilityRole="button" accessibilityLabel={`Edit ${p.name}`}>
                  <Text variant="callout" style={{ color: c.accent }}>Edit</Text>
                </Pressable>
                <Pressable onPress={() => toggleActive(p)} hitSlop={6} disabled={busy === p.id}
                  accessibilityRole="button" accessibilityLabel={p.active ? 'Hide' : 'Show'}>
                  <Text variant="callout" style={{ color: c.t2 }}>
                    {p.active ? 'Hide' : 'Put back up'}
                  </Text>
                </Pressable>
                <View style={{ flex: 1 }} />
                <Pressable onPress={() => remove(p)} hitSlop={6} disabled={busy === p.id}
                  accessibilityRole="button" accessibilityLabel={`Delete ${p.name}`}>
                  <Text variant="callout" style={{ color: c.danger }}>Delete</Text>
                </Pressable>
              </View>
            </View>
          )}
        />
      )}
    </Screen>
  );
}

function Tag({ label, tone }: { label: string; tone: 't3' | 'danger' | 'repost' }) {
  const { c } = useTheme();
  const col = tone === 'danger' ? c.danger : tone === 'repost' ? c.repost : c.t3;
  return (
    <View style={[styles.tag, { backgroundColor: col + '22' }]}>
      <Text variant="micro" style={{ color: col }}>{label}</Text>
    </View>
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
  body: { padding: spacing.gutter, paddingBottom: 40, gap: 12 },
  card: { borderRadius: radius.card, padding: 12 },
  row: { flexDirection: 'row' },
  thumb: { width: 62, height: 62, borderRadius: radius.sm },
  tags: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  tag: { paddingHorizontal: 7, height: 19, borderRadius: 10, justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 12 },
});
