import { View, FlatList, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { PageHeader } from '@/components/PageHeader';
import { PostCard } from '@/components/PostCard';
import { useTheme } from '@/theme/ThemeProvider';
import { useListTimeline, useListMembers } from '@/api/social';

/** One list's timeline — the same post cards, only these people. */
export default function ListTimeline() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const lid = Number(id);
  const { data, isLoading, refetch, isRefetching } = useListTimeline(Number.isFinite(lid) ? lid : undefined);
  /* The timeline route returns posts and nothing else, so the name comes from
     the list itself — two small calls rather than a header that just says
     "List". */
  const meta = useListMembers(Number.isFinite(lid) ? lid : undefined);
  const posts = data?.posts ?? [];

  return (
    <Screen edges={['top']}>
      <PageHeader title={meta.data?.list?.name ?? 'List'} />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(p) => String(p.id)}
          renderItem={({ item }) => <PostCard post={item} />}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.accent} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="list-outline" size={44} color={c.t4} />
              <Text variant="body" tone="t3" style={{ marginTop: 12, textAlign: 'center' }}>
                Nothing here yet. Add people to this list from their profile.
              </Text>
            </View>
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: 40 },
});
