import { useState } from 'react';
import { View, TextInput, ScrollView, Pressable, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Avatar } from '@/components/Avatar';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { PostCard } from '@/components/PostCard';
import { ListingCard } from '@/components/ListingCard';
import { useTheme } from '@/theme/ThemeProvider';
import { useSearch, SEARCH_SCOPES, jobPay, type SearchScope, type Job, type Service } from '@/api/search';
import type { SearchUser } from '@/api/social';

/**
 * Search across all of Atwe. One field, a row of scopes, and results that look
 * like what they are — a person as a person, a post as a post card, a listing
 * as a listing.
 */
export default function Search() {
  const { c, spacing, radius } = useTheme();
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<SearchScope>('all');
  const { data, isLoading } = useSearch(scope, q);

  const people = data?.users ?? data?.businesses ?? [];
  const posts = data?.posts ?? [];
  const listings = data?.listings ?? [];
  const jobs = data?.jobs ?? [];
  const services = data?.services ?? [];
  const nothing = !isLoading && q.trim().length > 0 &&
    !people.length && !posts.length && !listings.length && !jobs.length && !services.length;

  return (
    <Screen edges={['top']}>
      <View style={[styles.head, { paddingHorizontal: spacing.lg }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
          <Ionicons name="chevron-back" size={26} color={c.text} />
        </Pressable>
        <View style={[styles.field, { backgroundColor: c.s2, borderRadius: radius.pill }]}>
          <Ionicons name="search" size={17} color={c.t3} />
          <TextInput
            style={[styles.input, { color: c.text }]}
            placeholder="Search Atwe"
            placeholderTextColor={c.t3}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            value={q}
            onChangeText={setQ}
            accessibilityLabel="Search"
          />
          {q.length > 0 && (
            <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityLabel="Clear">
              <Ionicons name="close-circle" size={17} color={c.t3} />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.scopes, { paddingHorizontal: spacing.lg }]}
      >
        {SEARCH_SCOPES.map((s) => {
          const on = scope === s.key;
          return (
            <Pressable key={s.key} onPress={() => setScope(s.key)} hitSlop={6} style={styles.scope}>
              <Text variant="callout" weight={on ? '700' : '400'} style={{ color: on ? c.text : c.t3 }}>
                {s.label}
              </Text>
              {on && <View style={[styles.underline, { backgroundColor: c.accent }]} />}
            </Pressable>
          );
        })}
      </ScrollView>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : nothing ? (
        <View style={styles.center}>
          <Text variant="body" tone="t3">Nothing found for “{q.trim()}”.</Text>
        </View>
      ) : (
        <FlatList
          data={[1]}
          keyExtractor={() => 'body'}
          renderItem={() => (
            <View style={{ paddingBottom: 40 }}>
              {people.length > 0 && (
                <Section title="People">
                  {people.map((u) => <PersonRow key={u.id} user={u} />)}
                </Section>
              )}
              {jobs.length > 0 && (
                <Section title="Jobs">
                  {jobs.map((j) => <JobRow key={j.id} job={j} />)}
                </Section>
              )}
              {services.length > 0 && (
                <Section title="Services">
                  {services.map((s) => <ServiceRow key={s.id} service={s} />)}
                </Section>
              )}
              {listings.length > 0 && (
                <Section title="Shop">
                  {listings.map((l) => <ListingCard key={l.id} listing={l} />)}
                </Section>
              )}
              {posts.length > 0 && (
                <Section title="Posts">
                  {posts.map((p) => <PostCard key={p.id} post={p} />)}
                </Section>
              )}
            </View>
          )}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { c, spacing } = useTheme();
  return (
    <View style={{ marginTop: 14 }}>
      <Text variant="caption" tone="t3" weight="700" style={{ paddingHorizontal: spacing.lg, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 }}>
        {title}
      </Text>
      {children}
      <View style={[styles.sep, { backgroundColor: c.border }]} />
    </View>
  );
}

function PersonRow({ user }: { user: SearchUser }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={() => router.push(`/user/${user.username}`)}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.s1 }]}
      accessibilityRole="button"
    >
      <Avatar avatar={user.avatar} name={user.name} biz={user.accountType === 'business'} size={44} />
      <View style={styles.rowMain}>
        <View style={styles.nameLine}>
          <Text variant="callout" weight="600" numberOfLines={1}>{user.name}</Text>
          {user.verified && <VerifiedBadge size={14} />}
        </View>
        <Text variant="caption" tone="t3" numberOfLines={1}>
          @{user.username}{user.headline ? ` · ${user.headline}` : ''}
        </Text>
      </View>
    </Pressable>
  );
}

function JobRow({ job }: { job: Job }) {
  const { c } = useTheme();
  const pay = jobPay(job);
  return (
    <View style={[styles.row, { alignItems: 'flex-start' }]}>
      <View style={styles.rowMain}>
        <View style={styles.nameLine}>
          <Text variant="callout" weight="600" numberOfLines={1}>{job.title}</Text>
          {job.featured && <Text variant="micro" tone="accent" weight="700">FEATURED</Text>}
        </View>
        <Text variant="caption" tone="t3" numberOfLines={1}>
          {[job.poster?.name, job.location, job.remote ? 'Remote' : null].filter(Boolean).join(' · ')}
        </Text>
        {pay && <Text variant="caption" tone="t2" style={{ marginTop: 2 }}>{pay}</Text>}
      </View>
    </View>
  );
}

function ServiceRow({ service }: { service: Service }) {
  return (
    <View style={[styles.row, { alignItems: 'flex-start' }]}>
      <Avatar avatar={service.provider?.avatar ?? null} name={service.provider?.name ?? '?'} size={40} />
      <View style={styles.rowMain}>
        <Text variant="callout" weight="600" numberOfLines={1}>{service.title}</Text>
        <Text variant="caption" tone="t3" numberOfLines={1}>
          {[service.provider?.name, service.area, service.rate].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 40 },
  input: { flex: 1, fontSize: 16, height: '100%' },
  scopes: { flexDirection: 'row', gap: 20, paddingVertical: 10 },
  scope: { alignItems: 'center' },
  underline: { height: 2.5, borderRadius: 2, width: '100%', marginTop: 5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 11 },
  rowMain: { flex: 1, minWidth: 0 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  sep: { height: StyleSheet.hairlineWidth, marginTop: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
});
