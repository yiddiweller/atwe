import { View, ScrollView, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { PageHeader } from '@/components/PageHeader';
import { chromePad } from '@/components/Chrome';
import { useTheme } from '@/theme/ThemeProvider';
import { useBizAnalytics, type AnalyticsDay } from '@/api/bizops';
import { compact } from '@/lib/format';

/**
 * Who is looking. Distinct from Sales, which is what they bought — this is
 * reach: profile views, followers, how far the posts went, hiring, product-tag
 * taps, and how well the business actually answers people.
 */
export default function BusinessAnalytics() {
  const { c, radius, spacing } = useTheme();
  const { data, isLoading, isError, refetch, isRefetching } = useBizAnalytics();

  return (
    <Screen edges={[]}>
      <PageHeader title="Reach" />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : isError || !data ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">Only a business account has reach figures.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[{ padding: spacing.gutter, paddingBottom: 120 }, chromePad.header]}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.accent} />}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.hero, { backgroundColor: c.s1, borderRadius: radius.card }]}>
            <Text variant="caption" tone="t3">PROFILE VIEWS · LAST 30 DAYS</Text>
            <Text variant="display" weight="800" style={{ marginTop: 4 }}>
              {compact(data.profileViews.last30)}
            </Text>
            <Text variant="callout" tone="t2" style={{ marginTop: 2 }}>
              {compact(data.profileViews.unique30)} different people · {compact(data.profileViews.total)} all time
            </Text>
            <Spark days={data.profileViews.days} />
          </View>

          <Section title="YOUR AUDIENCE">
            <Stat label="Followers" value={compact(data.followers)} />
            <Stat label="Connections" value={compact(data.connections)} />
          </Section>

          <Section title="WHAT YOU POSTED">
            <Stat label="Posts" value={compact(data.posts.count)} />
            <Stat label="Seen" value={compact(data.posts.views)} />
            <Stat label="Likes" value={compact(data.posts.likes)} />
            <Stat label="Reposts" value={compact(data.posts.reposts)} />
          </Section>

          {(data.tagTaps.total > 0 || data.tagTaps.last30 > 0) && (
            <Section title="SHOPPING">
              <Stat label="Product taps · 30 days" value={compact(data.tagTaps.last30)} />
              <Stat label="Different people" value={compact(data.tagTaps.unique30)} />
              <Stat label="All time" value={compact(data.tagTaps.total)} />
            </Section>
          )}

          {data.jobs.count > 0 && (
            <Section title="HIRING">
              <Stat label="Jobs posted" value={compact(data.jobs.count)} />
              <Stat label="Applicants" value={compact(data.jobs.applicants)} />
              <Stat label="Job views" value={compact(data.jobs.views)} />
            </Section>
          )}

          {/* How well you answer people is the one figure here a business can
              act on TODAY, so it says what it means rather than a bare number. */}
          <Section title="HOW YOU ANSWER">
            <Stat label="Conversations" value={compact(data.messaging.conversations)} />
            <Stat label="You replied to" value={`${Math.round(data.messaging.responseRate)}%`} />
            {data.messaging.medianReplyMins != null && (
              <Stat label="Usually within" value={replyTime(data.messaging.medianReplyMins)} />
            )}
          </Section>
        </ScrollView>
      )}
    </Screen>
  );
}

/** "12 minutes" reads; "12" does not, and "0.2 hours" is worse. */
function replyTime(mins: number): string {
  if (mins < 1) return 'a minute';
  if (mins < 60) return `${Math.round(mins)} min`;
  const h = mins / 60;
  if (h < 24) return `${h < 2 ? h.toFixed(1) : Math.round(h)} hr`;
  const d = h / 24;
  return `${d < 2 ? d.toFixed(1) : Math.round(d)} days`;
}

/** A bar per day. No library — it is 30 rectangles, and a chart dependency for
 *  that is a dependency to carry forever. */
function Spark({ days }: { days: AnalyticsDay[] }) {
  const { c } = useTheme();
  if (!days?.length) return null;
  const max = Math.max(1, ...days.map((d) => d.views));
  return (
    <View style={styles.spark} accessibilityLabel={`Profile views over the last ${days.length} days`}>
      {days.map((d) => (
        <View
          key={d.day}
          style={[
            styles.bar,
            {
              backgroundColor: d.views > 0 ? c.accent : c.s2,
              /* A zero day still draws a 2px stub — an empty gap in the middle
                 of a chart reads as missing data rather than as a quiet day. */
              height: Math.max(2, Math.round((d.views / max) * 44)),
            },
          ]}
        />
      ))}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { c, radius } = useTheme();
  return (
    <View style={{ marginTop: 22 }}>
      <Text variant="caption" tone="t3" style={{ marginBottom: 8, letterSpacing: 0.6 }}>{title}</Text>
      <View style={{ backgroundColor: c.s1, borderRadius: radius.card, paddingHorizontal: 14 }}>
        {children}
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const { c } = useTheme();
  return (
    <View style={[styles.stat, { borderBottomColor: c.bg }]}>
      <Text variant="body" tone="t2" style={{ flex: 1 }}>{label}</Text>
      <Text variant="headline" weight="800">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  hero: { padding: 20 },
  spark: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, marginTop: 16, height: 44 },
  bar: { flex: 1, borderRadius: 2, minWidth: 2 },
  stat: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
});
