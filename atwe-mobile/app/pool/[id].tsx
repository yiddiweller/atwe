import { useState } from 'react';
import { View, ScrollView, StyleSheet, ActivityIndicator, Alert, TextInput } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { PageHeader } from '@/components/PageHeader';
import { chromePad } from '@/components/Chrome';
import { useTheme } from '@/theme/ThemeProvider';
import { usePool, contributeToPool, closePool } from '@/api/money';
import { money } from '@/api/wallet';
import { timeAgo } from '@/lib/format';
import { haptics } from '@/lib/haptics';

/** One pool: the progress, who chipped in, and a box to chip in yourself. */
export default function PoolDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, radius, spacing } = useTheme();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = usePool(id);
  const p = data?.pool;
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const give = async () => {
    if (!p) return;
    const cents = Math.round(parseFloat(amount.replace(/[^0-9.]/g, '')) * 100);
    if (!Number.isFinite(cents) || cents <= 0) { Alert.alert('Pool', 'How much would you like to put in?'); return; }
    setBusy(true);
    try {
      await contributeToPool(p.id, cents);
      haptics.success();
      setAmount('');
      qc.invalidateQueries({ queryKey: ['wallet'] });
      qc.invalidateQueries({ queryKey: ['pools'] });
      refetch();
    } catch (e) { haptics.error(); Alert.alert('Pool', (e as Error).message); }
    finally { setBusy(false); }
  };

  const close = () => {
    if (!p) return;
    Alert.alert('Close this pool?', 'Nobody will be able to chip in after that.', [
      { text: 'Keep it open', style: 'cancel' },
      {
        text: 'Close it', style: 'destructive', onPress: async () => {
          setBusy(true);
          try { await closePool(p.id); haptics.success(); qc.invalidateQueries({ queryKey: ['pools'] }); refetch(); }
          catch (e) { haptics.error(); Alert.alert('Pool', (e as Error).message); }
          finally { setBusy(false); }
        },
      },
    ]);
  };

  const pct = p?.goalCents ? Math.min(1, p.raisedCents / p.goalCents) : 0;

  return (
    <Screen edges={[]}>
      <PageHeader title="Pool" />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : isError || !p ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">This pool is not available.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[{ padding: spacing.gutter, paddingBottom: 60 }, chromePad.header]} keyboardShouldPersistTaps="handled">
          <View style={[styles.hero, { backgroundColor: c.s1, borderRadius: radius.card }]}>
            <Text variant="caption" tone="t3">RAISED SO FAR</Text>
            <Text variant="display" weight="800" style={{ marginTop: 4 }}>{money(p.raisedCents)}</Text>
            {!!p.goalCents && (
              <>
                <View style={[styles.bar, { backgroundColor: c.s2 }]}>
                  <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: c.green }]} />
                </View>
                <Text variant="caption" tone="t2" style={{ marginTop: 8 }}>of {money(p.goalCents)}</Text>
              </>
            )}
          </View>

          <Text variant="title" style={{ marginTop: 18 }}>{p.title}</Text>
          {!!p.description && (
            <Text variant="body" tone="t2" style={{ marginTop: 8, lineHeight: 22 }}>{p.description}</Text>
          )}

          <View style={[styles.who, { backgroundColor: c.s1, borderRadius: radius.card }]}>
            <Avatar name={p.creator.name} avatar={p.creator.avatar} size={38} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text variant="headline" numberOfLines={1}>{p.creator.name}</Text>
              <Text variant="caption" tone="t3">started this pool</Text>
            </View>
          </View>

          {p.closed ? (
            <Text variant="callout" tone="t3" style={{ marginTop: 22, textAlign: 'center' }}>
              This pool is closed.
            </Text>
          ) : !p.iAmCreator ? (
            <View style={{ marginTop: 22 }}>
              <Text variant="caption" tone="t3" style={{ marginBottom: 8, letterSpacing: 0.6 }}>CHIP IN</Text>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                placeholder="20"
                placeholderTextColor={c.t4}
                keyboardType="decimal-pad"
                accessibilityLabel="Amount in dollars"
                style={[styles.input, { backgroundColor: c.s2, color: c.text, borderRadius: radius.md }]}
              />
              <View style={{ height: 12 }} />
              <Button title="Put it in" onPress={give} loading={busy} />
            </View>
          ) : (
            <View style={{ marginTop: 22 }}>
              <Button title="Close this pool" kind="danger" onPress={close} loading={busy} />
            </View>
          )}

          {!!p.contributors?.length && (
            <View style={{ marginTop: 28 }}>
              <Text variant="caption" tone="t3" style={{ marginBottom: 8, letterSpacing: 0.6 }}>WHO CHIPPED IN</Text>
              {p.contributors.map((k, i) => (
                <View key={i} style={[styles.share, { borderBottomColor: c.border }]}>
                  <Avatar name={k.name} avatar={k.avatar} size={32} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text variant="body" numberOfLines={1}>{k.name}</Text>
                    <Text variant="micro" tone="t3">{timeAgo(k.at)}</Text>
                  </View>
                  <Text variant="body" style={{ color: c.green }}>{money(k.amountCents)}</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  hero: { padding: 20 },
  bar: { height: 6, borderRadius: 999, marginTop: 14, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 999 },
  who: { flexDirection: 'row', alignItems: 'center', padding: 12, marginTop: 16 },
  share: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  input: { paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
});
