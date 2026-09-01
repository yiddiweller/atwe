import { useEffect, useState } from 'react';
import {
  View, FlatList, Pressable, ActivityIndicator, RefreshControl, StyleSheet,
} from 'react-native';
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
import { useDirectory, distanceLabel, type DirectoryBusiness } from '@/api/services';
import { compact } from '@/lib/format';
import { haptics } from '@/lib/haptics';

/**
 * The business directory — `GET /api/businesses/directory`.
 *
 * Verified businesses sort first, then by following, which is the server's call
 * and the right one: on a directory the question is "who can I trust", and a
 * verified seal is the only signal here that is checked rather than claimed.
 */
export default function Businesses() {
  const { c } = useTheme();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isLoading, isError, refetch, isRefetching } = useDirectory(dq, verifiedOnly);
  const list = data?.businesses ?? [];

  return (
    <Screen edges={['top']}>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.icon} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={c.text} />
        </Pressable>
        <Text variant="headline">Businesses</Text>
        <View style={styles.icon} />
      </View>

      <View style={{ paddingHorizontal: spacing.gutter }}>
        <View style={[styles.search, { backgroundColor: c.s2 }]}>
          <Ionicons name="search" size={18} color={c.t3} />
          <HapticInput
            value={q} onChangeText={setQ}
            placeholder="A name, a trade, a place"
            placeholderTextColor={c.t3}
            style={[styles.searchInput, { color: c.text }]}
            returnKeyType="search" autoCorrect={false}
            accessibilityLabel="Search businesses"
          />
          {q.length > 0 && (
            <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityLabel="Clear">
              <Ionicons name="close-circle" size={18} color={c.t3} />
            </Pressable>
          )}
        </View>
        <Pressable
          onPress={() => { haptics.select(); setVerifiedOnly((v) => !v); }}
          style={[styles.toggle, { backgroundColor: verifiedOnly ? c.accent : c.s2 }]}
          accessibilityRole="radio"
          accessibilityState={{ selected: verifiedOnly }}
          accessibilityLabel="Verified only"
        >
          <Ionicons name="shield-checkmark-outline" size={15}
            color={verifiedOnly ? c.accentTint : c.t2} />
          <Text variant="callout" style={{ color: verifiedOnly ? c.accentTint : c.t2 }}>
            Verified only
          </Text>
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : isError ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">Couldn't load the directory.</Text>
          <View style={{ height: 14 }} />
          <Button title="Try again" kind="secondary" onPress={() => refetch()} />
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(b) => String(b.id)}
          renderItem={({ item }) => <BizCard b={item} />}
          contentContainerStyle={list.length ? { paddingTop: 12, paddingBottom: 120 } : styles.emptyWrap}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.t3} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text variant="title" tone="t2">No businesses found</Text>
              <Text variant="body" tone="t3" style={{ marginTop: 6, textAlign: 'center' }}>
                {dq ? `Nothing matches “${dq}”.`
                  : verifiedOnly ? 'No verified businesses yet — try turning that off.'
                  : 'None listed yet.'}
              </Text>
            </View>
          }
        />
      )}
    </Screen>
  );
}

function BizCard({ b }: { b: DirectoryBusiness }) {
  const { c, radius: r } = useTheme();
  const router = useRouter();
  const km = distanceLabel(b.distanceKm);
  return (
    <Pressable
      onPress={() => b.username && router.push(`/user/${b.username}`)}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: c.s1, borderRadius: r.card },
        pressed && { opacity: 0.9 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={b.name}
    >
      <Avatar name={b.name} avatar={b.avatar} biz size={48} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <View style={styles.nameLine}>
          <Text variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>{b.name}</Text>
          {b.verified && <VerifiedBadge size={14} />}
        </View>
        {!!b.headline && (
          <Text variant="caption" tone="t2" numberOfLines={1}>{b.headline}</Text>
        )}
        <Text variant="micro" tone="t3" style={{ marginTop: 2 }}>
          {[
            `${compact(b.followers)} follower${b.followers === 1 ? '' : 's'}`,
            b.jobs ? `${b.jobs} open role${b.jobs === 1 ? '' : 's'}` : null,
            km,
          ].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={c.t3} />
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
  toggle: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10,
    alignSelf: 'flex-start', paddingHorizontal: 14, height: 36, borderRadius: radius.pill,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyWrap: { flexGrow: 1 },
  card: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: spacing.gutter, marginBottom: 12, padding: 14,
  },
  nameLine: { flexDirection: 'row', alignItems: 'center' },
});
