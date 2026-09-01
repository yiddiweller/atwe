import { View, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Avatar } from '@/components/Avatar';
import { PageHeader } from '@/components/PageHeader';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { useStarred, type StarredItem } from '@/api/beam';
import { timeAgo } from '@/lib/format';

/**
 * Messages you kept. Across every conversation, newest first — the point is
 * that you do not have to remember WHICH chat it was in.
 */
export default function Starred() {
  const { c } = useTheme();
  const { data, isLoading, refetch, isRefetching } = useStarred();
  const rows = data?.items ?? [];

  return (
    <Screen edges={['top']}>
      <PageHeader title="Starred" />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => `${r.scope}-${r.id}`}
          renderItem={({ item }) => <Row item={item} />}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.accent} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="star-outline" size={44} color={c.t4} />
              <Text variant="body" tone="t3" style={{ marginTop: 12, textAlign: 'center' }}>
                Hold a message and star it to keep it here.
              </Text>
            </View>
          }
        />
      )}
    </Screen>
  );
}

/** What a starred message says when its body is a photo or a voice note. */
export function hitPreview(m: { body: string | null; image?: boolean; mediaKind?: string | null }): string {
  if (m.body) return m.body;
  if (m.mediaKind === 'audio') return 'Voice note';
  if (m.mediaKind === 'video') return 'Video';
  if (m.image) return 'Photo';
  return 'Message';
}

function Row({ item }: { item: StarredItem }) {
  const { c, radius } = useTheme();
  const router = useRouter();
  const who = item.peer ?? item.group;
  const open = () => {
    if (item.scope === 'group' && item.group) router.push(`/group/${item.group.id}`);
    else if (item.peer) router.push(`/chat/${item.peer.id}`);
  };
  return (
    <Pressable
      onPress={open}
      style={({ pressed }) => [
        styles.row, { backgroundColor: c.s1, borderRadius: radius.card }, pressed && { opacity: 0.9 },
      ]}
    >
      <Avatar name={who?.name} avatar={(who as { avatar?: string | null })?.avatar ?? null} size={38} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text variant="callout" weight="700" numberOfLines={1}>
          {who?.name ?? 'Conversation'}
        </Text>
        <Text variant="body" tone="t2" numberOfLines={2} style={{ marginTop: 2 }}>
          {item.mine ? 'You: ' : ''}{hitPreview(item)}
        </Text>
        <Text variant="micro" tone="t3" style={{ marginTop: 3 }}>{timeAgo(item.created_at)}</Text>
      </View>
      <Ionicons name="star" size={15} color={c.warning} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: 40 },
  row: {
    flexDirection: 'row', alignItems: 'flex-start', padding: 14,
    marginHorizontal: spacing.gutter, marginBottom: 10,
  },
});
