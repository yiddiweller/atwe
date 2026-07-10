import { useState } from 'react';
import { View, FlatList, RefreshControl, ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { PostCard } from '@/components/PostCard';
import { useTheme } from '@/theme/ThemeProvider';
import { useFeed, type FeedScope } from '@/api/social';

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
  const [scope, setScope] = useState<FeedScope>('foryou');
  const { data, isLoading, isError, refetch, isRefetching } = useFeed(scope);
  const posts = data?.posts ?? [];

  return (
    <Screen edges={['top']}>
      {/* Feed tabs */}
      <View style={[styles.tabs, { borderBottomColor: c.border }]}>
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
          contentContainerStyle={posts.length ? { paddingBottom: 120 } : styles.emptyWrap}
          showsVerticalScrollIndicator={false}
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
  tabs: {
    flexDirection: 'row',
    gap: 28,
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: { alignItems: 'center' },
  underline: {
    height: 3,
    borderRadius: 2,
    alignSelf: 'stretch',
    marginTop: 8,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyWrap: { flexGrow: 1 },
});
