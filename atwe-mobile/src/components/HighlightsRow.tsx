import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from './Text';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { useHighlights } from '@/api/social';
import { mediaUri } from '@/lib/media';

/**
 * Stories kept past their day. A row of circles under a profile header, the
 * way every app that has this does it — and it renders NOTHING when there are
 * none, rather than an empty rail, because an empty rail on somebody else's
 * profile is just a gap they cannot explain.
 */
export function HighlightsRow({ username }: { username: string | undefined }) {
  const { c } = useTheme();
  const router = useRouter();
  const { data } = useHighlights(username);
  const rows = data?.highlights ?? [];
  if (!rows.length) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={styles.strip}
    >
      {rows.map((h) => (
        <Pressable
          key={h.id}
          /* The viewer reads from the LIST, so it needs to know whose. */
          onPress={() => router.push(`/highlight/${h.id}?username=${username}`)}
          style={styles.item}
          accessibilityRole="button"
          accessibilityLabel={`${h.title}, ${h.count} ${h.count === 1 ? 'story' : 'stories'}`}
        >
          <View style={[styles.ring, { borderColor: c.border }]}>
            {h.cover ? (
              <Image source={{ uri: mediaUri(h.cover) }} style={styles.cover} contentFit="cover" transition={120} />
            ) : (
              <View style={[styles.cover, { backgroundColor: c.s2, alignItems: 'center', justifyContent: 'center' }]}>
                <Ionicons name="albums-outline" size={20} color={c.t3} />
              </View>
            )}
          </View>
          <Text variant="micro" tone="t2" numberOfLines={1} style={styles.title}>{h.title}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  /* flexShrink:0 as well as flexGrow:0 — a horizontal strip in a flex column
     gets squashed below its own content height without it. */
  strip: { flexGrow: 0, flexShrink: 0 },
  row: { paddingHorizontal: spacing.gutter, gap: 14, paddingVertical: 12 },
  item: { alignItems: 'center', width: 68 },
  ring: { width: 62, height: 62, borderRadius: 31, borderWidth: 1.5, padding: 2 },
  cover: { width: '100%', height: '100%', borderRadius: 28 },
  title: { marginTop: 5, textAlign: 'center' },
});
