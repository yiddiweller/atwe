import { useState } from 'react';
import { View, Pressable, StyleSheet, ActivityIndicator, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { GlassIcon } from '@/components/Glass';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { useTheme } from '@/theme/ThemeProvider';
import { useOneHighlight } from '@/api/social';
import { mediaUri } from '@/lib/media';
import { haptics } from '@/lib/haptics';

/**
 * A highlight, read like a story: tap the right half to go on, the left to go
 * back. No auto-advance and no seen-marking — a highlight is something somebody
 * chose to keep, not a thing expiring under you, so it waits.
 */
export default function HighlightViewer() {
  const { id, username } = useLocalSearchParams<{ id: string; username?: string }>();
  const { c } = useTheme();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const hid = Number(id);
  const { highlight, isLoading, isError } = useOneHighlight(username, Number.isFinite(hid) ? hid : undefined);
  const [at, setAt] = useState(0);

  const items = highlight?.items ?? [];
  const item = items[at];

  const go = (d: 1 | -1) => {
    const next = at + d;
    if (next < 0) return;
    if (next >= items.length) { router.back(); return; }
    haptics.tap();
    setAt(next);
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.head}>
        <GlassIcon onPress={() => router.back()} label="Close" size={38}>
          <Ionicons name="close" size={22} color={c.text} />
        </GlassIcon>
        <Text variant="headline" numberOfLines={1} style={{ flex: 1, textAlign: 'center' }}>
          {highlight?.title ?? 'Highlight'}
        </Text>
        <View style={{ width: 38 }} />
      </View>

      {/* Where you are in it, before anything else — a viewer with no progress
          bar is a viewer you cannot tell the length of. */}
      {items.length > 1 && (
        <View style={styles.bars}>
          {items.map((_, i) => (
            <View key={i} style={[styles.bar, { backgroundColor: i <= at ? c.text : c.s3 }]} />
          ))}
        </View>
      )}

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : isError || !item ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">This highlight is not available.</Text>
        </View>
      ) : (
        <View style={styles.stage}>
          {item.kind === 'text' ? (
            <View style={[styles.textCard, { backgroundColor: item.bg || c.s2 }]}>
              <Text variant="title" style={{ textAlign: 'center' }}>{item.caption}</Text>
            </View>
          ) : item.media ? (
            <Image source={{ uri: mediaUri(item.media) }} style={styles.media} contentFit="contain" transition={140} />
          ) : null}

          {!!item.caption && item.kind !== 'text' && (
            <Text variant="body" style={styles.caption}>{item.caption}</Text>
          )}

          {/* Tap halves, over the picture. Invisible on purpose: an arrow drawn
              on top of somebody's photo is a thing covering their photo. */}
          <Pressable style={[styles.half, { left: 0, width: width * 0.35 }]} onPress={() => go(-1)}
            accessibilityLabel="Previous" />
          <Pressable style={[styles.half, { right: 0, width: width * 0.65 }]} onPress={() => go(1)}
            accessibilityLabel="Next" />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 },
  bars: { flexDirection: 'row', gap: 4, paddingHorizontal: 16, paddingBottom: 10 },
  bar: { flex: 1, height: 3, borderRadius: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  stage: { flex: 1, justifyContent: 'center' },
  media: { width: '100%', flex: 1 },
  textCard: { flex: 1, margin: 16, borderRadius: 20, alignItems: 'center', justifyContent: 'center', padding: 26 },
  caption: { position: 'absolute', left: 20, right: 20, bottom: 30, textAlign: 'center' },
  half: { position: 'absolute', top: 0, bottom: 0 },
});
