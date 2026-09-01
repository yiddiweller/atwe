import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Avatar } from '@/components/Avatar';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, row } from '@/theme/tokens';
import { useAuth } from '@/auth/AuthProvider';
import { useCart, cartCount } from '@/api/cart';
import { money } from '@/api/wallet';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * Profile — the "Me" hub (web `acGoProfileHub`). No top bar; a premium account
 * hero that opens the full public profile, then grouped rounded rows with
 * blue-tint icon discs, exactly like the web Me hub. Rows deep-link to the
 * native surfaces that exist today; more slot in as they're built.
 */
export default function Profile() {
  const { c, radius, spacing } = useTheme();
  const { user } = useAuth();
  const cartN = cartCount(useCart().data?.carts);
  const router = useRouter();
  if (!user) return null;

  const isBiz = user.accountType === 'business';
  const openProfile = () => {
    if (user.username) router.push(`/user/${user.username}`);
  };

  return (
    <Screen edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
        {/* Account hero — subtle gradient-ish card → own profile */}
        <Pressable
          onPress={openProfile}
          style={({ pressed }) => [
            styles.hero,
            { backgroundColor: c.s1, borderRadius: radius.card },
            pressed && { opacity: 0.85 },
          ]}
        >
          <Avatar name={user.name} avatar={user.avatar} biz={isBiz} size={56} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <View style={styles.nameRow}>
              <Text variant="headline" numberOfLines={1}>{user.name}</Text>
              {user.verified && <VerifiedBadge size={16} />}
            </View>
            {user.username && (
              <Text variant="callout" tone="t3" numberOfLines={1}>@{user.username}</Text>
            )}
            <Text variant="micro" tone="accent" style={{ marginTop: 3 }}>View profile</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={c.t3} />
        </Pressable>

        {/* Account group */}
        <Group label="ACCOUNT">
          <NavRow icon="person-outline" label="Edit profile"
            onPress={() => router.push('/edit-profile')} c={c} last />
        </Group>

        {/* Money group */}
        <Group label="MONEY">
          <NavRow
            icon="wallet-outline"
            label="Wallet"
            value={typeof user.balanceCents === 'number' ? money(user.balanceCents) : undefined}
            onPress={() => router.push('/wallet')}
            c={c}
          />
          <NavRow
            icon="paper-plane-outline"
            label="Send money"
            onPress={() => router.push('/wallet-send')}
            c={c}
          />
          <NavRow
            icon="download-outline"
            label="Money requests"
            onPress={() => router.push('/wallet-requests')}
            c={c}
          />
          <NavRow
            icon="add-circle-outline"
            label="Add money"
            onPress={() => router.push('/wallet-topup')}
            c={c}
          />
          <NavRow
            icon="business-outline"
            label="Cash out to a bank"
            onPress={() => router.push('/wallet-cashout')}
            c={c}
            last
          />
        </Group>

        {/* What you have bought */}
        <Group label="SHOPPING">
          <NavRow
            icon="storefront-outline"
            label="Marketplace"
            onPress={() => router.push('/marketplace')}
            c={c}
          />
          <NavRow
            icon="bag-outline"
            label="Cart"
            value={cartN ? String(cartN) : undefined}
            onPress={() => router.push('/cart')}
            c={c}
          />
          <NavRow
            icon="receipt-outline"
            label="Orders"
            onPress={() => router.push('/orders')}
            c={c}
          />
          <NavRow
            icon="location-outline"
            label="Delivery addresses"
            onPress={() => router.push('/addresses')}
            c={c}
          />
          <NavRow
            icon="calendar-outline"
            label="Appointments"
            onPress={() => router.push('/appointments')}
            c={c}
            last
          />
        </Group>

        {/* What you sell */}
        <Group label="SELLING">
          <NavRow
            icon="pricetag-outline"
            label="Your listings"
            onPress={() => router.push('/sell')}
            c={c}
          />
          <NavRow
            icon="stats-chart-outline"
            label="Sales"
            onPress={() => router.push('/sales')}
            c={c}
            last
          />

        </Group>

        {/* App group */}
        <Group label="APP">
          <NavRow
            icon="notifications-outline"
            label="Notifications"
            onPress={() => router.push('/notifications')}
            c={c}
          />
          <NavRow
            icon="settings-outline"
            label="Settings"
            onPress={() => router.push('/settings')}
            c={c}
            last
          />
        </Group>
      </ScrollView>
    </Screen>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  const { c, radius, spacing } = useTheme();
  return (
    <>
      <Text variant="micro" tone="t3" style={{ marginTop: spacing.xl, marginBottom: 8, marginLeft: 4, letterSpacing: 0.4 }}>
        {label}
      </Text>
      <View style={[styles.card, { backgroundColor: c.s1, borderRadius: radius.card }]}>{children}</View>
    </>
  );
}

function NavRow({
  icon,
  label,
  value,
  onPress,
  c,
  last,
}: {
  icon: IconName;
  label: string;
  value?: string;
  onPress: () => void;
  c: ReturnType<typeof useTheme>['c'];
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.navRow,
        { borderBottomColor: c.bg, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth },
        pressed && { opacity: 0.6 },
      ]}
    >
      <View style={[styles.navIcon, { backgroundColor: c.accentDim }]}>
        <Ionicons name={icon} size={18} color={c.accent} />
      </View>
      <Text variant="body" style={{ flex: 1 }}>
        {label}
      </Text>
      {!!value && (
        <Text variant="body" tone="t3" style={{ marginRight: 6 }}>
          {value}
        </Text>
      )}
      <Ionicons name="chevron-forward" size={18} color={c.t3} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  card: { paddingHorizontal: spacing.gutter },
  // One height for every option row — the web's --row-h. A row with a SUBTITLE is
  // still allowed to grow past it, exactly as on iPhone Settings.
  navRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, minHeight: row.height },
  navIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
});
