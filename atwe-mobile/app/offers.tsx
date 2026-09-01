import { View, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Avatar } from '@/components/Avatar';
import { PageHeader } from '@/components/PageHeader';
import { chromePad } from '@/components/Chrome';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { useOffers, type Offer } from '@/api/seller';
import { money } from '@/api/wallet';
import { timeAgo } from '@/lib/format';

/**
 * Haggling. One list rather than two shelves, because an offer changes sides as
 * it goes — you make one, they counter, it is your move again — and splitting
 * "mine" from "theirs" would move a row across the screen mid-conversation.
 * What matters is whose move it is, so that is what the row says.
 */
export default function Offers() {
  const { c } = useTheme();
  const { data, isLoading, refetch, isRefetching } = useOffers();
  const rows = data?.offers ?? [];

  return (
    <Screen edges={[]}>
      <PageHeader title="Offers" />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => String(r.id)}
          renderItem={({ item }) => <Row offer={item} />}
          contentContainerStyle={[{ paddingTop: 12, paddingBottom: 120 }, chromePad.header]}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.accent} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="swap-horizontal-outline" size={44} color={c.t4} />
              <Text variant="body" tone="t3" style={{ marginTop: 12, textAlign: 'center' }}>
                No offers. You can make one on most listings.
              </Text>
            </View>
          }
        />
      )}
    </Screen>
  );
}

/** What this offer is waiting on, from the reader's side. */
export function offerState(o: Offer): { label: string; tone: 'success' | 'danger' | 't3' | 't2' | 'accent' } {
  if (o.status === 'paid') return { label: 'Paid', tone: 'success' };
  if (o.status === 'accepted') return { label: o.canPay ? 'Accepted — pay now' : 'Accepted', tone: 'success' };
  if (o.status === 'declined') return { label: 'Declined', tone: 'danger' };
  if (o.status === 'cancelled') return { label: 'Withdrawn', tone: 't3' };
  if (o.myTurn) return { label: 'Your move', tone: 'accent' };
  return { label: o.status === 'countered' ? 'They countered' : 'Waiting on them', tone: 't2' };
}

function Row({ offer }: { offer: Offer }) {
  const { c, radius } = useTheme();
  const router = useRouter();
  const other = offer.iAmBuyer ? offer.seller : offer.buyer;
  const st = offerState(offer);
  return (
    <Pressable
      onPress={() => router.push(`/offer/${offer.id}`)}
      style={({ pressed }) => [
        styles.row, { backgroundColor: c.s1, borderRadius: radius.card }, pressed && { opacity: 0.9 },
      ]}
    >
      <Avatar name={other.name} avatar={other.avatar} biz={other.accountType === 'business'} size={40} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text variant="headline" numberOfLines={1}>{offer.product.name}</Text>
        <Text variant="caption" tone="t3" numberOfLines={1}>
          {offer.iAmBuyer ? 'to' : 'from'} {other.name} · {timeAgo(offer.createdAt)}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text variant="headline" weight="800">{money(offer.amountCents)}</Text>
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
