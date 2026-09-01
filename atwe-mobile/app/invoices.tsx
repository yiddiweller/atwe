import { useState } from 'react';
import { View, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Avatar } from '@/components/Avatar';
import { PageHeader } from '@/components/PageHeader';
import { Shelf } from '@/components/Shelf';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { useInvoices, type Invoice } from '@/api/money';
import { money } from '@/api/wallet';
import { timeAgo } from '@/lib/format';

/**
 * Bills. Received is what you owe; Sent is what you are owed. "Overdue" is not
 * a status the server stores — it is derived from a due date that has passed
 * while the bill is still unpaid, which is exactly how the web reads it.
 */
export default function Invoices() {
  const { c } = useTheme();
  const [shelf, setShelf] = useState<'received' | 'sent'>('received');
  const { data, isLoading, refetch, isRefetching } = useInvoices(shelf);
  const rows = data?.invoices ?? [];

  return (
    <Screen edges={['top']}>
      <PageHeader title="Invoices" />
      <Shelf
        value={shelf}
        onChange={setShelf}
        options={[{ key: 'received', label: 'To pay' }, { key: 'sent', label: 'You sent' }]}
      />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => String(r.id)}
          renderItem={({ item }) => <Row inv={item} received={shelf === 'received'} />}
          contentContainerStyle={{ paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.accent} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="receipt-outline" size={44} color={c.t4} />
              <Text variant="body" tone="t3" style={{ marginTop: 12, textAlign: 'center' }}>
                {shelf === 'received' ? 'Nobody has billed you.' : 'You have not billed anybody.'}
              </Text>
            </View>
          }
        />
      )}
    </Screen>
  );
}

/** Sent · Paid · Overdue · Cancelled, with the colour the state deserves. */
export function invoiceState(inv: Invoice): { label: string; tone: 'success' | 'danger' | 't3' | 't2' } {
  if (inv.status === 'paid') return { label: inv.paidOutside ? 'Paid outside Atwe' : 'Paid', tone: 'success' };
  if (inv.status === 'cancelled') return { label: 'Cancelled', tone: 't3' };
  if (inv.dueAt && new Date(inv.dueAt).getTime() < Date.now()) return { label: 'Overdue', tone: 'danger' };
  return { label: 'Unpaid', tone: 't2' };
}

function Row({ inv, received }: { inv: Invoice; received: boolean }) {
  const { c, radius } = useTheme();
  const router = useRouter();
  const who = received ? inv.issuer : inv.customer;
  const st = invoiceState(inv);
  return (
    <Pressable
      onPress={() => router.push(`/invoice/${inv.id}`)}
      style={({ pressed }) => [
        styles.row, { backgroundColor: c.s1, borderRadius: radius.card }, pressed && { opacity: 0.9 },
      ]}
    >
      <Avatar name={who.name} avatar={who.avatar} biz={who.accountType === 'business'} size={40} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text variant="headline" numberOfLines={1}>{inv.title}</Text>
        <Text variant="caption" tone="t3" numberOfLines={1}>
          {received ? 'from' : 'to'} {who.name} · {timeAgo(inv.createdAt)}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text variant="headline" weight="800">{money(inv.amountCents)}</Text>
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
