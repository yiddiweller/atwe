import { useState } from 'react';
import {
  View, FlatList, Pressable, ActivityIndicator, RefreshControl, StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { PageHeader } from '@/components/PageHeader';
import { chromePad } from '@/components/Chrome';
import { Shelf } from '@/components/Shelf';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { useNewsletters, priceOrFree, type Newsletter, type NewsletterScope } from '@/api/discover';
import { mediaUri } from '@/lib/media';
import { compact } from '@/lib/format';

const SHELVES: { key: NewsletterScope; label: string }[] = [
  { key: 'discover', label: 'Discover' },
  { key: 'subscribed', label: 'Subscribed' },
  { key: 'mine', label: 'Mine' },
];

/** Newsletters people write, and the ones you read. */
export default function Newsletters() {
  const { c } = useTheme();
  const [scope, setScope] = useState<NewsletterScope>('discover');
  const { data, isLoading, isError, refetch, isRefetching } = useNewsletters(scope);
  const list = data?.newsletters ?? [];

  return (
    <Screen edges={[]}>
      <PageHeader title="Newsletters"
        below={<Shelf options={SHELVES} value={scope} onChange={setScope} />}
      />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : isError ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">Couldn't load newsletters.</Text>
          <View style={{ height: 14 }} />
          <Button title="Try again" kind="secondary" onPress={() => refetch()} />
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(n) => String(n.id)}
          renderItem={({ item }) => <Card n={item} />}
          contentContainerStyle={[list.length ? { paddingBottom: 120 } : styles.emptyWrap, chromePad.headerShelf]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.t3} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text variant="title" tone="t2">
                {scope === 'subscribed' ? 'Nothing subscribed'
                  : scope === 'mine' ? 'You haven’t written one'
                  : 'None yet'}
              </Text>
              <Text variant="body" tone="t3" style={{ marginTop: 6, textAlign: 'center' }}>
                {scope === 'subscribed' ? 'Newsletters you follow land here.'
                  : scope === 'mine' ? 'Write regularly to the people who follow you.'
                  : 'When somebody starts one, it shows here.'}
              </Text>
            </View>
          }
        />
      )}
    </Screen>
  );
}

function Card({ n }: { n: Newsletter }) {
  const { c, radius } = useTheme();
  const router = useRouter();
  const cover = mediaUri(n.cover);
  const o = n.owner;
  return (
    <Pressable
      onPress={() => router.push(`/newsletter/${n.id}`)}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: c.s1, borderRadius: radius.card, borderColor: c.border },
        pressed && { opacity: 0.9 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={n.title}
    >
      {!!cover && (
        <Image source={{ uri: cover }} style={[styles.cover, { backgroundColor: c.s2 }]}
          contentFit="cover" transition={120} />
      )}
      <View style={styles.body}>
        <Text variant="headline" numberOfLines={2}>{n.title}</Text>
        {!!n.description && (
          <Text variant="caption" tone="t2" numberOfLines={2} style={{ marginTop: 4, lineHeight: 18 }}>
            {n.description}
          </Text>
        )}
        <View style={styles.who}>
          <Avatar name={o.name} avatar={o.avatar} biz={o.business} size={22} />
          <Text variant="caption" tone="t3" numberOfLines={1} style={{ flexShrink: 1 }}>{o.name}</Text>
          {o.verified && <VerifiedBadge size={12} />}
          <Text variant="micro" tone="t3" style={{ marginLeft: 'auto' }}>
            {compact(n.subscribers)} reader{n.subscribers === 1 ? '' : 's'} · {n.issues} issue{n.issues === 1 ? '' : 's'}
          </Text>
        </View>
        <View style={styles.tags}>
          {n.priceCents > 0 && (
            <View style={[styles.tag, { backgroundColor: c.s2 }]}>
              <Text variant="micro" tone="t2">{priceOrFree(n.priceCents)}/mo</Text>
            </View>
          )}
          {n.subscribed && (
            <View style={[styles.tag, { backgroundColor: c.s2 }]}>
              <Text variant="micro" style={{ color: c.success }}>Subscribed</Text>
            </View>
          )}
          {n.locked && (
            <View style={[styles.tag, { backgroundColor: c.s2 }]}>
              <Ionicons name="lock-closed" size={10} color={c.t3} />
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyWrap: { flexGrow: 1 },
  card: {
    marginHorizontal: spacing.gutter, marginBottom: 14,
    borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden',
  },
  cover: { width: '100%', aspectRatio: 2.4 },
  body: { padding: 12 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  tags: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  tag: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, flexDirection: 'row', alignItems: 'center', gap: 4 },
});
