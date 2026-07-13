import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useTheme } from '@/theme/ThemeProvider';
import { useAuth } from '@/auth/AuthProvider';
import { money } from '@/api/wallet';

/**
 * Profile — the "Me" world. In this foundation it proves the full loop:
 * secure token → /api/auth/me hydration → themed render of the real account,
 * plus theme switching and logout. Phase 6 builds the X-style profile + Me hub.
 */
export default function Profile() {
  const { c, radius, spacing, pref, setPref, name } = useTheme();
  const { user, logout } = useAuth();
  const router = useRouter();

  if (!user) return null;

  const isBiz = user.accountType === 'business';
  const initial = (user.name || user.username || '?').charAt(0).toUpperCase();

  return (
    <Screen edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: 120 }}>
        {/* Identity hero */}
        <View style={styles.hero}>
          <View
            style={[
              styles.avatar,
              { backgroundColor: c.s2, borderRadius: isBiz ? radius.lg : 44 },
            ]}
          >
            <Text variant="display" tone="t2">
              {initial}
            </Text>
          </View>
          <View style={styles.nameRow}>
            <Text variant="title">{user.name}</Text>
            {user.verified && (
              <Ionicons
                name="checkmark-circle"
                size={18}
                color={c.verify}
                style={{ marginLeft: 6 }}
              />
            )}
          </View>
          {user.username && (
            <Text variant="body" tone="t3">
              @{user.username}
            </Text>
          )}
          {user.headline && (
            <Text variant="callout" tone="t2" style={{ marginTop: 6, textAlign: 'center' }}>
              {user.headline}
            </Text>
          )}
        </View>

        {/* Quick facts */}
        <View style={[styles.card, { backgroundColor: c.s1, borderRadius: radius.lg }]}>
          <Row label="Account" value={isBiz ? 'Business' : 'Personal'} c={c} />
          <Row label="Plan" value={user.plan === 'pro' ? 'Atwe Pro' : 'Free'} c={c} last />
        </View>

        {/* Quick links */}
        <View style={[styles.card, { backgroundColor: c.s1, borderRadius: radius.lg, marginTop: 12 }]}>
          <NavRow
            icon="wallet-outline"
            label="Wallet"
            value={typeof user.balanceCents === 'number' ? money(user.balanceCents) : undefined}
            onPress={() => router.push('/wallet')}
            c={c}
          />
          <NavRow
            icon="notifications-outline"
            label="Notifications"
            onPress={() => router.push('/notifications')}
            c={c}
            last
          />
        </View>

        {/* Appearance — proves live theming */}
        <Text variant="callout" tone="t3" style={{ marginTop: spacing.xl, marginBottom: 8 }}>
          APPEARANCE
        </Text>
        <View style={[styles.segment, { backgroundColor: c.s2, borderRadius: radius.md }]}>
          {(['black', 'light', 'system'] as const).map((opt) => {
            const active = pref === opt;
            return (
              <Text
                key={opt}
                onPress={() => setPref(opt)}
                variant="callout"
                style={[
                  styles.segItem,
                  {
                    color: active ? c.onPrimary : c.t2,
                    backgroundColor: active ? c.primary : 'transparent',
                    borderRadius: radius.sm,
                  },
                ]}
              >
                {opt === 'black' ? 'Black' : opt === 'light' ? 'Light' : 'System'}
              </Text>
            );
          })}
        </View>
        <Text variant="micro" tone="t4" style={{ marginTop: 6 }}>
          Current theme: {name}
        </Text>

        <View style={{ height: spacing.xxl }} />
        <Button title="Log out" kind="danger" onPress={logout} />

        <Text variant="micro" tone="t4" style={{ textAlign: 'center', marginTop: spacing.xl }}>
          Atwe iOS · foundation build 0.1.0
        </Text>
      </ScrollView>
    </Screen>
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
  icon: React.ComponentProps<typeof Ionicons>['name'];
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

function Row({
  label,
  value,
  c,
  last,
}: {
  label: string;
  value: string;
  c: ReturnType<typeof useTheme>['c'];
  last?: boolean;
}) {
  return (
    <View
      style={[
        styles.row,
        { borderBottomColor: c.bg, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth },
      ]}
    >
      <Text variant="body" tone="t2">
        {label}
      </Text>
      <Text variant="body">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginBottom: 24 },
  avatar: { width: 88, height: 88, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  card: { paddingHorizontal: 16 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  navRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  navIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  segment: { flexDirection: 'row', padding: 4 },
  segItem: { flex: 1, textAlign: 'center', paddingVertical: 9, overflow: 'hidden' },
});
