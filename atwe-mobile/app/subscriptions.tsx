import { useState } from 'react';
import { View, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { PageHeader } from '@/components/PageHeader';
import { chromePad } from '@/components/Chrome';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import {
  useProductSubscriptions, setSubscriptionPaused, cancelSubscription,
  everyLabel, type ProductSubscription,
} from '@/api/money';
import { money } from '@/api/wallet';
import { mediaUri } from '@/lib/media';
import { haptics } from '@/lib/haptics';

/**
 * Subscribe & Save — things that turn up on their own. Pausing and cancelling
 * both live on the card, because "I want to skip a month" and "I want to stop"
 * are the only two things anybody comes to this screen to do.
 */
export default function Subscriptions() {
  const { c } = useTheme();
  const { data, isLoading, refetch, isRefetching } = useProductSubscriptions();
  const rows = data?.subscriptions ?? [];

  return (
    <Screen edges={[]}>
      <PageHeader title="Subscriptions" />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => String(r.id)}
          renderItem={({ item }) => <Row sub={item} onDone={refetch} />}
          contentContainerStyle={[{ paddingTop: 12, paddingBottom: 120 }, chromePad.header]}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.accent} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="repeat-outline" size={44} color={c.t4} />
              <Text variant="body" tone="t3" style={{ marginTop: 12, textAlign: 'center' }}>
                Nothing on repeat. Some listings offer Subscribe &amp; Save.
              </Text>
            </View>
          }
        />
      )}
    </Screen>
  );
}

function Row({ sub, onDone }: { sub: ProductSubscription; onDone: () => void }) {
  const { c, radius } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const paused = sub.status === 'paused';
  const when = new Date(sub.nextAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  const toggle = async () => {
    setBusy(true);
    try { await setSubscriptionPaused(sub.id, !paused); haptics.success(); onDone(); }
    catch (e) { haptics.error(); Alert.alert('Subscription', (e as Error).message); }
    finally { setBusy(false); }
  };

  const stop = () => {
    Alert.alert('Cancel this subscription?', 'Nothing more will be delivered.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel it', style: 'destructive', onPress: async () => {
          setBusy(true);
          try {
            await cancelSubscription(sub.id);
            haptics.success();
            qc.invalidateQueries({ queryKey: ['product-subscriptions'] });
            onDone();
          } catch (e) { haptics.error(); Alert.alert('Subscription', (e as Error).message); }
          finally { setBusy(false); }
        },
      },
    ]);
  };

  return (
    <View style={[styles.row, { backgroundColor: c.s1, borderRadius: radius.card }]}>
      <Pressable style={styles.rowTop} onPress={() => router.push(`/listing/${sub.productId}`)}>
        {sub.product.image ? (
          <Image
            source={{ uri: mediaUri(sub.product.image) }}
            style={[styles.thumb, { backgroundColor: c.s2, borderRadius: radius.md }]}
            contentFit="cover"
            transition={120}
          />
        ) : (
          <View style={[styles.thumb, { backgroundColor: c.s2, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' }]}>
            <Ionicons name="cube-outline" size={20} color={c.t3} />
          </View>
        )}
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text variant="headline" numberOfLines={2}>{sub.product.name}</Text>
          <Text variant="caption" tone={paused ? 't3' : 't2'} numberOfLines={1}>
            {paused ? 'Paused' : `${everyLabel(sub.intervalDays)} · next ${when}`}
          </Text>
          <Text variant="micro" tone="t3" numberOfLines={1}>from {sub.seller.name}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="headline" weight="800">{money(sub.perDeliveryCents)}</Text>
          {sub.discountPct > 0 && (
            <Text variant="micro" style={{ color: c.green }}>{sub.discountPct}% off</Text>
          )}
        </View>
      </Pressable>

      {!sub.product.active && (
        <Text variant="caption" tone="warning" style={{ marginTop: 8 }}>
          This item is no longer on sale.
        </Text>
      )}

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
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: 40 },
  row: { padding: 14, marginHorizontal: spacing.gutter, marginBottom: 10 },
  rowTop: { flexDirection: 'row', alignItems: 'center' },
  thumb: { width: 54, height: 54 },
  acts: { flexDirection: 'row', gap: 10, marginTop: 12 },
});
