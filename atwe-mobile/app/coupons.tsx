import { useState } from 'react';
import {
  View, FlatList, StyleSheet, ActivityIndicator, RefreshControl, Alert, TextInput, Modal, Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { PageHeader } from '@/components/PageHeader';
import { chromePad } from '@/components/Chrome';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import {
  useCoupons, createCoupon, setCouponActive, deleteCoupon, couponLabel, type Coupon,
} from '@/api/seller';
import { money } from '@/api/wallet';
import { haptics } from '@/lib/haptics';

/**
 * Discount codes a seller issues. Buyers could already TYPE one at checkout;
 * there was no way to make one, which meant the box was there for codes that
 * could not exist.
 */
export default function Coupons() {
  const { c } = useTheme();
  const [making, setMaking] = useState(false);
  const { data, isLoading, refetch, isRefetching } = useCoupons();
  const rows = data?.coupons ?? [];

  return (
    <Screen edges={[]}>
      <PageHeader
        title="Discount codes"
        action={{ icon: 'add', label: 'New code', onPress: () => setMaking(true) }}
      />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => String(r.id)}
          renderItem={({ item }) => <Row coupon={item} onDone={refetch} />}
          contentContainerStyle={[{ paddingTop: 12, paddingBottom: 120 }, chromePad.header]}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.accent} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="pricetags-outline" size={44} color={c.t4} />
              <Text variant="body" tone="t3" style={{ marginTop: 12, textAlign: 'center' }}>
                Make a code and buyers can use it at checkout.
              </Text>
            </View>
          }
        />
      )}
      <NewCoupon visible={making} onClose={() => setMaking(false)} onDone={refetch} />
    </Screen>
  );
}

function Row({ coupon, onDone }: { coupon: Coupon; onDone: () => void }) {
  const { c, radius } = useTheme();
  const [busy, setBusy] = useState(false);
  const used = coupon.maxUses != null;
  const spent = used && coupon.usedCount >= (coupon.maxUses ?? 0);
  const expired = !!coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now();

  const toggle = async () => {
    setBusy(true);
    try { await setCouponActive(coupon.id, !coupon.active); haptics.success(); onDone(); }
    catch (e) { haptics.error(); Alert.alert('Code', (e as Error).message); }
    finally { setBusy(false); }
  };

  const remove = () => {
    Alert.alert('Delete this code?', 'Buyers who have it will no longer be able to use it.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          setBusy(true);
          try { await deleteCoupon(coupon.id); haptics.success(); onDone(); }
          catch (e) { haptics.error(); Alert.alert('Code', (e as Error).message); }
          finally { setBusy(false); }
        },
      },
    ]);
  };

  return (
    <View style={[styles.row, { backgroundColor: c.s1, borderRadius: radius.card }]}>
      <View style={styles.rowTop}>
        <View style={{ flex: 1 }}>
          <Text variant="headline" weight="800" style={{ letterSpacing: 1 }}>{coupon.code}</Text>
          <Text variant="caption" tone="t2">
            {couponLabel(coupon)}
            {coupon.minOrderCents > 0 ? ` · on ${money(coupon.minOrderCents)}+` : ''}
          </Text>
        </View>
        {/* One state chip, and the reasons are ranked: a spent or expired code is
            OFF whatever its switch says, so saying "Off" alone would be a lie. */}
        {expired ? <Chip label="Expired" tone="warn" />
          : spent ? <Chip label="All used" tone="warn" />
          : !coupon.active ? <Chip label="Off" tone="quiet" />
          : null}
      </View>

      <Text variant="micro" tone="t3" style={{ marginTop: 8 }}>
        {coupon.usedCount} used{coupon.maxUses != null ? ` of ${coupon.maxUses}` : ''}
        {coupon.expiresAt ? ` · until ${new Date(coupon.expiresAt).toLocaleDateString()}` : ''}
      </Text>

      <View style={styles.acts}>
        <Button
          title={coupon.active ? 'Turn off' : 'Turn on'}
          kind="secondary"
          onPress={toggle}
          loading={busy}
          style={{ flex: 1, minHeight: 40 }}
        />
        <Button title="Delete" kind="danger" onPress={remove} style={{ flex: 1, minHeight: 40 }} />
      </View>
    </View>
  );
}

function Chip({ label, tone }: { label: string; tone: 'warn' | 'quiet' }) {
  const { c } = useTheme();
  return (
    <View style={[styles.chip, { backgroundColor: tone === 'warn' ? 'rgba(255,187,0,0.14)' : c.s2 }]}>
      <Text variant="micro" tone={tone === 'warn' ? 'warning' : 't3'}>{label}</Text>
    </View>
  );
}

function NewCoupon({ visible, onClose, onDone }: { visible: boolean; onClose: () => void; onDone: () => void }) {
  const { c, radius, spacing } = useTheme();
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<'percent' | 'fixed'>('percent');
  const [value, setValue] = useState('10');
  const [minOrder, setMinOrder] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    try {
      const v = parseFloat(value.replace(/[^0-9.]/g, ''));
      const min = parseFloat(minOrder.replace(/[^0-9.]/g, ''));
      const uses = parseInt(maxUses.replace(/[^0-9]/g, ''), 10);
      await createCoupon({
        code: code.trim().toUpperCase(),
        kind,
        /* A percent is a plain number; a fixed discount is CENTS. Sending 5 for
           "$5 off" would take five cents off and look like the code was ignored. */
        value: kind === 'percent' ? Math.round(v) : Math.round(v * 100),
        minOrderCents: Number.isFinite(min) && min > 0 ? Math.round(min * 100) : undefined,
        maxUses: Number.isFinite(uses) && uses > 0 ? uses : undefined,
      });
      haptics.success();
      setCode(''); setValue('10'); setMinOrder(''); setMaxUses('');
      onDone(); onClose();
    } catch (e) { haptics.error(); Alert.alert('Code', (e as Error).message); }
    finally { setBusy(false); }
  };

  const valid = /^[A-Z0-9]{3,24}$/.test(code.trim().toUpperCase()) && parseFloat(value) > 0;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <Screen edges={[]}>
        <PageHeader title="New discount code" />
        <View style={{ padding: spacing.gutter }}>
          <Text variant="caption" tone="t3" style={styles.lbl}>THE CODE</Text>
          <TextInput
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
            placeholder="SPRING10"
            placeholderTextColor={c.t4}
            autoCapitalize="characters"
            autoCorrect={false}
            accessibilityLabel="Discount code"
            style={[styles.input, { backgroundColor: c.s2, color: c.text, borderRadius: radius.pill, letterSpacing: 1 }]}
          />
          <Text variant="micro" tone="t3" style={{ marginTop: 6 }}>
            Letters and numbers, 3 to 24 characters.
          </Text>

          <Text variant="caption" tone="t3" style={styles.lbl}>WHAT IT TAKES OFF</Text>
          <View style={styles.kinds}>
            {(['percent', 'fixed'] as const).map((k) => (
              <Pressable
                key={k}
                onPress={() => { haptics.select(); setKind(k); }}
                style={[styles.kind, { backgroundColor: kind === k ? c.primary : c.s2, borderRadius: radius.pill }]}
                accessibilityRole="radio"
                accessibilityState={{ selected: kind === k }}
                accessibilityLabel={k === 'percent' ? 'A percentage' : 'An amount'}
              >
                <Text variant="callout" style={{ color: kind === k ? c.onPrimary : c.t2 }}>
                  {k === 'percent' ? 'A percentage' : 'An amount'}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder={kind === 'percent' ? '10' : '5'}
            placeholderTextColor={c.t4}
            keyboardType="decimal-pad"
            accessibilityLabel={kind === 'percent' ? 'Percent off' : 'Dollars off'}
            style={[styles.input, { backgroundColor: c.s2, color: c.text, borderRadius: radius.pill, marginTop: 10 }]}
          />

          <Text variant="caption" tone="t3" style={styles.lbl}>ONLY ON ORDERS OVER (OPTIONAL)</Text>
          <TextInput
            value={minOrder} onChangeText={setMinOrder}
            placeholder="20" placeholderTextColor={c.t4} keyboardType="decimal-pad"
            accessibilityLabel="Minimum order in dollars"
            style={[styles.input, { backgroundColor: c.s2, color: c.text, borderRadius: radius.pill }]}
          />

          <Text variant="caption" tone="t3" style={styles.lbl}>HOW MANY TIMES (OPTIONAL)</Text>
          <TextInput
            value={maxUses} onChangeText={setMaxUses}
            placeholder="Leave empty for unlimited" placeholderTextColor={c.t4} keyboardType="number-pad"
            accessibilityLabel="Maximum uses"
            style={[styles.input, { backgroundColor: c.s2, color: c.text, borderRadius: radius.pill }]}
          />

          <View style={{ height: 20 }} />
          <Button title="Make the code" onPress={go} loading={busy} disabled={!valid} />
        </View>
      </Screen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: 40 },
  row: { padding: 14, marginHorizontal: spacing.gutter, marginBottom: 10 },
  rowTop: { flexDirection: 'row', alignItems: 'center' },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  acts: { flexDirection: 'row', gap: 10, marginTop: 12 },
  lbl: { marginTop: 16, marginBottom: 8, letterSpacing: 0.6 },
  input: { paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  kinds: { flexDirection: 'row', gap: 8 },
  kind: { paddingHorizontal: 16, paddingVertical: 9 },
});
