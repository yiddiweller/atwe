import { useRef, useState } from 'react';
import {
  View,
  FlatList,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { useTheme } from '@/theme/ThemeProvider';
import { sendChat, type ChatMessage } from '@/api/ai';

const EXAMPLES = [
  'Draft a friendly reply to a customer asking for a refund',
  'Write a short post announcing a summer sale',
  'Give me 5 name ideas for a coffee brand',
];

/**
 * Atwe AI — the assistant chat over POST /api/chat. Sends the running
 * conversation and renders the reply. In-memory for now (one conversation);
 * saved history, the agent action-cards and streaming come in later slices.
 */
export default function AI() {
  const { c, spacing } = useTheme();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const scrollEnd = () => setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);

  const ask = async (prompt?: string) => {
    const content = (prompt ?? text).trim();
    if (!content || busy) return;
    setError(null);
    const next = [...messages, { role: 'user' as const, content }];
    setMessages(next);
    setText('');
    setBusy(true);
    scrollEnd();
    try {
      const reply = await sendChat(next);
      setMessages([...next, { role: 'assistant', content: reply || '…' }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      scrollEnd();
    }
  };

  const empty = messages.length === 0;

  return (
    <Screen edges={['top']}>
      <View style={[styles.head, { borderBottomColor: c.border }]}>
        <Ionicons name="sparkles" size={18} color={c.accent} />
        <Text variant="title" style={{ marginLeft: 8 }}>
          Atwe AI
        </Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}
      >
        {empty ? (
          <View style={styles.hero}>
            <View style={[styles.orb, { backgroundColor: c.accentDim ?? c.s2 }]}>
              <Ionicons name="sparkles" size={30} color={c.accent} />
            </View>
            <Text variant="title" style={{ marginTop: 14, textAlign: 'center' }}>
              Ask Atwe AI anything
            </Text>
            <Text variant="body" tone="t3" style={{ marginTop: 6, textAlign: 'center' }}>
              Your business assistant — draft, brainstorm, analyze.
            </Text>
            <View style={{ height: 20 }} />
            {EXAMPLES.map((ex) => (
              <Pressable
                key={ex}
                onPress={() => ask(ex)}
                style={[styles.example, { backgroundColor: c.s1, borderColor: c.border }]}
              >
                <Text variant="callout" tone="t2">
                  {ex}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(_, i) => String(i)}
            renderItem={({ item }) => <Msg msg={item} />}
            contentContainerStyle={{ paddingVertical: 12, paddingHorizontal: 12 }}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={scrollEnd}
            ListFooterComponent={
              busy ? (
                <View style={[styles.typing]}>
                  <Text variant="callout" tone="t3">
                    Atwe AI is thinking…
                  </Text>
                </View>
              ) : null
            }
          />
        )}

        {error && (
          <Text variant="caption" tone="danger" style={{ paddingHorizontal: spacing.lg, paddingBottom: 6 }}>
            {error}
          </Text>
        )}

        {/* Composer */}
        <View style={[styles.composer, { borderTopColor: c.border, paddingBottom: spacing.md }]}>
          <TextInput
            style={[styles.input, { backgroundColor: c.s2, color: c.text }]}
            placeholder="Message Atwe AI"
            placeholderTextColor={c.t3}
            value={text}
            onChangeText={setText}
            multiline
            accessibilityLabel="Message Atwe AI"
          />
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              ask();
            }}
            disabled={!text.trim() || busy}
            style={[styles.sendBtn, { backgroundColor: text.trim() ? c.accent : c.s2 }]}
            accessibilityLabel="Send"
          >
            <Ionicons name="arrow-up" size={20} color={text.trim() ? '#fff' : c.t3} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Msg({ msg }: { msg: ChatMessage }) {
  const { c } = useTheme();
  const mine = msg.role === 'user';
  return (
    <View style={[styles.row, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
      <View
        style={[
          styles.bubble,
          mine
            ? { backgroundColor: c.accent, maxWidth: '82%', borderBottomRightRadius: 4 }
            : { backgroundColor: c.s2, maxWidth: '92%', borderBottomLeftRadius: 4 },
        ]}
      >
        <Text variant="body" style={{ color: mine ? '#fff' : c.text }}>
          {msg.content}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  orb: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center' },
  example: {
    width: '100%',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 8,
  },
  row: { flexDirection: 'row', marginVertical: 4 },
  bubble: { borderRadius: 20, paddingVertical: 9, paddingHorizontal: 14 },
  typing: { paddingHorizontal: 14, paddingVertical: 8 },
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
