import { useState } from 'react';
import {
  View, ScrollView, Pressable, ActivityIndicator, Alert, Linking, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { ShipSheet } from '@/components/ShipSheet';
import { LabelSheet } from '@/components/LabelSheet';
import { useConfig } from '@/api/config-query';
import { ReasonSheet } from '@/components/ReasonSheet';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { money } from '@/api/wallet';
import {
  useOrder, confirmOrder, disputeOrder, cancelOrder, markDelivered,
  orderStatusLabel, orderStatusTone, orderSteps, trackingUrl,
  type Order,
} from '@/api/orders';
import { useRealtime } from '@/lib/useRealtime';
import { useCallback } from 'react';
import { haptics } from '@/lib/haptics';

/**
 * One order, from both sides.
 *
 * It exists because buying with protection was shipped without it: the money on
 * an escrow order sits held until the buyer confirms, and with nowhere to
 * confirm, every purchase would have waited out the seven-day auto-release. So
 * the screen leads with where the order has got to, and then offers each side
 * exactly the actions the server will accept — nothing more, because a button
 * that fails is worse than a button that is not there.
 */
export default function OrderDetail() {
  const { c } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const oid = Number(id);
  const { data, isLoading, isError, refetch } = useOrder(Number.isFinite(oid) ? oid : undefined);
  const order = data?.order;
  const [busy, setBusy] = useState(false);
  const [shipping, setShipping] = useState(false);
  const [buyingLabel, setBuyingLabel] = useState(false);
  /* Labels are an optional integration. Without a provider the routes 503, so
     the button stays hidden and the manual entry below is the only path — which
     is exactly how it worked before. */
  const labelsOn = !!useConfig().data?.shippingLabelsEnabled;
  const [disputing, setDisputing] = useState(false);

  // The seller marking it sent, or the carrier reporting it delivered, arrives
  // as a live event — a buyer watching this screen sees it without reloading.
  const onLive = useCallback((d: unknown) => {
    if ((d as { id?: number })?.id === oid) qc.invalidateQueries({ queryKey: ['order', oid] });
  }, [oid, qc]);
  useRealtime('order', onLive);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['order', oid] });
    qc.invalidateQueries({ queryKey: ['orders'] });
    qc.invalidateQueries({ queryKey: ['wallet'] });
  };

  const run = async (fn: () => Promise<void>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      haptics.success();
      refresh();
      if (done) Alert.alert('Order', done);
    } catch (e) {
      haptics.error(); Alert.alert('Order', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    if (!order) return;
    Alert.alert(
      'Confirm it arrived?',
      `${money(order.totalCents)} will be released to ${order.seller?.name ?? 'the seller'}. This cannot be undone.`,
      [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Confirm', onPress: () => run(() => confirmOrder(oid), 'The seller has been paid.') },
      ],
    );
  };

  const cancel = () => {
    Alert.alert('Cancel this order?', 'Anything already paid is returned.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel order', style: 'destructive',
        onPress: () => { haptics.warning(); run(() => cancelOrder(oid)); } },
    ]);
  };

  return (
    <Screen edges={['top']}>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}
          accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={c.text} />
        </Pressable>
        <Text variant="headline">Order #{oid}</Text>
        <View style={styles.back} />
      </View>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : isError || !order ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">Couldn't open this order.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <Text variant="title" tone={orderStatusTone(order)}>{orderStatusLabel(order)}</Text>
          {order.escrow && order.status === 'escrow' && (
            <Text variant="caption" tone="t3" style={{ marginTop: 4 }}>
              {order.mine
                ? 'The buyer confirms, and then it is yours.'
                : 'Your money is safe until you say it arrived.'}
              {order.autoReleaseAt && !order.mine
                ? ` It releases on its own on ${new Date(order.autoReleaseAt).toLocaleDateString()}.`
                : ''}
            </Text>
          )}
          {order.status === 'disputed' && !!order.disputeReason && (
            <Text variant="caption" tone="t3" style={{ marginTop: 4 }}>
              “{order.disputeReason}”
            </Text>
          )}

          <Steps order={order} />

          {/* Items */}
          <Section title="What">
            {(order.items ?? []).map((it, i) => (
              <View key={i} style={styles.line}>
                <Text variant="body" style={{ flex: 1 }} numberOfLines={2}>
                  {it.qty > 1 ? `${it.qty} × ` : ''}{it.name}
                  {it.variantLabel ? ` · ${it.variantLabel}` : ''}
                </Text>
                <Text variant="body" weight="600">{money(it.priceCents * it.qty)}</Text>
              </View>
            ))}
            <View style={[styles.rule, { backgroundColor: c.border }]} />
            {order.subtotalCents != null && (
              <Row label="Subtotal" value={money(order.subtotalCents)} />
            )}
            {!!order.discountCents && <Row label="Discount" value={`−${money(order.discountCents)}`} />}
            {!!order.shippingCents && <Row label="Shipping" value={money(order.shippingCents)} />}
            {!!order.taxCents && <Row label="Tax" value={money(order.taxCents)} />}
            <Row label="Total" value={money(order.totalCents)} big />
            {!!order.refundedCents && (
              <Row label="Refunded" value={money(order.refundedCents)} />
            )}
          </Section>

          {/* Who */}
          <Section title={order.mine ? 'Buyer' : 'Seller'}>
            <Pressable
              style={styles.who}
              onPress={() => {
                const u = (order.mine ? order.buyer : order.seller)?.username;
                if (u) router.push(`/user/${u}`);
              }}
            >
              <Avatar
                name={(order.mine ? order.buyer : order.seller)?.name ?? undefined}
                avatar={(order.mine ? order.buyer : order.seller)?.avatar}
                size={38}
              />
              <Text variant="headline" style={{ flex: 1, marginLeft: 10 }} numberOfLines={1}>
                {(order.mine ? order.buyer : order.seller)?.name ?? 'Someone'}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={c.t3} />
            </Pressable>
            <Button
              title="Message"
              kind="secondary"
              onPress={() => {
                const p = (order.mine ? order.buyer : order.seller)?.id;
                if (p) router.push(`/chat/${p}`);
              }}
            />
          </Section>

          {/* Where */}
          {!!order.shipTo && (
            <Section title="Delivering to">
              <Text variant="body">{order.shipTo.name}</Text>
              <Text variant="body" tone="t2">
                {[order.shipTo.line1, order.shipTo.line2, order.shipTo.city,
                  order.shipTo.region, order.shipTo.postal, order.shipTo.country]
                  .filter(Boolean).join(', ')}
              </Text>
              {!!order.shipTo.instructions && (
                <Text variant="caption" tone="t3" style={{ marginTop: 4 }}>
                  {order.shipTo.instructions}
                </Text>
              )}
            </Section>
          )}
          {order.pickup && (
            <Section title="Collect in person">
              <Text variant="body" tone="t2">{order.pickupLocation || 'The seller will tell you where.'}</Text>
            </Section>
          )}

          {/* Tracking */}
          {!!order.tracking && (
            <Section title="Tracking">
              <Text variant="body">{order.carrier || 'Tracked'}</Text>
              <Pressable
                onPress={() => Clipboard.setStringAsync(order.tracking!)}
                accessibilityRole="button" accessibilityLabel="Copy tracking number"
              >
                <Text variant="body" tone="t2" style={{ marginTop: 2 }}>{order.tracking}</Text>
              </Pressable>
              {!!trackingUrl(order.carrier, order.tracking) && (
                <Button title={`Track with ${order.carrier}`} kind="secondary"
                  onPress={() => Linking.openURL(trackingUrl(order.carrier, order.tracking!)!)} />
              )}
              {!!order.shipNote && (
                <Text variant="caption" tone="t3" style={{ marginTop: 8 }}>{order.shipNote}</Text>
              )}
            </Section>
          )}
          {!order.tracking && !!order.eta && order.needsShipping && (
            <Section title="Expected">
              <Text variant="body" tone="t2">
                {new Date(order.eta.minAt).getDate()}–
                {new Date(order.eta.maxAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
              </Text>
            </Section>
          )}

          {/* What each side can do */}
          <View style={styles.actions}>
            {!order.mine && order.status === 'escrow' && (
              <>
                <Button title="It arrived — pay the seller" kind="primary"
                  loading={busy} onPress={confirm} />
                <Button title="Something's wrong" kind="secondary" onPress={() => setDisputing(true)} />
              </>
            )}
            {order.mine && order.status === 'escrow' && (
              <Button title="Something's wrong" kind="secondary" onPress={() => setDisputing(true)} />
            )}
            {order.mine && !order.shippedAt && order.needsShipping
              && ['paid', 'escrow'].includes(order.status) && (
              <>
                {labelsOn && (
                  <Button title="Buy a shipping label" kind="primary"
                    onPress={() => setBuyingLabel(true)} />
                )}
                <Button
                  title={labelsOn ? 'Or enter tracking yourself' : 'Mark as sent'}
                  kind={labelsOn ? 'secondary' : 'primary'}
                  onPress={() => setShipping(true)}
                />
              </>
            )}
            {!!order.shippedAt && !order.deliveredAt && (
              <Button
                title={order.mine ? 'Mark as delivered' : "I've received it"}
                kind="secondary" loading={busy}
                onPress={() => run(() => markDelivered(oid))}
              />
            )}
            {order.status === 'pending' && (
              <Button title="Cancel order" kind="danger" onPress={cancel} />
            )}
          </View>
        </ScrollView>
      )}

      <LabelSheet
        visible={buyingLabel}
        orderId={oid}
        onClose={() => setBuyingLabel(false)}
        onBought={() => refetch()}
      />

      <ShipSheet
        visible={shipping}
        orderId={oid}
        onClose={() => setShipping(false)}
        onShipped={() => { setShipping(false); refresh(); }}
      />

      <ReasonSheet
        visible={disputing}
        title="What went wrong?"
        sub="Atwe will look at it and decide where the money goes."
        placeholder="It never turned up, it wasn't what was described…"
        confirmLabel="Open dispute"
        destructive
        busy={busy}
        onCancel={() => setDisputing(false)}
        onConfirm={(reason) => {
          setDisputing(false);
          run(() => disputeOrder(oid, reason), 'Atwe will take a look and be in touch.');
        }}
      />
    </Screen>
  );
}

/** The steps an order walks, and how far it has got. */
function Steps({ order }: { order: Order }) {
  const { c } = useTheme();
  const steps = orderSteps(order);
  if (!steps) return null;
  return (
    <View style={styles.steps}>
      {steps.map((s, i) => (
        <View key={s.label} style={styles.step}>
          <View style={styles.stepIcon}>
            <Ionicons
              name={s.done ? 'checkmark-circle' : 'ellipse-outline'}
              size={20}
              color={s.done ? c.repost : c.t4}
            />
            {i < steps.length - 1 && (
              <View style={[styles.stepBar, { backgroundColor: s.done ? c.repost : c.border }]} />
            )}
          </View>
          <Text variant="body" tone={s.done ? undefined : 't3'} style={styles.stepLabel}>
            {s.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ marginTop: 20 }}>
      <Text variant="callout" tone="t2" style={{ marginBottom: 8 }}>{title}</Text>
      <View style={[styles.card, { backgroundColor: c.s1 }]}>{children}</View>
    </View>
  );
}

function Row({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <View style={styles.line}>
      <Text variant={big ? 'headline' : 'body'} tone={big ? undefined : 't2'} style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant={big ? 'headline' : 'body'} weight={big ? '800' : '600'}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingBottom: 8,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  body: { padding: spacing.gutter, paddingBottom: 40 },
  card: { borderRadius: radius.card, padding: 14, gap: 8 },
  line: { flexDirection: 'row', alignItems: 'center' },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
  who: { flexDirection: 'row', alignItems: 'center' },
  steps: { marginTop: 18 },
  step: { flexDirection: 'row', alignItems: 'flex-start' },
  stepIcon: { width: 20, alignItems: 'center' },
  stepBar: { width: 2, height: 18, marginVertical: 1 },
  stepLabel: { marginLeft: 10, marginTop: -1, marginBottom: 8 },
  actions: { marginTop: 26, gap: 10 },
});
