import { useEffect, useMemo, useRef, useState } from 'react';
import { View, FlatList, RefreshControl, ActivityIndicator, Pressable, StyleSheet, type NativeSyntheticEvent, type NativeScrollEvent, ScrollView } from 'react-native';
import { withTiming } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '@/components/Text';
import { Sidebar } from '@/components/Sidebar';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { PostCard } from '@/components/PostCard';
import { StoriesTray } from '@/components/StoriesTray';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { useInfiniteFeed, type FeedScope, type Post } from '@/api/social';
import { useAppReady } from '@/lib/appReady';
import { useNavMorph } from '@/lib/navMorph';
import { useChromeRetract } from '@/lib/chromeRetract';
import { haptics } from '@/lib/haptics';
import { FeedTab } from '@/components/FeedTab';
import { BrandBar } from '@/components/BrandBar';
import { ChromeBar, FEED_TABS_H, useFloatingChrome, BRAND_BAR_H } from '@/components/Chrome';

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
  /* The top chrome gets out of the way as you scroll, so the feed gets the
     whole screen — the counterpart to iOS taking the tab bar at the bottom. */
  const chrome = useChromeRetract();
  /* The bar hands down its own measured height — see `useFloatingChrome`.
     The estimate keeps the first frame right so nothing jumps. */
  const bar = useFloatingChrome(BRAND_BAR_H + FEED_TABS_H);
  const [menu, setMenu] = useState(false);
  const morph = useNavMorph();
  const lastY = useRef(0);
  const ballRef = useRef(false);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    chrome.onScroll(e);
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
    <Screen edges={[]}>
      {/* ONE list, always mounted. iOS finds a tab's scroll view once and then
          minimises the bar against it — swapping the list out for a spinner
          while the first page loads means there is nothing to find, which is
          why Home and Beam were the two worlds where the bar never shrank.
          Loading and error live in the list's own empty slot instead. */}
      <FlatList
          data={posts}
          keyExtractor={(p) => String(p.id)}
          renderItem={({ item }) => <PostCard post={item} />}
          ListHeaderComponent={<StoriesTray />}
          contentContainerStyle={[posts.length ? { paddingBottom: 120 } : styles.emptyWrap, bar.pad]}
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
              {isLoading ? <ActivityIndicator color={c.accent} /> : isError ? (
                <>
                  <Text variant="body" tone="t2">Couldn't load your feed.</Text>
                  <View style={{ height: 14 }} />
                  <Button title="Try again" kind="secondary" onPress={() => refetch()} />
                </>
              ) : (
                <>
                  <Text variant="title" tone="t2">Nothing here yet</Text>
                  <Text variant="body" tone="t3" style={{ marginTop: 6, textAlign: 'center' }}>
                    Follow people and businesses to fill your feed.
                  </Text>
                </>
              )}
            </View>
          }
        />

      {/* The bar FLOATS over the feed and the posts travel under it, showing
          through blurred — see `Chrome.tsx`. The brand row sits ABOVE the tabs, exactly as the web has it: the mark
          and the wordmark on the left, ＋ · ⋯ · your photo on the right. */}
      <ChromeBar retract={chrome.hidden} onLayout={bar.onLayout}>
      <BrandBar
        world="home"
        /* No ＋ here — the founder asked for it gone. Its four destinations
           moved into the ⋯ menu rather than disappearing with it, and they lead
           because making something is what people come to Home to do. The tab
           row's quiet "Add" still goes straight to the composer. */
        moreMenu={[
          { label: 'New post', icon: 'create-outline', onPress: () => router.push('/compose') },
          { label: 'New story', icon: 'add-circle-outline', onPress: () => router.push('/add-story') },
          { label: 'Sell an item', icon: 'pricetag-outline', onPress: () => router.push('/sell') },
          { label: 'Post a job', icon: 'briefcase-outline', onPress: () => router.push('/post-job') },
          { label: 'Saved', icon: 'bookmark-outline', onPress: () => router.push('/starred') },
          { label: 'Settings', icon: 'settings-outline', onPress: () => router.push('/settings') },
          { label: 'Help & feedback', icon: 'help-circle-outline', onPress: () => router.push('/feedback') },
        ]}
      />

      {/* Header: feed tabs */}
      <View style={styles.headerRow}>
        {/* The row scrolls, so at rest the last label is CUT — and a word chopped
            mid-letter reads as broken rather than as "there is more". The web
            solves it with a soft fade at the edge; so does this. */}
        <View style={styles.tabsWrap}>
          {/* The web's own mobile pattern: the tab row LEADS with the menu.
              Here rather than as a third button beside the ⋯ and the photo —
              the founder has just had the ＋ removed from that cluster and
              putting another one back would undo the point of it. */}
          <Pressable
            onPress={() => { haptics.tap(); setMenu(true); }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Menu"
            style={styles.menuBtn}
          >
            <Ionicons name="menu" size={24} color={c.text} />
          </Pressable>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}
        >
          {TABS.map((t) => (
            <FeedTab
              key={t.key}
              label={t.label}
              active={scope === t.key}
              onPress={() => setScope(t.key)}
            />
          ))}
          {/* The row ends with the WORD "Add", not a "+" icon — the web's own
              rule, and it is not decoration. A pinned + on the right sat on top
              of the last tab and chopped "Collections" mid-word. As the row's
              last scrolling child it clears the tabs instead, and it is one step
              quieter than a tab label (t3, not t2) so it reads as an extra
              action rather than as a fifth tab. Its accessible name starts with
              the visible word, which is what WCAG "Label in Name" asks for. */}
          <Pressable
            onPress={() => { haptics.tap(); router.push('/compose'); }}
            /* The word draws 29x21; Apple's floor is 44. Slop is invisible, so
               the target clears it without the label growing into a fifth tab. */
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Add a new post"
          >
            <Text tone="t3" style={styles.addWord}>Add</Text>
          </Pressable>
        </ScrollView>
        <LinearGradient
          pointerEvents="none"
          colors={[c.bg + '00', c.bg]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.tabsFade}
        />
        </View>
      </View>
      </ChromeBar>

      <Sidebar visible={menu} onClose={() => setMenu(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // Pinned, so the floating bar's height is known before it renders.
    height: FEED_TABS_H,
    // the app's ONE margin, so the tab row starts on the same line as the cards below
    paddingHorizontal: spacing.gutter,
    paddingBottom: 10,
    /* No hairline: chrome has no edge — the content dissolves under it. */
  },
  menuBtn: { paddingLeft: spacing.gutter, paddingRight: 10 },
  /* A ROW: the ≡ leads it and the scrolling tabs take the rest. It was
     `position:relative` only, so the ≡ stacked above the tabs instead of
     sitting beside them and landed mid-screen. */
  tabsWrap: { flexShrink: 1, position: 'relative', flexDirection: 'row', alignItems: 'center' },
  tabsFade: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 40 },
  /* The web's tab row is roomy (gap 34 on a phone) and the last word must be
     able to scroll clear of the + rather than sit permanently half-eaten. */
  tabs: { flexDirection: 'row', gap: 30, alignItems: 'center', paddingRight: 8 },
  /* Same size and weight as a tab label, so the row stays even; the colour is
     what makes it quieter. */
  addWord: { fontSize: 15, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyWrap: { flexGrow: 1 },
});
