import { View, ScrollView, Pressable, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { ChromeBar, useFloatingChrome } from '@/components/Chrome';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { money } from '@/api/wallet';
import { useShopAnalytics } from '@/api/selling';

/**
 * How the shop is doing.
 *
 * It leads with the number that is actually a to-do list — orders paid for and
 * waiting to be posted — rather than with revenue, because that is the one a
 * seller can do something about this morning. Revenue and units follow, then
 * what is selling, then the last fortnight as bars.
 */
export default function Sales() {
  const { c } = useTheme();
  const router = useRouter();
  const q = useShopAnalytics();
  const a = q.data;
  const peak = Math.max(1, ...(a?.trend ?? []).map((d) => d.revenueCents));

  const chrome = useFloatingChrome();

  return (
    <Screen edges={[]}>
      <ChromeBar onLayout={chrome.onLayout}>
        <View style={styles.head}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}
            accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={26} color={c.text} />
          </Pressable>
          <Text variant="headline">Sales</Text>
          <View style={styles.back} />
        </View>
      </ChromeBar>

      {q.isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : q.isError || !a ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">Couldn't load your sales.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.body, chrome.pad]}
          refreshControl={
            <RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={c.t3} />
          }
        >
          {a.toShip > 0 && (
            <View style={[styles.attn, { backgroundColor: c.warning + '22' }]}>
              <Ionicons name="cube-outline" size={20} color={c.warning} />
              <Text variant="body" style={{ flex: 1, marginLeft: 10 }}>
                {a.toShip} order{a.toShip === 1 ? '' : 's'} paid and waiting to be sent
              </Text>
            </View>
          )}
          <Button title="Orders to fulfil" kind={a.toShip > 0 ? 'primary' : 'secondary'}
            onPress={() => router.push('/orders')} />

          <View style={styles.grid}>
            <Stat label="Made" value={money(a.totalRevenueCents)} big />
            <Stat label="Orders" value={String(a.orders)} />
            <Stat label="Items sold" value={String(a.units)} />
            {a.pending > 0 && <Stat label="Not paid yet" value={String(a.pending)} />}
          </View>

          {!!a.topProducts?.length && (
            <>
              <Text variant="callout" tone="t2" style={styles.lbl}>What is selling</Text>
              <View style={[styles.card, { backgroundColor: c.s1 }]}>
                {a.topProducts.map((p, i) => (
                  <View key={i} style={styles.row}>
                    <Text variant="body" style={{ flex: 1 }} numberOfLines={1}>{p.name}</Text>
                    <Text variant="caption" tone="t3" style={{ marginRight: 10 }}>
                      {p.units} sold
                    </Text>
                    <Text variant="body" weight="600">{money(p.revenueCents)}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {!!a.trend?.length && (
            <>
              <Text variant="callout" tone="t2" style={styles.lbl}>
                Last {a.trendDays} days
              </Text>
              <View style={[styles.card, { backgroundColor: c.s1 }]}>
                <View style={styles.bars}>
                  {a.trend.map((d) => (
                    <View
                      key={d.day}
                      style={[
                        styles.bar,
                        {
                          backgroundColor: d.revenueCents ? c.accent : c.s2,
                          // A day with nothing still gets a sliver, so the row
                          // reads as a run of days rather than a gap.
                          height: Math.max(3, (d.revenueCents / peak) * 72),
                        },
                      ]}
                    />
                  ))}
                </View>
                <Text variant="caption" tone="t3" style={{ marginTop: 8 }}>
                  Best day {money(peak)}
                </Text>
              </View>
            </>
          )}

          {a.orders === 0 && (
            <Text variant="body" tone="t3" style={{ textAlign: 'center', marginTop: 24 }}>
              Nothing sold yet. It shows up here the moment it does.
            </Text>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: c.s1 }, big && { flexBasis: '100%' }]}>
      <Text variant={big ? 'display' : 'title'} weight="800">{value}</Text>
      <Text variant="caption" tone="t3" style={{ marginTop: 2 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingBottom: 8,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  body: { padding: spacing.gutter, paddingBottom: 40, gap: 12 },
  attn: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: radius.card },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 },
  stat: { flexGrow: 1, flexBasis: '45%', borderRadius: radius.card, padding: 14 },
  lbl: { marginTop: 12 },
  card: { borderRadius: radius.card, padding: 14, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center' },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 72 },
  bar: { flex: 1, borderRadius: 2, minWidth: 3 },
});
