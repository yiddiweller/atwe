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
// `post` is aliased: the component's own prop is also called post, and a token that
// silently shadows a prop is exactly the kind of thing nobody notices until it breaks.
import { spacing, post as card, type Palette } from '@/theme/tokens';
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
        { backgroundColor: c.s2 },
        pressed && linkToDetail ? { opacity: 0.85 } : null,
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

        {/* Five EQUAL pills, each one the card's inner radius doubled so its corner
            matches the photo's, with the card's own padding as the gap between them —
            so the row reads as one even beat with the card's edge. They were bare
            glyphs spread apart before the web moved to the card. */}
        <View style={styles.actions}>
          <ActionPill icon="chatbubble-outline" n={post.replies} c={c} />
          <ActionPill icon="repeat" n={reposts} c={c} on={reposted} onColor={c.repost}
            onPress={toggleRepost} label="Repost" />
          <ActionPill icon={liked ? 'heart' : 'heart-outline'} n={likes} c={c} on={liked}
            onColor={c.like} onPress={toggleLike} label="Like" />
          <ActionPill icon="eye-outline" n={post.views} c={c} />
          <ActionPill icon={bookmarked ? 'bookmark' : 'bookmark-outline'} c={c} on={bookmarked}
            onColor={c.accent} onPress={toggleBookmark} label="Save" />
        </View>
      </View>
    </Pressable>
  );
}

/* One action. The pill is the PAGE colour, so it reads as a hole punched through the
   card rather than a raised control, and the glyph steps down to a quiet grey — the
   founder asked for exactly that ("fully black instead of grey, and the icon a darker
   grey"). Every count is compacted: a raw 123456 does not fit five-across on a 320px
   phone. flex:1 makes the five equal, so a post with counts and one without look the
   same shape. */
function ActionPill({ icon, n, c, on, onColor, onPress, label }: {
  icon: IconName; n?: number; c: Palette; on?: boolean; onColor?: string;
  onPress?: () => void; label?: string;
}) {
  const tint = on && onColor ? onColor : c.postPillInk;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      hitSlop={6}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={label}
      style={[styles.pill, { backgroundColor: c.postPill }]}
    >
      <Ionicons name={icon} size={17} color={tint} />
      {!!n && n > 0 && (
        <Text variant="caption" style={{ marginLeft: 4, color: tint }} numberOfLines={1}>
          {compact(n)}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.gutter,
    marginBottom: card.gap,
    padding: card.pad,
    borderRadius: card.cardRadius,
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
    // the card's corner minus its padding: the only radius that hugs the corner
    borderRadius: card.innerRadius,
  },
  locked: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: card.innerRadius,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: card.rowGap,
  },
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: card.shape,
    borderRadius: card.shape / 2,   // a capsule's radius IS half its height
  },
});
