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
import { likePost, repostPost, bookmarkPost, type Post } from '@/api/social';

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * Post card — matches the web `acPostCard` layout exactly:
 *   [avatar]  Name ✓ ················· time
 *             @handle
 *   body (full width, from the left edge — NOT indented under the name)
 *   reply · repost · like · views · bookmark
 * i.e. the header is a two-line id-column beside the avatar, and the body +
 * actions sit full-width below the whole header (web `.ac-post-top` +
 * `.ac-post-body`). Like/repost/bookmark are optimistic (revert on error).
 */
export function PostCard({ post, linkToDetail = true }: { post: Post; linkToDetail?: boolean }) {
  const { c } = useTheme();
  const router = useRouter();
  const [liked, setLiked] = useState(!!post.liked);
  const [likes, setLikes] = useState(post.likes || 0);
  const [reposted, setReposted] = useState(!!post.reposted);
  const [reposts, setReposts] = useState(post.reposts || 0);
  const [bookmarked, setBookmarked] = useState(!!post.bookmarked);
  const biz = post.author?.accountType === 'business';
  const img = post.images?.[0] || post.image || null;

  const openDetail = () => {
    if (linkToDetail) router.push(`/post/${post.id}`);
  };

  const goProfile = () => {
    const u = post.author?.username;
    if (u) router.push(`/user/${u}`);
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

  const toggleRepost = async () => {
    const next = !reposted;
    setReposted(next);
    setReposts((n) => Math.max(0, n + (next ? 1 : -1)));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await repostPost(post.id, next);
    } catch {
      setReposted(!next);
      setReposts((n) => Math.max(0, n + (next ? -1 : 1)));
    }
  };

  const toggleBookmark = async () => {
    const next = !bookmarked;
    setBookmarked(next);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await bookmarkPost(post.id, next);
    } catch {
      setBookmarked(!next);
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
      {post.promoted && (
        <Text variant="micro" tone="t3" style={{ marginBottom: 4 }}>
          Ad
        </Text>
      )}

      {/* Header: avatar + id-column (name line, then @handle underneath) */}
      <View style={styles.top}>
        <Pressable onPress={goProfile} hitSlop={6}>
          <Avatar name={post.author?.name} avatar={post.author?.avatar} biz={biz} size={44} />
        </Pressable>
        <View style={styles.idcol}>
          <View style={styles.headLine}>
            <Text numberOfLines={1} style={styles.name} onPress={goProfile}>
              {post.author?.name || 'Someone'}
            </Text>
            {post.author?.verified && <VerifiedBadge />}
            <Text tone="t3" numberOfLines={1} style={styles.time}>
              {timeAgo(post.created_at)}
            </Text>
          </View>
          {!!post.author?.username && (
            <Text tone="t3" numberOfLines={1} style={styles.handle} onPress={goProfile}>
              @{post.author.username}
            </Text>
          )}
        </View>
      </View>

      {/* Body — full width below the header (not indented under the name) */}
      <View style={styles.body}>
        {post.locked ? (
          <View style={[styles.locked, { backgroundColor: c.s2 }]}>
            <Ionicons name="lock-closed" size={15} color={c.t3} />
            <Text variant="callout" tone="t2" style={{ marginLeft: 6 }}>
              {post.ppvCents ? `Unlock for $${(post.ppvCents / 100).toFixed(2)}` : 'Subscribers only'}
            </Text>
          </View>
        ) : (
          <>
            {!!post.body && <Text variant="body">{post.body}</Text>}
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
          <Pressable onPress={toggleRepost} style={styles.stat} hitSlop={8}>
            <Ionicons name="repeat" size={18} color={reposted ? c.repost : c.t3} />
            {reposts > 0 && (
              <Text variant="caption" style={{ marginLeft: 5, color: reposted ? c.repost : c.t3 }}>
                {compact(reposts)}
              </Text>
            )}
          </Pressable>
          <Pressable onPress={toggleLike} style={styles.stat} hitSlop={8}>
            <Ionicons name={liked ? 'heart' : 'heart-outline'} size={17} color={liked ? c.like : c.t3} />
            {likes > 0 && (
              <Text variant="caption" style={{ marginLeft: 5, color: liked ? c.like : c.t3 }}>
                {compact(likes)}
              </Text>
            )}
          </Pressable>
          <Stat icon="eye-outline" n={post.views} color={c.t3} />
          <Pressable onPress={toggleBookmark} hitSlop={8}>
            <Ionicons
              name={bookmarked ? 'bookmark' : 'bookmark-outline'}
              size={16}
              color={bookmarked ? c.accent : c.t3}
            />
          </Pressable>
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
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  idcol: { flex: 1 },
  headLine: { flexDirection: 'row', alignItems: 'center' },
  name: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  time: { marginLeft: 'auto', paddingLeft: 8, fontSize: 13, flexShrink: 0 },
  handle: { fontSize: 13.5, marginTop: 1 },
  body: { marginTop: 9 },
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
