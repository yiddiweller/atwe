import { useState } from 'react';
import { View, FlatList, Pressable, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { PageHeader } from '@/components/PageHeader';
import { Shelf } from '@/components/Shelf';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { useCommunities, type Community } from '@/api/discover';
import { compact } from '@/lib/format';

const SHELVES = [
  { key: 'discover' as const, label: 'Discover' },
  { key: 'mine' as const, label: 'Mine' },
];

/** Communities — an umbrella over several group chats plus an announcements channel. */
export default function Communities() {
  const { c } = useTheme();
  const [scope, setScope] = useState<'discover' | 'mine'>('discover');
  const { data, isLoading, isError, refetch, isRefetching } = useCommunities(scope);
  const list = data?.communities ?? [];

  return (
    <Screen edges={['top']}>
      <PageHeader title="Communities" />
      <Shelf options={SHELVES} value={scope} onChange={setScope} />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : isError ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">Couldn't load communities.</Text>
          <View style={{ height: 14 }} />
          <Button title="Try again" kind="secondary" onPress={() => refetch()} />
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(x) => String(x.id)}
          renderItem={({ item }) => <Row x={item} />}
          contentContainerStyle={list.length ? { paddingBottom: 120 } : styles.emptyWrap}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.t3} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text variant="title" tone="t2">
                {scope === 'mine' ? 'You’re not in any' : 'None yet'}
              </Text>
              <Text variant="body" tone="t3" style={{ marginTop: 6, textAlign: 'center' }}>
                {scope === 'mine'
                  ? 'Join one from Discover and it appears here.'
                  : 'A community gathers several group chats under one roof.'}
              </Text>
            </View>
          }
        />
      )}
    </Screen>
  );
}

function Row({ x }: { x: Community }) {
  const { c, radius } = useTheme();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(`/community/${x.id}`)}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: c.s1, borderRadius: radius.card },
        pressed && { opacity: 0.9 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={x.name}
    >
      <Avatar name={x.name} avatar={x.avatar} size={48} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text variant="headline" numberOfLines={1}>{x.name}</Text>
        {!!x.description && (
          <Text variant="caption" tone="t2" numberOfLines={2} style={{ marginTop: 2 }}>
            {x.description}
          </Text>
        )}
        <Text variant="micro" tone="t3" style={{ marginTop: 4 }}>
          {[
            x.members != null ? `${compact(x.members)} member${x.members === 1 ? '' : 's'}` : null,
            x.groups != null ? `${x.groups} group${x.groups === 1 ? '' : 's'}` : null,
            x.isMember ? 'Joined' : null,
          ].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={c.t3} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyWrap: { flexGrow: 1 },
  card: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: spacing.gutter, marginBottom: 12, padding: 14,
  },
});
