import { useEffect, useState } from 'react';
import {
  View, ScrollView, Pressable, ActivityIndicator, Alert, StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { ChromeBar, useFloatingChrome } from '@/components/Chrome';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { JobCard } from '@/components/JobCard';
import { ApplySheet } from '@/components/ApplySheet';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import {
  useJob, useSimilarJobs, saveJob, withdrawApplication, matchJob, recordJobView,
  closeJob, deleteJob, payLabel, showsPlace, STATUS_LABEL, type JobMatch,
} from '@/api/jobs';
import { timeAgo } from '@/lib/format';
import { haptics } from '@/lib/haptics';

/**
 * One role, in full — `GET /api/jobs/:id`.
 *
 * The order is the order a person reads in: who is hiring, what the job is,
 * what it pays, where it is, then the description, then how they measure up,
 * then similar roles. Applying is a sheet rather than a page, because the
 * decision was already made on this screen and a second screen loses people.
 *
 * The poster sees a different bottom: applicants, and the two ways to take a
 * role down.
 */
export default function JobDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, radius, spacing: sp } = useTheme();
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useJob(id);
  const job = data?.job;
  const similar = useSimilarJobs(id);

  const [saved, setSaved] = useState<boolean | null>(null);
  const isSaved = saved ?? job?.saved ?? false;
  const [applying, setApplying] = useState(false);
  const [match, setMatch] = useState<JobMatch | null>(null);
  const [matching, setMatching] = useState(false);

  /* A view is what feeds the poster's Insights, so it is recorded once the job
     is genuinely on screen — not on the tap that started the navigation, which
     would also count a mis-tap that went straight back. */
  useEffect(() => { if (job && !job.mine) recordJobView(job.id); }, [job?.id, job?.mine]);

  const toggleSave = async () => {
    if (!job) return;
    const next = !isSaved;
    setSaved(next);
    haptics.select();
    try { await saveJob(job.id, next); } catch { setSaved(!next); }
  };

  const howYouMatch = async () => {
    if (!job) return;
    setMatching(true);
    try { setMatch(await matchJob(job.id)); }
    catch (e) { haptics.error(); Alert.alert('Atwe AI', (e as Error).message); }
    finally { setMatching(false); }
  };

  const withdraw = () => {
    if (!job) return;
    Alert.alert('Withdraw application', 'Your application will be removed.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Withdraw', style: 'destructive',
        onPress: async () => {
          haptics.warning();
          try { await withdrawApplication(job.id); await refetch(); }
          catch (e) { haptics.error(); Alert.alert('Withdraw', (e as Error).message); }
        },
      },
    ]);
  };

  const closeIt = () => {
    if (!job) return;
    Alert.alert('Close this role', 'It stops taking applications. You keep the applicants you already have.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Close it', style: 'destructive',
        onPress: async () => {
          haptics.warning();
          try { await closeJob(job.id); await refetch(); }
          catch (e) { haptics.error(); Alert.alert('Job', (e as Error).message); }
        },
      },
    ]);
  };

  const removeIt = () => {
    if (!job) return;
    Alert.alert('Delete this role', 'This removes the posting and its applicants for good.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          haptics.warning();
          try { await deleteJob(job.id); router.back(); }
          catch (e) { haptics.error(); Alert.alert('Job', (e as Error).message); }
        },
      },
    ]);
  };

  const pay = job ? payLabel(job) : null;
  const p = job?.poster;

  const chrome = useFloatingChrome();

  return (
    <Screen edges={[]}>
      <ChromeBar onLayout={chrome.onLayout}>
        <View style={styles.head}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.icon} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={26} color={c.text} />
          </Pressable>
          {/* No title here. The role's name is the first thing in the page, in
              Display type — repeating it in the bar put the same sentence on
              screen twice, one above the other. */}
          <View style={{ flex: 1 }} />
          <Pressable onPress={toggleSave} hitSlop={10} style={styles.icon}
            accessibilityRole="button"
            accessibilityLabel={isSaved ? 'Saved' : 'Save this job'}>
            {job && !job.mine && (
              <Ionicons name={isSaved ? 'heart' : 'heart-outline'} size={24}
                color={isSaved ? c.like : c.text} />
            )}
          </Pressable>
        </View>
      </ChromeBar>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : isError || !job ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">This role is no longer listed.</Text>
          <View style={{ height: 14 }} />
          <Button title="Try again" kind="secondary" onPress={() => refetch()} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={[{ paddingBottom: 48 }, chrome.pad]} showsVerticalScrollIndicator={false}>
          <View style={{ padding: sp.lg }}>
            <Text variant="display" weight="800">{job.title}</Text>

            {/* Who is hiring */}
            {!!p && (
              <Pressable
                onPress={() => p.username && router.push(`/user/${p.username}`)}
                style={[styles.employer, { backgroundColor: c.s1, borderRadius: radius.card }]}
                accessibilityRole="button"
                accessibilityLabel={`View ${job.company || p.name}`}
              >
                <Avatar name={p.name} avatar={p.avatar} biz={p.accountType === 'business'} size={40} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <View style={styles.nameLine}>
                    <Text variant="headline" numberOfLines={1}>{job.company || p.name}</Text>
                    {job.verifiedEmployer && <VerifiedBadge size={14} />}
                  </View>
                  <Text variant="caption" tone="t3">Posted {timeAgo(job.created_at)}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={c.t3} />
              </Pressable>
            )}

            {/* The facts */}
            <View style={styles.facts}>
              {!!pay && <FactRow icon="cash-outline" text={pay} strong />}
              {showsPlace(job) && <FactRow icon="location-outline" text={job.location!} />}
              {job.remote && <FactRow icon="globe-outline" text="Remote" />}
              {!!job.type && <FactRow icon="time-outline" text={job.type} />}
              {!!job.hours && <FactRow icon="calendar-outline" text={job.hours} />}
              {!!job.industry && <FactRow icon="business-outline" text={job.industry} />}
              {job.applicants != null && (
                <FactRow
                  icon="people-outline"
                  text={
                    job.applicants === 0 ? 'No applicants yet — be the first'
                    : job.earlyApplicant
                      ? `Only ${job.applicants} applicant${job.applicants === 1 ? '' : 's'} so far`
                      : `${job.applicants} applicants`
                  }
                />
              )}
              {!!job.closesAt && (
                <FactRow
                  icon="hourglass-outline"
                  text={job.closed ? 'Applications have closed' : `Closes ${new Date(job.closesAt).toLocaleDateString()}`}
                />
              )}
            </View>

            {/* How you match — asked for, not pushed, because it costs a call
                and not everybody wants to be scored. */}
            {!job.mine && !job.closed && (
              <View style={{ marginTop: 20 }}>
                {match ? (
                  <MatchCard match={match} />
                ) : (
                  <Button
                    title={matching ? 'Working…' : 'How you match'}
                    kind="secondary"
                    loading={matching}
                    onPress={howYouMatch}
                  />
                )}
              </View>
            )}

            {/* The role itself */}
            {!!job.description && (
              <>
                <Text variant="headline" style={{ marginTop: 24 }}>About the role</Text>
                <Text variant="body" tone="t2" style={{ marginTop: 8, lineHeight: 23 }}>
                  {job.description}
                </Text>
              </>
            )}

            {/* What happens next */}
            <View style={{ marginTop: 26, gap: 10 }}>
              {job.mine ? (
                <>
                  <Button
                    title={`Applicants${job.applicants ? ` (${job.applicants})` : ''}`}
                    kind="primary"
                    onPress={() => router.push(`/applicants/${job.id}`)}
                  />
                  {!job.closed && (
                    <Button title="Close this role" kind="secondary" onPress={closeIt} />
                  )}
                  <Button title="Delete" kind="danger" onPress={removeIt} />
                </>
              ) : job.applied ? (
                <>
                  <View style={[styles.applied, { backgroundColor: c.s1, borderRadius: radius.card }]}>
                    <Ionicons name="checkmark-circle" size={20} color={c.success} />
                    <Text variant="callout" style={{ flex: 1 }}>
                      Applied — {STATUS_LABEL[job.applicationStatus ?? 'applied']}
                    </Text>
                  </View>
                  <Button title="Withdraw application" kind="secondary" onPress={withdraw} />
                </>
              ) : job.closed ? (
                <Text variant="callout" tone="t3" style={{ textAlign: 'center' }}>
                  This role is no longer taking applications.
                </Text>
              ) : (
                <Button title="Apply" kind="primary" onPress={() => setApplying(true)} />
              )}
              {!!p && !job.mine && (
                <Button
                  title="Message the employer"
                  kind="secondary"
                  onPress={() => router.push(`/chat/${p.id}`)}
                />
              )}
            </View>
          </View>

          {/* Similar roles */}
          {!!similar.data?.jobs?.length && (
            <View style={{ marginTop: 10 }}>
              <Text variant="headline" style={{ marginHorizontal: spacing.gutter, marginBottom: 10 }}>
                Similar roles
              </Text>
              {similar.data.jobs.map((j) => <JobCard key={j.id} job={j} />)}
            </View>
          )}
        </ScrollView>
      )}

      {!!job && (
        <ApplySheet
          visible={applying}
          job={job}
          onClose={() => setApplying(false)}
          onApplied={async () => { setApplying(false); await refetch(); }}
        />
      )}
    </Screen>
  );
}

/** The score, and — more useful than the number — which skills carried it and
 *  which ones are missing. Without an AI key the server answers with a skills
 *  overlap instead, which is honest rather than absent. */
function MatchCard({ match }: { match: JobMatch }) {
  const { c, radius } = useTheme();
  const tone = match.score >= 75 ? c.success : match.score >= 50 ? c.accent : c.warning;
  return (
    <View style={[styles.match, { backgroundColor: c.s1, borderRadius: radius.card }]}>
      <View style={styles.matchTop}>
        <Text variant="display" weight="800" style={{ color: tone }}>{match.score}</Text>
        <View style={{ flex: 1 }}>
          <Text variant="headline">{match.level}</Text>
          <Text variant="micro" tone="t4">
            {match.ai ? 'Scored by Atwe AI' : 'Based on your skills'}
          </Text>
        </View>
      </View>
      {!!match.summary && (
        <Text variant="callout" tone="t2" style={{ marginTop: 10, lineHeight: 20 }}>
          {match.summary}
        </Text>
      )}
      {/* A lone number is not much use. When the score came from a plain skills
          overlap and none of them landed, say what would make it sharper rather
          than leaving a bare figure sitting there. */}
      {!match.ai && match.have.length === 0 && (
        <Text variant="callout" tone="t2" style={{ marginTop: 10, lineHeight: 20 }}>
          Add your skills and experience to your profile and this gets a lot
          sharper.
        </Text>
      )}
      {match.have.length > 0 && (
        <SkillRow title="You have" items={match.have} tone={c.success} />
      )}
      {match.missing.length > 0 && (
        <SkillRow title="Worth adding" items={match.missing} tone={c.t2} />
      )}
    </View>
  );
}

function SkillRow({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  const { c } = useTheme();
  return (
    <View style={{ marginTop: 12 }}>
      <Text variant="micro" tone="t3" style={{ marginBottom: 6 }}>{title}</Text>
      <View style={styles.skills}>
        {items.map((s) => (
          <View key={s} style={[styles.skill, { backgroundColor: c.s2 }]}>
            <Text variant="micro" style={{ color: tone }}>{s}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function FactRow({ icon, text, strong }: {
  icon: React.ComponentProps<typeof Ionicons>['name']; text: string; strong?: boolean;
}) {
  const { c } = useTheme();
  return (
    <View style={styles.factRow}>
      <Ionicons name={icon} size={17} color={c.t3} />
      <Text variant={strong ? 'headline' : 'body'} tone={strong ? undefined : 't2'} style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 8, gap: 4 },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  employer: { flexDirection: 'row', alignItems: 'center', padding: 12, marginTop: 16 },
  nameLine: { flexDirection: 'row', alignItems: 'center' },
  facts: { marginTop: 18, gap: 10 },
  factRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  applied: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  match: { padding: 14 },
  matchTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  skills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  skill: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999 },
});
