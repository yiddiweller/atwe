import { useEffect, useMemo, useState } from 'react';
import { View, FlatList, RefreshControl, ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { PostCard } from '@/components/PostCard';
import { StoriesTray } from '@/components/StoriesTray';
import { useTheme } from '@/theme/ThemeProvider';
import { useInfiniteFeed, type FeedScope, type Post } from '@/api/social';
import { useNotifCount } from '@/api/notifications';
import { useAppReady } from '@/lib/appReady';

const TABS: { key: FeedScope; label: string }[] = [
  { key: 'foryou', label: 'For You' },
  { key: 'following', label: 'Following' },
];

/**
 * Home — the business feed. For You (ranked) / Following (chronological),
 * over the live /api/social/feed. X-style cards, pull-to-refresh, and clean
 * loading / empty / error states.
 */
export default function Home() {
  const { c } = useTheme();
  const router = useRouter();
  const [scope, setScope] = useState<FeedScope>('foryou');
  const {
    data,
    isLoading,
    isError,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteFeed(scope);
  // Flatten pages, de-duping ids in case the same post appears across batches.
  const posts = useMemo(() => {
    const seen = new Set<number>();
    const out: Post[] = [];
    for (const page of data?.pages ?? []) {
      for (const p of page.posts) {
        if (!seen.has(p.id)) {
          seen.add(p.id);
          out.push(p);
        }
      }
    }
    return out;
  }, [data]);
  const { data: nc } = useNotifCount();
  const unread = nc?.unread ?? 0;

  // Tell the opening splash the feed is ready the moment the first page settles
  // (success or error), so it zoom-reveals straight into the posts.
  const { markFeedReady } = useAppReady();
  useEffect(() => {
    if (!isLoading) markFeedReady();
  }, [isLoading, markFeedReady]);

  return (
    <Screen edges={['top']}>
      {/* Header: feed tabs + notifications bell */}
      <View style={[styles.headerRow, { borderBottomColor: c.border }]}>
        <View style={styles.tabs}>
          {TABS.map((t) => {
            const active = scope === t.key;
            return (
              <Pressable key={t.key} onPress={() => setScope(t.key)} style={styles.tab} hitSlop={8}>
                <Text variant="headline" style={{ color: active ? c.text : c.t3 }}>
                  {t.label}
                </Text>
                {active && <View style={[styles.underline, { backgroundColor: c.accent }]} />}
              </Pressable>
            );
          })}
        </View>
        {/* Right actions: notifications bell + top-right compose "+" (replaces the
            old floating FAB; a clean plus, X/web-style). */}
        <View style={styles.headActions}>
          <Pressable
            onPress={() => router.push('/notifications')}
            hitSlop={8}
            style={styles.headBtn}
            accessibilityLabel="Notifications"
          >
            <Ionicons name="notifications-outline" size={24} color={c.text} />
            {unread > 0 && <View style={[styles.bellDot, { backgroundColor: c.accent, borderColor: c.bg }]} />}
          </Pressable>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              router.push('/compose');
            }}
            hitSlop={8}
            style={styles.headBtn}
            accessibilityLabel="Create a post"
          >
            <Ionicons name="add" size={30} color={c.text} />
          </Pressable>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.accent} />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">
            Couldn't load your feed.
          </Text>
          <View style={{ height: 14 }} />
          <Button title="Try again" kind="secondary" onPress={() => refetch()} />
        </View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(p) => String(p.id)}
          renderItem={({ item }) => <PostCard post={item} />}
          ListHeaderComponent={<StoriesTray />}
          contentContainerStyle={posts.length ? { paddingBottom: 120 } : styles.emptyWrap}
          showsVerticalScrollIndicator={false}
          onEndReachedThreshold={0.6}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }}
          ListFooterComponent={
            isFetchingNextPage ? (
              <View style={{ paddingVertical: 20 }}>
                <ActivityIndicator color={c.t3} />
              </View>
            ) : null
          }
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.t3} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text variant="title" tone="t2">
                Nothing here yet
              </Text>
              <Text variant="body" tone="t3" style={{ marginTop: 6, textAlign: 'center' }}>
                Follow people and businesses to fill your feed.
              </Text>
            </View>
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabs: { flexDirection: 'row', gap: 28 },
  tab: { alignItems: 'center' },
  headActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headBtn: { padding: 2 },
  bellDot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
  },
  underline: {
    height: 3,
    borderRadius: 2,
    alignSelf: 'stretch',
    marginTop: 8,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyWrap: { flexGrow: 1 },
});
