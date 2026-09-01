import { View, FlatList, Pressable, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Avatar } from '@/components/Avatar';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import {
  useConversations, conversationPreview, type Conversation,
  useGroups, groupPreview, type Group,
} from '@/api/beam';
import { timeAgo } from '@/lib/format';
import { useRealtimeInvalidate } from '@/lib/useRealtime';
import { useState } from 'react';

/**
 * Beam — the messaging world. Chats (1:1) and Groups, each a real list over its own
 * route, opening a live thread. Calls, stories-in-chat and the rich composer are later
 * slices. The tab row mirrors the web's, minus the scopes the phone does not have yet —
 * an empty tab is worse than a missing one.
 */
type Tab = 'chats' | 'groups';

export default function Beam() {
  const { c } = useTheme();
  const [tab, setTab] = useState<Tab>('chats');
  const { data, isLoading, isError, refetch, isRefetching } = useConversations();
  const convos = data?.conversations ?? [];
  const groupsQ = useGroups();
  const groups = groupsQ.data?.groups ?? [];
  // A message arriving anywhere reorders this list and changes an unread count,
  // so the list is refetched the moment one does — rather than only when the
  // screen is pulled down.
  useRealtimeInvalidate(['msg', 'read', 'read-self'], [['conversations'], ['groups']]);

  return (
    <Screen edges={['top']}>
      <View style={[styles.head, { borderBottomColor: c.border }]}>
        <Text variant="title">Beam</Text>
        <View style={styles.tabs}>
          {(['chats', 'groups'] as Tab[]).map((t) => (
            <Pressable key={t} onPress={() => setTab(t)} hitSlop={8}
              accessibilityRole="tab" accessibilityState={{ selected: tab === t }}>
              <Text variant="headline" style={{ color: tab === t ? c.text : c.t3 }}>
                {t === 'chats' ? 'Chats' : 'Groups'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.accent} />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">
            Couldn't load your chats.
          </Text>
        </View>
      ) : tab === 'groups' ? (
        <FlatList
          data={groups}
          keyExtractor={(g) => String(g.id)}
          renderItem={({ item }) => <GroupRow group={item} />}
          contentContainerStyle={groups.length ? { paddingBottom: 24 } : styles.emptyWrap}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={groupsQ.isRefetching} onRefresh={groupsQ.refetch} tintColor={c.t3} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text variant="title" tone="t2">No groups yet</Text>
              <Text variant="body" tone="t3" style={{ marginTop: 6, textAlign: 'center' }}>
                Groups you're added to show up here.
              </Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={convos}
          keyExtractor={(c) => `${c.id}:${c.thread_id ?? 'main'}`}
          renderItem={({ item }) => <ConvoRow convo={item} />}
          contentContainerStyle={convos.length ? { paddingBottom: 24 } : styles.emptyWrap}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.t3} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text variant="title" tone="t2">
                No messages yet
              </Text>
              <Text variant="body" tone="t3" style={{ marginTop: 6, textAlign: 'center' }}>
                Start a conversation from someone's profile.
              </Text>
            </View>
          }
        />
      )}
    </Screen>
  );
}

/* A group row. Deliberately the same shape as a chat row — same avatar size, same two
   lines, same unread badge — because to a member a group IS just another conversation.
   The two things a group has that a DM does not: a member count, and being @mentioned,
   which is the one thing worth interrupting someone for in a busy group. */
function GroupRow({ group }: { group: Group }) {
  const { c } = useTheme();
  const router = useRouter();
  const unread = group.unread > 0;
  const preview = groupPreview(group);

  return (
    <Pressable
      onPress={() => router.push(`/group/${group.id}`)}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: c.border },
        pressed && { backgroundColor: c.s1 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${group.name}, ${group.members} members${unread ? `, ${group.unread} unread` : ''}`}
    >
      <Avatar name={group.name} avatar={group.avatar} size={52} />
      <View style={styles.mid}>
        <View style={styles.topline}>
          <Text variant="headline" numberOfLines={1}
            style={[styles.name, unread && { fontWeight: '800' }]}>
            {group.name}
          </Text>
          {group.last_at && (
            <Text variant="caption"
              style={{ color: unread ? c.accent : c.t3, fontWeight: unread ? '700' : '400' }}>
              {timeAgo(group.last_at)}
            </Text>
          )}
        </View>
        <View style={styles.botline}>
          <Text variant="body" numberOfLines={1}
            style={[{ flex: 1, color: unread ? c.text : c.t3 }, unread && { fontWeight: '600' }]}>
            {preview || `${group.members} member${group.members === 1 ? '' : 's'}`}
          </Text>
          {group.mentioned && (
            <Text variant="caption" style={{ color: c.accent, fontWeight: '800', marginRight: 6 }}>@</Text>
          )}
          {unread && (
            <View style={[styles.badge, { backgroundColor: c.accent }]}>
              <Text variant="micro" style={{ color: c.accentTint }}>
                {group.unread > 99 ? '99+' : group.unread}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

function ConvoRow({ convo }: { convo: Conversation }) {
  const { c } = useTheme();
  const router = useRouter();
  const unread = convo.unread > 0;

  return (
    <Pressable
      onPress={() => router.push(`/chat/${convo.id}`)}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: c.border },
        pressed && { backgroundColor: c.s1 },
      ]}
    >
      <Avatar name={convo.name} avatar={convo.avatar} size={52} />
      <View style={styles.mid}>
        <View style={styles.topline}>
          <Text
            variant="headline"
            numberOfLines={1}
            style={[styles.name, unread && { fontWeight: '800' }]}
          >
            {convo.name}
            {convo.thread_title ? `  · ${convo.thread_title}` : ''}
          </Text>
          {convo.last_at && (
            <Text
              variant="caption"
              style={{ color: unread ? c.accent : c.t3, fontWeight: unread ? '700' : '400' }}
            >
              {timeAgo(convo.last_at)}
            </Text>
          )}
        </View>
        <View style={styles.botline}>
          <Text
            variant="body"
            numberOfLines={1}
            style={[{ flex: 1, color: unread ? c.text : c.t3 }, unread && { fontWeight: '600' }]}
          >
            {conversationPreview(convo)}
          </Text>
          {unread && (
            <View style={[styles.badge, { backgroundColor: c.accent }]}>
              <Text variant="micro" style={{ color: '#fff', fontWeight: '800' }}>
                {convo.unread > 99 ? '99+' : convo.unread}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: 22, marginTop: 10 },
  head: { paddingHorizontal: spacing.gutter, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyWrap: { flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.gutter,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  mid: { flex: 1, marginLeft: 12 },
  topline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { flex: 1, marginRight: 8 },
  botline: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
});
