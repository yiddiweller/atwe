import { useEffect, useState } from 'react';
import {
  View,
  ScrollView,
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
import { Avatar } from '@/components/Avatar';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { useTheme } from '@/theme/ThemeProvider';
import {
  useTrending,
  useSuggestions,
  useSearchPeople,
  followUser,
  type SuggestUser,
  type SearchUser,
} from '@/api/social';
import { compact } from '@/lib/format';

/**
 * Engine — discovery & explore. A search field over `GET /api/search?scope=people`
 * on top of the web Search page's empty state (`acSearchDiscover`): Trending +
 * Who to follow. More scopes (shop / jobs / posts) come in later slices.
 */
export default function Engine() {
  const { c, spacing } = useTheme();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState(''); // debounced
  useEffect(() => {
    const t = setTimeout(() => setDq(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <Screen edges={['top']}>
      {/* Search bar */}
      <View style={styles.searchWrap}>
        <View style={[styles.search, { backgroundColor: c.s2 }]}>
          <Ionicons name="search" size={18} color={c.t3} />
          <TextInput
            style={[styles.searchInput, { color: c.text }]}
            placeholder="Search people"
            placeholderTextColor={c.t3}
            value={q}
            onChangeText={setQ}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search"
          />
          {q.length > 0 && (
            <Pressable onPress={() => setQ('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={c.t3} />
            </Pressable>
          )}
        </View>
      </View>

      {dq.trim() ? <SearchResults q={dq} /> : <Explore spacing={spacing} />}
    </Screen>
  );
}

function SearchResults({ q }: { q: string }) {
  const { c } = useTheme();
  const { data, isLoading, isError } = useSearchPeople(q);
  const users = data?.users ?? [];

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }
  if (isError) {
    return (
      <View style={styles.center}>
        <Text variant="body" tone="t2">
          Search failed. Try again.
        </Text>
      </View>
    );
  }
  return (
    <FlatList
      data={users}
      keyExtractor={(u) => String(u.id)}
      renderItem={({ item }) => <PersonRow user={item} />}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={users.length ? { paddingBottom: 120 } : styles.emptyWrap}
      ListEmptyComponent={
        <View style={styles.center}>
          <Text variant="body" tone="t3">
            No people found for “{q}”.
          </Text>
        </View>
      }
    />
  );
}

function PersonRow({ user }: { user: SearchUser }) {
  const { c } = useTheme();
  const router = useRouter();
  const biz = user.accountType === 'business';
  return (
    <Pressable
      onPress={() => user.username && router.push(`/user/${user.username}`)}
      style={({ pressed }) => [
        styles.personRow,
        { borderBottomColor: c.border },
        pressed && { backgroundColor: c.s1 },
      ]}
    >
      <Avatar name={user.name} avatar={user.avatar} biz={biz} size={46} />
      <View style={styles.personMid}>
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
      </View>
    </Pressable>
  );
}

function Explore({ spacing }: { spacing: ReturnType<typeof useTheme>['spacing'] }) {
  const { c } = useTheme();
  const trending = useTrending();
  const suggestions = useSuggestions();
  const loading = trending.isLoading || suggestions.isLoading;
  const trends = trending.data?.trends ?? [];
  const people = suggestions.data?.users ?? [];
  const refresh = () => {
    trending.refetch();
    suggestions.refetch();
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: 120 }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={trending.isRefetching || suggestions.isRefetching}
          onRefresh={refresh}
          tintColor={c.t3}
        />
      }
    >
      {trends.length > 0 && (
        <View style={{ paddingTop: spacing.sm }}>
          <Text variant="headline" style={styles.sectionTitle}>
            Trending
          </Text>
          {trends.map((t, i) => (
            <View key={t.tag} style={[styles.trendRow, { borderBottomColor: c.border }]}>
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

  return (
    <Pressable
      onPress={() => user.username && router.push(`/user/${user.username}`)}
      style={({ pressed }) => [
        styles.personRow,
        { borderBottomColor: c.border },
        pressed && { backgroundColor: c.s1 },
      ]}
    >
      <Avatar name={user.name} avatar={user.avatar} biz={biz} size={48} />
      <View style={styles.personMid}>
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
  searchWrap: { paddingHorizontal: 12, paddingBottom: 10 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 40,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, minHeight: 200 },
  emptyWrap: { flexGrow: 1 },
  sectionTitle: { paddingHorizontal: 16, marginBottom: 6, fontSize: 20 },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  personMid: { flex: 1, marginLeft: 12, marginRight: 10 },
  nameLine: { flexDirection: 'row', alignItems: 'center' },
  followBtn: { minHeight: 34, paddingHorizontal: 18 },
});
