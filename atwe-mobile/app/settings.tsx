import { useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, row } from '@/theme/tokens';
import { useAuth } from '@/auth/AuthProvider';
import { haptics } from '@/lib/haptics';

/**
 * Settings — iOS-Settings-style hub. Mirrors the web `#settingsOverlay`: a back
 * header, an account card, and grouped rounded rows. This native slice covers
 * Appearance (live theme), the account facts, and Sign out; more sub-pages
 * (Privacy, Security, Notifications) land as those surfaces are built natively.
 */
export default function Settings() {
  const { c, radius, spacing, pref, setPref, name } = useTheme();
  const { user, logout } = useAuth();
  const router = useRouter();
  if (!user) return null;

  const isBiz = user.accountType === 'business';

  return (
    <Screen edges={['top']}>
      {/* Header */}
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={c.text} />
        </Pressable>
        <Text variant="headline">Settings</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
        {/* Appearance */}
        <GroupLabel>APPEARANCE</GroupLabel>
        <View style={[styles.card, { backgroundColor: c.s1, borderRadius: radius.card }]}>
          <View style={styles.segRow}>
            <Text variant="body" style={{ flex: 1 }}>Theme</Text>
          </View>
          <View style={[styles.segment, { backgroundColor: c.s2, borderRadius: radius.md }]}>
            {(['black', 'light', 'system'] as const).map((opt) => {
              const active = pref === opt;
              return (
                <Text
                  key={opt}
                  onPress={() => { haptics.select(); setPref(opt); }}
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
          <Text variant="micro" tone="t4" style={{ paddingHorizontal: 14, paddingBottom: 12 }}>
            Currently showing the {name} theme.
          </Text>
          <View style={{ borderTopColor: c.bg, borderTopWidth: StyleSheet.hairlineWidth }} />
          <HapticsRow />
        </View>

        {/* Account */}
        <GroupLabel>ACCOUNT</GroupLabel>
        <View style={[styles.card, { backgroundColor: c.s1, borderRadius: radius.card }]}>
          <Row label="Name" value={user.name} c={c} />
          {user.username && <Row label="Username" value={`@${user.username}`} c={c} />}
          <Row label="Email" value={user.email} c={c} />
          <Row label="Account type" value={isBiz ? 'Business' : 'Personal'} c={c} />
          <Row label="Plan" value={user.plan === 'pro' ? 'Atwe Pro' : 'Free'} c={c} />
          <Row
            label="Email verified"
            value={user.email_verified ? 'Yes' : 'Not verified'}
            c={c}
          />
          <Row
            label="Two-factor"
            value={user.twoFactorEnabled ? 'On' : 'Off'}
            c={c}
            last
          />
        </View>

        {/* Shopping */}
        <GroupLabel>SHOPPING</GroupLabel>
        <View style={[styles.card, { backgroundColor: c.s1, borderRadius: radius.card }]}>
          <LinkRow label="Cart" c={c} onPress={() => router.push('/cart')} />
          <LinkRow label="Delivery addresses" c={c} onPress={() => router.push('/addresses')} />
          <LinkRow label="Orders" c={c} onPress={() => router.push('/orders')} />
          <LinkRow label="Appointments" c={c} onPress={() => router.push('/appointments')} last />
        </View>

        {/* Work */}
        <GroupLabel>WORK</GroupLabel>
        <View style={[styles.card, { backgroundColor: c.s1, borderRadius: radius.card }]}>
          <LinkRow label="Jobs" c={c} onPress={() => router.push('/jobs')} />
          <LinkRow label="Open to work" c={c} onPress={() => router.push('/workers')} last />
        </View>

        {/* Selling */}
        <GroupLabel>SELLING</GroupLabel>
        <View style={[styles.card, { backgroundColor: c.s1, borderRadius: radius.card }]}>
          <LinkRow label="Your listings" c={c} onPress={() => router.push('/sell')} />
          <LinkRow label="Sales" c={c} onPress={() => router.push('/sales')} last />
        </View>

        <View style={{ height: spacing.xxl }} />
        <Button title="Log out" kind="danger" onPress={logout} />

        <Text variant="micro" tone="t4" style={{ textAlign: 'center', marginTop: spacing.xl }}>
          Atwe iOS · build 0.1.0
        </Text>
      </ScrollView>
    </Screen>
  );
}

/**
 * Haptics on or off. Some people find any vibration unpleasant and iOS's own
 * switch is buried three screens deep in Accessibility, so an app that leans on
 * touch this hard owes them a one-tap way out. Turning it OFF is the last thing
 * that ticks, and turning it back ON ticks immediately — so the control
 * demonstrates itself in both directions.
 */
function HapticsRow() {
  const { c, radius } = useTheme();
  const [on, setOn] = useState(haptics.isEnabled);
  const set = (next: boolean) => {
    if (next) { haptics.setEnabled(true); haptics.select(); }
    else { haptics.select(); haptics.setEnabled(false); }
    setOn(next);
  };
  return (
    <>
      <View style={styles.segRow}>
        <Text variant="body" style={{ flex: 1 }}>Haptics</Text>
      </View>
      <View style={[styles.segment, { backgroundColor: c.s2, borderRadius: radius.md }]}>
        {([true, false] as const).map((v) => (
          <Text
            key={String(v)}
            onPress={() => set(v)}
            variant="callout"
            style={[
              styles.segItem,
              {
                color: on === v ? c.onPrimary : c.t2,
                backgroundColor: on === v ? c.primary : 'transparent',
                borderRadius: radius.sm,
              },
            ]}
          >
            {v ? 'On' : 'Off'}
          </Text>
        ))}
      </View>
      <Text variant="micro" tone="t4" style={{ paddingHorizontal: 14, paddingBottom: 12 }}>
        The small taps you feel when you press, pick and confirm.
      </Text>
    </>
  );
}

function GroupLabel({ children }: { children: string }) {
  const { spacing } = useTheme();
  return (
    <Text variant="micro" tone="t3" style={{ marginTop: spacing.lg, marginBottom: 8, marginLeft: 4, letterSpacing: 0.4 }}>
      {children}
    </Text>
  );
}

/** A row that goes somewhere, rather than just reporting a value. */
function LinkRow({ label, c, onPress, last }: {
  label: string;
  c: ReturnType<typeof useTheme>['c'];
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: c.bg, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth },
        pressed && { opacity: 0.6 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text variant="body" style={{ flex: 1 }}>{label}</Text>
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
      <Text variant="body" style={{ flexShrink: 1, textAlign: 'right', marginLeft: 12 }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  card: { paddingHorizontal: spacing.gutter },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    minHeight: row.height,
  },
  segRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 14, paddingBottom: 10 },
  segment: { flexDirection: 'row', padding: 4, marginBottom: 4 },
  segItem: { flex: 1, textAlign: 'center', paddingVertical: 9, overflow: 'hidden' },
});
