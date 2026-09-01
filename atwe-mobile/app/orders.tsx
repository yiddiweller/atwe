import { useState } from 'react';
import { View, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { useTheme } from '@/theme/ThemeProvider';
import { useOrders, orderStatusLabel, orderStatusTone, type Order } from '@/api/orders';
import { money } from '@/api/wallet';
import { timeAgo } from '@/lib/format';

/** What you have bought, and what you have sold. */
export default function Orders() {
  const { c, spacing } = useTheme();
  const [scope, setScope] = useState<'buyer' | 'seller'>('buyer');
  const { data, isLoading, refetch, isRefetching } = useOrders(scope);
  const orders = data?.orders ?? [];

  return (
    <Screen edges={['top']}>
      <View style={[styles.head, { paddingHorizontal: spacing.lg, borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
          {/* A chevron, like every other screen — the word "Back" was the only
              one of its kind in the app. */}
          <Ionicons name="chevron-back" size={26} color={c.text} />
        </Pressable>
        <Text variant="headline">Orders</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={[styles.tabs, { paddingHorizontal: spacing.lg }]}>
        {(['buyer', 'seller'] as const).map((k) => (
          <Pressable key={k} onPress={() => setScope(k)} style={styles.tab} hitSlop={8}>
            <Text variant="headline" style={{ color: scope === k ? c.text : c.t3 }}>
              {k === 'buyer' ? 'Bought' : 'Sold'}
            </Text>
            {scope === k && <View style={[styles.underline, { backgroundColor: c.accent }]} />}
          </Pressable>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => String(o.id)}
          renderItem={({ item }) => <OrderRow order={item} scope={scope} />}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.accent} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text variant="body" tone="t3">
                {scope === 'buyer' ? 'You have not bought anything yet.' : 'Nothing sold yet.'}
              </Text>
            </View>
          }
        />
      )}
    </Screen>
  );
}

function OrderRow({ order, scope }: { order: Order; scope: 'buyer' | 'seller' }) {
  const { c, radius } = useTheme();
  const who = (scope === 'buyer' ? order.seller : order.buyer)?.name;
  const what = (order.items ?? []).map((i) => `${i.qty > 1 ? i.qty + '× ' : ''}${i.name}`).join(', ');
  return (
    <Pressable
      onPress={() => router.push(`/order/${order.id}`)}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: c.s1, borderRadius: radius.card },
        pressed && { opacity: 0.7 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Order ${order.id}`}
    >
      <View style={styles.rowTop}>
        <Text variant="callout" weight="600" style={{ flex: 1 }} numberOfLines={1}>
          {what || `Order #${order.id}`}
        </Text>
        <Text variant="callout" weight="700">{money(order.totalCents)}</Text>
      </View>
      <Text variant="caption" tone={orderStatusTone(order)} style={{ marginTop: 4 }}>
        {orderStatusLabel(order)}
        {order.localDelivery ? ' · being driven round' : ''}
      </Text>
      <Text variant="caption" tone="t3" style={{ marginTop: 2 }}>
        {who ? `${scope === 'buyer' ? 'from' : 'to'} ${who} · ` : ''}{timeAgo(order.createdAt)}
        {order.tracking ? ` · ${order.carrier ?? 'tracked'} ${order.tracking}` : ''}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  tabs: { flexDirection: 'row', gap: 24, paddingVertical: 10 },
  tab: { alignItems: 'center' },
  underline: { height: 3, borderRadius: 2, width: '100%', marginTop: 5 },
  row: { marginHorizontal: 14, marginBottom: 10, padding: 14 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
});
