import { useEffect, useMemo, useRef, useState } from 'react';
import { View, FlatList, RefreshControl, ActivityIndicator, Pressable, StyleSheet, type NativeSyntheticEvent, type NativeScrollEvent, ScrollView } from 'react-native';
import { withTiming } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { PostCard } from '@/components/PostCard';
import { StoriesTray } from '@/components/StoriesTray';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { useInfiniteFeed, type FeedScope, type Post } from '@/api/social';
import { useAppReady } from '@/lib/appReady';
import { useNavMorph } from '@/lib/navMorph';

// The same four the web Home has, in the same order.
const TABS: { key: FeedScope; label: string }[] = [
  { key: 'foryou', label: 'For You' },
  { key: 'following', label: 'Following' },
  { key: 'circles', label: 'Circles' },
  { key: 'bookmarks', label: 'Collections' },
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

  // Tell the opening splash the feed is ready the moment the first page settles
  // (success or error), so it zoom-reveals straight into the posts.
  const { markFeedReady } = useAppReady();
  useEffect(() => {
    if (!isLoading) markFeedReady();
  }, [isLoading, markFeedReady]);

  // Scroll-morph: drive the bottom tab bar (bar ⇄ "+" ball) by scroll direction.
  const morph = useNavMorph();
  const lastY = useRef(0);
  const ballRef = useRef(false);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!morph) return;
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastY.current;
    lastY.current = y;
    let next = ballRef.current;
    if (y <= 40) next = false;
    else if (dy > 4) next = true;
    else if (dy < -4) next = false;
    if (next !== ballRef.current) {
      ballRef.current = next;
      morph.setBall(next);
      morph.collapsed.value = withTiming(next ? 1 : 0, { duration: next ? 340 : 300 });
    }
  };

  return (
    <Screen edges={['top']}>
      {/* Header: feed tabs + notifications bell */}
      <View style={[styles.headerRow, { borderBottomColor: c.border }]}>
        {/* The row scrolls, so at rest the last label is CUT — and a word chopped
            mid-letter reads as broken rather than as "there is more". The web
            solves it with a soft fade at the edge; so does this. */}
        <View style={styles.tabsWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}
        >
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
        </ScrollView>
        <LinearGradient
          pointerEvents="none"
          colors={[c.bg + '00', c.bg]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.tabsFade}
        />
        </View>
        {/* Right actions: the compose "+" (a clean plus, X/web-style).
            The notifications BELL used to sit here — it was the only way in before
            Notifications had a seat in the tab bar. It has one now, and it carries the
            unread dot, so a bell here would be the same thing on screen twice. */}
        <View style={styles.headActions}>
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
          onScroll={onScroll}
          scrollEventThrottle={16}
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
    // the app's ONE margin, so the tab row starts on the same line as the cards below
    paddingHorizontal: spacing.gutter,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabsWrap: { flexShrink: 1, position: 'relative' },
  tabsFade: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 26 },
  tabs: { flexDirection: 'row', gap: 24, alignItems: 'flex-end', paddingRight: 8 },
  tab: { alignItems: 'center' },
  headActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headBtn: { padding: 2 },
  underline: {
    height: 3,
    borderRadius: 2,
    alignSelf: 'stretch',
    marginTop: 8,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyWrap: { flexGrow: 1 },
});
