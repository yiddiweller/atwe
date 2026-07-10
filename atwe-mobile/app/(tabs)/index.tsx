import { useState } from 'react';
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
  const router = useRouter();
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
          ListHeaderComponent={<StoriesTray />}
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

      {/* Compose FAB — the one white action (blueprint §10): 56px white disc, dark +. */}
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          router.push('/compose');
        }}
        style={({ pressed }) => [
          styles.fab,
          { backgroundColor: c.primary },
          pressed && { transform: [{ scale: 0.94 }] },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Create a post"
      >
        <Ionicons name="add" size={30} color={c.onPrimary} />
      </Pressable>
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
  fab: {
    position: 'absolute',
    right: 18,
    bottom: 96,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
});
