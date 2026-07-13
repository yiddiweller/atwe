import { useEffect } from 'react';
import { View, FlatList, Pressable, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Avatar } from '@/components/Avatar';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { useTheme } from '@/theme/ThemeProvider';
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
  const { c } = useTheme();
  const router = useRouter();
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
    <Screen edges={['top']}>
      <View style={[styles.head, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <Ionicons name="chevron-back" size={26} color={c.text} />
        </Pressable>
        <Text variant="title">Notifications</Text>
        <View style={styles.back} />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.accent} />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">
            Couldn't load notifications.
          </Text>
        </View>
      ) : (
        <FlatList
          data={notifs}
          keyExtractor={(n) => String(n.id)}
          renderItem={({ item }) => <NotifRow n={item} />}
          contentContainerStyle={notifs.length ? undefined : styles.emptyWrap}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.t3} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="notifications-outline" size={40} color={c.t3} />
              <Text variant="body" tone="t3" style={{ marginTop: 10 }}>
                No notifications yet.
              </Text>
            </View>
          }
        />
      )}
    </Screen>
  );
}

function NotifRow({ n }: { n: Notification }) {
  const { c } = useTheme();
  const router = useRouter();
  const isLogin = n.type === 'login';

  const go = () => {
    if (isLogin) return;
    if (n.type === 'message') router.push(`/chat/${n.actor.id}`);
    else if (n.postId) router.push(`/post/${n.postId}`);
    else if (n.actor.username) router.push(`/user/${n.actor.username}`);
  };

  const detail = n.postBody || n.jobTitle || n.productName || null;

  return (
    <Pressable
      onPress={go}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: c.border, backgroundColor: n.read ? 'transparent' : c.accentDim },
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: { width: 40, alignItems: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyWrap: { flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  brand: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  mid: { flex: 1, marginLeft: 12 },
  dot: { width: 9, height: 9, borderRadius: 5, marginLeft: 8 },
});
