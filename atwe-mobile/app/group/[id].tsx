import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, FlatList, Pressable, KeyboardAvoidingView, Platform,
  ActivityIndicator, StyleSheet, Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { ChromeBar, ChromeButton, ChromeSurface, chromePad, useFloatingFoot, GROUP_HEAD_H } from '@/components/Chrome';
import { Avatar } from '@/components/Avatar';
import { GlassComposer } from '@/components/GlassComposer';
import { MessageActions, type MessageAction } from '@/components/MessageActions';
import { ReactionChips } from '@/components/ReactionChips';
import { ReplyQuote, ReplyStrip } from '@/components/ReplyQuote';
import { VoiceNote } from '@/components/VoiceNote';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { useBubbleRadius } from '@/lib/bubbleShape';
import {
  useGroupThread, sendGroupMessage, react, deleteMessage,
  type Attachment, type GroupMessage, type GroupThreadData,
} from '@/api/beam';
import { useAuth } from '@/auth/AuthProvider';
import { useRealtime } from '@/lib/useRealtime';
import { pickPhoto, pickPhotoMessage } from '@/lib/pickPhoto';
import { mediaUri } from '@/lib/media';
import { useVoiceRecorder, voiceFailMessage, VOICE_MAX_SEC } from '@/lib/voice';
import { haptics } from '@/lib/haptics';

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
  const { user } = useAuth();
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
  useRealtime('dm_reaction', onLive);

  const { data, isLoading, isError } = useGroupThread(Number.isFinite(gid) ? gid : undefined);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  // A photo waiting to go with (or instead of) the next message.
  const [photo, setPhoto] = useState<string | null>(null);
  // The message a long-press opened the actions sheet on, and the one being
  // answered. Held as ids, not objects, so a refetch can never leave either
  // pointing at a stale copy of a message that has since changed.
  const [actingOn, setActingOn] = useState<number | null>(null);
  const [replyTo, setReplyTo] = useState<number | null>(null);

  const attachPhoto = async () => {
    const r = await pickPhoto();
    if (r.ok) { setPhoto(r.dataUrl); return; }
    const msg = pickPhotoMessage(r.reason);
    if (msg) Alert.alert('Photo', msg);
  };

  const listRef = useRef<FlatList<GroupMessage>>(null);
  /* The composer floats over the conversation — see the 1:1 thread. */
  const foot = useFloatingFoot(96);
  // Re-pin to the bottom once the composer's real height lands.
  useEffect(() => { scrollEnd(); }, [foot.height]);  // eslint-disable-line react-hooks/exhaustive-deps

  const messages = data?.messages ?? [];
  const group = data?.group;
  // A channel takes posts from admins only — say so instead of failing on send.
  const canPost = !group?.broadcast || !!group?.iAmAdmin;
  const byId = (mid: number | null) => (mid == null ? undefined : messages.find((m) => m.id === mid));
  const acting = byId(actingOn);

  const scrollEnd = () => setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);

  const voice = useVoiceRecorder();
  const startVoice = async () => {
    const ok = await voice.start();
    if (!ok) Alert.alert('Voice note', voiceFailMessage('denied')!);
  };
  const sendVoice = async () => {
    const r = await voice.stop();
    if ('fail' in r) {
      const m = voiceFailMessage(r.fail);
      if (m) Alert.alert('Voice note', m);
      return;
    }
    send({ media: r.dataUrl, mediaKind: 'audio', durationSec: r.durationSec }, r.fileUri);
  };
  // At the ceiling the recorder has already stopped taking audio, so the note is
  // sent rather than discarded.
  useEffect(() => {
    if (voice.recording && voice.seconds >= VOICE_MAX_SEC) sendVoice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.recording, voice.seconds]);

  /** `localMedia`: the recording on disk, for the optimistic bubble to play
   *  while the data URL being sent is still in flight. */
  const send = async (att: Attachment = {}, localMedia?: string) => {
    const body = text.trim();
    const image = photo ?? undefined;
    if ((!body && !image && !att.media) || sending || !canPost) return;
    const clientId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const answering = replyTo;
    const optimistic: GroupMessage = {
      id: -Date.now(),
      body,
      image: photo,
      images: [],
      // The local recording, so the note is playable before the round trip.
      media: localMedia ?? null,
      media_kind: att.mediaKind ?? null,
      media_name: null,
      duration_sec: att.durationSec ?? null,
      created_at: new Date().toISOString(),
      mine: true,
      sender: {
        id: user?.id ?? -1,
        name: user?.name ?? null,
        username: user?.username ?? null,
        avatar: user?.avatar ?? null,
        verified: !!user?.verified,
      },
      deleted: false,
      hidden: false,
      edited: false,
      reply_to: answering,
      reactions: {},
      clientId,
    };
    qc.setQueryData<GroupThreadData>(['group', gid], (old) =>
      old ? { ...old, messages: [...old.messages, optimistic] } : old,
    );
    setText('');
    setPhoto(null);
    setReplyTo(null);
    setSending(true);
    scrollEnd();
    try {
      await sendGroupMessage(gid, body, clientId, {
        image, ...att, ...(answering ? { replyTo: answering } : {}),
      });
    } catch {
      // leave the optimistic bubble; the refetch below reconciles it away if it failed
    } finally {
      setSending(false);
      qc.invalidateQueries({ queryKey: ['group', gid] });
      qc.invalidateQueries({ queryKey: ['groups'] });
      scrollEnd();
    }
  };

  const onReact = async (emoji: string) => {
    const m = acting;
    if (!m || m.id < 0) return;   // an optimistic bubble has no server id yet
    const myId = user?.id;
    // Show it immediately, and put it back if the server disagrees.
    const before = m.reactions;
    const next = { ...before };
    if (myId != null) {
      if (next[String(myId)] === emoji) delete next[String(myId)];
      else next[String(myId)] = emoji;
    }
    patchMessage(m.id, { reactions: next });
    try {
      const server = await react({ messageId: m.id, groupId: gid }, emoji);
      patchMessage(m.id, { reactions: server });
    } catch {
      patchMessage(m.id, { reactions: before });
    }
  };

  const patchMessage = (mid: number, patch: Partial<GroupMessage>) => {
    qc.setQueryData<GroupThreadData>(['group', gid], (old) =>
      old ? { ...old, messages: old.messages.map((m) => (m.id === mid ? { ...m, ...patch } : m)) } : old,
    );
  };

  const onAction = async (a: MessageAction) => {
    const m = acting;
    if (!m) return;
    if (a === 'reply') { setReplyTo(m.id); return; }
    if (a === 'copy') { await Clipboard.setStringAsync(m.body || ''); return; }
    const everyone = a === 'delete-all';
    Alert.alert(
      everyone ? 'Delete for everyone?' : 'Delete for me?',
      everyone
        ? 'It will be replaced with "Message deleted" for everyone in this group.'
        : 'It stays for everyone else.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            haptics.warning();
            try {
              await deleteMessage({ messageId: m.id, groupId: gid }, everyone ? 'everyone' : 'me');
            } catch (e) {
              haptics.error(); Alert.alert('Delete', (e as Error).message);
            } finally {
              qc.invalidateQueries({ queryKey: ['group', gid] });
              qc.invalidateQueries({ queryKey: ['groups'] });
            }
          },
        },
      ],
    );
  };

  return (
    <Screen edges={[]}>
      <ChromeBar>
        <View style={styles.header}>
          <ChromeButton onPress={() => router.back()} label="Back">
            <Ionicons name="chevron-back" size={22} color={c.text} />
          </ChromeButton>
          {/* The group is its own floating pill, the same shape as the back
              button beside it — see the 1:1 thread. */}
          <ChromeSurface radius={23} style={styles.peer}>
            <Avatar name={group?.name} avatar={group?.avatar} size={30} />
            <View style={{ marginLeft: 8, flexShrink: 1 }}>
              <Text variant="headline" numberOfLines={1}>{group?.name ?? '…'}</Text>
              {!!data?.members?.length && (
                <Text variant="caption" tone="t3" numberOfLines={1}>
                  {data.members.length} member{data.members.length === 1 ? '' : 's'}
                  {group?.broadcast ? ' · channel' : ''}
                </Text>
              )}
            </View>
          </ChromeSurface>
          <View style={styles.headSpacer} />
        </View>
      </ChromeBar>

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
                myId={user?.id}
                answering={byId(item.reply_to)}
                onLongPress={() => setActingOn(item.id)}
                /* the sender's name and face show only on the FIRST message of a run
                   from that person — repeating them on every line is what makes a
                   group read like a log rather than a conversation */
                startsRun={index === 0 || messages[index - 1]?.sender?.id !== item.sender?.id}
              />
            )}
            contentContainerStyle={[{ paddingVertical: 12, paddingHorizontal: 12 }, chromePad.group, foot.pad]}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={scrollEnd}
            ListEmptyComponent={
              <View style={styles.center}>
                <Text variant="body" tone="t3">No messages yet.</Text>
              </View>
            }
          />

          {/* The foot floats — see the 1:1 thread. */}
          <ChromeBar edge="bottom" inset={false} onLayout={foot.onLayout}>
          {replyTo != null && (
            <ReplyStrip
              name={byId(replyTo)?.mine ? 'yourself' : byId(replyTo)?.sender?.name ?? null}
              preview={previewOf(byId(replyTo))}
              onCancel={() => setReplyTo(null)}
            />
          )}

          <GlassComposer
            value={text}
            onChangeText={setText}
            onSend={() => send()}
            placeholder={canPost ? 'Message' : 'Only admins can post here'}
            sending={sending}
            onPlus={attachPhoto}
            attachment={photo}
            onRemoveAttachment={() => setPhoto(null)}
            editable={canPost}
            recording={voice.recording}
            recordSeconds={voice.seconds}
            onStartRecord={startVoice}
            onCancelRecord={voice.cancel}
            onSendRecord={sendVoice}
          />
          </ChromeBar>
        </KeyboardAvoidingView>
      )}

      <MessageActions
        visible={actingOn != null}
        onClose={() => setActingOn(null)}
        onReact={onReact}
        onAction={onAction}
        myReaction={user?.id != null ? acting?.reactions?.[String(user.id)] : undefined}
        canDeleteForEveryone={!!acting?.mine || !!group?.iAmAdmin}
        canCopy={!!acting?.body}
      />
    </Screen>
  );
}

/** One line describing a message, for a reply strip or a quote. */
function previewOf(m?: GroupMessage): string {
  if (!m) return '';
  if (m.deleted) return 'Message deleted';
  if (m.media_kind === 'audio') return '🎤 Voice message';
  if (m.media_kind === 'video') return '🎬 Video';
  if (m.image) return '📷 Photo';
  return m.body || '';
}

function GroupBubble({ msg, startsRun, myId, answering, onLongPress }: {
  msg: GroupMessage;
  startsRun: boolean;
  myId?: number;
  answering?: GroupMessage;
  onLongPress: () => void;
}) {
  const { c } = useTheme();
  const mine = msg.mine;
  const shape = useBubbleRadius(msg.body);
  const voice = !msg.deleted && msg.media_kind === 'audio' && msg.media ? msg.media : null;
  const label = msg.deleted
    ? 'Message deleted'
    : voice ? null
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
          {startsRun && <Avatar name={msg.sender?.name ?? undefined} avatar={msg.sender?.avatar} size={26} />}
        </View>
      )}
      <View style={{ maxWidth: '78%' }}>
        {!mine && startsRun && !!msg.sender?.name && (
          <Text variant="caption" tone="t3" style={styles.sender} numberOfLines={1}>
            {msg.sender.name}
          </Text>
        )}
        <Pressable
          onLongPress={msg.deleted ? undefined : onLongPress}
          delayLongPress={280}
          style={[styles.bubble,
            /* Round on all four corners — see the 1:1 thread. */
            { backgroundColor: mine ? c.accent : c.s2, borderRadius: shape.borderRadius }]}
          onLayout={shape.onLayout}
          accessibilityRole="button"
          accessibilityHint="Press and hold for message options"
        >
          {!!answering && (
            <ReplyQuote
              name={answering.mine ? 'You' : answering.sender?.name ?? null}
              preview={previewOf(answering)}
              mine={mine}
            />
          )}
          {!!msg.image && (
            <Image source={{ uri: mediaUri(msg.image) }} style={styles.img} contentFit="cover" transition={120} />
          )}
          {voice && <VoiceNote uri={voice} durationSec={msg.duration_sec} mine={mine} />}
          {label ? (
            <Text variant="body" style={{ color: mine ? '#fff' : c.t2,
              fontStyle: msg.deleted ? 'italic' : 'normal' }}>{label}</Text>
          ) : (
            !!msg.body && (
              <Text variant="body" style={{ color: mine ? '#fff' : c.text }}>{msg.body}</Text>
            )
          )}
        </Pressable>
        <ReactionChips reactions={msg.reactions} myId={myId} align={mine ? 'right' : 'left'} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    paddingHorizontal: 12, paddingBottom: 10, height: GROUP_HEAD_H,
    /* No hairline: chrome has no edge — the content dissolves under it. */
  },
  peer: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', minHeight: 46, paddingLeft: 4, paddingRight: 14, paddingVertical: 4 },
  headSpacer: { width: 38 },
  row: { flexDirection: 'row' },
  avaSlot: { width: 26, marginRight: 8, justifyContent: 'flex-end' },
  sender: { marginLeft: 4, marginBottom: 3 },
  bubble: { borderRadius: radius.bubble, paddingVertical: 10, paddingHorizontal: 16 },
  img: { width: 200, height: 200, borderRadius: radius.bubble - 10, marginBottom: 4 },
});
