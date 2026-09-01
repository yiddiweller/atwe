import { useState } from 'react';
import { View, FlatList, StyleSheet, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { PageHeader } from '@/components/PageHeader';
import { Shelf } from '@/components/Shelf';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import {
  useScheduledPayments, setScheduledPaymentPaused, cancelScheduledPayment,
  everyLabel, type ScheduledPayment,
} from '@/api/money';
import { money } from '@/api/wallet';
import { haptics } from '@/lib/haptics';

/**
 * Standing payments — money that goes out on its own, on a date or on a repeat.
 * The thing a person wants to know here is WHEN the next one goes, so that is
 * the line under the name; the amount is the number on the right.
 */
export default function ScheduledPayments() {
  const { c } = useTheme();
  const [shelf, setShelf] = useState<'outgoing' | 'incoming'>('outgoing');
  const { data, isLoading, refetch, isRefetching } = useScheduledPayments(shelf);
  const rows = data?.payments ?? [];

  return (
    <Screen edges={['top']}>
      <PageHeader title="Scheduled payments" />
      <Shelf
        value={shelf}
        onChange={setShelf}
        options={[{ key: 'outgoing', label: 'You pay' }, { key: 'incoming', label: 'You receive' }]}
      />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => String(r.id)}
          renderItem={({ item }) => <Row p={item} onDone={refetch} />}
          contentContainerStyle={{ paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.accent} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="calendar-outline" size={44} color={c.t4} />
              <Text variant="body" tone="t3" style={{ marginTop: 12, textAlign: 'center' }}>
                {shelf === 'outgoing' ? 'Nothing is going out on a schedule.' : 'Nobody has a standing payment to you.'}
              </Text>
            </View>
          }
        />
      )}
    </Screen>
  );
}

function Row({ p, onDone }: { p: ScheduledPayment; onDone: () => void }) {
  const { c, radius } = useTheme();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const paused = p.status === 'paused';

  const toggle = async () => {
    setBusy(true);
    try {
      await setScheduledPaymentPaused(p.id, !paused);
      haptics.success();
      onDone();
    } catch (e) { haptics.error(); Alert.alert('Scheduled payment', (e as Error).message); }
    finally { setBusy(false); }
  };

  const stop = () => {
    Alert.alert('Cancel this payment?', 'It will not run again.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel it', style: 'destructive', onPress: async () => {
          setBusy(true);
          try {
            await cancelScheduledPayment(p.id);
            haptics.success();
            qc.invalidateQueries({ queryKey: ['scheduled-payments'] });
            onDone();
          } catch (e) { haptics.error(); Alert.alert('Scheduled payment', (e as Error).message); }
          finally { setBusy(false); }
        },
      },
    ]);
  };

  const when = new Date(p.nextAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <View style={[styles.row, { backgroundColor: c.s1, borderRadius: radius.card }]}>
      <View style={styles.rowTop}>
        <Avatar
          name={p.counterparty.name}
          avatar={p.counterparty.avatar}
          biz={p.counterparty.accountType === 'business'}
          size={38}
        />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text variant="headline" numberOfLines={1}>{p.counterparty.name}</Text>
          <Text variant="caption" tone={paused ? 't3' : 't2'} numberOfLines={1}>
            {paused ? 'Paused' : `${everyLabel(p.intervalDays)} · next ${when}`}
          </Text>
        </View>
        <Text variant="headline" weight="800">{money(p.amountCents)}</Text>
      </View>

      {!!p.note && <Text variant="caption" tone="t3" style={{ marginTop: 8 }}>{p.note}</Text>}

      {/* Only the payer can pause or stop it — the receiver is just told. */}
      {p.outgoing && p.status !== 'completed' && p.status !== 'cancelled' && (
        <View style={styles.acts}>
          <Button
            title={paused ? 'Resume' : 'Pause'}
            kind="secondary"
            onPress={toggle}
            loading={busy}
            style={{ flex: 1, minHeight: 40 }}
          />
          <Button title="Cancel" kind="danger" onPress={stop} style={{ flex: 1, minHeight: 40 }} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: 40 },
  row: { padding: 14, marginHorizontal: spacing.gutter, marginBottom: 10 },
  rowTop: { flexDirection: 'row', alignItems: 'center' },
  acts: { flexDirection: 'row', gap: 10, marginTop: 12 },
});
