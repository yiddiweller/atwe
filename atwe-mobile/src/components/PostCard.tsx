import { useState, type ComponentProps } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { useTheme } from '@/theme/ThemeProvider';
import { compact, timeAgo } from '@/lib/format';
import { likePost, type Post } from '@/api/social';

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * X-style post card, matching the web `acPostCard` layout: avatar + name +
 * verified seal + @handle · time, full-width body & media, and the
 * reply · repost · like · views · bookmark engagement row. Like is interactive
 * (optimistic, reverts on error); the rest are display for now.
 */
export function PostCard({ post, linkToDetail = true }: { post: Post; linkToDetail?: boolean }) {
  const { c } = useTheme();
  const router = useRouter();
  const [liked, setLiked] = useState(!!post.liked);
  const [likes, setLikes] = useState(post.likes || 0);
  const biz = post.author?.accountType === 'business';
  const img = post.images?.[0] || post.image || null;

  const openDetail = () => {
    if (linkToDetail) router.push(`/post/${post.id}`);
  };

  const toggleLike = async () => {
    const next = !liked;
    setLiked(next);
    setLikes((n) => Math.max(0, n + (next ? 1 : -1)));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await likePost(post.id, next);
    } catch {
      setLiked(!next);
      setLikes((n) => Math.max(0, n + (next ? -1 : 1)));
    }
  };

  return (
    <Pressable
      onPress={openDetail}
      disabled={!linkToDetail}
      android_ripple={undefined}
      style={({ pressed }) => [
        styles.card,
        { borderBottomColor: c.border },
        pressed && linkToDetail ? { backgroundColor: c.s1 } : null,
      ]}
    >
      <Avatar name={post.author?.name} avatar={post.author?.avatar} biz={biz} size={44} />
      <View style={styles.main}>
        {post.promoted && (
          <Text variant="micro" tone="t3" style={{ marginBottom: 2 }}>
            Ad
          </Text>
        )}
        <View style={styles.nameline}>
          <Text variant="headline" numberOfLines={1} style={styles.name}>
            {post.author?.name || 'Someone'}
          </Text>
          {post.author?.verified && <VerifiedBadge />}
          <Text variant="callout" tone="t3" numberOfLines={1} style={styles.meta}>
            {post.author?.username ? ` @${post.author.username}` : ''} · {timeAgo(post.created_at)}
          </Text>
        </View>

        {post.locked ? (
          <View style={[styles.locked, { backgroundColor: c.s2 }]}>
            <Ionicons name="lock-closed" size={15} color={c.t3} />
            <Text variant="callout" tone="t2" style={{ marginLeft: 6 }}>
              {post.ppvCents ? `Unlock for $${(post.ppvCents / 100).toFixed(2)}` : 'Subscribers only'}
            </Text>
          </View>
        ) : (
          <>
            {!!post.body && (
              <Text variant="body" style={{ marginTop: 2 }}>
                {post.body}
              </Text>
            )}
            {img && (
              <Image
                source={{ uri: img }}
                style={[styles.media, { backgroundColor: c.s2 }]}
                contentFit="cover"
                transition={150}
              />
            )}
          </>
        )}

        <View style={styles.actions}>
          <Stat icon="chatbubble-outline" n={post.replies} color={c.t3} />
          <Stat icon="repeat" n={post.reposts} color={post.reposted ? c.repost : c.t3} />
          <Pressable onPress={toggleLike} style={styles.stat} hitSlop={8}>
            <Ionicons name={liked ? 'heart' : 'heart-outline'} size={17} color={liked ? c.like : c.t3} />
            {likes > 0 && (
              <Text variant="caption" style={{ marginLeft: 5, color: liked ? c.like : c.t3 }}>
                {compact(likes)}
              </Text>
            )}
          </Pressable>
          <Stat icon="eye-outline" n={post.views} color={c.t3} />
          <Ionicons
            name={post.bookmarked ? 'bookmark' : 'bookmark-outline'}
            size={16}
            color={post.bookmarked ? c.accent : c.t3}
          />
        </View>
      </View>
    </Pressable>
  );
}

function Stat({ icon, n, color }: { icon: IconName; n: number; color: string }) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={17} color={color} />
      {n > 0 && (
        <Text variant="caption" style={{ marginLeft: 5, color }}>
          {compact(n)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  main: { flex: 1, marginLeft: 10 },
  nameline: { flexDirection: 'row', alignItems: 'center' },
  name: { flexShrink: 1 },
  meta: { flexShrink: 1 },
  media: {
    marginTop: 10,
    width: '100%',
    aspectRatio: 1.6,
    borderRadius: 16,
  },
  locked: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingRight: 8,
  },
  stat: { flexDirection: 'row', alignItems: 'center', minWidth: 44 },
});
