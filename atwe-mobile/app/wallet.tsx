import { View, FlatList, Pressable, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Avatar } from '@/components/Avatar';
import { useTheme } from '@/theme/ThemeProvider';
import { useWallet, money, txLabel, type WalletTx } from '@/api/wallet';
import { timeAgo } from '@/lib/format';

/**
 * Wallet — balance + peer-to-peer history (GET /api/wallet), with a Send action.
 * Add-money / cash-out / pots / requests come in later slices.
 */
export default function Wallet() {
  const { c, radius } = useTheme();
  const router = useRouter();
  const { data, isLoading, refetch, isRefetching } = useWallet();
  const txs = data?.transactions ?? [];

  return (
    <Screen edges={['top']}>
      <View style={[styles.head, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <Ionicons name="chevron-back" size={26} color={c.text} />
        </Pressable>
        <Text variant="title">Wallet</Text>
        <View style={styles.back} />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.accent} />
        </View>
      ) : (
        <FlatList
          data={txs}
          keyExtractor={(t) => String(t.id)}
          renderItem={({ item }) => <TxRow tx={item} />}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.t3} />
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 120 }}
          ListHeaderComponent={
            <View style={{ padding: 16 }}>
              {/* Balance card */}
              <View style={[styles.card, { backgroundColor: c.accent, borderRadius: radius.xl }]}>
                <Text variant="caption" style={{ color: 'rgba(255,255,255,0.85)' }}>
                  Atwe balance
                </Text>
                <Text style={styles.balance}>{money(data?.balanceCents ?? 0)}</Text>
                <View style={styles.actionsRow}>
                  <Pressable
                    style={[styles.action, { backgroundColor: 'rgba(255,255,255,0.18)' }]}
                    onPress={() => router.push('/wallet-send')}
                  >
                    <Ionicons name="arrow-up" size={18} color="#fff" />
                    <Text variant="callout" style={styles.actionLabel}>
                      Send
                    </Text>
                  </Pressable>
                </View>
              </View>
              <Text variant="headline" style={{ marginTop: 22, marginBottom: 4 }}>
                Activity
              </Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text variant="body" tone="t3">
                No transactions yet.
              </Text>
            </View>
          }
        />
      )}
    </Screen>
  );
}

function TxRow({ tx }: { tx: WalletTx }) {
  const { c } = useTheme();
  const positive = tx.deltaCents >= 0;
  return (
    <View style={[styles.tx, { borderBottomColor: c.border }]}>
      {tx.peer ? (
        <Avatar name={tx.peer.name} avatar={tx.peer.avatar} biz={tx.peer.accountType === 'business'} size={44} />
      ) : (
        <View style={[styles.txIcon, { backgroundColor: c.s2 }]}>
          <Ionicons
            name={positive ? 'arrow-down' : 'arrow-up'}
            size={20}
            color={positive ? c.repost : c.t2}
          />
        </View>
      )}
      <View style={styles.txMid}>
        <Text variant="headline" numberOfLines={1}>
          {txLabel(tx)}
        </Text>
        {!!tx.note && (
          <Text variant="caption" tone="t3" numberOfLines={1}>
            {tx.note}
          </Text>
        )}
        <Text variant="micro" tone="t3" style={{ marginTop: 1 }}>
          {timeAgo(tx.createdAt)}
        </Text>
      </View>
      <Text variant="headline" style={{ color: positive ? c.repost : c.text }}>
        {positive ? '+' : '−'}
        {money(tx.deltaCents)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: { width: 40, alignItems: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  card: { padding: 20 },
  balance: { color: '#fff', fontSize: 40, fontWeight: '800', marginTop: 4 },
  actionsRow: { flexDirection: 'row', marginTop: 18, gap: 10 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderRadius: 22,
  },
  actionLabel: { color: '#fff', fontWeight: '700' },
  tx: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  txIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  txMid: { flex: 1, marginLeft: 12, marginRight: 10 },
});
