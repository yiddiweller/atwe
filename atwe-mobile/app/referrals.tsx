import { View, ScrollView, Pressable, StyleSheet, ActivityIndicator, RefreshControl, Share, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { PageHeader } from '@/components/PageHeader';
import { useTheme } from '@/theme/ThemeProvider';
import { useReferrals } from '@/api/money';
import { money } from '@/api/wallet';
import { timeAgo } from '@/lib/format';
import { haptics } from '@/lib/haptics';

/**
 * Invite somebody, you both get paid. The number that matters is what you have
 * actually earned, so that is the big one — not the count of invites, which is
 * the vanity figure most referral screens lead with.
 */
export default function Referrals() {
  const { c, radius, spacing } = useTheme();
  const { data, isLoading, refetch, isRefetching } = useReferrals();

  const copy = async () => {
    if (!data) return;
    await Clipboard.setStringAsync(data.link);
    haptics.success();
    Alert.alert('Copied', 'Your invite link is on the clipboard.');
  };

  /* No haptic here — <Button> already ticked on press-in, and two generators
     on one gesture merge into a single long buzz. */
  const share = async () => {
    if (!data) return;
    try {
      await Share.share({ message: `Join me on Atwe — we both get ${money(data.bonusCents)}. ${data.link}` });
    } catch { /* the sheet was dismissed */ }
  };

  return (
    <Screen edges={['top']}>
      <PageHeader title="Invite friends" />
      {isLoading || !data ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.gutter, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.accent} />}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.hero, { backgroundColor: c.s1, borderRadius: radius.card }]}>
            <Text variant="caption" tone="t3">YOU HAVE EARNED</Text>
            <Text variant="display" weight="800" style={{ marginTop: 4 }}>{money(data.totalEarnedCents)}</Text>
            <Text variant="callout" tone="t2" style={{ marginTop: 2 }}>
              from {data.count} {data.count === 1 ? 'person' : 'people'}
            </Text>
          </View>

          <Text variant="body" tone="t2" style={{ marginTop: 16, lineHeight: 22 }}>
            Share your link. When somebody joins with it, you both get {money(data.bonusCents)} —
            {' '}{money(data.businessBonusCents)} if they sign up as a business.
          </Text>

          <Pressable
            onPress={copy}
            style={[styles.codeBox, { backgroundColor: c.s2, borderRadius: radius.card }]}
            accessibilityRole="button"
            accessibilityLabel="Copy your invite code"
          >
            <View style={{ flex: 1 }}>
              <Text variant="caption" tone="t3">YOUR CODE</Text>
              <Text variant="title" weight="800" style={{ letterSpacing: 2, marginTop: 2 }}>{data.code}</Text>
            </View>
            <Ionicons name="copy-outline" size={20} color={c.t2} />
          </Pressable>

          <View style={{ marginTop: 14, gap: 10 }}>
            <Button title="Share your link" onPress={share} />
          </View>

          {!!data.nextMilestone && (
            <View style={[styles.milestone, { backgroundColor: c.s1, borderRadius: radius.card }]}>
              <Ionicons name="trophy-outline" size={18} color={c.warning} />
              <Text variant="callout" tone="t2" style={{ flex: 1, marginLeft: 10 }}>
                {data.nextMilestone.at - data.count} more and you get a {money(data.nextMilestone.cents)} bonus.
              </Text>
            </View>
          )}

          {data.referrals.length > 0 && (
            <View style={{ marginTop: 26 }}>
              <Text variant="caption" tone="t3" style={{ marginBottom: 10, letterSpacing: 0.6 }}>WHO JOINED</Text>
              {data.referrals.map((r, i) => (
                <View key={i} style={[styles.row, { borderBottomColor: c.border }]}>
                  <Avatar name={r.user.name} avatar={r.user.avatar} size={34} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text variant="body" numberOfLines={1}>{r.user.name}</Text>
                    <Text variant="micro" tone="t3">{timeAgo(r.createdAt)}</Text>
                  </View>
                  <Text variant="callout" style={{ color: c.green }}>+{money(r.rewardCents)}</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  hero: { padding: 22 },
  codeBox: { flexDirection: 'row', alignItems: 'center', padding: 16, marginTop: 16 },
  milestone: { flexDirection: 'row', alignItems: 'center', padding: 14, marginTop: 18 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
});
