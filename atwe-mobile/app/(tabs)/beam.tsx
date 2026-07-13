import { View, FlatList, Pressable, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Avatar } from '@/components/Avatar';
import { useTheme } from '@/theme/ThemeProvider';
import { useConversations, conversationPreview, type Conversation } from '@/api/beam';
import { timeAgo } from '@/lib/format';

/**
 * Beam — the messaging world. Phase-1 slice: the real conversation list over
 * GET /api/atchat/conversations, opening a live DM thread (app/chat/[peer]).
 * Groups, calls, stories-in-chat and the rich composer come in later slices.
 */
export default function Beam() {
  const { c } = useTheme();
  const { data, isLoading, isError, refetch, isRefetching } = useConversations();
  const convos = data?.conversations ?? [];

  return (
    <Screen edges={['top']}>
      <View style={[styles.head, { borderBottomColor: c.border }]}>
        <Text variant="title">Beam</Text>
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
      ) : (
        <FlatList
          data={convos}
          keyExtractor={(c) => `${c.id}:${c.thread_id ?? 'main'}`}
          renderItem={({ item }) => <ConvoRow convo={item} />}
          contentContainerStyle={convos.length ? undefined : styles.emptyWrap}
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
  head: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyWrap: { flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
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
