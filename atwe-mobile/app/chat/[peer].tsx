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
import * as Haptics from 'expo-haptics';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Avatar } from '@/components/Avatar';
import { useTheme } from '@/theme/ThemeProvider';
import { useThread, sendDm, type DmMessage, type DmThreadData } from '@/api/beam';

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
  const { peer } = useLocalSearchParams<{ peer: string }>();
  const peerId = Number(peer);
  const { data, isLoading } = useThread(Number.isFinite(peerId) ? peerId : undefined);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<DmMessage>>(null);

  const messages = data?.messages ?? [];
  const canMessage = data?.canMessage !== false;

  const scrollEnd = () => setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    const clientId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic: DmMessage = {
      id: -Date.now(),
      body,
      image: null,
      images: [],
      media_kind: null,
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
    setSending(true);
    scrollEnd();
    try {
      await sendDm(peerId, body, clientId);
    } catch {
      // leave the optimistic bubble; the reconcile below will drop it if it failed
    } finally {
      setSending(false);
      qc.invalidateQueries({ queryKey: ['thread', peerId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
      scrollEnd();
    }
  };

  return (
    <Screen edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <Ionicons name="chevron-back" size={26} color={c.accent} />
        </Pressable>
        <Pressable
          style={styles.peer}
          onPress={() => data?.peer.username && router.push(`/user/${data.peer.username}`)}
        >
          <Avatar name={data?.peer.name} avatar={data?.peer.avatar} size={34} />
          <Text variant="headline" numberOfLines={1} style={{ marginLeft: 8 }}>
            {data?.peer.name ?? '…'}
          </Text>
        </Pressable>
        <View style={styles.back} />
      </View>

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
            renderItem={({ item }) => <Bubble msg={item} />}
            contentContainerStyle={{ paddingVertical: 12, paddingHorizontal: 12 }}
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

          {/* Composer */}
          <View style={[styles.composer, { borderTopColor: c.border, paddingBottom: spacing.md }]}>
            <TextInput
              style={[styles.input, { backgroundColor: c.s2, color: c.text }]}
              placeholder={canMessage ? 'Message' : "You can't message this account"}
              placeholderTextColor={c.t3}
              value={text}
              onChangeText={setText}
              editable={canMessage}
              multiline
              accessibilityLabel="Message text"
            />
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                send();
              }}
              disabled={!text.trim() || sending || !canMessage}
              style={[
                styles.sendBtn,
                { backgroundColor: text.trim() && canMessage ? c.accent : c.s2 },
              ]}
              accessibilityLabel="Send"
            >
              <Ionicons
                name="arrow-up"
                size={20}
                color={text.trim() && canMessage ? '#fff' : c.t3}
              />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}
    </Screen>
  );
}

function Bubble({ msg }: { msg: DmMessage }) {
  const { c } = useTheme();
  const mine = msg.mine;
  const img = msg.images?.[0] || msg.image || null;

  const label = msg.deleted
    ? 'Message deleted'
    : msg.media_kind === 'audio'
      ? '🎤 Voice message'
      : msg.media_kind === 'video'
        ? '🎬 Video'
        : msg.meta
          ? '📎 Attachment'
          : null;

  return (
    <View style={[styles.bubbleRow, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
      <View
        style={[
          styles.bubble,
          mine
            ? { backgroundColor: c.accent, borderBottomRightRadius: 4 }
            : { backgroundColor: c.s2, borderBottomLeftRadius: 4 },
        ]}
      >
        {img && (
          <Image
            source={{ uri: img }}
            style={styles.bubbleImg}
            contentFit="cover"
            transition={120}
          />
        )}
        {label ? (
          <Text
            variant="body"
            style={{ color: mine ? '#fff' : c.t2, fontStyle: msg.deleted ? 'italic' : 'normal' }}
          >
            {label}
          </Text>
        ) : (
          !!msg.body && (
            <Text variant="body" style={{ color: mine ? '#fff' : c.text }}>
              {msg.body}
            </Text>
          )
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: { width: 40, alignItems: 'flex-start' },
  peer: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  bubbleRow: { flexDirection: 'row', marginVertical: 3 },
  bubble: { maxWidth: '78%', borderRadius: 20, paddingVertical: 8, paddingHorizontal: 13 },
  bubbleImg: { width: 200, height: 200, borderRadius: 12, marginBottom: 4 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 16,
  },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
