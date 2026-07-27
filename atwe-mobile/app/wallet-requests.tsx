import { useState } from 'react';
import { View, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Avatar } from '@/components/Avatar';
import { useTheme } from '@/theme/ThemeProvider';
import { useMoneyRequests, payMoneyRequest, declineMoneyRequest, money, type MoneyRequest } from '@/api/wallet';
import { timeAgo } from '@/lib/format';

/**
 * Money somebody has asked you for, and what you have asked for. Paying is one
 * tap, and it goes through the same route the web uses — which claims the
 * request before it moves anything, so two taps pay once.
 */
export default function WalletRequests() {
  const { c, spacing } = useTheme();
  const [tab, setTab] = useState<'incoming' | 'outgoing'>('incoming');
  const { data, isLoading, refetch, isRefetching } = useMoneyRequests(tab);
  const rows = data?.requests ?? [];

  return (
    <Screen edges={['top']}>
      <View style={[styles.head, { paddingHorizontal: spacing.lg, borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
          <Text variant="callout" tone="accent">Back</Text>
        </Pressable>
        <Text variant="headline">Money requests</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={[styles.tabs, { paddingHorizontal: spacing.lg }]}>
        {(['incoming', 'outgoing'] as const).map((k) => (
          <Pressable key={k} onPress={() => setTab(k)} style={styles.tab} hitSlop={8}>
            <Text variant="headline" style={{ color: tab === k ? c.text : c.t3 }}>
              {k === 'incoming' ? 'To pay' : 'You asked'}
            </Text>
            {tab === k && <View style={[styles.underline, { backgroundColor: c.accent }]} />}
          </Pressable>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => String(r.id)}
          renderItem={({ item }) => <RequestRow req={item} incoming={tab === 'incoming'} onDone={refetch} />}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.accent} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text variant="body" tone="t3">
                {tab === 'incoming' ? 'Nobody has asked you for anything.' : 'You have not asked anybody.'}
              </Text>
            </View>
          }
        />
      )}
    </Screen>
  );
}

function RequestRow({ req, incoming, onDone }: { req: MoneyRequest; incoming: boolean; onDone: () => void }) {
  const { c, radius } = useTheme();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<'pay' | 'no' | null>(null);
  const who = incoming ? req.requester : req.payer;
  const [clientId] = useState(() => `req-${req.id}-${Math.random().toString(36).slice(2, 8)}`);

  const pay = async () => {
    setBusy('pay');
    try {
      await payMoneyRequest(req.id, clientId);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ['wallet'] });
      onDone();
    } catch { /* the row stays; the server said why */ }
    finally { setBusy(null); }
  };
  const decline = async () => {
    setBusy('no');
    try { await declineMoneyRequest(req.id); onDone(); } catch {} finally { setBusy(null); }
  };

  return (
    <View style={[styles.row, { borderBottomColor: c.border }]}>
      <Avatar avatar={who?.avatar ?? null} name={who?.name ?? "?"} size={44} />
      <View style={styles.rowMain}>
        <Text variant="callout" weight="600">{who?.name ?? 'Someone'}</Text>
        <Text variant="caption" tone="t3">
          {money(req.amountCents)}{req.note ? ` · ${req.note}` : ''} · {timeAgo(req.createdAt)}
        </Text>
      </View>
      {req.status !== 'pending' ? (
        <Text variant="caption" tone="t3">{req.status}</Text>
      ) : incoming ? (
        <View style={styles.actions}>
          <Pressable onPress={decline} disabled={!!busy} style={[styles.btn, { backgroundColor: c.s2, borderRadius: radius.pill }]}>
            <Text variant="caption" tone="t2">No</Text>
          </Pressable>
          <Pressable onPress={pay} disabled={!!busy} style={[styles.btn, { backgroundColor: c.primary, borderRadius: radius.pill }]}>
            <Text variant="caption" tone="onPrimary" weight="700">{busy === 'pay' ? '…' : 'Pay'}</Text>
          </Pressable>
        </View>
      ) : (
        <Text variant="caption" tone="t3">waiting</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  tabs: { flexDirection: 'row', gap: 24, paddingVertical: 10 },
  tab: { alignItems: 'center' },
  underline: { height: 3, borderRadius: 2, width: '100%', marginTop: 5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  rowMain: { flex: 1, minWidth: 0 },
  actions: { flexDirection: 'row', gap: 8 },
  btn: { paddingHorizontal: 14, paddingVertical: 7 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
});
