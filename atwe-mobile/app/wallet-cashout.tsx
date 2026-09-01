import { useState } from 'react';
import { View, TextInput, Pressable, StyleSheet, Linking, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { ChromePill } from '@/components/Chrome';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { useCashoutStatus, cashOut, connectBank, money } from '@/api/wallet';
import { HapticInput } from '@/components/HapticInput';
import { haptics } from '@/lib/haptics';

/**
 * Taking money out to a bank account.
 *
 * Three honest states, and the screen says which one you are in rather than
 * showing a button that will not work: payouts are not set up on this server at
 * all; your bank is not connected yet; or you are ready and it is a matter of
 * how much.
 */
export default function WalletCashOut() {
  const { c, radius, spacing } = useTheme();
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useCashoutStatus();
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId] = useState(() => `cashout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  const balance = data?.balanceCents ?? 0;
  const cents = Math.round((parseFloat(amount) || 0) * 100);
  const ready = !!data?.payoutsEnabled;

  const connect = async () => {
    setBusy(true); setError(null);
    try {
      const r = await connectBank();
      if (r.url) await Linking.openURL(r.url);
      // They come back to the app after; a refresh picks up the new state.
      setTimeout(() => refetch(), 1200);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const go = async () => {
    setBusy(true); setError(null);
    try {
      await cashOut({ amount: cents / 100, clientId });
      void haptics.success();
      qc.invalidateQueries({ queryKey: ['wallet'] });
      router.back();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const input = {
    backgroundColor: c.s2, color: c.text, borderRadius: radius.pill,
    paddingHorizontal: spacing.gutter, height: 56, fontSize: 22, fontWeight: '700' as const,
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={[styles.head, { paddingHorizontal: spacing.lg }]}>
        <ChromePill text="Cancel" onPress={() => router.back()} />
        <Text variant="headline">Cash out</Text>
        <View style={{ width: 84 }} />
      </View>

      <View style={{ paddingHorizontal: spacing.lg }}>
        {isLoading ? (
          <ActivityIndicator color={c.accent} style={{ marginTop: 40 }} />
        ) : !data?.configured ? (
          <Text variant="body" tone="t2" style={{ marginTop: 30 }}>
            Paying out to a bank is not set up on this server yet.
          </Text>
        ) : !ready ? (
          <>
            <Text variant="body" tone="t2" style={{ marginTop: 20, marginBottom: 20 }}>
              Connect a bank account first. It opens a secure page — we never see your
              bank details.
            </Text>
            <Button title="Connect a bank account" onPress={connect} loading={busy} />
          </>
        ) : (
          <>
            <Text variant="callout" tone="t2" style={{ marginTop: 18, marginBottom: 8 }}>
              You have {money(balance)}
            </Text>
            <HapticInput
              style={input}
              placeholder="0.00"
              placeholderTextColor={c.t3}
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
              accessibilityLabel="Amount to cash out"
            />
            {cents > balance && (
              <Text variant="caption" tone="danger" style={{ marginTop: 10 }}>
                That is more than you have.
              </Text>
            )}
            {error && <Text variant="caption" tone="danger" style={{ marginTop: 10 }}>{error}</Text>}
            <View style={{ height: 22 }} />
            <Button
              title={cents > 0 ? `Cash out ${money(cents)}` : 'Cash out'}
              onPress={go}
              loading={busy}
              disabled={cents <= 0 || cents > balance}
            />
            <Text variant="caption" tone="t3" style={{ marginTop: 14 }}>
              It usually reaches your bank in a couple of working days.
            </Text>
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
});
