import { useState } from 'react';
import { View, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Avatar } from '@/components/Avatar';
import { PageHeader } from '@/components/PageHeader';
import { chromePad } from '@/components/Chrome';
import { Shelf } from '@/components/Shelf';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { useSplits, type Split } from '@/api/money';
import { money } from '@/api/wallet';
import { timeAgo } from '@/lib/format';

/**
 * Splitting a bill. Two sides of one idea, so two shelves: what I owe, and what
 * I am collecting. The row leads with the number that matters on each — my
 * share when I owe it, how much is in when I am collecting.
 */
export default function Splits() {
  const { c } = useTheme();
  const [shelf, setShelf] = useState<'owed' | 'created'>('owed');
  const { data, isLoading, refetch, isRefetching } = useSplits(shelf);
  const rows = data?.splits ?? [];

  return (
    <Screen edges={[]}>
      <PageHeader title="Split a bill"
        below={<Shelf
          value={shelf}
          onChange={setShelf}
          options={[{ key: 'owed', label: 'You owe' }, { key: 'created', label: 'You are collecting' }]}
        />}
      />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => String(r.id)}
          renderItem={({ item }) => <Row split={item} />}
          contentContainerStyle={[{ paddingBottom: 120 }, chromePad.headerShelf]}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.accent} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="pie-chart-outline" size={44} color={c.t4} />
              <Text variant="body" tone="t3" style={{ marginTop: 12, textAlign: 'center' }}>
                {shelf === 'owed' ? 'You do not owe a share of anything.' : 'You are not collecting anything.'}
              </Text>
            </View>
          }
        />
      )}
    </Screen>
  );
}

function Row({ split }: { split: Split }) {
  const { c, radius } = useTheme();
  const router = useRouter();
  const mine = split.iAmCreator;
  const pct = split.totalCents > 0 ? Math.min(1, split.paidCents / split.totalCents) : 0;
  return (
    <Pressable
      onPress={() => router.push(`/split/${split.id}`)}
      style={({ pressed }) => [
        styles.row, { backgroundColor: c.s1, borderRadius: radius.card }, pressed && { opacity: 0.9 },
      ]}
    >
      <View style={styles.rowTop}>
        {!mine && (
          <Avatar name={split.creator.name} avatar={split.creator.avatar} size={36} />
        )}
        <View style={{ flex: 1, marginLeft: mine ? 0 : 12 }}>
          <Text variant="headline" numberOfLines={1}>{split.title}</Text>
          <Text variant="caption" tone="t3" numberOfLines={1}>
            {mine
              ? `${money(split.paidCents)} of ${money(split.totalCents)} in`
              : `${split.creator.name} · ${timeAgo(split.createdAt)}`}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="headline" weight="800">
            {money(mine ? split.totalCents : split.myShareCents ?? 0)}
          </Text>
          {!mine && (
            <Text variant="micro" tone={split.myPaid ? 'success' : 't2'}>
              {split.myPaid ? 'Paid' : 'Your share'}
            </Text>
          )}
        </View>
      </View>
      {mine && (
        <View style={[styles.bar, { backgroundColor: c.s2 }]}>
          <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: c.green }]} />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: 40 },
  row: { padding: 14, marginHorizontal: spacing.gutter, marginBottom: 10 },
  rowTop: { flexDirection: 'row', alignItems: 'center' },
  bar: { height: 5, borderRadius: 999, marginTop: 12, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 999 },
});
