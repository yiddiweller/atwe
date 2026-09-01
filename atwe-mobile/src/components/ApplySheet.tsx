import { useState } from 'react';
import {
  Modal, View, ScrollView, Pressable, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { Button } from './Button';
import { HapticInput } from './HapticInput';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { applyToJob, aiCoverNote, type Job } from '@/api/jobs';
import { haptics } from '@/lib/haptics';

/**
 * Easy Apply.
 *
 * Two things stand between somebody and a job: the employer's screening
 * questions, and the blank box asking why they want it. Both are handled here —
 * the questions in the shape the employer set them, and the note with a "Write
 * it for me" that drafts from their own profile and résumé.
 *
 * The KNOCKOUT answers are deliberately not shown. The server strips each
 * question's `expect` before it ever reaches the phone, so nobody can read off
 * the answer the employer wants; a required question is simply marked required.
 */
export function ApplySheet({ visible, job, onClose, onApplied }: {
  visible: boolean;
  job: Job;
  onClose: () => void;
  onApplied: () => void;
}) {
  const { c } = useTheme();
  const [note, setNote] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);

  const setAnswer = (id: string, v: string) =>
    setAnswers((a) => ({ ...a, [id]: v }));

  /* A required question with nothing in it is the one thing worth blocking on:
     the server would take the application and silently mark it as missing the
     requirements, which reads to the applicant as though it went fine. */
  const missing = job.screening.filter((q) => q.required && !(answers[q.id] ?? '').trim());

  const draft = async () => {
    setDrafting(true);
    try {
      const r = await aiCoverNote(job.id);
      setNote(r.note);
      haptics.success();
    } catch (e) {
      haptics.error();
      Alert.alert('Atwe AI', (e as Error).message);
    } finally {
      setDrafting(false);
    }
  };

  const send = async () => {
    if (missing.length) {
      haptics.warning();
      Alert.alert('Almost there', 'Please answer the questions marked required.');
      return;
    }
    setBusy(true);
    try {
      await applyToJob(job.id, {
        note: note.trim() || undefined,
        answers: Object.keys(answers).length ? answers : undefined,
      });
      haptics.success();
      onApplied();
    } catch (e) {
      haptics.error();
      Alert.alert('Apply', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close">
          <Pressable style={[styles.card, { backgroundColor: c.bg }]} onPress={() => {}}>
            <View style={styles.head}>
              <View style={{ flex: 1 }}>
                <Text variant="title">Apply</Text>
                <Text variant="caption" tone="t3" numberOfLines={1}>
                  {job.title}{job.company ? ` · ${job.company}` : ''}
                </Text>
              </View>
              <Pressable onPress={onClose} hitSlop={10}
                accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={24} color={c.t2} />
              </Pressable>
            </View>

            <ScrollView
              style={{ maxHeight: 420 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {job.screening.map((q) => (
                <View key={q.id} style={{ marginTop: 16 }}>
                  <Text variant="callout" tone="t2" style={{ marginBottom: 8 }}>
                    {q.text}{q.required ? ' *' : ''}
                  </Text>
                  {q.type === 'yesno' ? (
                    <View style={styles.chips}>
                      {['yes', 'no'].map((v) => {
                        const on = (answers[q.id] ?? '') === v;
                        return (
                          <Pressable
                            key={v}
                            onPress={() => { haptics.select(); setAnswer(q.id, v); }}
                            style={[styles.chip, { backgroundColor: on ? c.accent : c.s1 }]}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: on }}
                            accessibilityLabel={v === 'yes' ? 'Yes' : 'No'}
                          >
                            <Text variant="callout" weight="600"
                              style={{ color: on ? c.accentTint : c.text }}>
                              {v === 'yes' ? 'Yes' : 'No'}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : (
                    <HapticInput
                      value={answers[q.id] ?? ''}
                      onChangeText={(v) => setAnswer(q.id, v)}
                      keyboardType={q.type === 'number' ? 'number-pad' : 'default'}
                      placeholder={q.type === 'number' ? 'A number' : 'Your answer'}
                      placeholderTextColor={c.t3}
                      style={[styles.input, { backgroundColor: c.s1, color: c.text }]}
                      accessibilityLabel={q.text}
                    />
                  )}
                </View>
              ))}

              <View style={styles.noteHead}>
                <Text variant="callout" tone="t2" style={{ flex: 1 }}>
                  A note to the employer
                </Text>
                <Pressable
                  onPress={draft}
                  disabled={drafting}
                  hitSlop={8}
                  style={[styles.ai, { backgroundColor: c.accentDim }]}
                  accessibilityRole="button"
                  accessibilityLabel="Write it for me with Atwe AI"
                >
                  {drafting ? (
                    <ActivityIndicator size="small" color={c.accent} />
                  ) : (
                    <Text variant="micro" style={{ color: c.accent }}>✦ Write it for me</Text>
                  )}
                </Pressable>
              </View>
              <HapticInput
                value={note}
                onChangeText={setNote}
                multiline
                placeholder="Why you, in a couple of lines. Optional."
                placeholderTextColor={c.t3}
                style={[styles.input, styles.noteBox, { backgroundColor: c.s1, color: c.text }]}
                accessibilityLabel="A note to the employer"
              />
            </ScrollView>

            <View style={{ marginTop: 18 }}>
              <Button title="Send application" kind="primary" loading={busy} onPress={send} />
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  card: {
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing.gutter, paddingBottom: 34,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  chips: { flexDirection: 'row', gap: 8 },
  chip: { paddingHorizontal: 20, height: 38, borderRadius: radius.pill, justifyContent: 'center' },
  input: { borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16 },
  noteBox: { minHeight: 110, textAlignVertical: 'top' },
  noteHead: { flexDirection: 'row', alignItems: 'center', marginTop: 20, marginBottom: 8, gap: 10 },
  ai: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, minWidth: 108, alignItems: 'center' },
});
