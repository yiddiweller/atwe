import { useState } from 'react';
import { View, TextInput, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from './Text';
import { Button } from './Button';
import { Avatar } from './Avatar';
import { useTheme } from '@/theme/ThemeProvider';
import {
  useProductQa, askProductQuestion, answerProductQuestion,
  deleteProductQuestion, deleteProductAnswer, type QaQuestion,
} from '@/api/seller';
import { timeAgo } from '@/lib/format';
import { haptics } from '@/lib/haptics';

/**
 * "Does it come oiled?" — the questions buyers ask before they buy, answered in
 * public so the next person does not have to ask again.
 *
 * The SELLER's answer is flagged and sorted first by the server; that is the one
 * a shopper is looking for, so it is the one marked.
 */
export function ProductQa({ productId }: { productId: number }) {
  const { c, radius, spacing } = useTheme();
  const { data, isLoading, refetch } = useProductQa(productId);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const questions = data?.questions ?? [];
  const isSeller = !!data?.isSeller;

  const ask = async () => {
    const body = q.trim();
    if (!body || busy) return;
    setBusy(true);
    try { await askProductQuestion(productId, body); haptics.success(); setQ(''); refetch(); }
    catch (e) { haptics.error(); Alert.alert('Question', (e as Error).message); }
    finally { setBusy(false); }
  };

  if (isLoading) return <ActivityIndicator color={c.accent} style={{ marginVertical: 20 }} />;

  return (
    <View style={{ marginTop: 26 }}>
      <Text variant="headline" style={{ marginBottom: 10 }}>Questions</Text>

      {questions.length === 0 && (
        <Text variant="caption" tone="t3" style={{ marginBottom: 12 }}>
          {isSeller
            ? 'Nobody has asked anything yet.'
            : 'No questions yet. Ask the seller anything about it.'}
        </Text>
      )}

      {questions.map((item) => (
        <Question key={item.id} q={item} isSeller={isSeller} onDone={refetch} />
      ))}

      {/* A seller answers, they do not ask themselves. */}
      {!isSeller && (
        <View style={[styles.askBox, { backgroundColor: c.s2, borderRadius: radius.card }]}>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Ask about this item…"
            placeholderTextColor={c.t4}
            multiline
            accessibilityLabel="Your question"
            style={[styles.askInput, { color: c.text }]}
          />
          <Button title="Ask" onPress={ask} loading={busy} disabled={!q.trim()}
            style={{ minHeight: 38, alignSelf: 'flex-end', paddingHorizontal: 22 }} />
        </View>
      )}
    </View>
  );
}

function Question({ q, isSeller, onDone }: { q: QaQuestion; isSeller: boolean; onDone: () => void }) {
  const { c, radius } = useTheme();
  const router = useRouter();
  const [answering, setAnswering] = useState(false);
  const [a, setA] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const body = a.trim();
    if (!body || busy) return;
    setBusy(true);
    try { await answerProductQuestion(q.id, body); haptics.success(); setA(''); setAnswering(false); onDone(); }
    catch (e) { haptics.error(); Alert.alert('Answer', (e as Error).message); }
    finally { setBusy(false); }
  };

  const removeQ = () => {
    Alert.alert('Delete this question?', '', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try { await deleteProductQuestion(q.id); haptics.success(); onDone(); }
          catch (e) { haptics.error(); Alert.alert('Question', (e as Error).message); }
        },
      },
    ]);
  };

  return (
    <View style={[styles.qCard, { backgroundColor: c.s1, borderRadius: radius.card }]}>
      <Pressable
        style={styles.qHead}
        onPress={() => q.asker.username && router.push(`/user/${q.asker.username}`)}
      >
        <Avatar name={q.asker.name} avatar={q.asker.avatar}
          biz={q.asker.accountType === 'business'} size={26} />
        <Text variant="caption" tone="t3" style={{ flex: 1, marginLeft: 8 }} numberOfLines={1}>
          {q.asker.name} · {timeAgo(q.createdAt)}
        </Text>
        {/* The asker can take their own question back; so can the seller, who
            has to live with it on their listing. */}
        {(q.mine || isSeller) && (
          <Pressable onPress={removeQ} hitSlop={8} accessibilityLabel="Delete this question">
            <Ionicons name="trash-outline" size={15} color={c.t3} />
          </Pressable>
        )}
      </Pressable>

      <Text variant="body" style={{ marginTop: 6 }}>{q.body}</Text>

      {q.answers.map((ans) => (
        <View key={ans.id} style={[styles.answer, { borderLeftColor: ans.bySeller ? c.accent : c.border }]}>
          <View style={styles.qHead}>
            <Text variant="caption" tone={ans.bySeller ? 'accent' : 't3'} numberOfLines={1} style={{ flex: 1 }}>
              {ans.bySeller ? `${ans.author.name} · the seller` : ans.author.name}
              {' · '}{timeAgo(ans.createdAt)}
            </Text>
            {ans.mine && (
              <Pressable
                onPress={async () => {
                  try { await deleteProductAnswer(ans.id); haptics.success(); onDone(); }
                  catch (e) { haptics.error(); Alert.alert('Answer', (e as Error).message); }
                }}
                hitSlop={8}
                accessibilityLabel="Delete this answer"
              >
                <Ionicons name="trash-outline" size={14} color={c.t3} />
              </Pressable>
            )}
          </View>
          <Text variant="body" tone="t2" style={{ marginTop: 4 }}>{ans.body}</Text>
        </View>
      ))}

      {isSeller && !answering && (
        <Pressable onPress={() => { haptics.tap(); setAnswering(true); }} hitSlop={6} style={{ marginTop: 10 }}
          accessibilityRole="button" accessibilityLabel="Answer this question">
          <Text variant="caption" tone="accent">Answer</Text>
        </Pressable>
      )}
      {isSeller && answering && (
        <View style={{ marginTop: 10 }}>
          <TextInput
            value={a} onChangeText={setA}
            placeholder="Your answer…" placeholderTextColor={c.t4} multiline autoFocus
            accessibilityLabel="Your answer"
            style={[styles.askInput, { color: c.text, backgroundColor: c.s2, borderRadius: radius.bubble, paddingHorizontal: 16 }]}
          />
          <Button title="Post the answer" onPress={send} loading={busy} disabled={!a.trim()}
            style={{ minHeight: 38, marginTop: 8 }} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  qCard: { padding: 14, marginBottom: 10 },
  qHead: { flexDirection: 'row', alignItems: 'center' },
  answer: { marginTop: 12, paddingLeft: 12, borderLeftWidth: 2 },
  askBox: { padding: 12, marginTop: 4 },
  askInput: { fontSize: 15, minHeight: 60, textAlignVertical: 'top', paddingVertical: 8, marginBottom: 8 },
});
