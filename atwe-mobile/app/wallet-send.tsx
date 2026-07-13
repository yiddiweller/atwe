import { useRef, useState } from 'react';
import { View, TextInput, KeyboardAvoidingView, Platform, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeProvider';
import { sendMoney } from '@/api/wallet';

/**
 * Send money to a @username. Posts to /api/wallet/send (server enforces the
 * $1–$2,000 range, blocks, velocity caps and clientId idempotency).
 */
export default function WalletSend() {
  const { c, radius, spacing } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const cid = useRef(`${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const canSend = to.trim().length > 0 && parseFloat(amount) > 0 && !busy;

  const submit = async () => {
    if (!canSend) return;
    setBusy(true);
    setError(null);
    try {
      await sendMoney({ to, amount, note, clientId: cid.current });
      qc.invalidateQueries({ queryKey: ['wallet'] });
      setDone(true);
      setTimeout(() => router.back(), 1100);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Screen>
        <View style={styles.center}>
          <View style={[styles.tick, { backgroundColor: c.repost }]}>
            <Ionicons name="checkmark" size={40} color="#fff" />
          </View>
          <Text variant="title" style={{ marginTop: 16 }}>
            Sent {amount ? `$${parseFloat(amount).toFixed(2)}` : ''}
          </Text>
          <Text variant="body" tone="t3" style={{ marginTop: 4 }}>
            to @{to.replace(/^@/, '')}
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text variant="headline" tone="t2">
            Cancel
          </Text>
        </Pressable>
        <Text variant="headline">Send money</Text>
        <View style={{ width: 54 }} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={{ padding: spacing.lg }}>
          <Field label="To (@username)">
            <TextInput
              style={[styles.input, { backgroundColor: c.s2, color: c.text, borderRadius: radius.md }]}
              placeholder="@username"
              placeholderTextColor={c.t3}
              value={to}
              onChangeText={setTo}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Recipient username"
            />
          </Field>

          <Field label="Amount">
            <View style={[styles.amountRow, { backgroundColor: c.s2, borderRadius: radius.md }]}>
              <Text variant="title" tone="t2">
                $
              </Text>
              <TextInput
                style={[styles.amountInput, { color: c.text }]}
                placeholder="0"
                placeholderTextColor={c.t3}
                value={amount}
                onChangeText={(t) => setAmount(t.replace(/[^0-9.]/g, ''))}
                keyboardType="decimal-pad"
                accessibilityLabel="Amount in dollars"
              />
            </View>
            <Text variant="micro" tone="t3" style={{ marginTop: 4 }}>
              $1 – $2,000
            </Text>
          </Field>

          <Field label="Note (optional)">
            <TextInput
              style={[styles.input, { backgroundColor: c.s2, color: c.text, borderRadius: radius.md }]}
              placeholder="What's it for?"
              placeholderTextColor={c.t3}
              value={note}
              onChangeText={setNote}
              maxLength={200}
              accessibilityLabel="Note"
            />
          </Field>

          {error && (
            <Text variant="caption" tone="danger" style={{ marginTop: 4 }}>
              {error}
            </Text>
          )}

          <View style={{ height: 20 }} />
          <Button
            title={amount ? `Send $${(parseFloat(amount) || 0).toFixed(2)}` : 'Send'}
            onPress={submit}
            loading={busy}
            disabled={!canSend}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 18 }}>
      <Text variant="caption" tone="t3" style={{ marginBottom: 6 }}>
        {label}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  tick: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  input: { height: 48, paddingHorizontal: 14, fontSize: 16 },
  amountRow: { flexDirection: 'row', alignItems: 'center', height: 64, paddingHorizontal: 16, gap: 4 },
  amountInput: { flex: 1, fontSize: 34, fontWeight: '700', paddingVertical: 0 },
});
