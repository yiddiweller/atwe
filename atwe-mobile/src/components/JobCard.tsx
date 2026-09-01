import { View, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { payLabel, showsPlace, STATUS_LABEL, type Job } from '@/api/jobs';
import { timeAgo } from '@/lib/format';

/**
 * One open role, as a card. Mirrors the web job card: employer, title, where and
 * how it pays, then the small facts that actually decide whether somebody taps —
 * remote, early applicant, and (on your own applications) where you stand.
 */
export function JobCard({ job }: { job: Job }) {
  const { c, radius } = useTheme();
  const router = useRouter();
  const pay = payLabel(job);
  const p = job.poster;
  const showPlace = showsPlace(job);

  /* Where an application stands earns a colour, because "Not selected" and
     "Hired" are not the same news and a person scanning a list should not have
     to read the word to know which it is. */
  const statusTone =
    job.applicationStatus === 'hired' ? c.success
    : job.applicationStatus === 'rejected' ? c.danger
    : job.applicationStatus === 'shortlisted' ? c.accent
    : c.t2;

  return (
    <Pressable
      onPress={() => router.push(`/job/${job.id}`)}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: c.s1, borderRadius: radius.card, borderColor: c.border },
        pressed && { opacity: 0.9 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${job.title}${p ? ` at ${job.company || p.name}` : ''}`}
    >
      {/* Employer */}
      {p && (
        <View style={styles.head}>
          <Avatar name={p.name} avatar={p.avatar} biz={p.accountType === 'business'} size={30} />
          <View style={styles.headName}>
            <Text variant="callout" weight="700" numberOfLines={1}>
              {job.company || p.name}
            </Text>
            {job.verifiedEmployer && <VerifiedBadge size={13} />}
          </View>
          {job.featured && (
            <View style={[styles.pill, { backgroundColor: c.accentDim }]}>
              <Text variant="micro" style={{ color: c.accent }}>Promoted</Text>
            </View>
          )}
        </View>
      )}

      <View style={styles.body}>
        <Text variant="headline" numberOfLines={2}>{job.title}</Text>

        {/* Where + how it pays */}
        <View style={styles.factRow}>
          {showPlace && (
            <Fact icon="location-outline" text={job.location!} />
          )}
          {job.remote && <Fact icon="globe-outline" text="Remote" />}
          {!!job.type && <Fact icon="time-outline" text={job.type} />}
        </View>
        {!!pay && (
          <Text variant="headline" weight="800" style={{ marginTop: 2 }}>{pay}</Text>
        )}

        {/* The small facts that decide a tap */}
        <View style={styles.tagRow}>
          {job.closed ? (
            <Tag text="Closed" tone={c.danger} bg={c.s2} />
          ) : job.applicants === 0 ? (
            <Tag text="Be the first to apply" tone={c.success} bg={c.s2} />
          ) : job.earlyApplicant ? (
            <Tag text="Be an early applicant" tone={c.success} bg={c.s2} />
          ) : job.applicants != null ? (
            <Tag text={`${job.applicants} applicants`} tone={c.t2} bg={c.s2} />
          ) : null}
          {job.applied && job.applicationStatus && (
            <Tag text={STATUS_LABEL[job.applicationStatus]} tone={statusTone} bg={c.s2} />
          )}
          {job.saved && !job.applied && <Tag text="Saved" tone={c.t2} bg={c.s2} />}
          <Text variant="micro" tone="t4" style={{ marginLeft: 'auto' }}>
            {timeAgo(job.created_at)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function Fact({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string }) {
  const { c } = useTheme();
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={13} color={c.t3} />
      <Text variant="caption" tone="t3" numberOfLines={1}>{text}</Text>
    </View>
  );
}

function Tag({ text, tone, bg }: { text: string; tone: string; bg: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text variant="micro" style={{ color: tone }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.gutter,
    marginBottom: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  head: { flexDirection: 'row', alignItems: 'center', padding: 12, paddingBottom: 0, gap: 8 },
  headName: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  body: { padding: 12, gap: 6 },
  factRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 2 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%' },
  tagRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  pill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
});
