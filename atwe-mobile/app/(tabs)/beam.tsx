import { View, FlatList, Pressable, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { haptics } from '@/lib/haptics';
import {
  useConversations, conversationPreview, type Conversation,
  useGroups, groupPreview, type Group,
  useCalls, callSubtitle, type CallLog,
  useContacts, type Person,
} from '@/api/beam';
import { timeAgo } from '@/lib/format';
import { useRealtimeInvalidate } from '@/lib/useRealtime';
import { useState } from 'react';
import { FeedTab } from '@/components/FeedTab';
import { NewChatSheet } from '@/components/NewChatSheet';
import { BeamToolsMenu } from '@/components/BeamToolsMenu';
import { BrandBar } from '@/components/BrandBar';
import { ChromeButton, ChromeBar, chromePad, BEAM_TABS_H } from '@/components/Chrome';
import { RowDivider } from '@/components/RowDivider';

/**
 * Beam — the messaging world, with the web's own four tabs.
 *
 * It shipped with two (Chats · Groups) because Calls and Contacts had no list
 * behind them. They do now: the call LOG is a plain read of `/api/calls`, which
 * is worth having on its own — a record of who rang and who was missed —
 * whether or not you can place a call from the phone yet. Placing one still
 * needs WebRTC and is not here.
 *
 * ALL is the merge, and it is what the web opens on: one list of every
 * conversation, DM and group together, newest first. Two lists side by side
 * make you check both to find out what just happened.
 */
type Tab = 'all' | 'chats' | 'calls' | 'contacts';
const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'chats', label: 'Chats' },
  { key: 'calls', label: 'Calls' },
  { key: 'contacts', label: 'Contacts' },
];

/** One row of the All list — a DM or a group, told apart by which field is set. */
type AnyRow =
  | { kind: 'dm'; at: string | null; convo: Conversation }
  | { kind: 'group'; at: string | null; group: Group };

export default function Beam() {
  const { c } = useTheme();
  const [tab, setTab] = useState<Tab>('all');
  const [newChat, setNewChat] = useState(false);
  const [tools, setTools] = useState(false);
  const { data, isLoading, isError, refetch, isRefetching } = useConversations();
  const convos = data?.conversations ?? [];
  const groupsQ = useGroups();
  const groups = groupsQ.data?.groups ?? [];
  /* Only fetched once the tab is opened — a call log and a contact book are not
     needed to show somebody their messages, and asking for them on every visit
     to Beam is two requests nobody reads. */
  const callsQ = useCalls();
  const contactsQ = useContacts();

  /* Newest first, DMs and groups interleaved. A row with no timestamp has never
     been used, so it sorts last rather than to the top on a falsy compare. */
  const all: AnyRow[] = [
    ...convos.map((x) => ({ kind: 'dm' as const, at: x.last_at, convo: x })),
    ...groups.map((g) => ({ kind: 'group' as const, at: g.last_at, group: g })),
  ].sort((a, b) => (b.at ? Date.parse(b.at) : 0) - (a.at ? Date.parse(a.at) : 0));
  // A message arriving anywhere reorders this list and changes an unread count,
  // so the list is refetched the moment one does — rather than only when the
  // screen is pulled down.
  useRealtimeInvalidate(['msg', 'read', 'read-self'], [['conversations'], ['groups']]);

  return (
    <Screen edges={[]}>
      {/* The world's own brand row: the mark, the word "Beam", and the three
          controls — ＋ starts a conversation, ⋯ opens the tools. The bespoke
          title row it replaces had the buttons but no brand and no name. */}
      <ChromeBar>
      <BrandBar
        world="beam"
        onPlus={() => setNewChat(true)}
        onMore={() => setTools(true)}
      />
      <View style={styles.head}>
        <View style={[styles.titleRow, styles.hiddenRow]}>
          <Text variant="title" style={{ flex: 1 }}>Beam</Text>
          <ChromeButton onPress={() => { haptics.tap(); setNewChat(true); }} label="New chat">
            <Ionicons name="create-outline" size={22} color={c.text} />
          </ChromeButton>
          {/* Six rarely-used destinations. A menu is where those belong — a row
              of six icons is six things nobody can tell apart at a glance. */}
          <ChromeButton onPress={() => { haptics.tap(); setTools(true); }} label="More">
            <Ionicons name="ellipsis-horizontal" size={22} color={c.text} />
          </ChromeButton>
        </View>
        <View style={styles.tabs}>
          {TABS.map((t) => (
            <FeedTab key={t.key} label={t.label} active={tab === t.key} onPress={() => setTab(t.key)} />
          ))}
        </View>
      </View>
      </ChromeBar>

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
      ) : tab === 'all' ? (
        <FlatList
          data={all}
          keyExtractor={(r) => (r.kind === 'dm'
            ? `d${r.convo.id}:${r.convo.thread_id ?? 'main'}`
            : `g${r.group.id}`)}
          renderItem={({ item }) => (item.kind === 'dm'
            ? <ConvoRow convo={item.convo} />
            : <GroupRow group={item.group} />)}
          contentContainerStyle={[all.length ? { paddingBottom: 24 } : styles.emptyWrap, chromePad.beam]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefetching || groupsQ.isRefetching}
              onRefresh={() => { void refetch(); void groupsQ.refetch(); }} tintColor={c.t3} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text variant="title" tone="t2">No conversations yet</Text>
              <Text variant="body" tone="t3" style={{ marginTop: 6, textAlign: 'center' }}>
                Message anybody on Atwe.
              </Text>
              <View style={{ height: 18 }} />
              <Button title="Start a conversation" onPress={() => setNewChat(true)} />
            </View>
          }
        />
      ) : tab === 'calls' ? (
        <FlatList
          data={callsQ.data?.calls ?? []}
          keyExtractor={(x) => String(x.id)}
          renderItem={({ item }) => <CallRow call={item} />}
          contentContainerStyle={[(callsQ.data?.calls?.length) ? { paddingBottom: 24 } : styles.emptyWrap, chromePad.beam]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={callsQ.isRefetching} onRefresh={callsQ.refetch} tintColor={c.t3} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              {callsQ.isLoading ? <ActivityIndicator color={c.accent} /> : (
                <>
                  <Text variant="title" tone="t2">No calls yet</Text>
                  <Text variant="body" tone="t3" style={{ marginTop: 6, textAlign: 'center' }}>
                    Calls you make or miss are listed here.
                  </Text>
                </>
              )}
            </View>
          }
        />
      ) : tab === 'contacts' ? (
        <FlatList
          data={contactsQ.data?.contacts ?? []}
          keyExtractor={(p) => String(p.id)}
          renderItem={({ item }) => <ContactRow person={item} />}
          contentContainerStyle={[(contactsQ.data?.contacts?.length) ? { paddingBottom: 24 } : styles.emptyWrap, chromePad.beam]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={contactsQ.isRefetching} onRefresh={contactsQ.refetch} tintColor={c.t3} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              {contactsQ.isLoading ? <ActivityIndicator color={c.accent} /> : (
                <>
                  <Text variant="title" tone="t2">No contacts yet</Text>
                  <Text variant="body" tone="t3" style={{ marginTop: 6, textAlign: 'center' }}>
                    People you message or connect with show up here.
                  </Text>
                </>
              )}
            </View>
          }
        />
      ) : (
        <FlatList
          data={convos}
          keyExtractor={(c) => `${c.id}:${c.thread_id ?? 'main'}`}
          renderItem={({ item }) => <ConvoRow convo={item} />}
          contentContainerStyle={[convos.length ? { paddingBottom: 24 } : styles.emptyWrap, chromePad.beam]}
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
                Message anybody on Atwe.
              </Text>
              <View style={{ height: 18 }} />
              <Button title="Start a conversation" onPress={() => setNewChat(true)} />
            </View>
          }
        />
      )}
      <NewChatSheet visible={newChat} onClose={() => setNewChat(false)} />
      <BeamToolsMenu visible={tools} onClose={() => setTools(false)} />
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
      <RowDivider />
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
      <RowDivider />
    </Pressable>
  );
}

/* One entry in the call log. Deliberately the same row shape as a chat — same
   avatar, same two lines, same right-hand time — because a call and a message
   are two things that happened with the same person, and a different-looking
   row would say otherwise.

   A MISSED call is the one thing here worth colouring, and only a missed one: a
   SILENCED call is the "silence unknown callers" setting working as asked, not
   something that went wrong, so it stays quiet grey. */
function CallRow({ call }: { call: CallLog }) {
  const { c } = useTheme();
  const router = useRouter();
  const missed = call.missed || !call.duration;
  const bad = missed && !call.silenced;
  return (
    <Pressable
      onPress={() => { haptics.tap(); router.push(`/chat/${call.peer.id}`); }}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.s1 }]}
      accessibilityRole="button"
      accessibilityLabel={`${call.direction === 'in' ? 'Incoming' : 'Outgoing'} ${call.media} call with ${call.peer.name}. ${callSubtitle(call)}`}
    >
      <Avatar name={call.peer.name} avatar={call.peer.avatar} size={52} />
      <View style={styles.mid}>
        <View style={styles.topline}>
          <Text variant="headline" numberOfLines={1}
            style={[styles.name, bad && { color: c.danger }]}>
            {call.peer.name}
          </Text>
          <Text variant="caption" tone="t3">{timeAgo(call.created_at)}</Text>
        </View>
        <View style={styles.botline}>
          <Ionicons
            name={call.direction === 'in' ? 'arrow-down-outline' : 'arrow-up-outline'}
            size={13} color={bad ? c.danger : c.t3} style={{ marginRight: 5 }}
          />
          <Text variant="body" style={{ flex: 1, color: bad ? c.danger : c.t3 }} numberOfLines={1}>
            {callSubtitle(call)}
          </Text>
          <Ionicons name={call.media === 'video' ? 'videocam-outline' : 'call-outline'}
            size={16} color={c.t3} />
        </View>
      </View>
      <RowDivider />
    </Pressable>
  );
}

/* A contact opens the CONVERSATION, not the profile — this is the messaging
   world, and the reason to look somebody up here is to say something to them.
   Their profile is one tap further, from the thread's own header. */
function ContactRow({ person }: { person: Person }) {
  const { c } = useTheme();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => { haptics.tap(); router.push(`/chat/${person.id}`); }}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.s1 }]}
      accessibilityRole="button"
      accessibilityLabel={`Message ${person.name}`}
    >
      <Avatar name={person.name} avatar={person.avatar} biz={person.accountType === 'business'} size={52} />
      <View style={styles.mid}>
        <Text variant="headline" numberOfLines={1}>{person.name}</Text>
        {!!person.username && (
          <Text variant="body" tone="t3" numberOfLines={1} style={{ marginTop: 2 }}>
            @{person.username}
          </Text>
        )}
      </View>
      <RowDivider />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: 22, marginTop: 10 },
  head: { paddingHorizontal: spacing.gutter, paddingBottom: 12, height: BEAM_TABS_H },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  /* The old title row's controls moved into BrandBar; the row itself is kept
     out of the layout rather than deleted so the tabs below keep their
     spacing. */
  hiddenRow: { display: 'none' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyWrap: { flexGrow: 1 },
  row: {
    position: 'relative',   // RowDivider pins itself to this row's bottom edge
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.gutter,
    paddingVertical: 11,
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
