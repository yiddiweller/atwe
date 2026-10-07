import { useState } from 'react';
import {
  View, ScrollView, Pressable, ActivityIndicator, useWindowDimensions, StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { PageHeader } from '@/components/PageHeader';
import { chromePad } from '@/components/Chrome';
import { useTheme } from '@/theme/ThemeProvider';
import { useShowcase, likeShowcase } from '@/api/discover';
import { mediaUri } from '@/lib/media';
import { compact } from '@/lib/format';

/** One showcase item: the pictures, who made it, and whether you appreciate it. */
export default function ShowcaseDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, radius, spacing: sp } = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { data, isLoading, isError, refetch } = useShowcase(id);
  const s = data?.showcase;
  const [liked, setLiked] = useState<boolean | null>(null);
  const [bump, setBump] = useState(0);
  const isLiked = liked ?? s?.liked ?? false;

  const toggle = async () => {
    if (!s) return;
    const next = !isLiked;
    setLiked(next); setBump((b) => b + (next ? 1 : -1));
    // no haptic here: this runs from a <Button>, which already clicked on press-in
    try { await likeShowcase(s.id, next); }
    catch { setLiked(!next); setBump((b) => b + (next ? -1 : 1)); }
  };

  const a = s?.author;
  return (
    <Screen edges={[]}>
      <PageHeader title={s?.title ?? 'Showcase'} />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : isError || !s ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">This is no longer shown.</Text>
          <View style={{ height: 14 }} />
          <Button title="Try again" kind="secondary" onPress={() => refetch()} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={[{ paddingBottom: 48 }, chromePad.header]} showsVerticalScrollIndicator={false}>
          {s.images.length > 0 && (
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}
              style={{ backgroundColor: c.s2 }}>
              {s.images.map((src, i) => (
                <Image key={i} source={{ uri: mediaUri(src) }}
                  style={{ width, aspectRatio: 1 }} contentFit="cover" transition={120} />
              ))}
            </ScrollView>
          )}
          <View style={{ padding: sp.lg }}>
            <Text variant="title" weight="800">{s.title}</Text>
            {!!s.category && (
              <View style={[styles.tag, { backgroundColor: c.s2 }]}>
                <Text variant="micro" tone="t2">{s.category}</Text>
              </View>
            )}
            {!!a && (
              <Pressable
                onPress={() => a.username && router.push(`/user/${a.username}`)}
                style={[styles.who, { backgroundColor: c.s1, borderRadius: radius.card }]}
                accessibilityRole="button" accessibilityLabel={`View ${a.name}`}
              >
                <Avatar name={a.name} avatar={a.avatar} biz={a.accountType === 'business'} size={40} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <View style={styles.nameLine}>
                    <Text variant="headline" numberOfLines={1}>{a.name}</Text>
                    {a.verified && <VerifiedBadge size={14} />}
                  </View>
                  {a.username && <Text variant="caption" tone="t3">@{a.username}</Text>}
                </View>
                <Ionicons name="chevron-forward" size={18} color={c.t3} />
              </Pressable>
            )}
            {!!s.description && (
              <Text variant="body" tone="t2" style={{ marginTop: 16, lineHeight: 23 }}>
                {s.description}
              </Text>
            )}
            <View style={{ marginTop: 22, gap: 10 }}>
              <Button
                title={isLiked
                  ? `Appreciated${s.likes + bump > 0 ? ` · ${compact(s.likes + bump)}` : ''}`
                  : 'Appreciate this'}
                kind={isLiked ? 'secondary' : 'primary'}
                onPress={toggle}
              />
              {!!s.productId && (
                <Button title="See the listing" kind="secondary"
                  onPress={() => router.push(`/listing/${s.productId}`)} />
              )}
            </View>
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  tag: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, marginTop: 8 },
  who: { flexDirection: 'row', alignItems: 'center', padding: 12, marginTop: 16 },
  nameLine: { flexDirection: 'row', alignItems: 'center' },
});
