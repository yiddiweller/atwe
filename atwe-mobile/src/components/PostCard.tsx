import { useState, type ComponentProps } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { useTheme } from '@/theme/ThemeProvider';
// `post` is aliased: the component's own prop is also called post, and a token that
// silently shadows a prop is exactly the kind of thing nobody notices until it breaks.
import { spacing, post as card, type Palette } from '@/theme/tokens';
import { compact, timeAgo } from '@/lib/format';
import { likePost, repostPost, bookmarkPost, type Post } from '@/api/social';
import { mediaUri } from '@/lib/media';
import { PostMenu } from './PostMenu';
import { haptics } from '@/lib/haptics';

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [gone, setGone] = useState(false);
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
    haptics.tap();
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
    haptics.tap();
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
    haptics.tap();
    try {
      await bookmarkPost(post.id, next);
    } catch {
      setBookmarked(!next);
    }
  };


  /* "Not interested", a mute, a block and a delete all promise the post goes
     away, so it has to actually go — the list itself is not refetched, and
     leaving the card sitting there makes every one of those actions look like
     it failed. Collapsing it here is what keeps the promise. */
  if (gone) return null;
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
        <Pressable onPress={goProfile} hitSlop={6} style={styles.avatar}>
          <Avatar name={post.author?.name} avatar={post.author?.avatar} biz={biz} size={card.shape} />
        </Pressable>
        <View style={styles.idcol}>
          <View style={styles.headLine}>
            <Text numberOfLines={1} style={styles.name} onPress={goProfile}>
              {post.author?.name || 'Someone'}
            </Text>
            {post.author?.verified && <VerifiedBadge />}
          </View>
          {!!post.author?.username && (
            <Text tone="t3" numberOfLines={1} style={styles.handle} onPress={goProfile}>
              @{post.author.username}
            </Text>
          )}
        </View>

        {/* Time and ⋯ are ONE cluster, and it is its own box the picture's height
            rather than a pair sitting inside the (fixed-height, centred) name
            column. That is what puts them on one line by construction: the ⋯ has
            to sit at the card's padding edge for its corner to be concentric,
            and the name rides the centre of the column, so anything sharing the
            column with the dots ends up several pixels off. */}
        <View style={styles.meta}>
          <Text tone="t3" numberOfLines={1} style={styles.time}>
            {timeAgo(post.created_at)}
          </Text>
          <Pressable
            onPress={() => { haptics.tap(); setMenuOpen(true); }}
            hitSlop={6}
            style={styles.dots}
            accessibilityRole="button"
            accessibilityLabel="More"
          >
            <Ionicons name="ellipsis-horizontal" size={17} color={c.t3} />
          </Pressable>
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
                source={{ uri: mediaUri(img) }}
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

      <PostMenu
        post={post}
        mine={!!post.mine}
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        onGone={() => setGone(true)}
      />
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
  /* The picture is `card.shape` (36) — the size at which its own radius is 18,
     the same as the photo's, so it nests in the card's top-left corner. Pinned
     to flex-start, so its inset is the card's padding on BOTH sides and its
     centre lands on the corner arc's centre.

     The text column is then given EXACTLY the picture's height and centred
     inside it. That is what makes the two goals true at once: pinning the
     picture to the padding edge while a taller text column set the row height
     left the name sitting ~4px lower than the face, which is what the founder
     photographed on the web. Fixing the column's height removes the problem by
     construction rather than by a nudge. The handle's line-height is spelled
     out for the same reason — the body's own 1.6 pushed the two lines past 36. */
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  avatar: { alignSelf: 'flex-start' },
  idcol: { flex: 1, height: card.shape, justifyContent: 'center' },
  headLine: { flexDirection: 'row', alignItems: 'center' },
  meta: { height: card.shape, flexDirection: 'row', alignItems: 'center', gap: 2 },
  dots: { width: card.shape, height: card.shape, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 15, fontWeight: '700', flexShrink: 1, lineHeight: 19 },
  time: { fontSize: 13, flexShrink: 0 },
  handle: { fontSize: 13.5, lineHeight: 16 },
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
