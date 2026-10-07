import { View, FlatList, Pressable, ActivityIndicator, RefreshControl, useWindowDimensions, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { PageHeader } from '@/components/PageHeader';
import { chromePad } from '@/components/Chrome';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { useShowcases, type Showcase } from '@/api/discover';
import { mediaUri } from '@/lib/media';
import { compact } from '@/lib/format';

/**
 * Showcase — work people are proud of. A two-up grid, because these are pictures
 * first and a full-width card would show four of them a screen instead of eight.
 * Popularity-ranked by the server.
 */
export default function ShowcaseDiscover() {
  const { c } = useTheme();
  const { width } = useWindowDimensions();
  const { data, isLoading, isError, refetch, isRefetching } = useShowcases();
  const items = data?.showcases ?? [];
  const cell = (width - spacing.gutter * 2 - 12) / 2;

  return (
    <Screen edges={[]}>
      <PageHeader title="Showcase" />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : isError ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">Couldn't load the showcase.</Text>
          <View style={{ height: 14 }} />
          <Button title="Try again" kind="secondary" onPress={() => refetch()} />
        </View>
      ) : (
        <FlatList
          data={items}
          numColumns={2}
          keyExtractor={(s) => String(s.id)}
          columnWrapperStyle={{ gap: 12, paddingHorizontal: spacing.gutter }}
          contentContainerStyle={[items.length ? { gap: 12, paddingBottom: 120 } : styles.emptyWrap, chromePad.header]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.t3} />}
          renderItem={({ item }) => <Tile s={item} size={cell} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text variant="title" tone="t2">Nothing shown yet</Text>
              <Text variant="body" tone="t3" style={{ marginTop: 6, textAlign: 'center' }}>
                Work people are proud of turns up here — a project, a product, anything.
              </Text>
            </View>
          }
        />
      )}
    </Screen>
  );
}

function Tile({ s, size }: { s: Showcase; size: number }) {
  const { c, radius } = useTheme();
  const router = useRouter();
  const cover = mediaUri(s.images[0]);
  return (
    <Pressable
      onPress={() => router.push(`/showcase/${s.id}`)}
      style={({ pressed }) => [{ width: size }, pressed && { opacity: 0.9 }]}
      accessibilityRole="button"
      accessibilityLabel={s.title}
    >
      <View style={[styles.cover, { width: size, height: size, backgroundColor: c.s2, borderRadius: radius.lg }]}>
        {cover ? (
          <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} />
        ) : (
          <Ionicons name="image-outline" size={28} color={c.t3} />
        )}
      </View>
      <Text variant="callout" weight="700" numberOfLines={2} style={{ marginTop: 6 }}>{s.title}</Text>
      <View style={styles.meta}>
        <Text variant="micro" tone="t3" numberOfLines={1} style={{ flexShrink: 1 }}>
          {s.author.name}
        </Text>
        {s.likes > 0 && (
          <>
            <Ionicons name="heart" size={11} color={c.like} />
            <Text variant="micro" tone="t3">{compact(s.likes)}</Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyWrap: { flexGrow: 1 },
  cover: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
});
