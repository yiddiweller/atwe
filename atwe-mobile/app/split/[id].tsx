import { useState } from 'react';
import { View, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { PageHeader } from '@/components/PageHeader';
import { chromePad } from '@/components/Chrome';
import { useTheme } from '@/theme/ThemeProvider';
import { useSplit, paySplit } from '@/api/money';
import { money } from '@/api/wallet';
import { haptics } from '@/lib/haptics';

/**
 * One split. Paying your share goes through the route that CLAIMS the share
 * before any money moves, so two taps pay once — and a second call comes back
 * `alreadyPaid` rather than charging again, which is what the screen says.
 */
export default function SplitDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, radius, spacing } = useTheme();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useSplit(id);
  const s = data?.split;
  const [busy, setBusy] = useState(false);

  const pay = async () => {
    if (!s) return;
    setBusy(true);
    try {
      const r = await paySplit(s.id);
      if (r.alreadyPaid) Alert.alert('Already paid', 'Your share was settled.');
      else haptics.success();
      qc.invalidateQueries({ queryKey: ['wallet'] });
      qc.invalidateQueries({ queryKey: ['splits'] });
      refetch();
    } catch (e) { haptics.error(); Alert.alert('Split', (e as Error).message); }
    finally { setBusy(false); }
  };

  const pct = s && s.totalCents > 0 ? Math.min(1, s.paidCents / s.totalCents) : 0;

  return (
    <Screen edges={[]}>
      <PageHeader title="Split" />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : isError || !s ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">This split is not available.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[{ padding: spacing.gutter, paddingBottom: 60 }, chromePad.header]}>
          <View style={[styles.hero, { backgroundColor: c.s1, borderRadius: radius.card }]}>
            <Text variant="caption" tone="t3">{s.title.toUpperCase()}</Text>
            <Text variant="display" weight="800" style={{ marginTop: 4 }}>{money(s.totalCents)}</Text>
            <View style={[styles.bar, { backgroundColor: c.s2 }]}>
              <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: c.green }]} />
            </View>
            <Text variant="caption" tone="t2" style={{ marginTop: 8 }}>
              {money(s.paidCents)} collected
            </Text>
          </View>

          {!s.iAmCreator && (
            <View style={[styles.who, { backgroundColor: c.s1, borderRadius: radius.card }]}>
              <Avatar name={s.creator.name} avatar={s.creator.avatar} size={38} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text variant="headline" numberOfLines={1}>{s.creator.name}</Text>
                <Text variant="caption" tone="t3">is collecting</Text>
              </View>
            </View>
          )}

          <Text variant="caption" tone="t3" style={{ marginTop: 22, marginBottom: 8, letterSpacing: 0.6 }}>
            WHO IS IN
          </Text>
          {s.shares.map((sh, i) => (
            <View key={i} style={[styles.share, { borderBottomColor: c.border }]}>
              <Avatar name={sh.user.name} avatar={sh.user.avatar} size={32} />
              <Text variant="body" style={{ flex: 1, marginLeft: 10 }} numberOfLines={1}>{sh.user.name}</Text>
              <Text variant="body" tone="t2" style={{ marginRight: 8 }}>{money(sh.amountCents)}</Text>
              <Ionicons
                name={sh.paid ? 'checkmark-circle' : 'ellipse-outline'}
                size={18}
                color={sh.paid ? c.green : c.t4}
              />
            </View>
          ))}

          {!s.iAmCreator && !s.myPaid && (
            <View style={{ marginTop: 24 }}>
              <Button title={`Pay ${money(s.myShareCents ?? 0)}`} onPress={pay} loading={busy} />
            </View>
          )}
          {!s.iAmCreator && s.myPaid && (
            <Text variant="callout" tone="success" style={{ marginTop: 20, textAlign: 'center' }}>
              Your share is paid.
            </Text>
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
});
