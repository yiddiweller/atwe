import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useTheme } from '@/theme/ThemeProvider';
import { useAuth } from '@/auth/AuthProvider';

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
        <View style={[styles.card, { backgroundColor: c.s1, borderRadius: radius.lg }]}>
          <View style={styles.segRow}>
            <Text variant="body" style={{ flex: 1 }}>Theme</Text>
          </View>
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
          <Text variant="micro" tone="t4" style={{ paddingHorizontal: 14, paddingBottom: 12 }}>
            Currently showing the {name} theme.
          </Text>
        </View>

        {/* Account */}
        <GroupLabel>ACCOUNT</GroupLabel>
        <View style={[styles.card, { backgroundColor: c.s1, borderRadius: radius.lg }]}>
          <Row label="Name" value={user.name} c={c} />
          {user.username && <Row label="Username" value={`@${user.username}`} c={c} />}
          <Row label="Email" value={user.email} c={c} />
          <Row label="Account type" value={isBiz ? 'Business' : 'Personal'} c={c} />
          <Row label="Plan" value={user.plan === 'pro' ? 'Atwe Pro' : 'Free'} c={c} />
          <Row
            label="Email verified"
            value={user.emailVerified ? 'Yes' : 'Not verified'}
            c={c}
          />
          <Row
            label="Two-factor"
            value={user.twoFactorEnabled ? 'On' : 'Off'}
            c={c}
            last
          />
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

function GroupLabel({ children }: { children: string }) {
  const { spacing } = useTheme();
  return (
    <Text variant="micro" tone="t3" style={{ marginTop: spacing.lg, marginBottom: 8, marginLeft: 4, letterSpacing: 0.4 }}>
      {children}
    </Text>
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
  card: { paddingHorizontal: 16 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
  },
  segRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 14, paddingBottom: 10 },
  segment: { flexDirection: 'row', padding: 4, marginBottom: 4 },
  segItem: { flex: 1, textAlign: 'center', paddingVertical: 9, overflow: 'hidden' },
});
