import { useEffect, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, Switch, ActivityIndicator, Alert } from 'react-native';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { PageHeader } from '@/components/PageHeader';
import { chromePad } from '@/components/Chrome';
import { useTheme } from '@/theme/ThemeProvider';
import { useCartRecovery, saveCartRecovery } from '@/api/bizops';
import { useAuth } from '@/auth/AuthProvider';
import { haptics } from '@/lib/haptics';

const HOURS = [1, 2, 4, 8, 24];

/**
 * A shopper fills a basket and leaves. One polite message, later, wins some of
 * them back.
 *
 * The two counters are the whole point of the screen: "sent" without "recovered"
 * is a business messaging people with no idea whether it works.
 */
export default function CartRecovery() {
  const { c, radius, spacing } = useTheme();
  const { user } = useAuth();
  const isBiz = user?.accountType === 'business';
  const { data, isLoading, refetch } = useCartRecovery(isBiz);

  const [on, setOn] = useState(true);
  const [hours, setHours] = useState(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    setOn(data.enabled);
    setHours(data.delayHours);
  }, [data]);

  const save = async () => {
    setBusy(true);
    try {
      await saveCartRecovery({ enabled: on, delayHours: hours });
      haptics.success();
      refetch();
      Alert.alert('Saved', on ? 'Reminders are on.' : 'Reminders are off.');
    } catch (e) { haptics.error(); Alert.alert('Cart reminders', (e as Error).message); }
    finally { setBusy(false); }
  };

  if (!isBiz) {
    return (
      <Screen edges={[]}>
        <PageHeader title="Cart reminders" />
        <View style={styles.center}>
          <Text variant="body" tone="t2" style={{ textAlign: 'center' }}>
            Cart reminders are for business accounts.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={[]}>
      <PageHeader title="Cart reminders" />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <ScrollView contentContainerStyle={[{ padding: spacing.gutter, paddingBottom: 60 }, chromePad.header]}>
          <View style={[styles.card, { backgroundColor: c.s1, borderRadius: radius.card }]}>
            <View style={styles.head}>
              <View style={{ flex: 1 }}>
                <Text variant="headline">Remind people</Text>
                <Text variant="micro" tone="t3" style={{ marginTop: 2 }}>
                  One message when a basket is left behind
                </Text>
              </View>
              <Switch
                value={on}
                onValueChange={(v) => { haptics.select(); setOn(v); }}
                trackColor={{ true: c.accent, false: c.s3 }}
                accessibilityLabel="Send cart reminders"
              />
            </View>
          </View>

          {on && (
            <>
              <Text variant="caption" tone="t3" style={styles.lbl}>HOW LONG TO WAIT</Text>
              <View style={styles.hours}>
                {HOURS.map((h) => (
                  <Pressable
                    key={h}
                    onPress={() => { haptics.select(); setHours(h); }}
                    style={[styles.hour, { backgroundColor: hours === h ? c.primary : c.s2, borderRadius: radius.pill }]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: hours === h }}
                    accessibilityLabel={h === 1 ? '1 hour' : `${h} hours`}
                  >
                    <Text variant="callout" style={{ color: hours === h ? c.onPrimary : c.t2 }}>
                      {h === 24 ? '1 day' : `${h}h`}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          {/* Sent without recovered is a business messaging people with no idea
              whether it works, so the two always sit together. */}
          <View style={[styles.stats, { backgroundColor: c.s1, borderRadius: radius.card }]}>
            <View style={{ flex: 1 }}>
              <Text variant="display" weight="800">{data?.sentCount ?? 0}</Text>
              <Text variant="caption" tone="t3">reminders sent</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="display" weight="800" style={{ color: c.green }}>
                {data?.recoveredCount ?? 0}
              </Text>
              <Text variant="caption" tone="t3">came back and paid</Text>
            </View>
          </View>

          <Text variant="caption" tone="t3" style={{ marginTop: 16, lineHeight: 19 }}>
            One reminder per basket, ever, and at most one a week per person.
            Never for a basket that has sold out, and never to somebody who has
            turned reminders off.
          </Text>

          <View style={{ height: 20 }} />
          <Button title="Save" onPress={save} loading={busy} />
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  card: { padding: 16 },
  head: { flexDirection: 'row', alignItems: 'center' },
  lbl: { marginTop: 20, marginBottom: 8, letterSpacing: 0.6 },
  hours: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  hour: { paddingHorizontal: 18, paddingVertical: 9 },
  stats: { flexDirection: 'row', padding: 18, marginTop: 22, gap: 14 },
});
