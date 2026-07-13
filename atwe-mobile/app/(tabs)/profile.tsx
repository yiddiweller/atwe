import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Avatar } from '@/components/Avatar';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { useTheme } from '@/theme/ThemeProvider';
import { useAuth } from '@/auth/AuthProvider';
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
            { backgroundColor: c.s1, borderRadius: radius.xl },
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
          <NavRow icon="person-outline" label="Edit profile" onPress={openProfile} c={c} />
          <NavRow
            icon="star-outline"
            label={user.plan === 'pro' ? 'Manage plan' : 'Upgrade to Pro'}
            value={user.plan === 'pro' ? 'Pro' : undefined}
            onPress={openProfile}
            c={c}
            last
          />
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
      <View style={[styles.card, { backgroundColor: c.s1, borderRadius: radius.lg }]}>{children}</View>
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
  card: { paddingHorizontal: 16 },
  navRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  navIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
});
