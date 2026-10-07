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
import { useQuotes, type WorkQuote } from '@/api/money';
import { money } from '@/api/wallet';
import { timeAgo } from '@/lib/format';

/**
 * Quotes — the priced proposal that comes BEFORE the work, and the thing every
 * trade and agency starts with. Different from an offer (a buyer haggling over
 * a listing) and from an invoice (billing for work already agreed).
 */
export default function Quotes() {
  const { c } = useTheme();
  const [shelf, setShelf] = useState<'received' | 'sent'>('received');
  const { data, isLoading, refetch, isRefetching } = useQuotes(shelf);
  const rows = data?.quotes ?? [];

  return (
    <Screen edges={[]}>
      <PageHeader title="Quotes"
        below={<Shelf
          value={shelf}
          onChange={setShelf}
          options={[{ key: 'received', label: 'To review' }, { key: 'sent', label: 'You sent' }]}
        />}
      />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => String(r.id)}
          renderItem={({ item }) => <Row q={item} received={shelf === 'received'} />}
          contentContainerStyle={[{ paddingBottom: 120 }, chromePad.headerShelf]}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.accent} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="document-text-outline" size={44} color={c.t4} />
              <Text variant="body" tone="t3" style={{ marginTop: 12, textAlign: 'center' }}>
                {shelf === 'received' ? 'Nothing to review.' : 'You have not quoted anybody.'}
              </Text>
            </View>
          }
        />
      )}
    </Screen>
  );
}

export function quoteState(q: WorkQuote): { label: string; tone: 'success' | 'danger' | 't3' | 't2' | 'warning' } {
  if (q.status === 'accepted') return { label: 'Accepted', tone: 'success' };
  if (q.status === 'declined') return { label: 'Declined', tone: 'danger' };
  if (q.status === 'cancelled') return { label: 'Withdrawn', tone: 't3' };
  if (q.status === 'expired') return { label: 'Expired', tone: 'warning' };
  return { label: 'Waiting', tone: 't2' };
}

function Row({ q, received }: { q: WorkQuote; received: boolean }) {
  const { c, radius } = useTheme();
  const router = useRouter();
  const who = received ? q.issuer : q.customer;
  const st = quoteState(q);
  return (
    <Pressable
      onPress={() => router.push(`/quote/${q.id}`)}
      style={({ pressed }) => [
        styles.row, { backgroundColor: c.s1, borderRadius: radius.card }, pressed && { opacity: 0.9 },
      ]}
    >
      <Avatar name={who.name} avatar={who.avatar} biz={who.accountType === 'business'} size={40} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text variant="headline" numberOfLines={1}>{q.title}</Text>
        <Text variant="caption" tone="t3" numberOfLines={1}>
          {received ? 'from' : 'to'} {who.name} · {timeAgo(q.createdAt)}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text variant="headline" weight="800">{money(q.amountCents)}</Text>
        <Text variant="micro" tone={st.tone}>{st.label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: 40 },
  row: {
    flexDirection: 'row', alignItems: 'center', padding: 14,
    marginHorizontal: spacing.gutter, marginBottom: 10,
  },
});
