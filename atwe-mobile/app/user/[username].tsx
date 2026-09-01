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
import { BookSheet } from '@/components/BookSheet';
import { Stars } from '@/components/Stars';
import { openNow, hoursLabel, todayIndex, DAY_NAMES, type DayHours } from '@/api/business';
import { PostCard } from '@/components/PostCard';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, radius } from '@/theme/tokens';
import {
  useProfile, useLikes, followUser,
  type Profile, type Post, type Experience, type Education, type Certification,
  type Skill, type Recommendation,
} from '@/api/social';
import { compact, monthYear, timeAgo } from '@/lib/format';
import { FeedTab } from '@/components/FeedTab';
import { HighlightsRow } from '@/components/HighlightsRow';
import { mediaUri } from '@/lib/media';

/**
 * A user's X-style profile — banner, overlapping avatar, identity, follow,
 * counts, then a TABBED body: Posts · Replies · Media · Likes · About, the same
 * five the web has. Opened by tapping a person anywhere in the feed (see
 * PostCard), and it reuses PostCard for every timeline so cards stay consistent.
 *
 * Likes is the one tab that costs a second request, so it is lazy — most visits
 * never open it, and loading it with the profile would slow down every visit for
 * the few that do.
 */
type Tab = 'posts' | 'replies' | 'media' | 'likes' | 'about';
const TABS: { key: Tab; label: string }[] = [
  { key: 'posts', label: 'Posts' },
  { key: 'replies', label: 'Replies' },
  { key: 'media', label: 'Media' },
  { key: 'likes', label: 'Likes' },
  { key: 'about', label: 'About' },
];
export default function UserProfile() {
  const { c } = useTheme();
  const router = useRouter();
  const { username } = useLocalSearchParams<{ username: string }>();
  const { data, isLoading, isError, refetch, isRefetching } = useProfile(username);
  const [tab, setTab] = useState<Tab>('posts');
  const likesQ = useLikes(username, tab === 'likes');

  /* A pinned post rides above the timeline with its own label, and is dropped
     from the list underneath so it is not on screen twice. */
  const pinned = data?.pinnedPost ?? null;
  const timeline = (data?.posts ?? []).filter((p) => !pinned || p.id !== pinned.id);
  const rows: Post[] =
    tab === 'posts' ? timeline
    : tab === 'replies' ? (data?.replies ?? [])
    : tab === 'media' ? (data?.posts ?? []).filter((p) => !!(p.image || p.images?.length))
    : tab === 'likes' ? (likesQ.data?.posts ?? [])
    : [];

  const emptyLine =
    tab === 'replies' ? 'No replies yet.'
    : tab === 'media' ? 'No photos or video yet.'
    : tab === 'likes' ? (likesQ.isLoading ? '' : 'Nothing liked publicly.')
    : 'No posts yet.';

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
          data={tab === 'about' ? [] : rows}
          keyExtractor={(p) => String(p.id)}
          renderItem={({ item }) => <PostCard post={item} />}
          ListHeaderComponent={
            <>
              <ProfileHeader data={data} />
              <HighlightsRow username={username} />
              {/* Word-only tabs, not pills — the web's own `.ac-prof-tabs`, and
                  the practical reason too: five pills measure ~700px of content
                  in a 390px row, so the last one ("About") sat half off-screen
                  while WHITE, i.e. the one indicator that says where you are was
                  the one being clipped. Five words fit. */}
              <View style={[styles.ptabs, { borderBottomColor: c.border }]}>
                {TABS.map((t) => (
                  <FeedTab
                    key={t.key}
                    label={t.label}
                    active={tab === t.key}
                    onPress={() => setTab(t.key)}
                  />
                ))}
              </View>
              {tab === 'posts' && !!pinned && (
                <View>
                  <Text variant="micro" tone="t3" style={styles.pinLabel}>PINNED</Text>
                  <PostCard post={pinned} />
                </View>
              )}
              {tab === 'about' && <About data={data} />}
            </>
          }
          ListEmptyComponent={
            tab === 'about' ? null : (
              <View style={styles.empty}>
                {tab === 'likes' && likesQ.isLoading
                  ? <ActivityIndicator color={c.accent} />
                  : <Text variant="body" tone="t3">{emptyLine}</Text>}
              </View>
            )
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
  const router = useRouter();
  const { user, counts, isMe } = data;
  const biz = user.accountType === 'business';

  const [following, setFollowing] = useState(!!data.isFollowing);
  const [followers, setFollowers] = useState(counts.followers || 0);
  const [booking, setBooking] = useState(false);
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
          <Image source={{ uri: mediaUri(user.banner) }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : null}
      </View>

      {/* Avatar + action row */}
      <View style={styles.identityRow}>
        {/* The ring takes the SHAPE of the avatar. A business avatar is an
            app-shaped rounded square, so a circular ring around one is a box
            inside a circle — the corners collide and it reads as a mistake.
            Radius = the avatar's own radius PLUS the ring's width, which is the
            concentric rule; equal radii leave the gap 1.41× wider at a corner. */}
        <View style={[styles.avatarRing, {
          borderColor: c.bg,
          backgroundColor: c.bg,
          /* Circle for everybody now — the web dropped the business square. */
          borderRadius: (AVA_SIZE + AVA_RING * 2) / 2,
        }]}>
          <Avatar name={user.name} avatar={user.avatar} biz={biz} size={AVA_SIZE} />
        </View>
        {isMe && (
          <View style={styles.followWrap}>
            <Button
              title="Edit profile"
              kind="secondary"
              onPress={() => router.push('/edit-profile')}
              style={styles.followBtn}
            />
          </View>
        )}
        {!isMe && (
          <View style={styles.followWrap}>
            {biz && (
              <Pressable
                onPress={() => setBooking(true)}
                style={[styles.msgBtn, { borderColor: c.border }]}
                accessibilityRole="button"
                accessibilityLabel={`Book ${user.name}`}
              >
                <Ionicons name="calendar-outline" size={20} color={c.text} />
              </Pressable>
            )}
            <Pressable
              onPress={() => router.push(`/chat/${user.id}`)}
              style={[styles.msgBtn, { borderColor: c.border }]}
              accessibilityLabel="Message"
            >
              <Ionicons name="mail-outline" size={20} color={c.text} />
            </Pressable>
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
        <View style={styles.handleRow}>
          {user.username && (
            <Text variant="body" tone="t3">
              @{user.username}
            </Text>
          )}
          {/* "Follows you" answers the question every profile visit asks first,
             and it is the reason the handle is now a row rather than a line. */}
          {data.followsYou && !isMe && (
            <View style={[styles.followsYou, { backgroundColor: c.s2 }]}>
              <Text variant="micro" tone="t3">Follows you</Text>
            </View>
          )}
        </View>
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

        {/* What a business is, beyond a name: whether it is open, what people
            said, and what it sells. All three were missing — a business profile
            on the phone showed exactly what a personal one did. */}
        {biz && (
          <View style={styles.bizRows}>
            {!!data.reviewSummary?.count && (
              <Pressable
                style={[styles.bizRow, { backgroundColor: c.s1 }]}
                onPress={() => router.push(
                  `/reviews/${user.id}?name=${encodeURIComponent(user.name)}`,
                )}
                accessibilityRole="button"
                accessibilityLabel={`Reviews, ${data.reviewSummary.average.toFixed(1)} out of 5`}
              >
                <Stars n={Math.round(data.reviewSummary.average)} size={15} />
                <Text variant="callout" style={{ marginLeft: 8, flex: 1 }}>
                  {data.reviewSummary.average.toFixed(1)} · {data.reviewSummary.count} review
                  {data.reviewSummary.count === 1 ? '' : 's'}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={c.t3} />
              </Pressable>
            )}
            {!data.reviewSummary?.count && !isMe && (
              <Pressable
                style={[styles.bizRow, { backgroundColor: c.s1 }]}
                onPress={() => router.push(
                  `/reviews/${user.id}?name=${encodeURIComponent(user.name)}`,
                )}
                accessibilityRole="button" accessibilityLabel="Write a review"
              >
                <Ionicons name="star-outline" size={17} color={c.t2} />
                <Text variant="callout" tone="t2" style={{ marginLeft: 8, flex: 1 }}>
                  No reviews yet — be the first
                </Text>
                <Ionicons name="chevron-forward" size={16} color={c.t3} />
              </Pressable>
            )}
            <Hours hours={user.businessHours as DayHours[] | null | undefined} />
            <Pressable
              style={[styles.bizRow, { backgroundColor: c.s1 }]}
              onPress={() => router.push(`/shop/${user.id}?name=${encodeURIComponent(user.name)}`)}
              accessibilityRole="button" accessibilityLabel={`${user.name}'s shop`}
            >
              <Ionicons name="storefront-outline" size={17} color={c.t2} />
              <Text variant="callout" style={{ marginLeft: 8, flex: 1 }}>
                {isMe ? 'Your shop' : 'Shop'}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={c.t3} />
            </Pressable>
          </View>
        )}

        {/* Who you both know — the single most useful thing on a stranger's
            profile, and the server already computes it (verified first, ≤3). */}
        {!isMe && !!data.followedByCount && data.followedByCount > 0 && (
          <View style={styles.followedBy}>
            <View style={styles.fbFaces}>
              {(data.followedBy ?? []).slice(0, 3).map((p, i) => (
                <View key={p.id} style={i ? styles.fbOverlap : undefined}>
                  <Avatar name={p.name} avatar={p.avatar} size={22} />
                </View>
              ))}
            </View>
            <Text variant="caption" tone="t3" style={{ flex: 1, marginLeft: 8 }} numberOfLines={2}>
              {followedByLine(data.followedBy ?? [], data.followedByCount)}
            </Text>
          </View>
        )}

        {/* Counts */}
        <View style={styles.counts}>
          <Count n={counts.following} label="Following" c={c} />
          <Count n={followers} label="Followers" c={c} />
          <Count n={counts.posts} label="Posts" c={c} />
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: c.border }]} />

      <BookSheet
        visible={booking}
        onClose={() => setBooking(false)}
        businessId={user.id}
        businessName={user.name}
      />
    </View>
  );
}


/**
 * "Followed by Alice, Bob and 3 others" — written out rather than left as a
 * count, because a name you recognise is the whole point of the line.
 */
function followedByLine(people: { name: string }[], total: number): string {
  const names = people.slice(0, 2).map((p) => p.name);
  const rest = total - names.length;
  if (!names.length) return `Followed by ${total} ${total === 1 ? 'person' : 'people'} you follow`;
  if (rest <= 0) return `Followed by ${names.join(' and ')}`;
  return `Followed by ${names.join(', ')} and ${rest} ${rest === 1 ? 'other' : 'others'}`;
}

/**
 * The professional half of a profile — the part the web keeps behind an About
 * tab so a timeline is not interrupted by somebody's education. Each block
 * renders only when it has something in it, so a personal account with no work
 * history shows a short honest line rather than five empty headings.
 */
function About({ data }: { data: Profile }) {
  const { c, radius, spacing } = useTheme();
  const exp = data.experiences ?? [];
  const edu = data.education ?? [];
  const certs = data.certifications ?? [];
  const skills = data.skills ?? [];
  const recs = data.recommendations ?? [];
  const trust = data.trustScore;
  const nothing = !exp.length && !edu.length && !certs.length && !skills.length && !recs.length && !trust;

  if (nothing) {
    return (
      <View style={styles.empty}>
        <Text variant="body" tone="t3">Nothing here yet.</Text>
      </View>
    );
  }

  return (
    <View style={{ paddingHorizontal: spacing.gutter, paddingBottom: 20 }}>
      {!!trust && (
        <View style={[styles.trust, { backgroundColor: c.s1, borderRadius: radius.card }]}>
          <Ionicons name="shield-checkmark-outline" size={20} color={c.repost} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text variant="headline">{trust.tier} · {trust.score}/100</Text>
            <Text variant="micro" tone="t3">
              {typeof trust.dealings === 'number' && trust.dealings > 0
                ? `${trust.dealings} completed ${trust.dealings === 1 ? 'dealing' : 'dealings'} on Atwe`
                : 'How they have been to deal with on Atwe'}
            </Text>
          </View>
        </View>
      )}

      <Block title="EXPERIENCE" show={exp.length > 0}>
        {exp.map((e: Experience) => (
          <Line key={e.id} head={e.title} sub={[e.company, years(e.startYear, e.endYear)].filter(Boolean).join(' · ')} />
        ))}
      </Block>

      <Block title="EDUCATION" show={edu.length > 0}>
        {edu.map((e: Education) => (
          <Line key={e.id} head={e.school}
            sub={[[e.degree, e.field].filter(Boolean).join(', '), years(e.startYear, e.endYear)].filter(Boolean).join(' · ')} />
        ))}
      </Block>

      <Block title="LICENCES & CERTIFICATIONS" show={certs.length > 0}>
        {certs.map((k: Certification) => (
          <Line key={k.id} head={k.name}
            sub={[k.issuer, k.issueYear ? String(k.issueYear) : null].filter(Boolean).join(' · ')} />
        ))}
      </Block>

      <Block title="SKILLS" show={skills.length > 0}>
        <View style={styles.chips}>
          {skills.map((sk: Skill) => (
            <View key={sk.id} style={[styles.chip, { backgroundColor: c.s2 }]}>
              {sk.assessed && <Ionicons name="checkmark-circle" size={13} color={c.accent} style={{ marginRight: 5 }} />}
              <Text variant="caption" tone="t2">{sk.name}</Text>
              {sk.endorsements > 0 && (
                <Text variant="micro" tone="t3" style={{ marginLeft: 6 }}>{sk.endorsements}</Text>
              )}
            </View>
          ))}
        </View>
      </Block>

      <Block title="RECOMMENDATIONS" show={recs.length > 0}>
        {recs.map((r: Recommendation) => (
          <View key={r.id} style={[styles.rec, { backgroundColor: c.s1, borderRadius: radius.card }]}>
            <View style={styles.recHead}>
              <Avatar name={r.author?.name} avatar={r.author?.avatar} size={30} />
              <View style={{ flex: 1, marginLeft: 9 }}>
                <Text variant="callout" weight="700" numberOfLines={1}>{r.author?.name}</Text>
                <Text variant="micro" tone="t3">
                  {[r.relationship, timeAgo(r.createdAt)].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </View>
            <Text variant="body" tone="t2" style={{ marginTop: 8, lineHeight: 21 }}>{r.body}</Text>
          </View>
        ))}
      </Block>
    </View>
  );
}

/** "2019 - now" reads better than a bare year, and an ongoing role has no end. */
function years(a: number | null, b: number | null): string {
  if (!a && !b) return '';
  if (a && !b) return `${a} - now`;
  if (!a) return String(b);
  return a === b ? String(a) : `${a} - ${b}`;
}

function Block({ title, show, children }: { title: string; show: boolean; children: React.ReactNode }) {
  if (!show) return null;
  return (
    <View style={{ marginTop: 22 }}>
      <Text variant="caption" tone="t3" style={{ letterSpacing: 0.6, marginBottom: 10 }}>{title}</Text>
      {children}
    </View>
  );
}

function Line({ head, sub }: { head: string; sub?: string }) {
  const { c } = useTheme();
  return (
    <View style={[styles.aboutLine, { borderBottomColor: c.border }]}>
      <Text variant="body">{head}</Text>
      {!!sub && <Text variant="caption" tone="t3" style={{ marginTop: 2 }}>{sub}</Text>}
    </View>
  );
}

/** Open or closed right now, and the week underneath when you tap it. Business
 *  hours are stored as plain wall-clock times, so "now" means the reader's own
 *  clock — the only honest reading available. */
function Hours({ hours }: { hours?: DayHours[] | null }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const isOpen = openNow(hours);
  if (isOpen === null) return null;
  const today = todayIndex();
  return (
    <View>
      <Pressable
        style={[styles.bizRow, { backgroundColor: c.s1 }]}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={isOpen ? 'Open now, see hours' : 'Closed now, see hours'}
      >
        <View style={[styles.dot, { backgroundColor: isOpen ? c.repost : c.t4 }]} />
        <Text variant="callout" style={{ marginLeft: 8, flex: 1, color: isOpen ? c.repost : c.t2 }}>
          {isOpen ? 'Open now' : 'Closed now'}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={c.t3} />
      </Pressable>
      {open && (
        <View style={[styles.hoursBox, { backgroundColor: c.s1 }]}>
          {DAY_NAMES.map((d, i) => (
            <View key={d} style={styles.hoursRow}>
              <Text variant="body" tone={i === today ? undefined : 't2'}
                style={{ flex: 1, fontWeight: i === today ? '700' : '400' }}>
                {d}
              </Text>
              <Text variant="body" tone={i === today ? undefined : 't2'}>
                {hoursLabel(hours?.[i])}
              </Text>
            </View>
          ))}
        </View>
      )}
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

/** The profile avatar and the ring the banner cuts around it. Both the size and
 *  the ring's width are named because the ring's CORNER is derived from them. */
const AVA_SIZE = 80;
const AVA_RING = 4;

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  ptabs: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.gutter,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  handleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  followsYou: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  followedBy: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  fbFaces: { flexDirection: 'row', alignItems: 'center' },
  fbOverlap: { marginLeft: -8 },
  pinLabel: { marginHorizontal: spacing.gutter + 12, marginBottom: 6, letterSpacing: 0.6 },
  trust: { flexDirection: 'row', alignItems: 'center', padding: 14, marginTop: 16 },
  aboutLine: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  rec: { padding: 14, marginBottom: 10 },
  recHead: { flexDirection: 'row', alignItems: 'center' },
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
    paddingHorizontal: spacing.gutter,
    marginTop: -40,
  },
  avatarRing: { borderWidth: AVA_RING, padding: 0 },
  followWrap: { paddingBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 8 },
  followBtn: { minHeight: 38, paddingHorizontal: 22 },
  msgBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameLine: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, gap: 14 },
  metaItem: { flexDirection: 'row', alignItems: 'center' },
  bizRows: { marginTop: 14, gap: 8 },
  bizRow: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: radius.card, paddingHorizontal: 14, paddingVertical: 12,
  },
  dot: { width: 9, height: 9, borderRadius: 5 },
  hoursBox: { borderRadius: radius.card, padding: 14, marginTop: 8 },
  hoursRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
  counts: { flexDirection: 'row', marginTop: 12, gap: 20 },
  count: { flexDirection: 'row', alignItems: 'baseline' },
  divider: { height: StyleSheet.hairlineWidth, marginTop: 16 },
});
