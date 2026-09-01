import { useState } from 'react';
import { View, ScrollView, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { PageHeader } from '@/components/PageHeader';
import { useTheme } from '@/theme/ThemeProvider';
import { useCourse, enrolCourse, priceOrFree, type Lesson } from '@/api/discover';
import { mediaUri } from '@/lib/media';
import { compact } from '@/lib/format';
import { haptics } from '@/lib/haptics';

/**
 * One course: what it is, who teaches it, and the curriculum — grouped by the
 * creator's own sections, since that is how they built it.
 *
 * A paid course is taken from the WALLET BALANCE, not a card, so enrolling can
 * fail for want of funds. That message comes from the server and is shown as-is.
 */
export default function CourseDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, radius, spacing: sp } = useTheme();
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useCourse(id);
  const x = data?.course;
  const [busy, setBusy] = useState(false);

  const enrol = async () => {
    if (!x) return;
    setBusy(true);
    try { await enrolCourse(x.id); haptics.success(); await refetch(); }
    catch (e) { haptics.error(); Alert.alert('Courses', (e as Error).message); }
    finally { setBusy(false); }
  };

  /* Lessons come back flat with an optional `section`; group them into the
     modules the creator wrote, keeping first-seen order and putting the
     unsectioned ones under no heading at all rather than inventing one. */
  const groups: { section: string | null; items: Lesson[] }[] = [];
  for (const l of x?.lessons ?? []) {
    const g = groups.find((v) => v.section === (l.section || null));
    if (g) g.items.push(l);
    else groups.push({ section: l.section || null, items: [l] });
  }
  const k = x?.creator;
  const open = !!x && (x.enrolled || x.mine);

  return (
    <Screen edges={['top']}>
      <PageHeader title={x?.title ?? 'Course'} />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : isError || !x ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">This course is no longer here.</Text>
          <View style={{ height: 14 }} />
          <Button title="Try again" kind="secondary" onPress={() => refetch()} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
          {!!mediaUri(x.cover) && (
            <Image source={{ uri: mediaUri(x.cover) }} style={[styles.cover, { backgroundColor: c.s2 }]}
              contentFit="cover" transition={120} />
          )}
          <View style={{ padding: sp.lg }}>
            <Text variant="display" weight="800">{x.title}</Text>
            <Text variant="caption" tone="t3" style={{ marginTop: 4 }}>
              {x.lessonCount} lesson{x.lessonCount === 1 ? '' : 's'}
              {x.studentCount ? ` · ${compact(x.studentCount)} learning` : ''}
            </Text>

            {!!k && (
              <Pressable
                onPress={() => k.username && router.push(`/user/${k.username}`)}
                style={[styles.who, { backgroundColor: c.s1, borderRadius: radius.card }]}
                accessibilityRole="button" accessibilityLabel={`View ${k.name}`}
              >
                <Avatar name={k.name} avatar={k.avatar} biz={k.business} size={40} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <View style={styles.nameLine}>
                    <Text variant="headline" numberOfLines={1}>{k.name}</Text>
                    {k.verified && <VerifiedBadge size={14} />}
                  </View>
                  <Text variant="caption" tone="t3">Teaches this</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={c.t3} />
              </Pressable>
            )}

            {!!x.description && (
              <Text variant="body" tone="t2" style={{ marginTop: 16, lineHeight: 23 }}>
                {x.description}
              </Text>
            )}

            {/* Where you are, or the way in */}
            <View style={{ marginTop: 22 }}>
              {open ? (
                typeof x.progress === 'number' && (
                  <View>
                    <View style={[styles.track, { backgroundColor: c.s2 }]}>
                      <View style={[styles.fill, {
                        backgroundColor: c.accent,
                        width: `${Math.max(2, Math.round(x.progress * 100))}%`,
                      }]} />
                    </View>
                    <Text variant="micro" tone="t3" style={{ marginTop: 6 }}>
                      {Math.round(x.progress * 100)}% done
                    </Text>
                  </View>
                )
              ) : (
                <Button
                  title={x.priceCents > 0 ? `Enrol · ${priceOrFree(x.priceCents)}` : 'Start it — free'}
                  kind="primary"
                  loading={busy}
                  onPress={enrol}
                />
              )}
            </View>

            {/* The curriculum */}
            <View style={{ marginTop: 26 }}>
              <Text variant="headline" style={{ marginBottom: 6 }}>What's in it</Text>
              {groups.map((g, gi) => (
                <View key={gi} style={{ marginTop: g.section ? 14 : 4 }}>
                  {!!g.section && (
                    <Text variant="callout" tone="t3" style={{ marginBottom: 4 }}>{g.section}</Text>
                  )}
                  {g.items.map((l) => (
                    <Pressable
                      key={l.id}
                      onPress={() => {
                        if (l.locked) {
                          haptics.warning();
                          Alert.alert('Not yet', 'Enrol to open the lessons.');
                          return;
                        }
                        router.push(`/course/lesson/${l.id}?course=${x.id}`);
                      }}
                      style={styles.lesson}
                      accessibilityRole="button"
                      accessibilityLabel={l.title}
                    >
                      <Ionicons
                        name={l.locked ? 'lock-closed-outline'
                          : l.done ? 'checkmark-circle' : 'play-circle-outline'}
                        size={20}
                        color={l.done ? c.success : l.locked ? c.t4 : c.t2}
                      />
                      <Text variant="callout" numberOfLines={2}
                        tone={l.locked ? 't3' : undefined} style={{ flex: 1 }}>
                        {l.title}
                      </Text>
                      {!l.locked && <Ionicons name="chevron-forward" size={15} color={c.t3} />}
                    </Pressable>
                  ))}
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  cover: { width: '100%', aspectRatio: 2 },
  who: { flexDirection: 'row', alignItems: 'center', padding: 12, marginTop: 16 },
  nameLine: { flexDirection: 'row', alignItems: 'center' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
  lesson: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11 },
});
