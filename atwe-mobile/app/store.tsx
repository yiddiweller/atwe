import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { PageHeader } from '@/components/PageHeader';
import { chromePad } from '@/components/Chrome';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, row as rowTokens } from '@/theme/tokens';
import { useAuth } from '@/auth/AuthProvider';
import { useOrders } from '@/api/orders';
import { haptics } from '@/lib/haptics';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * Manage store — the one place a seller runs their business from, mirroring the
 * web's own hub. Before this, the seller-side surfaces were scattered: listings
 * on one Account row, sales on an icon inside it, and coupons, bundles and
 * offers nowhere at all.
 *
 * A personal account sells too (Atwe has no "you must be a business to sell"
 * rule), so nothing here is business-gated except the things that genuinely need
 * a storefront to point at.
 */
export default function Store() {
  const { c, radius, spacing } = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const seller = useOrders('seller');
  /* The badge is what makes the hub worth opening: it says whether anything is
     waiting, so nobody has to go and look. Paid and escrow are both "the money
     is in, get it ready". */
  const toFulfil = (seller.data?.orders ?? [])
    .filter((o) => o.status === 'paid' || o.status === 'escrow').length;

  const isBiz = user?.accountType === 'business';

  return (
    <Screen edges={[]}>
      <PageHeader title="Manage store" />
      <ScrollView contentContainerStyle={[{ padding: spacing.gutter, paddingBottom: 120 }, chromePad.header]}
        showsVerticalScrollIndicator={false}>
        <Group label="WHAT YOU SELL">
          <Row icon="pricetag-outline" label="Listings" onPress={() => router.push('/sell')} />
          <Row icon="cube-outline" label="Bundles" sub="Sell a few things together for one price"
            onPress={() => router.push('/bundles')} />
          <Row icon="pricetags-outline" label="Discount codes"
            onPress={() => router.push('/coupons')} last />
        </Group>

        <Group label="WHAT IS HAPPENING">
          <Row icon="receipt-outline" label="Orders" badge={toFulfil || undefined}
            onPress={() => router.push('/orders?tab=seller')} />
          <Row icon="swap-horizontal-outline" label="Offers" sub="Prices people have proposed"
            onPress={() => router.push('/offers')} />
          <Row icon="stats-chart-outline" label="Sales" sub="What you have sold and earned"
            onPress={() => router.push('/sales')} />
          {isBiz && (
            <Row icon="eye-outline" label="Reach" sub="Who is looking, and how well you answer"
              onPress={() => router.push('/business-analytics')} />
          )}
          <Row icon="people-outline" label="Team" sub="People who help you run it"
            onPress={() => router.push('/team')} last />
        </Group>

        {isBiz && (
          <Group label="TALKING TO CUSTOMERS">
            <Row icon="chatbubble-ellipses-outline" label="Auto-messages"
              sub="A greeting, and a reply when you are away"
              onPress={() => router.push('/auto-messages')} />
            <Row icon="bag-handle-outline" label="Cart reminders"
              sub="Win back a basket somebody left behind"
              onPress={() => router.push('/cart-recovery')} last />
          </Group>
        )}

        {isBiz && (
          <Group label="YOUR STOREFRONT">
            <Row icon="storefront-outline" label="View your storefront"
              onPress={() => user?.username && router.push(`/user/${user.username}`)} last />
          </Group>
        )}

        <Group label="MONEY">
          <Row icon="wallet-outline" label="Wallet & payouts" onPress={() => router.push('/wallet')} last />
        </Group>
      </ScrollView>
    </Screen>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  const { c, radius } = useTheme();
  return (
    <View style={{ marginBottom: 22 }}>
      <Text variant="caption" tone="t3" style={{ marginBottom: 8, letterSpacing: 0.6 }}>{label}</Text>
      <View style={{ backgroundColor: c.s1, borderRadius: radius.card, overflow: 'hidden' }}>
        {children}
      </View>
    </View>
  );
}

function Row({ icon, label, sub, badge, onPress, last }: {
  icon: IconName; label: string; sub?: string; badge?: number; onPress: () => void; last?: boolean;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={() => { haptics.tap(); onPress(); }}
      style={({ pressed }) => [
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.bg },
        pressed && { backgroundColor: c.s2 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={[styles.disc, { backgroundColor: c.accentDim }]}>
        <Ionicons name={icon} size={18} color={c.accent} />
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text variant="body">{label}</Text>
        {!!sub && <Text variant="micro" tone="t3" style={{ marginTop: 2 }}>{sub}</Text>}
      </View>
      {badge != null && (
        <View style={[styles.badge, { backgroundColor: c.accent }]}>
          <Text variant="micro" style={{ color: '#fff' }}>{badge}</Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={18} color={c.t3} style={{ marginLeft: 8 }} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, minHeight: rowTokens.height },
  disc: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
});
