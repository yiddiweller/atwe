import { useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { ChromeButton } from '@/components/Chrome';
import { Button } from '@/components/Button';
import { HapticInput } from '@/components/HapticInput';
import { MeGroup } from '@/components/MeRow';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { haptics } from '@/lib/haptics';
import { FEEDBACK_CATEGORIES, sendFeedback, type FeedbackCategory } from '@/api/settings';
import { APP_VERSION } from '@/lib/version';

const LABEL: Record<FeedbackCategory, string> = {
  bug: 'Something is broken',
  idea: 'I have an idea',
  question: 'I have a question',
  other: 'Something else',
};
const ICON: Record<FeedbackCategory, React.ComponentProps<typeof Ionicons>['name']> = {
  bug: 'bug-outline',
  idea: 'bulb-outline',
  question: 'help-circle-outline',
  other: 'ellipsis-horizontal-outline',
};

/**
 * Tell us what went wrong — straight into the support inbox staff already work
 * (`POST /api/feedback` → `support_requests`), not a mailto: link that opens a
 * mail app somebody may never have set up.
 *
 * The four categories are the server's own `FEEDBACK_CATEGORIES`; sending a
 * fifth would just be filed as "other", so there is no point offering one.
 */
export default function Feedback() {
  const { c } = useTheme();
  const router = useRouter();
  const [cat, setCat] = useState<FeedbackCategory>('bug');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await sendFeedback({
        category: cat,
        body: body.trim(),
        /* The build goes with it. A bug report that does not say which version
           it happened on is a bug report somebody has to write back about — and
           it has to be the RIGHT version, which is why this reads app.json
           rather than the runtime manifest. See lib/version. */
        build: APP_VERSION,
      });
      haptics.success();
      setSent(true);
    } catch (e) {
      haptics.error();
      Alert.alert('Could not send that', (e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Screen edges={['top']}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={styles.head}>
          <ChromeButton onPress={() => { haptics.tap(); router.back(); }} label="Back">
            <Ionicons name="chevron-back" size={22} color={c.text} />
          </ChromeButton>
          <Text style={styles.title}>Send feedback</Text>
        </View>

        {sent ? (
          <View style={styles.done}>
            <Ionicons name="checkmark-circle" size={54} color={c.accent} />
            <Text variant="title" style={{ marginTop: 14 }}>Thank you</Text>
            <Text variant="body" tone="t3" style={styles.doneSub}>
              It went straight to the team. If it needs a reply, we'll email you.
            </Text>
            <View style={{ height: 20 }} />
            <Button title="Done" onPress={() => router.back()} />
          </View>
        ) : (
          <>
            <MeGroup>
              {FEEDBACK_CATEGORIES.map((k, i) => (
                <Pressable
                  key={k}
                  onPress={() => { haptics.select(); setCat(k); }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: cat === k }}
                  style={[styles.pick, {
                    borderBottomColor: c.bg,
                    borderBottomWidth: i === FEEDBACK_CATEGORIES.length - 1 ? 0 : 1,
                  }]}
                >
                  <Ionicons name={ICON[k]} size={20} color={c.text} style={styles.pickIc} />
                  <Text style={styles.pickLbl}>{LABEL[k]}</Text>
                  {cat === k && <Ionicons name="checkmark" size={20} color={c.accent} />}
                </Pressable>
              ))}
            </MeGroup>

            <HapticInput
              value={body}
              onChangeText={setBody}
              multiline
              placeholder={cat === 'bug'
                ? 'What did you do, and what happened instead?'
                : 'Tell us as much or as little as you like.'}
              placeholderTextColor={c.t3}
              style={[styles.box, { backgroundColor: c.s2, color: c.text }]}
              accessibilityLabel="Your feedback"
            />
            <Text style={[styles.cap, { color: c.t3 }]}>
              We send your account and the app version with it, so we can find the problem.
              Nothing else.
            </Text>
            <View style={{ height: 8 }} />
            <Button
              title={busy ? 'Sending…' : 'Send'}
              disabled={busy || body.trim().length < 3}
              onPress={() => void submit()}
            />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.gutter, paddingTop: 2, paddingBottom: 60 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 14 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.48, lineHeight: 29},
  pick: {
    flexDirection: 'row', alignItems: 'center', gap: 13,
    paddingVertical: 12, paddingHorizontal: 15, minHeight: 55,
  },
  pickIc: { width: 30, textAlign: 'center' },
  pickLbl: { flex: 1, fontSize: 15.5, fontWeight: '600', letterSpacing: -0.155 },
  box: {
    minHeight: 150, borderRadius: radius.card, padding: 15,
    fontSize: 16, lineHeight: 22, textAlignVertical: 'top',
  },
  cap: { fontSize: 12.5, lineHeight: 17, marginTop: 10, paddingHorizontal: 15 },
  done: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 20 },
  doneSub: { marginTop: 8, textAlign: 'center', lineHeight: 21 },
});
