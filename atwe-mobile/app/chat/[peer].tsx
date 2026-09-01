import { useRef, useState } from 'react';
import {
  View,
  FlatList,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { ChromeBar, ChromeButton, ChromeSurface, chromePad, useFloatingFoot, CHAT_HEAD_H } from '@/components/Chrome';
import { Avatar } from '@/components/Avatar';
import { GlassComposer } from '@/components/GlassComposer';
import { useTheme } from '@/theme/ThemeProvider';
import {
  useThread, sendDm, react, deleteMessage, openViewOnce,
  type Attachment, type DmMessage, type DmThreadData,
} from '@/api/beam';
import { useAuth } from '@/auth/AuthProvider';
import { useRealtime } from '@/lib/useRealtime';
import { pickPhoto, pickPhotoMessage } from '@/lib/pickPhoto';
import { useCallback, useEffect } from 'react';
import { mediaUri } from '@/lib/media';
import { VoiceNote } from '@/components/VoiceNote';
import { MetaCard, type Meta } from '@/components/MetaCard';
import { useVoiceRecorder, voiceFailMessage, VOICE_MAX_SEC } from '@/lib/voice';
import { MessageActions, type MessageAction } from '@/components/MessageActions';
import { ChatSettingsSheet } from '@/components/ChatSettingsSheet';
import { ReactionChips } from '@/components/ReactionChips';
import { ReplyQuote, ReplyStrip } from '@/components/ReplyQuote';
import * as Clipboard from 'expo-clipboard';
import { radius } from '@/theme/tokens';
import { useBubbleRadius } from '@/lib/bubbleShape';
import { haptics } from '@/lib/haptics';

/**
 * A live 1:1 DM thread — reads GET /api/atchat/with/:id (polled) and sends via
 * POST /api/atchat/with/:id with optimistic echo + clientId idempotency. iMessage-
 * style bubbles (mine = accent right, theirs = grey left). Realtime SSE, media,
 * reactions and the rich composer are later slices.
 */
export default function ChatThread() {
  const { c, spacing } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { peer } = useLocalSearchParams<{ peer: string }>();
  const peerId = Number(peer);

  // Live delivery. A message for THIS conversation refetches it straight away;
  // one for a different conversation is left alone, so opening a chat does not
  // start reacting to every message on the account.
  const onLiveMsg = useCallback((data: unknown) => {
    const d = data as { kind?: string; peerId?: number };
    if (d?.kind === 'dm' && d.peerId === peerId) {
      qc.invalidateQueries({ queryKey: ['thread', peerId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    }
  }, [peerId, qc]);
  useRealtime('msg', onLiveMsg);
  // Their "seen" tick, and their edits and deletions, arrive the same way.
  const onLiveState = useCallback((data: unknown) => {
    const d = data as { peerId?: number };
    if (d?.peerId === peerId) qc.invalidateQueries({ queryKey: ['thread', peerId] });
  }, [peerId, qc]);
  useRealtime('read', onLiveState);
  useRealtime('dm_deleted', onLiveState);
  useRealtime('dm_edited', onLiveState);
  useRealtime('dm_reaction', onLiveState);
  const { data, isLoading } = useThread(Number.isFinite(peerId) ? peerId : undefined);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  // A photo waiting to go with (or instead of) the next message.
  const [photo, setPhoto] = useState<string | null>(null);
  const [viewOnce, setViewOnce] = useState(false);
  // The message a long-press opened the sheet on, and the one being answered.
  // Held as ids so a refetch can never leave either pointing at a stale copy.
  const [actingOn, setActingOn] = useState<number | null>(null);
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [settings, setSettings] = useState(false);

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
  // A note that reaches the ceiling is SENT, not thrown away — the recorder has
  // already stopped taking audio by then, so holding it hostage would only lose
  // what was said.
  useEffect(() => {
    if (voice.recording && voice.seconds >= VOICE_MAX_SEC) sendVoice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.recording, voice.seconds]);

  const attachPhoto = async () => {
    const r = await pickPhoto();
    if (r.ok) { setPhoto(r.dataUrl); return; }
    const msg = pickPhotoMessage(r.reason);
    if (msg) Alert.alert('Photo', msg);   // a cancel says nothing — it was deliberate
  };
  const listRef = useRef<FlatList<DmMessage>>(null);
  /* The composer floats over the conversation, so the list has to reserve
     its height — measured, because a reply strip or a photo makes it grow. */
  const foot = useFloatingFoot(96);
  // Re-pin to the bottom once the composer's real height lands.
  useEffect(() => { scrollEnd(); }, [foot.height]);  // eslint-disable-line react-hooks/exhaustive-deps

  const messages = data?.messages ?? [];
  const canMessage = data?.canMessage !== false;
  const byId = (mid: number | null) => (mid == null ? undefined : messages.find((m) => m.id === mid));
  const acting = byId(actingOn);

  const scrollEnd = () => setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);

  /** `localMedia` is what the optimistic bubble plays while the real message is
   *  in flight — a file on disk, never the multi-megabyte data URL being sent. */
  const send = async (att: Attachment = {}, localMedia?: string) => {
    const body = text.trim();
    const image = photo ?? undefined;
    if ((!body && !image && !att.media) || sending) return;
    const clientId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const answering = replyTo;
    const optimistic: DmMessage = {
      id: -Date.now(),
      body,
      image: photo,
      images: [],
      reply_to: answering,
      reactions: {},
      // The optimistic bubble shows the LOCAL recording, so a voice note is
      // playable the instant it is sent rather than after a round trip.
      media: localMedia ?? null,
      media_kind: att.mediaKind ?? null,
      media_name: null,
      duration_sec: att.durationSec ?? null,
      created_at: new Date().toISOString(),
      mine: true,
      read_at: null,
      clientId,
      deleted: false,
      hidden: false,
      meta: null,
    };
    qc.setQueryData<DmThreadData>(['thread', peerId], (old) =>
      old ? { ...old, messages: [...old.messages, optimistic] } : old,
    );
    setText('');
    setPhoto(null);
    setReplyTo(null);
    setSending(true);
    scrollEnd();
    try {
      await sendDm(peerId, body, clientId, {
        image, ...att,
        /* Only ever with a photo — a view-once text message is not a thing, and
           the flag would just sit on the row confusing the next reader. */
        ...(image && viewOnce ? { viewOnce: true } : {}),
        ...(answering ? { replyTo: answering } : {}),
      });
    } catch {
      // leave the optimistic bubble; the reconcile below will drop it if it failed
    } finally {
      setSending(false);
      qc.invalidateQueries({ queryKey: ['thread', peerId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
      scrollEnd();
    }
  };

  const patchMessage = (mid: number, patch: Partial<DmMessage>) => {
    qc.setQueryData<DmThreadData>(['thread', peerId], (old) =>
      old ? { ...old, messages: old.messages.map((m) => (m.id === mid ? { ...m, ...patch } : m)) } : old,
    );
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
      const server = await react({ messageId: m.id }, emoji);
      patchMessage(m.id, { reactions: server });
    } catch {
      patchMessage(m.id, { reactions: before });
    }
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
        ? 'It will be replaced with "Message deleted" on both sides.'
        : 'It stays in their copy of the conversation.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            haptics.warning();
            try {
              await deleteMessage({ messageId: m.id }, everyone ? 'everyone' : 'me');
            } catch (e) {
              haptics.error(); Alert.alert('Delete', (e as Error).message);
            } finally {
              qc.invalidateQueries({ queryKey: ['thread', peerId] });
              qc.invalidateQueries({ queryKey: ['conversations'] });
            }
          },
        },
      ],
    );
  };

  return (
    <Screen edges={[]}>
      {/* Header */}
      <ChromeBar>
        <View style={styles.header}>
          <ChromeButton onPress={() => router.back()} label="Back">
            <Ionicons name="chevron-back" size={22} color={c.text} />
          </ChromeButton>
          {/* Who you are talking to is its own floating pill, not a label on a
              bar — the same shape the ＋ and the ⋯ are, so the row reads as
              three pieces over the conversation rather than as a header. */}
          <ChromeSurface
            radius={19}
            label={data?.peer.name ?? 'Profile'}
            onPress={() => data?.peer.username && router.push(`/user/${data.peer.username}`)}
            style={styles.peer}
          >
            <Avatar name={data?.peer.name} avatar={data?.peer.avatar} size={30} />
            <Text variant="headline" numberOfLines={1} style={styles.peerName}>
              {data?.peer.name ?? '…'}
            </Text>
          </ChromeSurface>
          <ChromeButton onPress={() => { haptics.tap(); setSettings(true); }} label="Chat settings">
            <Ionicons name="ellipsis-horizontal" size={20} color={c.text} />
          </ChromeButton>
        </View>
      </ChromeBar>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.accent} />
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
            renderItem={({ item }) => (
              <Bubble
                msg={item}
                myId={user?.id}
                answering={byId(item.reply_to)}
                peerName={data?.peer.name}
                onLongPress={() => setActingOn(item.id)}
              />
            )}
            contentContainerStyle={[{ paddingVertical: 12, paddingHorizontal: 12 }, chromePad.chat, foot.pad]}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={scrollEnd}
            ListEmptyComponent={
              <View style={styles.center}>
                <Text variant="body" tone="t3">
                  Say hello 👋
                </Text>
              </View>
            }
          />

          {/* The foot floats: messages travel UNDER it and dissolve into the
              bottom of the screen rather than stopping at a bar. It carries its
              own safe-area inset, so the fade must not add a second one. */}
          <ChromeBar edge="bottom" inset={false} onLayout={foot.onLayout}>
          {replyTo != null && (
            <ReplyStrip
              name={byId(replyTo)?.mine ? 'yourself' : data?.peer.name ?? null}
              preview={previewOf(byId(replyTo))}
              onCancel={() => setReplyTo(null)}
            />
          )}

          {/* Composer — floating Liquid Glass pill (ChatGPT-style, Atwe design) */}
          <GlassComposer
            value={text}
            onChangeText={setText}
            onSend={() => send()}
            placeholder={canMessage ? 'Message' : "You can't message this account"}
            sending={sending}
            onPlus={attachPhoto}
            attachment={photo}
            onRemoveAttachment={() => { setPhoto(null); setViewOnce(false); }}
            viewOnce={viewOnce}
            onToggleViewOnce={photo ? () => { haptics.select(); setViewOnce((v) => !v); } : undefined}
            editable={canMessage}
            recording={voice.recording}
            recordSeconds={voice.seconds}
            onStartRecord={startVoice}
            onCancelRecord={voice.cancel}
            onSendRecord={sendVoice}
          />
          </ChromeBar>
        </KeyboardAvoidingView>
      )}

      {!!data?.peer && (
        <ChatSettingsSheet
          visible={settings}
          kind="dm"
          id={data.peer.id}
          name={data.peer.name}
          onClose={() => setSettings(false)}
        />
      )}

      <MessageActions
        visible={actingOn != null}
        onClose={() => setActingOn(null)}
        onReact={onReact}
        onAction={onAction}
        myReaction={user?.id != null ? acting?.reactions?.[String(user.id)] : undefined}
        canDeleteForEveryone={!!acting?.mine}
        canCopy={!!acting?.body}
      />
    </Screen>
  );
}

/** One line describing a message, for a reply strip or a quote. */
function previewOf(m?: DmMessage): string {
  if (!m) return '';
  if (m.deleted) return 'Message deleted';
  if (m.media_kind === 'audio') return '🎤 Voice message';
  if (m.media_kind === 'video') return '🎬 Video';
  if (m.image || m.images?.length) return '📷 Photo';
  return m.body || '';
}

function Bubble({ msg, myId, answering, peerName, onLongPress }: {
  msg: DmMessage;
  myId?: number;
  answering?: DmMessage;
  /** Who the other side is — a DM bubble has no sender on it, so the quote of
   *  a message you are answering has to be told whose it was. */
  peerName?: string | null;
  onLongPress: () => void;
}) {
  const { c } = useTheme();
  const mine = msg.mine;
  const img = msg.images?.[0] || msg.image || null;
  /* Capsule on one line, squarer on two — the shape follows the box. */
  const shape = useBubbleRadius(msg.body);

  /* View-once. The thread payload carries NO bytes for one of these, so there
     is nothing to render until it is opened — and opening it is a one-way door,
     which is why it is its own tap rather than something that happens on
     scroll. Once opened, the bytes are held in state for as long as the screen
     lives and never fetched again: a second request is a 410 by design. */
  const [once, setOnce] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const viewOnce = !msg.deleted && !!msg.viewOnce;
  const openedAlready = viewOnce && !!msg.viewed;

  const openOnce = async () => {
    if (opening || once) return;
    setOpening(true);
    try {
      const r = await openViewOnce(msg.id);
      haptics.tap();
      setOnce(r.image ?? r.images?.[0] ?? r.media ?? null);
    } catch (e) {
      haptics.error();
      /* A 410 is the feature working, not a failure — say so plainly rather
         than showing it as an error. */
      const gone = (e as { status?: number }).status === 410;
      Alert.alert('View once', gone ? 'You have already opened this one.' : (e as Error).message);
    } finally { setOpening(false); }
  };

  const voice = !msg.deleted && msg.media_kind === 'audio' && msg.media ? msg.media : null;
  /* A rich card — money, an invoice, an order, a call that happened. Every one
     of these used to render as the words "📎 Attachment", which is the whole
     of Beam's own pitch reduced to a paperclip. */
  const meta = !msg.deleted && msg.meta && typeof msg.meta === 'object'
    ? (msg.meta as Meta) : null;
  const label = msg.deleted
    ? 'Message deleted'
    : voice || meta
      ? null
      : msg.media_kind === 'audio'
        ? '🎤 Voice message'
        : msg.media_kind === 'video'
          ? '🎬 Video'
          : null;

  return (
    <View style={[styles.bubbleRow, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
      {/* A text bubble is capped at 78% so a wall of text does not run edge to
          edge. A CARD is a fixed layout — an icon, a title, a line of context
          and an amount — and at 78% the titles truncated ("You received m…")
          and every subtitle wrapped to three lines. It gets the wider cap. */}
      <View style={{ maxWidth: meta ? '90%' : '78%' }}>
      <Pressable
        onLongPress={msg.deleted ? undefined : onLongPress}
        delayLongPress={280}
        accessibilityRole="button"
        accessibilityHint="Press and hold for message options"
        onLayout={shape.onLayout}
        style={[
          styles.bubble,
          /* No squared-off tail corner. A bubble is round on ALL FOUR corners,
             the way iOS 26 Messages draws them — one flat 4pt corner is exactly
             what stopped these reading as fully rounded. */
          { backgroundColor: mine ? c.accent : c.s2, borderRadius: shape.borderRadius },
          /* A card brings its own surface, so the bubble gets out of its way —
             the same reason a sticker has no bubble. A blue pill wrapped round
             a grey card is two backgrounds arguing. */
          meta && styles.bubbleCard,
        ]}
      >
        {!!answering && (
          <ReplyQuote
            name={answering.mine ? 'You' : peerName ?? null}
            preview={previewOf(answering)}
            mine={mine}
          />
        )}
        {viewOnce ? (
          once ? (
            <Image source={{ uri: mediaUri(once) }} style={styles.bubbleImg}
              contentFit="cover" transition={120} />
          ) : (
            <Pressable
              onPress={mine || openedAlready ? undefined : openOnce}
              disabled={mine || openedAlready}
              style={[styles.onceBox, { borderColor: mine ? 'rgba(255,255,255,0.3)' : c.border }]}
              accessibilityRole="button"
              accessibilityLabel={mine ? 'View once photo you sent' : 'Tap to view once'}
            >
              <Ionicons
                name={openedAlready ? 'eye-off-outline' : 'flame-outline'}
                size={19}
                color={mine ? '#fff' : c.t2}
              />
              <Text variant="caption" style={{ marginLeft: 8, color: mine ? '#fff' : c.t2 }}>
                {opening ? 'Opening…'
                  : mine ? (openedAlready ? 'Opened' : 'View once')
                  : openedAlready ? 'Opened' : 'Tap to view once'}
              </Text>
            </Pressable>
          )
        ) : img ? (
          <Image
            source={{ uri: mediaUri(img) }}
            style={styles.bubbleImg}
            contentFit="cover"
            transition={120}
          />
        ) : null}
        {voice && (
          <VoiceNote uri={voice} durationSec={msg.duration_sec} mine={mine} />
        )}
        {meta && <MetaCard meta={meta} mine={mine} body={msg.body} />}
        {label ? (
          <Text
            variant="body"
            style={{ color: mine ? '#fff' : c.t2, fontStyle: msg.deleted ? 'italic' : 'normal' }}
          >
            {label}
          </Text>
        ) : (
          /* A card carries its own words. The server sends a body alongside it
             for the chat list's preview and for anything that cannot draw the
             card — printing it under the card as well says everything twice.
             A Daily reply is the exception the other way: the card IS the
             reply, so it renders the body itself. */
          !meta && !!msg.body && (
            <Text variant="body" style={{ color: mine ? '#fff' : c.text }}>
              {msg.body}
            </Text>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 12,
    paddingBottom: 10,
    height: CHAT_HEAD_H,
    /* No hairline: chrome has no edge — the content dissolves under it. */
  },
  peer: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', height: 38, paddingLeft: 4, paddingRight: 14 },
  peerName: { marginLeft: 8, flexShrink: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  bubbleRow: { flexDirection: 'row', marginVertical: 3 },
  /* `radius.bubble` is past half the height of a bubble up to four lines
     long, so those are true capsules; the padding is what keeps a longer
     one's first line clear of the curve (see the token). */
  bubble: { borderRadius: radius.bubble, paddingVertical: 10, paddingHorizontal: 16 },
  bubbleCard: { backgroundColor: 'transparent', padding: 0 },
  onceBox: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderStyle: 'dashed',
  },
  bubbleImg: { width: 200, height: 200, borderRadius: radius.bubble - 10, marginBottom: 4 },
});
