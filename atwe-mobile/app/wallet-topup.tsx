import { useState } from 'react';
import { View, Pressable, StyleSheet, Linking, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeProvider';
import { topUp, money } from '@/api/wallet';
import { haptics } from '@/lib/haptics';

/**
 * Putting money in. Real amounts only, and if the server has card payments set
 * up it hands back a page to open — the card details are never typed here,
 * which is deliberate: they should be entered somewhere that is already trusted
 * to hold them.
 */
const PRESETS = [1000, 2500, 5000, 10000];

export default function WalletTopUp() {
  const { c, radius, spacing } = useTheme();
  const qc = useQueryClient();
  const [amount, setAmount] = useState<number>(2500);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id for this attempt, so a double tap or a retry after a dropped
  // connection can never add the money twice.
  const [clientId] = useState(() => `topup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  const go = async () => {
    setBusy(true); setError(null);
    try {
      const r = await topUp({ amount: amount / 100, clientId });
      if (r.url) { await Linking.openURL(r.url); router.back(); return; }
      void haptics.success();
      qc.invalidateQueries({ queryKey: ['wallet'] });
      router.back();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={[styles.head, { paddingHorizontal: spacing.lg }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
          <Text variant="callout" tone="t2">Cancel</Text>
        </Pressable>
        <Text variant="headline">Add money</Text>
        <View style={{ width: 50 }} />
      </View>

      <View style={{ paddingHorizontal: spacing.lg }}>
        <Text variant="display" style={{ textAlign: 'center', marginVertical: 24 }}>{money(amount)}</Text>
        <View style={styles.grid}>
          {PRESETS.map((p) => {
            const on = amount === p;
            return (
              <Pressable
                key={p}
                onPress={() => { setAmount(p); void haptics.select(); }}
                style={[styles.chip, {
                  backgroundColor: on ? c.accent : c.s1,
                  borderRadius: radius.pill,
                }]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text variant="callout" weight="600" style={{ color: on ? '#fff' : c.text }}>{money(p)}</Text>
              </Pressable>
            );
          })}
        </View>
        {error && <Text variant="caption" tone="danger" style={{ marginTop: 14 }}>{error}</Text>}
        <View style={{ height: 24 }} />
        {busy ? <ActivityIndicator color={c.accent} /> : <Button title={`Add ${money(amount)}`} onPress={go} />}
        <Text variant="caption" tone="t3" style={{ marginTop: 14, textAlign: 'center' }}>
          If card payments are set up, this opens a secure page to pay on.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  chip: { paddingHorizontal: 22, paddingVertical: 12, minWidth: 92, alignItems: 'center' },
});
