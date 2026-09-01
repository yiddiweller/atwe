import { useState } from 'react';
import { View, ScrollView, StyleSheet, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { PageHeader } from '@/components/PageHeader';
import { useTheme } from '@/theme/ThemeProvider';
import { useLoyalty, redeemPoints } from '@/api/money';
import { money } from '@/api/wallet';
import { timeAgo } from '@/lib/format';
import { haptics } from '@/lib/haptics';

/**
 * Points earned on what you buy, turned back into balance. Redeeming snaps to
 * whole dollars — the server does that anyway, so the button says the real
 * number rather than promising cents it will round away.
 */
export default function Rewards() {
  const { c, radius, spacing } = useTheme();
  const qc = useQueryClient();
  const { data, isLoading, refetch, isRefetching } = useLoyalty();
  const [busy, setBusy] = useState(false);

  const canRedeem = !!data && data.pointsBalance >= data.minRedeem && data.redeemableCents > 0;
  /* Only whole dollars can come out, so only whole dollars go in — asking for
     405 points back when 400 is the most that converts leaves 5 in limbo. */
  const spend = data ? Math.floor(data.redeemableCents / 100) * data.pointsPerDollar : 0;

  const redeem = () => {
    if (!data) return;
    Alert.alert(
      'Turn points into balance',
      `${spend.toLocaleString()} points becomes ${money(data.redeemableCents)} in your Atwe balance.`,
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Redeem', onPress: async () => {
            setBusy(true);
            try {
              await redeemPoints(spend);
              haptics.success();
              qc.invalidateQueries({ queryKey: ['wallet'] });
              refetch();
            } catch (e) { haptics.error(); Alert.alert('Rewards', (e as Error).message); }
            finally { setBusy(false); }
          },
        },
      ],
    );
  };

  return (
    <Screen edges={['top']}>
      <PageHeader title="Rewards" />
      {isLoading || !data ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.gutter, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.accent} />}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.hero, { backgroundColor: c.s1, borderRadius: radius.card }]}>
            <Text variant="caption" tone="t3">YOUR POINTS</Text>
            <Text variant="display" weight="800" style={{ marginTop: 4 }}>
              {data.pointsBalance.toLocaleString()}
            </Text>
            <Text variant="callout" tone="t2" style={{ marginTop: 2 }}>
              worth {money(data.redeemableCents)}
            </Text>
            <View style={[styles.tier, { backgroundColor: c.accentDim }]}>
              <Ionicons name="ribbon-outline" size={14} color={c.accent} />
              <Text variant="micro" tone="accent" style={{ marginLeft: 5 }}>{data.tier.name}</Text>
            </View>
          </View>

          {!!data.nextTier && (
            <Text variant="caption" tone="t3" style={{ marginTop: 12 }}>
              {data.nextTier.pointsAway.toLocaleString()} more points to {data.nextTier.name}.
            </Text>
          )}

          <View style={{ marginTop: 20 }}>
            <Button
              title={canRedeem ? `Redeem for ${money(data.redeemableCents)}` : `${data.minRedeem} points to redeem`}
              onPress={redeem}
              loading={busy}
              disabled={!canRedeem}
            />
          </View>

          <Text variant="caption" tone="t3" style={{ marginTop: 14, lineHeight: 19 }}>
            You earn about 1% back on what you buy on Atwe. {data.pointsPerDollar} points is $1.
          </Text>

          {data.transactions.length > 0 && (
            <View style={{ marginTop: 26 }}>
              <Text variant="caption" tone="t3" style={{ marginBottom: 10, letterSpacing: 0.6 }}>HISTORY</Text>
              {data.transactions.map((t, i) => (
                <View key={i} style={[styles.tx, { borderBottomColor: c.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text variant="body">
                      {t.reason === 'redeem' ? 'Turned into balance' : t.reason === 'bonus' ? 'Bonus' : 'Earned on an order'}
                    </Text>
                    <Text variant="micro" tone="t3">{timeAgo(t.createdAt)}</Text>
                  </View>
                  <Text variant="headline" style={{ color: t.delta >= 0 ? c.green : c.t2 }}>
                    {t.delta >= 0 ? '+' : ''}{t.delta.toLocaleString()}
                  </Text>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  hero: { padding: 22, alignItems: 'flex-start' },
  tier: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, marginTop: 12 },
  tx: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
});
