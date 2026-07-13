import { useState } from 'react';
import { View, ScrollView, Pressable, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { useTheme } from '@/theme/ThemeProvider';
import { useTrending, useSuggestions, followUser, type SuggestUser } from '@/api/social';
import { compact } from '@/lib/format';

/**
 * Engine — discovery & explore. Mirrors the web Search page's empty state
 * (`acSearchDiscover`): Trending topics + a Who-to-follow list. Full search
 * (people / shop / jobs / posts scopes over /api/search) is the next slice.
 */
export default function Engine() {
  const { c, spacing } = useTheme();
  const trending = useTrending();
  const suggestions = useSuggestions();
  const loading = trending.isLoading || suggestions.isLoading;
  const trends = trending.data?.trends ?? [];
  const people = suggestions.data?.users ?? [];

  const refresh = () => {
    trending.refetch();
    suggestions.refetch();
  };

  return (
    <Screen edges={['top']}>
      <View style={[styles.head, { borderBottomColor: c.border }]}>
        <Text variant="title">Explore</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.accent} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={trending.isRefetching || suggestions.isRefetching}
              onRefresh={refresh}
              tintColor={c.t3}
            />
          }
        >
          {/* Trending */}
          {trends.length > 0 && (
            <View style={{ paddingTop: spacing.md }}>
              <Text variant="headline" style={styles.sectionTitle}>
                Trending
              </Text>
              {trends.map((t, i) => (
                <View
                  key={t.tag}
                  style={[styles.trendRow, { borderBottomColor: c.border }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text variant="micro" tone="t3">
                      {i + 1} · Trending
                    </Text>
                    <Text variant="headline" style={{ color: c.accent, marginTop: 1 }}>
                      #{t.tag}
                    </Text>
                    <Text variant="caption" tone="t3" style={{ marginTop: 1 }}>
                      {compact(t.count)} {t.count === 1 ? 'post' : 'posts'}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Who to follow */}
          {people.length > 0 && (
            <View style={{ paddingTop: spacing.xl }}>
              <Text variant="headline" style={styles.sectionTitle}>
                Who to follow
              </Text>
              {people.map((p) => (
                <SuggestRow key={p.id} user={p} />
              ))}
            </View>
          )}

          {trends.length === 0 && people.length === 0 && (
            <View style={styles.center}>
              <Ionicons name="search" size={40} color={c.t3} />
              <Text variant="body" tone="t2" style={{ marginTop: 10, textAlign: 'center' }}>
                Nothing to explore yet — check back as Atwe grows.
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

function SuggestRow({ user }: { user: SuggestUser }) {
  const { c } = useTheme();
  const router = useRouter();
  const biz = user.accountType === 'business';
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    const next = !following;
    setFollowing(next);
    setBusy(true);
    try {
      await followUser(user.id, next);
    } catch {
      setFollowing(!next);
    } finally {
      setBusy(false);
    }
  };

  const openProfile = () => {
    if (user.username) router.push(`/user/${user.username}`);
  };

  return (
    <Pressable
      onPress={openProfile}
      style={({ pressed }) => [
        styles.suggestRow,
        { borderBottomColor: c.border },
        pressed && { backgroundColor: c.s1 },
      ]}
    >
      <Avatar name={user.name} avatar={user.avatar} biz={biz} size={48} />
      <View style={styles.suggestMid}>
        <View style={styles.nameLine}>
          <Text variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>
            {user.name}
          </Text>
          {user.verified && <VerifiedBadge />}
        </View>
        {user.username && (
          <Text variant="caption" tone="t3" numberOfLines={1}>
            @{user.username}
          </Text>
        )}
        {!!user.headline && (
          <Text variant="caption" tone="t2" numberOfLines={1} style={{ marginTop: 1 }}>
            {user.headline}
          </Text>
        )}
        {user.mutuals > 0 && (
          <Text variant="micro" tone="t3" style={{ marginTop: 2 }}>
            {user.mutuals} mutual{user.mutuals === 1 ? '' : 's'}
          </Text>
        )}
      </View>
      <Button
        title={following ? 'Following' : 'Follow'}
        kind={following ? 'secondary' : 'primary'}
        loading={busy}
        onPress={toggle}
        style={styles.followBtn}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, minHeight: 200 },
  sectionTitle: { paddingHorizontal: 16, marginBottom: 6, fontSize: 20 },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  suggestMid: { flex: 1, marginLeft: 12, marginRight: 10 },
  nameLine: { flexDirection: 'row', alignItems: 'center' },
  followBtn: { minHeight: 34, paddingHorizontal: 18 },
});
