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
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { GlassComposer } from '@/components/GlassComposer';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { sendChat, askAgent, runAgentAction, agentSummary, type ChatMessage, type AgentAction } from '@/api/ai';
import { haptics } from '@/lib/haptics';

const EXAMPLES = [
  'Draft a friendly reply to a customer asking for a refund',
  'Write a short post announcing a summer sale',
  'Give me 5 name ideas for a coffee brand',
];

// Phrases that mean "do something", rather than "tell me something". Checked
// here so an ordinary question never takes the slower agent route.
const DOING = /\b(create|make|schedule|set up|book|send|invoice|remind|post)\b/i;

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
  // Something the assistant is offering to DO, waiting to be agreed to.
  const [pending, setPending] = useState<AgentAction | null>(null);
  const [doing, setDoing] = useState(false);
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
      // Anything phrased as an instruction goes to the assistant that can act.
      // It either hands back something to do — shown as a card to agree to —
      // or plain words, in which case it reads exactly like a normal answer.
      if (DOING.test(content)) {
        const out = await askAgent(content);
        if (out.action) {
          setPending(out.action);
          setMessages([...next, { role: 'assistant', content: out.text || 'Here is what I would do — have a look before I do it.' }]);
          return;
        }
        if (out.text) { setMessages([...next, { role: 'assistant', content: out.text }]); return; }
      }
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

        {pending && (
          <ActionCard
            action={pending}
            busy={doing}
            onCancel={() => setPending(null)}
            onConfirm={async () => {
              setDoing(true);
              setError(null);
              try {
                const done = await runAgentAction(pending);
                setMessages((m) => [...m, { role: 'assistant', content: done }]);
                setPending(null);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setDoing(false);
                scrollEnd();
              }
            }}
          />
        )}

        {error && (
          <Text variant="caption" tone="danger" style={{ paddingHorizontal: spacing.lg, paddingBottom: 6 }}>
            {error}
          </Text>
        )}

        {/* Composer — floating Liquid Glass pill (ChatGPT-style, Atwe design) */}
        <GlassComposer
          value={text}
          onChangeText={setText}
          onSend={() => ask()}
          placeholder="Message Atwe AI"
          sending={busy}
        />
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
    paddingHorizontal: spacing.gutter,
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

/**
 * The confirmation card. Nothing the assistant proposes happens until this is
 * read and agreed to — which is the point, and why the words on it are the
 * actual details rather than a summary of them.
 */
function ActionCard({
  action, busy, onConfirm, onCancel,
}: { action: AgentAction; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const { c, radius, spacing } = useTheme();
  const s = agentSummary(action);
  return (
    <View style={[cardStyles.wrap, { backgroundColor: c.s1, borderRadius: radius.card, marginHorizontal: spacing.md }]}>
      <Text variant="headline">{s.title}</Text>
      {s.lines.map((l, i) => (
        <Text key={i} variant="callout" tone="t2" style={{ marginTop: 4 }}>{l}</Text>
      ))}
      <View style={cardStyles.row}>
        <Pressable
          onPress={onCancel}
          style={[cardStyles.btn, { backgroundColor: c.s2, borderRadius: radius.pill }]}
          accessibilityRole="button"
        >
          <Text variant="callout" tone="t2">Not now</Text>
        </Pressable>
        <Pressable
          onPress={() => { void haptics.press(); onConfirm(); }}
          disabled={busy}
          style={[cardStyles.btn, { backgroundColor: c.primary, borderRadius: radius.pill, opacity: busy ? 0.6 : 1 }]}
          accessibilityRole="button"
        >
          <Text variant="callout" tone="onPrimary" weight="700">{busy ? 'Working…' : s.confirm}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  wrap: { padding: 16, marginBottom: 10 },
  row: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { flex: 1, alignItems: 'center', paddingVertical: 11 },
});
