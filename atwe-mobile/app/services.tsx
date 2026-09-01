import { useEffect, useState } from 'react';
import {
  View, ScrollView, Pressable, ActivityIndicator, RefreshControl, StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { HapticInput } from '@/components/HapticInput';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { useServices, useLocal, SERVICE_CATEGORIES, type ServiceListing } from '@/api/services';
import { mediaUri } from '@/lib/media';
import { haptics } from '@/lib/haptics';
import { whenLabel } from '@/api/events';

/**
 * Services — "find any service".
 *
 * With no category chosen this is the LOCAL HUB (`/api/local`): one search
 * across services, businesses, open roles and what's on, because somebody
 * typing "plumber" does not care which of our tables the answer lives in.
 * Choosing a category narrows to services proper (`/api/services`).
 */
export default function Services() {
  const { c } = useTheme();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const hub = useLocal(cat ? '' : dq);
  const narrowed = useServices(dq, cat);
  const loading = cat ? narrowed.isLoading : hub.isLoading;
  const refetch = () => { void (cat ? narrowed.refetch() : hub.refetch()); };
  const refreshing = cat ? narrowed.isRefetching : hub.isRefetching;

  return (
    <Screen edges={['top']}>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.icon} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={c.text} />
        </Pressable>
        <Text variant="headline">Services</Text>
        <Pressable onPress={() => router.push('/offer-service')} hitSlop={10} style={styles.icon}
          accessibilityRole="button" accessibilityLabel="Offer a service">
          <Ionicons name="add" size={26} color={c.text} />
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: spacing.gutter }}>
        <View style={[styles.search, { backgroundColor: c.s2 }]}>
          <Ionicons name="search" size={18} color={c.t3} />
          <HapticInput
            value={q} onChangeText={setQ}
            placeholder="A plumber, a tutor, a photographer"
            placeholderTextColor={c.t3}
            style={[styles.searchInput, { color: c.text }]}
            returnKeyType="search" autoCorrect={false}
            accessibilityLabel="Search services"
          />
          {q.length > 0 && (
            <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityLabel="Clear">
              <Ionicons name="close-circle" size={18} color={c.t3} />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={styles.strip} contentContainerStyle={styles.chipRow}>
        {[null, ...SERVICE_CATEGORIES].map((k) => {
          const on = cat === k;
          return (
            <Pressable
              key={k ?? 'all'}
              onPress={() => { haptics.select(); setCat(k); }}
              style={[styles.chip, { backgroundColor: on ? c.primary : c.s2 }]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={k ?? 'Everything'}
            >
              <Text variant="callout" style={{ color: on ? c.onPrimary : c.t2 }}>
                {k ?? 'Everything'}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetch} tintColor={c.t3} />}
        >
          {cat ? (
            (narrowed.data?.services ?? []).length ? (
              (narrowed.data?.services ?? []).map((s) => <ServiceCard key={s.id} s={s} />)
            ) : <Nothing q={dq} what={cat} />
          ) : (
            <Hub data={hub.data} q={dq} />
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

/** The hub: every kind of answer, each under its own heading, and nothing at all
 *  where there is nothing — an empty heading is worse than no heading. */
function Hub({ data, q }: { data: ReturnType<typeof useLocal>['data']; q: string }) {
  const router = useRouter();
  const { c } = useTheme();
  if (!data) return null;
  const empty = !data.services.length && !data.businesses.length
    && !data.jobs.length && !data.events.length;
  if (empty) return <Nothing q={q} what="anything" />;

  return (
    <View>
      {data.services.length > 0 && (
        <Section title="Services">
          {data.services.map((s) => <ServiceCard key={s.id} s={s} />)}
        </Section>
      )}
      {data.businesses.length > 0 && (
        <Section title="Businesses">
          {data.businesses.map((b) => (
            <Pressable
              key={b.id}
              onPress={() => b.username && router.push(`/user/${b.username}`)}
              style={styles.row}
              accessibilityRole="button"
              accessibilityLabel={b.name}
            >
              <Avatar name={b.name} avatar={b.avatar} biz={b.accountType === 'business'} size={42} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <View style={styles.nameLine}>
                  <Text variant="callout" weight="700" numberOfLines={1}>{b.name}</Text>
                  {b.verified && <VerifiedBadge size={13} />}
                </View>
                {!!b.headline && (
                  <Text variant="caption" tone="t3" numberOfLines={1}>{b.headline}</Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={16} color={c.t3} />
            </Pressable>
          ))}
        </Section>
      )}
      {data.jobs.length > 0 && (
        <Section title="Open roles">
          {data.jobs.map((j) => (
            <Pressable key={j.id} onPress={() => router.push(`/job/${j.id}`)} style={styles.row}
              accessibilityRole="button" accessibilityLabel={j.title}>
              <View style={{ flex: 1 }}>
                <Text variant="callout" weight="700" numberOfLines={1}>{j.title}</Text>
                <Text variant="caption" tone="t3" numberOfLines={1}>
                  {[j.company, j.remote ? 'Remote' : j.location].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={c.t3} />
            </Pressable>
          ))}
        </Section>
      )}
      {data.events.length > 0 && (
        <Section title="What's on">
          {data.events.map((e) => (
            <Pressable key={e.id} onPress={() => router.push(`/event/${e.id}`)} style={styles.row}
              accessibilityRole="button" accessibilityLabel={e.title}>
              <View style={{ flex: 1 }}>
                <Text variant="callout" weight="700" numberOfLines={1}>{e.title}</Text>
                <Text variant="caption" tone="t3" numberOfLines={1}>
                  {whenLabel(e.startsAt)} · {e.online ? 'Online' : (e.location || e.host)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={c.t3} />
            </Pressable>
          ))}
        </Section>
      )}
    </View>
  );
}

export function ServiceCard({ s }: { s: ServiceListing }) {
  const { c, radius: r } = useTheme();
  const router = useRouter();
  const cover = mediaUri(s.image);
  return (
    <Pressable
      onPress={() => router.push(`/service/${s.id}`)}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: c.s1, borderRadius: r.card, borderColor: c.border },
        pressed && { opacity: 0.9 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={s.title}
    >
      {!!cover && (
        <Image source={{ uri: cover }} style={[styles.cover, { backgroundColor: c.s2 }]}
          contentFit="cover" transition={120} />
      )}
      <View style={styles.body}>
        <View style={styles.who}>
          <Avatar name={s.provider.name} avatar={s.provider.avatar}
            biz={s.provider.accountType === 'business'} size={26} />
          <Text variant="caption" tone="t2" numberOfLines={1} style={{ flexShrink: 1 }}>
            {s.provider.name}
          </Text>
          {s.provider.verified && <VerifiedBadge size={12} />}
        </View>
        <Text variant="headline" numberOfLines={2} style={{ marginTop: 4 }}>{s.title}</Text>
        <View style={styles.factRow}>
          {!!s.area && (
            <View style={styles.fact}>
              <Ionicons name="location-outline" size={13} color={c.t3} />
              <Text variant="caption" tone="t3" numberOfLines={1}>{s.area}</Text>
            </View>
          )}
          {!!s.category && (
            <View style={[styles.tag, { backgroundColor: c.s2 }]}>
              <Text variant="micro" tone="t2">{s.category}</Text>
            </View>
          )}
        </View>
        {!!s.rate && (
          <Text variant="headline" weight="800" style={{ marginTop: 2 }}>{s.rate}</Text>
        )}
      </View>
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 8 }}>
      <Text variant="headline" style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Nothing({ q, what }: { q: string; what: string }) {
  const router = useRouter();
  return (
    <View style={[styles.center, { paddingTop: 60 }]}>
      <Text variant="title" tone="t2">Nothing found</Text>
      <Text variant="body" tone="t3" style={{ marginTop: 6, textAlign: 'center' }}>
        {q ? `Nothing matches “${q}” in ${what}.` : `No ${what} listed yet.`}
      </Text>
      <View style={{ height: 18 }} />
      <Button title="Offer a service" kind="secondary" onPress={() => router.push('/offer-service')} />
    </View>
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
  strip: { flexGrow: 0, flexShrink: 0 },
  chipRow: { paddingHorizontal: spacing.gutter, gap: 8, paddingVertical: 12 },
  chip: { paddingHorizontal: spacing.gutter, paddingVertical: 8, borderRadius: 999 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  sectionTitle: { paddingHorizontal: spacing.gutter, marginBottom: 8, marginTop: 8 },
  card: {
    marginHorizontal: spacing.gutter, marginBottom: 14,
    borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden',
  },
  cover: { width: '100%', aspectRatio: 1.9 },
  body: { padding: 12 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nameLine: { flexDirection: 'row', alignItems: 'center' },
  factRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tag: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.gutter, paddingVertical: 11,
  },
});
