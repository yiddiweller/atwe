import { useEffect, useState } from 'react';
import {
  View, FlatList, ScrollView, Pressable, ActivityIndicator, RefreshControl, StyleSheet,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { JobCard } from '@/components/JobCard';
import { HapticInput } from '@/components/HapticInput';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, radius } from '@/theme/tokens';
import { useJobs, JOB_TYPES, type JobFilters } from '@/api/jobs';
import { haptics } from '@/lib/haptics';
import { useAuth } from '@/auth/AuthProvider';

type Scope = NonNullable<JobFilters['scope']>;

/** The four shelves. "Posted" only exists for somebody who can post. */
const SCOPES: { key: Scope; label: string }[] = [
  { key: 'all', label: 'All jobs' },
  { key: 'saved', label: 'Saved' },
  { key: 'applied', label: 'Applied' },
  { key: 'mine', label: 'Posted' },
];

/**
 * The jobs board — `GET /api/jobs`. Search, then narrow by shelf, contract type
 * and remote. Featured roles sort first; that is the server's decision, not the
 * client's. Posting a role lives behind the ＋ in the header, which is the same
 * place every other "make one" in this app lives.
 */
export default function Jobs() {
  const { c } = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  /* Deep-linkable, because the Account page has a row for each shelf ("Jobs I
     posted", "My applications", "Saved jobs") and three rows that all land on
     the same unfiltered board are three rows pretending to be different. */
  const params = useLocalSearchParams<{ scope?: string }>();
  const initial = SCOPES.some((s) => s.key === params.scope) ? (params.scope as Scope) : 'all';
  const [scope, setScope] = useState<Scope>(initial);
  const [type, setType] = useState<string | null>(null);
  const [remote, setRemote] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isLoading, isError, refetch, isRefetching } =
    useJobs({ q: dq, type: type ?? undefined, remote, scope });
  const jobs = data?.jobs ?? [];

  return (
    <Screen edges={['top']}>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.icon} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={c.text} />
        </Pressable>
        <Text variant="headline">Jobs</Text>
        <Pressable
          onPress={() => router.push('/post-job')}
          hitSlop={10}
          style={styles.icon}
          accessibilityRole="button"
          accessibilityLabel="Post a job"
        >
          <Ionicons name="add" size={26} color={c.text} />
        </Pressable>
      </View>

      {/* Search */}
      <View style={{ paddingHorizontal: spacing.gutter }}>
        <View style={[styles.search, { backgroundColor: c.s2 }]}>
          <Ionicons name="search" size={18} color={c.t3} />
          <HapticInput
            value={q}
            onChangeText={setQ}
            placeholder="Job title, company or keyword"
            placeholderTextColor={c.t3}
            style={[styles.searchInput, { color: c.text }]}
            returnKeyType="search"
            autoCorrect={false}
            accessibilityLabel="Search jobs"
          />
          {q.length > 0 && (
            <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityLabel="Clear">
              <Ionicons name="close-circle" size={18} color={c.t3} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Two rows that say different things, so they look different: the shelf
          is WHERE YOU ARE (white, the one primary), the filters are WHAT YOU
          NARROWED TO (blue, which is this app's selected-state colour).

          Both are plain ScrollViews. A horizontal FlatList stacked under another
          one measured 19px shorter than its own chips and the two rows visibly
          overlapped — and for eight items there is nothing to virtualise. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.rowStrip}
        contentContainerStyle={styles.shelfRow}
      >
        {SCOPES.map((s) => (
          <Chip
            key={s.key}
            label={s.label}
            active={scope === s.key}
            onPress={() => setScope(s.key)}
          />
        ))}
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.rowStrip}
        contentContainerStyle={styles.filterRow}
      >
        <Chip
          label="Remote"
          icon="globe-outline"
          active={remote}
          tone="filter"
          onPress={() => setRemote(!remote)}
        />
        {/* No "Any type" chip: it would sit lit up by default and make the row
            look like something was already filtered. Tapping the chosen type
            again clears it, which is what the lit one means. */}
        {JOB_TYPES.map((t) => (
          <Chip
            key={t}
            label={t}
            active={type === t}
            tone="filter"
            onPress={() => setType(type === t ? null : t)}
          />
        ))}
      </ScrollView>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : isError ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">Couldn't load jobs.</Text>
          <View style={{ height: 14 }} />
          <Button title="Try again" kind="secondary" onPress={() => refetch()} />
        </View>
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={(j) => String(j.id)}
          renderItem={({ item }) => <JobCard job={item} />}
          contentContainerStyle={jobs.length ? { paddingTop: 4, paddingBottom: 120 } : styles.emptyWrap}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.t3} />}
          ListEmptyComponent={<Empty scope={scope} q={dq} onPost={() => router.push('/post-job')} biz={user?.accountType === 'business'} />}
        />
      )}
    </Screen>
  );
}

/** Each empty shelf says something different, because each means something
 *  different: nothing matched, versus you have not done this yet. */
function Empty({ scope, q, onPost, biz }: {
  scope: Scope; q: string; onPost: () => void; biz: boolean;
}) {
  const copy: Record<Scope, { title: string; body: string }> = {
    all: { title: 'No jobs found', body: q ? `Nothing matches “${q}”.` : 'No roles are open right now — check back soon.' },
    saved: { title: 'Nothing saved', body: 'Tap the heart on a role to keep it here.' },
    applied: { title: 'No applications yet', body: 'Roles you apply to show up here, with where each one stands.' },
    mine: { title: biz ? 'You haven’t posted a role' : 'Nothing posted', body: 'Post a role and applicants land in one place.' },
  };
  const { title, body } = copy[scope];
  return (
    <View style={styles.center}>
      <Text variant="title" tone="t2">{title}</Text>
      <Text variant="body" tone="t3" style={{ marginTop: 6, textAlign: 'center' }}>{body}</Text>
      {scope === 'mine' && (
        <>
          <View style={{ height: 18 }} />
          <Button title="Post a job" kind="primary" onPress={onPost} />
        </>
      )}
    </View>
  );
}

function Chip({ label, active, onPress, icon, tone = 'shelf' }: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  tone?: 'shelf' | 'filter';
}) {
  const { c } = useTheme();
  const on = tone === 'shelf' ? c.primary : c.accent;
  const ink = tone === 'shelf' ? c.onPrimary : c.accentTint;
  /* The chip owns its tick, the way Button owns its click — so a new filter can
     never be added without one, and no caller has to remember. */
  return (
    <Pressable
      onPress={() => { haptics.select(); onPress(); }}
      style={[styles.chip, { backgroundColor: active ? on : c.s2 }]}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      {!!icon && <Ionicons name={icon} size={14} color={active ? ink : c.t2} />}
      <Text variant="callout" style={{ color: active ? ink : c.t2 }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingBottom: 8,
  },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: radius.pill, paddingHorizontal: 12, height: 42,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  /* A horizontal strip in a flex column must be told NOT to shrink. `flexGrow:0`
     alone leaves flex-shrink at 1 on the web build, and the list below it took
     the space: the chips' own 8px padding was squashed away and two stacked
     rows visibly overlapped. Measured 24.3px tall against 35px of content. */
  rowStrip: { flexGrow: 0, flexShrink: 0 },
  shelfRow: { paddingHorizontal: spacing.gutter, gap: 8, paddingTop: 12, paddingBottom: 8 },
  filterRow: { paddingHorizontal: spacing.gutter, gap: 8, paddingBottom: 12 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: spacing.gutter, paddingVertical: 8, borderRadius: 999,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyWrap: { flexGrow: 1 },
});
