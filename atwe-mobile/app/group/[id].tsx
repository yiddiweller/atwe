import { useCallback, useRef, useState } from 'react';
import {
  View, FlatList, Pressable, KeyboardAvoidingView, Platform,
  ActivityIndicator, StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Avatar } from '@/components/Avatar';
import { GlassComposer } from '@/components/GlassComposer';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import {
  useGroupThread, sendGroupMessage, type GroupMessage, type GroupThreadData,
} from '@/api/beam';
import { useRealtime } from '@/lib/useRealtime';
import { pickPhoto, pickPhotoMessage } from '@/lib/pickPhoto';

/**
 * A live group thread — GET /api/atchat/groups/:id, sending via
 * POST /api/atchat/groups/:id/messages with an optimistic echo and clientId
 * idempotency (the server has a unique index on group+sender+clientId, so a
 * double-tap or a retry lands once).
 *
 * What a group needs that a DM does not:
 *  - a SENDER on every message that is not yours. A thread with several people in
 *    it is unreadable without one.
 *  - that sender shown ONCE per run of consecutive messages, not on every bubble —
 *    repeating it on each line is what makes a group chat look like a log file.
 *  - a BROADCAST group ("channel") is admin-post-only, so the composer says so
 *    rather than letting someone type into a message that will be refused.
 */
export default function GroupThread() {
  const { c } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const gid = Number(id);

  // Live delivery, scoped to THIS group: a message elsewhere on the account must
  // not make this screen refetch.
  const onLive = useCallback((data: unknown) => {
    const d = data as { groupId?: number };
    if (d?.groupId === gid) {
      qc.invalidateQueries({ queryKey: ['group', gid] });
      qc.invalidateQueries({ queryKey: ['groups'] });
    }
  }, [gid, qc]);
  useRealtime('msg', onLive);
  useRealtime('dm_deleted', onLive);
  useRealtime('dm_edited', onLive);

  const { data, isLoading, isError } = useGroupThread(Number.isFinite(gid) ? gid : undefined);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  // A photo waiting to go with (or instead of) the next message.
  const [photo, setPhoto] = useState<string | null>(null);

  const attachPhoto = async () => {
    const r = await pickPhoto();
    if (r.ok) { setPhoto(r.dataUrl); return; }
    const msg = pickPhotoMessage(r.reason);
    if (msg) Alert.alert('Photo', msg);   // a cancel says nothing — it was deliberate
  };
  const listRef = useRef<FlatList<GroupMessage>>(null);

  const messages = data?.messages ?? [];
  const group = data?.group;
  // A channel takes posts from admins only — say so instead of failing on send.
  const canPost = !group?.broadcast || !!group?.iAmAdmin;

  const scrollEnd = () => setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);

  const send = async () => {
    const body = text.trim();
    if ((!body && !photo) || sending || !canPost) return;
    const clientId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic: GroupMessage = {
      id: -Date.now(),
      body,
      image: photo,
      media_kind: null,
      created_at: new Date().toISOString(),
      mine: true,
      sender_id: -1,
      sender_name: null,
      sender_avatar: null,
    };
    qc.setQueryData<GroupThreadData>(['group', gid], (old) =>
      old ? { ...old, messages: [...old.messages, optimistic] } : old,
    );
    setText('');
    setPhoto(null);
    setSending(true);
    scrollEnd();
    try {
      await sendGroupMessage(gid, body, clientId, photo ?? undefined);
    } catch {
      // leave the optimistic bubble; the refetch below reconciles it away if it failed
    } finally {
      setSending(false);
      qc.invalidateQueries({ queryKey: ['group', gid] });
      qc.invalidateQueries({ queryKey: ['groups'] });
      scrollEnd();
    }
  };

  return (
    <Screen edges={['top']}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}
          accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={c.accent} />
        </Pressable>
        <View style={styles.peer}>
          <Avatar name={group?.name} avatar={group?.avatar} size={34} />
          <View style={{ marginLeft: 8, flex: 1 }}>
            <Text variant="headline" numberOfLines={1}>{group?.name ?? '…'}</Text>
            {!!data?.members?.length && (
              <Text variant="caption" tone="t3" numberOfLines={1}>
                {data.members.length} member{data.members.length === 1 ? '' : 's'}
                {group?.broadcast ? ' · channel' : ''}
              </Text>
            )}
          </View>
        </View>
        <View style={styles.back} />
      </View>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : isError ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">Couldn't open this group.</Text>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={8}
        >
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => String(m.id)}
            renderItem={({ item, index }) => (
              <GroupBubble
                msg={item}
                /* the sender's name and face show only on the FIRST message of a run
                   from that person — repeating them on every line is what makes a
                   group read like a log rather than a conversation */
                startsRun={index === 0 || messages[index - 1]?.sender_id !== item.sender_id}
              />
            )}
            contentContainerStyle={{ paddingVertical: 12, paddingHorizontal: 12 }}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={scrollEnd}
            ListEmptyComponent={
              <View style={styles.center}>
                <Text variant="body" tone="t3">No messages yet.</Text>
              </View>
            }
          />

          <GlassComposer
            value={text}
            onChangeText={setText}
            onSend={send}
            placeholder={canPost ? 'Message' : 'Only admins can post here'}
            sending={sending}
            onPlus={attachPhoto}
            attachment={photo}
            onRemoveAttachment={() => setPhoto(null)}
            editable={canPost}
          />
        </KeyboardAvoidingView>
      )}
    </Screen>
  );
}

function GroupBubble({ msg, startsRun }: { msg: GroupMessage; startsRun: boolean }) {
  const { c } = useTheme();
  const mine = msg.mine;
  const label = msg.deleted_all
    ? 'Message deleted'
    : msg.media_kind === 'audio' ? '🎤 Voice message'
    : msg.media_kind === 'video' ? '🎬 Video'
    : null;

  return (
    <View style={[styles.row, { justifyContent: mine ? 'flex-end' : 'flex-start' },
      startsRun ? { marginTop: 10 } : { marginTop: 2 }]}>
      {/* their face, once per run — the gutter is held open on the others so the
          bubbles in a run stay on one line rather than stepping left and right */}
      {!mine && (
        <View style={styles.avaSlot}>
          {startsRun && <Avatar name={msg.sender_name ?? undefined} avatar={msg.sender_avatar} size={26} />}
        </View>
      )}
      <View style={{ maxWidth: '78%' }}>
        {!mine && startsRun && !!msg.sender_name && (
          <Text variant="caption" tone="t3" style={styles.sender} numberOfLines={1}>
            {msg.sender_name}
          </Text>
        )}
        <View style={[styles.bubble,
          mine ? { backgroundColor: c.accent, borderBottomRightRadius: 4 }
               : { backgroundColor: c.s2, borderBottomLeftRadius: 4 }]}>
          {!!msg.image && (
            <Image source={{ uri: msg.image }} style={styles.img} contentFit="cover" transition={120} />
          )}
          {label ? (
            <Text variant="body" style={{ color: mine ? '#fff' : c.t2,
              fontStyle: msg.deleted_all ? 'italic' : 'normal' }}>{label}</Text>
          ) : (
            !!msg.body && (
              <Text variant="body" style={{ color: mine ? '#fff' : c.text }}>{msg.body}</Text>
            )
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.gutter, paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: { width: 34, alignItems: 'flex-start' },
  peer: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'flex-end' },
  avaSlot: { width: 26, marginRight: 6 },
  sender: { marginLeft: 10, marginBottom: 2 },
  bubble: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 18 },
  img: { width: 220, height: 150, borderRadius: 12, marginBottom: 6 },
});
