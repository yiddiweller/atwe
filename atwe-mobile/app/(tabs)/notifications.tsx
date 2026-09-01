import { useEffect } from 'react';
import { View, FlatList, Pressable, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { ChromeBar, chromePad, ALERTS_HEAD_H } from '@/components/Chrome';
import { useChromeRetract } from '@/lib/chromeRetract';
import { Avatar } from '@/components/Avatar';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import {
  useNotifications,
  markAllNotificationsRead,
  notifText,
  type Notification,
} from '@/api/notifications';
import { timeAgo } from '@/lib/format';

/**
 * Notifications — the activity feed (GET /api/notifications). X-style rows:
 * actor avatar + a human sentence + time, unread rows tinted, tap deep-links to
 * the post / profile / chat. Marks everything read on open.
 */
export default function Notifications() {
  const chrome = useChromeRetract();
  const { c } = useTheme();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch, isRefetching } = useNotifications();
  const notifs = data?.notifications ?? [];

  // Mark all read once the screen opens, then refresh the bell badge.
  useEffect(() => {
    markAllNotificationsRead()
      .then(() => qc.invalidateQueries({ queryKey: ['notif-count'] }))
      .catch(() => {});
  }, [qc]);

  return (
    <Screen edges={[]}>
      {/* One always-mounted list, and the chrome after it: iOS minimises the
          tab bar against the scroll view it finds, and a world that swaps its
          list out for a spinner has none to find. */}
      <FlatList
          data={groupNotifs(notifs)}
          keyExtractor={(g) => String(g.head.id)}
          renderItem={({ item }) => <NotifRow n={item.head} count={item.count} />}
          contentContainerStyle={[notifs.length ? undefined : styles.emptyWrap, chromePad.alerts]}
          showsVerticalScrollIndicator={false}
          onScroll={chrome.onScroll}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.t3} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              {isLoading ? <ActivityIndicator color={c.accent} /> : isError ? (
                <Text variant="body" tone="t2">Couldn't load notifications.</Text>
              ) : (
                <>
                  <Ionicons name="notifications-outline" size={40} color={c.t3} />
                  <Text variant="body" tone="t3" style={{ marginTop: 10 }}>
                    No notifications yet.
                  </Text>
                </>
              )}
            </View>
          }
        />

      {/* No back arrow: this is one of the five worlds now, not a page opened
          from somewhere, and an arrow with nothing behind it is a dead control. */}
      <ChromeBar retract={chrome.hidden}>
        <View style={styles.head}>
          <Text variant="title">Notifications</Text>
        </View>
      </ChromeBar>
    </Screen>
  );
}


/**
 * CONSECUTIVE notifications of the same kind, from the same person, collapse
 * into one row with a count — the same thing the web's list does. It is not a
 * nicety: every sign-in writes a `login` row, so an account that opens the app a
 * few times a day ends up with a screen of identical "New sign-in" lines pushing
 * the real notifications off the bottom. Twelve in a row was the state on a test
 * account after one afternoon.
 *
 * Only CONSECUTIVE ones group, deliberately: reordering somebody's timeline to
 * gather scattered events would lose the thread of what happened when.
 */
interface Grouped {
  /** The newest of the run — the one whose time and target are used. */
  head: Notification;
  /** How many were folded in, 1 when nothing was. */
  count: number;
}

function groupNotifs(list: Notification[]): Grouped[] {
  const out: Grouped[] = [];
  for (const n of list) {
    const prev = out[out.length - 1];
    const same = prev
      && prev.head.type === n.type
      && (prev.head.actor?.id ?? null) === (n.actor?.id ?? null)
      /* A run only groups when the individual ones carry nothing that would be
         lost: two likes on DIFFERENT posts are two different events. */
      && (prev.head.postId ?? null) === (n.postId ?? null)
      && (prev.head.groupId ?? null) === (n.groupId ?? null)
      && (prev.head.productId ?? null) === (n.productId ?? null);
    if (same) prev.count += 1;
    else out.push({ head: n, count: 1 });
  }
  return out;
}

/* Anything about a purchase belongs in Orders. The server names these exactly;
   they are listed rather than pattern-matched so a new verb has to be added
   deliberately instead of being swept in by a prefix. */
const ORDER_TYPES = new Set([
  'order', 'order_fulfilled', 'order_shipped', 'order_delivered', 'order_disputed',
  'escrow_released', 'escrow_refunded', 'return_requested', 'return_approved',
  'return_declined', 'return_label_ready', 'digital_ready',
]);
/* Money that is not about an order lands in the wallet. */
const MONEY_TYPES = new Set([
  'money_received', 'money_request', 'money_request_paid', 'money_request_declined',
  'tip', 'payment', 'referral', 'affiliate', 'loyalty',
]);

function NotifRow({ n, count }: { n: Notification; count: number }) {
  const { c } = useTheme();
  const router = useRouter();
  const isLogin = n.type === 'login';

  /* Every notification should land on the THING it is about, not on whoever
     happened to trigger it. The ids the server attaches are the answer, and the
     order matters: a message about a group is a group, a sale is the order, a
     restock is the listing. Falling through to the actor's profile is the last
     resort, not the plan. */
  const go = () => {
    if (isLogin) return;
    if (n.groupId) router.push(`/group/${n.groupId}`);
    else if (n.type === 'message') router.push(`/chat/${n.actor.id}`);
    else if (ORDER_TYPES.has(n.type)) router.push('/orders');
    else if (n.postId) router.push(`/post/${n.postId}`);
    else if (n.productId) router.push(`/listing/${n.productId}`);
    else if (MONEY_TYPES.has(n.type)) router.push('/wallet');
    else if (n.actor.username) router.push(`/user/${n.actor.username}`);
  };

  const detail = n.postBody || n.jobTitle || n.productName || null;

  return (
    <Pressable
      onPress={go}
      style={({ pressed }) => [
        styles.row,
        /* The web is explicit: notification rows are "theme-following var(--bg)"
           with NO divider lines and a subtle unread DOT. This tinted every unread
           row blue and drew a line under each — on a page of unread alerts that is
           a wall of blue stripes, which is the opposite of the clean feed the web
           settled on. The dot is the whole cue. */
        { backgroundColor: 'transparent' },
        pressed && { backgroundColor: c.s1 },
      ]}
    >
      {isLogin ? (
        <View style={[styles.brand, { backgroundColor: c.s2 }]}>
          <Ionicons name="shield-checkmark" size={22} color={c.t2} />
        </View>
      ) : (
        <Avatar name={n.actor.name} avatar={n.actor.avatar} biz={n.actor.accountType === 'business'} size={44} />
      )}
      <View style={styles.mid}>
        <Text variant="body" numberOfLines={2}>
          {!isLogin && (
            <Text variant="body" style={{ fontWeight: '700' }}>
              {n.actor.name}
            </Text>
          )}
          {!isLogin && n.actor.verified && <VerifiedBadge size={14} />}
          <Text variant="body" tone="t2">
            {isLogin ? notifText(n) : ` ${notifText(n)}`}
          </Text>
          {count > 1 && (
            <Text variant="body" tone="t3">{`  ·  ${count} times`}</Text>
          )}
        </Text>
        {detail && (
          <Text variant="caption" tone="t3" numberOfLines={1} style={{ marginTop: 2 }}>
            {detail}
          </Text>
        )}
        <Text variant="micro" tone="t3" style={{ marginTop: 2 }}>
          {timeAgo(n.created_at)}
        </Text>
      </View>
      {!n.read && <View style={[styles.dot, { backgroundColor: c.accent }]} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: {
    // The arrow is gone, so the title sits on the page's own gutter rather than
    // where a 40pt button used to hold it in.
    paddingHorizontal: spacing.gutter,
    paddingBottom: 10,
    height: ALERTS_HEAD_H,
    /* No hairline: chrome has no edge — the content dissolves under it. */
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyWrap: { flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.gutter,
    paddingVertical: 12,
  },
  brand: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  mid: { flex: 1, marginLeft: 12 },
  dot: { width: 9, height: 9, borderRadius: 5, marginLeft: 8 },
});
