import { View, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { useTheme } from '@/theme/ThemeProvider';
import { post as card } from '@/theme/tokens';
import { mediaUri } from '@/lib/media';
import { timeAgo } from '@/lib/format';
import type { QuotedPost } from '@/api/social';

/**
 * The post being quoted, inside the one quoting it. Deliberately QUIET — a
 * smaller avatar, one line of identity, the body clamped: it is context for
 * what is written above it, not a second post competing with it.
 */
export function QuotedPostCard({ quote }: { quote: QuotedPost }) {
  const { c, radius } = useTheme();
  const router = useRouter();
  const a = quote.author;

  return (
    <Pressable
      onPress={() => router.push(`/post/${quote.id}`)}
      style={({ pressed }) => [
        styles.wrap,
        { backgroundColor: c.s2, borderRadius: card.innerRadius },
        pressed && { opacity: 0.9 },
      ]}
    >
      <View style={styles.head}>
        <Avatar name={a?.name} avatar={a?.avatar} biz={a?.accountType === 'business'} size={20} />
        <Text variant="micro" weight="700" numberOfLines={1} style={{ marginLeft: 6 }}>
          {a?.name ?? 'Someone'}
        </Text>
        {a?.verified && <VerifiedBadge size={11} />}
        <Text variant="micro" tone="t3" numberOfLines={1} style={{ marginLeft: 6 }}>
          {timeAgo(quote.created_at)}
        </Text>
      </View>
      {!!quote.body && (
        <Text variant="caption" tone="t2" numberOfLines={4} style={{ marginTop: 5 }}>
          {quote.body}
        </Text>
      )}
      {!!quote.image && (
        <Image
          source={{ uri: mediaUri(quote.image) }}
          style={[styles.img, { backgroundColor: c.s1, borderRadius: radius.sm }]}
          contentFit="cover"
          transition={120}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 10, marginTop: 10 },
  head: { flexDirection: 'row', alignItems: 'center' },
  img: { width: '100%', aspectRatio: 1.9, marginTop: 8 },
});
