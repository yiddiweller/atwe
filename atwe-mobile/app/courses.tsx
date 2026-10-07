import { useState } from 'react';
import { View, FlatList, Pressable, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { PageHeader } from '@/components/PageHeader';
import { chromePad } from '@/components/Chrome';
import { Shelf } from '@/components/Shelf';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { useCourses, priceOrFree, type Course, type CourseScope } from '@/api/discover';
import { mediaUri } from '@/lib/media';
import { compact } from '@/lib/format';

const SHELVES: { key: CourseScope; label: string }[] = [
  { key: 'discover', label: 'Discover' },
  { key: 'enrolled', label: 'Learning' },
  { key: 'teaching', label: 'Teaching' },
];

/** Courses — what people teach, and what you are taking. */
export default function Courses() {
  const { c } = useTheme();
  const [scope, setScope] = useState<CourseScope>('discover');
  const { data, isLoading, isError, refetch, isRefetching } = useCourses(scope);
  const list = data?.courses ?? [];

  return (
    <Screen edges={[]}>
      <PageHeader title="Courses"
        below={<Shelf options={SHELVES} value={scope} onChange={setScope} />}
      />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : isError ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">Couldn't load courses.</Text>
          <View style={{ height: 14 }} />
          <Button title="Try again" kind="secondary" onPress={() => refetch()} />
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(x) => String(x.id)}
          renderItem={({ item }) => <Card x={item} />}
          contentContainerStyle={[list.length ? { paddingBottom: 120 } : styles.emptyWrap, chromePad.headerShelf]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.t3} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text variant="title" tone="t2">
                {scope === 'enrolled' ? 'Nothing on the go'
                  : scope === 'teaching' ? 'You’re not teaching yet'
                  : 'None published yet'}
              </Text>
              <Text variant="body" tone="t3" style={{ marginTop: 6, textAlign: 'center' }}>
                {scope === 'enrolled' ? 'Courses you join show up here with your progress.'
                  : scope === 'teaching' ? 'Teach what you know — lessons, video, notes.'
                  : 'When somebody publishes one, it shows here.'}
              </Text>
            </View>
          }
        />
      )}
    </Screen>
  );
}

function Card({ x }: { x: Course }) {
  const { c, radius } = useTheme();
  const router = useRouter();
  const cover = mediaUri(x.cover);
  const k = x.creator;
  return (
    <Pressable
      onPress={() => router.push(`/course/${x.id}`)}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: c.s1, borderRadius: radius.card, borderColor: c.border },
        pressed && { opacity: 0.9 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={x.title}
    >
      {!!cover && (
        <Image source={{ uri: cover }} style={[styles.cover, { backgroundColor: c.s2 }]}
          contentFit="cover" transition={120} />
      )}
      <View style={styles.body}>
        <Text variant="headline" numberOfLines={2}>{x.title}</Text>
        <View style={styles.who}>
          <Avatar name={k.name} avatar={k.avatar} biz={k.business} size={22} />
          <Text variant="caption" tone="t3" numberOfLines={1} style={{ flexShrink: 1 }}>{k.name}</Text>
          {k.verified && <VerifiedBadge size={12} />}
        </View>
        <View style={styles.factRow}>
          <Text variant="headline" weight="800">{priceOrFree(x.priceCents)}</Text>
          <Text variant="micro" tone="t3" style={{ marginLeft: 'auto' }}>
            {x.lessonCount} lesson{x.lessonCount === 1 ? '' : 's'}
            {x.studentCount ? ` · ${compact(x.studentCount)} learning` : ''}
          </Text>
        </View>
        {!x.published && x.mine && (
          <View style={[styles.tag, { backgroundColor: c.s2 }]}>
            <Text variant="micro" tone="t2">Not published</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyWrap: { flexGrow: 1 },
  card: {
    marginHorizontal: spacing.gutter, marginBottom: 14,
    borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden',
  },
  cover: { width: '100%', aspectRatio: 2 },
  body: { padding: 12 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  factRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  tag: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, marginTop: 8 },
});
