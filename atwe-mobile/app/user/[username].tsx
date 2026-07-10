import { useState } from 'react';
import { View, FlatList, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { PostCard } from '@/components/PostCard';
import { useTheme } from '@/theme/ThemeProvider';
import { useProfile, followUser, type Profile } from '@/api/social';
import { compact, monthYear } from '@/lib/format';

/**
 * A user's X-style profile — banner, overlapping avatar, identity, follow,
 * counts, then their posts. Opened by tapping a person anywhere in the feed
 * (see PostCard). Reuses PostCard for the timeline so cards stay consistent.
 * Phase 6 expands this into the full tabbed profile (Replies / About / Media).
 */
export default function UserProfile() {
  const { c } = useTheme();
  const router = useRouter();
  const { username } = useLocalSearchParams<{ username: string }>();
  const { data, isLoading, isError, refetch, isRefetching } = useProfile(username);

  return (
    <Screen edges={['top']}>
      {/* Floating back chevron (the stack hides its own header) */}
      <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
        <View style={[styles.backDisc, { backgroundColor: c.s1 }]}>
          <Ionicons name="chevron-back" size={22} color={c.text} />
        </View>
      </Pressable>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.accent} />
        </View>
      ) : isError || !data ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">
            Couldn't load this profile.
          </Text>
          <View style={{ height: 14 }} />
          <Button title="Try again" kind="secondary" onPress={() => refetch()} />
        </View>
      ) : (
        <FlatList
          data={data.posts}
          keyExtractor={(p) => String(p.id)}
          renderItem={({ item }) => <PostCard post={item} />}
          ListHeaderComponent={<ProfileHeader data={data} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text variant="body" tone="t3">
                No posts yet.
              </Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 120 }}
          onRefresh={refetch}
          refreshing={isRefetching}
        />
      )}
    </Screen>
  );
}

function ProfileHeader({ data }: { data: Profile }) {
  const { c, spacing } = useTheme();
  const { user, counts, isMe } = data;
  const biz = user.accountType === 'business';

  const [following, setFollowing] = useState(!!data.isFollowing);
  const [followers, setFollowers] = useState(counts.followers || 0);
  const [busy, setBusy] = useState(false);

  const toggleFollow = async () => {
    const next = !following;
    setFollowing(next);
    setFollowers((n) => Math.max(0, n + (next ? 1 : -1)));
    setBusy(true);
    try {
      await followUser(user.id, next);
    } catch {
      setFollowing(!next);
      setFollowers((n) => Math.max(0, n + (next ? -1 : 1)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      {/* Banner */}
      <View style={[styles.banner, { backgroundColor: c.s2 }]}>
        {user.banner ? (
          <Image source={{ uri: user.banner }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : null}
      </View>

      {/* Avatar + action row */}
      <View style={styles.identityRow}>
        <View style={[styles.avatarRing, { borderColor: c.bg, backgroundColor: c.bg }]}>
          <Avatar name={user.name} avatar={user.avatar} biz={biz} size={80} />
        </View>
        {!isMe && (
          <View style={styles.followWrap}>
            <Button
              title={following ? 'Following' : 'Follow'}
              kind={following ? 'secondary' : 'primary'}
              loading={busy}
              onPress={toggleFollow}
              style={styles.followBtn}
            />
          </View>
        )}
      </View>

      {/* Identity */}
      <View style={{ paddingHorizontal: spacing.lg }}>
        <View style={styles.nameLine}>
          <Text variant="title" numberOfLines={1}>
            {user.name}
          </Text>
          {user.verified && <VerifiedBadge size={18} />}
        </View>
        {user.username && (
          <Text variant="body" tone="t3">
            @{user.username}
          </Text>
        )}
        {!!user.headline && (
          <Text variant="callout" tone="t2" style={{ marginTop: 8 }}>
            {user.headline}
          </Text>
        )}
        {!!user.bio && (
          <Text variant="body" style={{ marginTop: 8 }}>
            {user.bio}
          </Text>
        )}

        {/* Meta row */}
        <View style={styles.metaRow}>
          {!!user.location && (
            <View style={styles.metaItem}>
              <Ionicons name="location-outline" size={15} color={c.t3} />
              <Text variant="caption" tone="t3" style={{ marginLeft: 4 }}>
                {user.location}
              </Text>
            </View>
          )}
          {!!user.joinedAt && (
            <View style={styles.metaItem}>
              <Ionicons name="calendar-outline" size={15} color={c.t3} />
              <Text variant="caption" tone="t3" style={{ marginLeft: 4 }}>
                Joined {monthYear(user.joinedAt)}
              </Text>
            </View>
          )}
        </View>

        {/* Counts */}
        <View style={styles.counts}>
          <Count n={counts.following} label="Following" c={c} />
          <Count n={followers} label="Followers" c={c} />
          <Count n={counts.posts} label="Posts" c={c} />
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: c.border }]} />
    </View>
  );
}

function Count({
  n,
  label,
  c,
}: {
  n: number;
  label: string;
  c: ReturnType<typeof useTheme>['c'];
}) {
  return (
    <View style={styles.count}>
      <Text variant="headline">{compact(n)}</Text>
      <Text variant="caption" tone="t3" style={{ marginLeft: 4 }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  empty: { padding: 32, alignItems: 'center' },
  back: { position: 'absolute', top: 8, left: 12, zIndex: 10 },
  backDisc: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  banner: { height: 120, width: '100%' },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginTop: -40,
  },
  avatarRing: { borderRadius: 48, borderWidth: 4, padding: 0 },
  followWrap: { paddingBottom: 6 },
  followBtn: { minHeight: 38, paddingHorizontal: 22 },
  nameLine: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, gap: 14 },
  metaItem: { flexDirection: 'row', alignItems: 'center' },
  counts: { flexDirection: 'row', marginTop: 12, gap: 20 },
  count: { flexDirection: 'row', alignItems: 'baseline' },
  divider: { height: StyleSheet.hairlineWidth, marginTop: 16 },
});
