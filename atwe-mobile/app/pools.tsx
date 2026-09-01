import { useState } from 'react';
import { View, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl, TextInput, Alert, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { PageHeader } from '@/components/PageHeader';
import { chromePad } from '@/components/Chrome';
import { Shelf } from '@/components/Shelf';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { usePools, createPool, type Pool } from '@/api/money';
import { money } from '@/api/wallet';
import { haptics } from '@/lib/haptics';

/**
 * Money pools — a shareable goal anybody can chip in toward. Different from a
 * split, which assigns a fixed share to named people; here nobody owes anything
 * and the total is whatever comes in.
 */
export default function Pools() {
  const { c } = useTheme();
  const [shelf, setShelf] = useState<'mine' | 'contributed'>('mine');
  const [making, setMaking] = useState(false);
  const { data, isLoading, refetch, isRefetching } = usePools(shelf);
  const rows = data?.pools ?? [];

  return (
    <Screen edges={[]}>
      <PageHeader
        title="Pools"
        action={{ icon: 'add', label: 'Start a pool', onPress: () => setMaking(true) }}
        below={<Shelf
          value={shelf}
          onChange={setShelf}
          options={[{ key: 'mine', label: 'Yours' }, { key: 'contributed', label: 'Chipped in' }]}
        />}
      />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => String(r.id)}
          renderItem={({ item }) => <Row pool={item} />}
          contentContainerStyle={[{ paddingBottom: 120 }, chromePad.headerShelf]}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.accent} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="people-circle-outline" size={44} color={c.t4} />
              <Text variant="body" tone="t3" style={{ marginTop: 12, textAlign: 'center' }}>
                {shelf === 'mine' ? 'Start a pool and share it.' : 'You have not chipped into anything.'}
              </Text>
            </View>
          }
        />
      )}
      <NewPool visible={making} onClose={() => setMaking(false)} onDone={refetch} />
    </Screen>
  );
}

function Row({ pool }: { pool: Pool }) {
  const { c, radius } = useTheme();
  const router = useRouter();
  const pct = pool.goalCents ? Math.min(1, pool.raisedCents / pool.goalCents) : 0;
  return (
    <Pressable
      onPress={() => router.push(`/pool/${pool.id}`)}
      style={({ pressed }) => [
        styles.row, { backgroundColor: c.s1, borderRadius: radius.card }, pressed && { opacity: 0.9 },
      ]}
    >
      <View style={styles.rowTop}>
        <Avatar name={pool.creator.name} avatar={pool.creator.avatar} size={36} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text variant="headline" numberOfLines={1}>{pool.title}</Text>
          <Text variant="caption" tone="t3" numberOfLines={1}>
            {pool.closed ? 'Closed' : `by ${pool.creator.name}`}
          </Text>
        </View>
        <Text variant="headline" weight="800">{money(pool.raisedCents)}</Text>
      </View>
      {!!pool.goalCents && (
        <>
          <View style={[styles.bar, { backgroundColor: c.s2 }]}>
            <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: c.green }]} />
          </View>
          <Text variant="micro" tone="t3" style={{ marginTop: 6 }}>
            of {money(pool.goalCents)}
          </Text>
        </>
      )}
    </Pressable>
  );
}

function NewPool({ visible, onClose, onDone }: { visible: boolean; onClose: () => void; onDone: () => void }) {
  const { c, radius, spacing } = useTheme();
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    try {
      const cents = Math.round(parseFloat(goal.replace(/[^0-9.]/g, '')) * 100);
      await createPool({
        title: title.trim(),
        description: desc.trim() || undefined,
        goalCents: Number.isFinite(cents) && cents > 0 ? cents : undefined,
      });
      haptics.success();
      setTitle(''); setDesc(''); setGoal('');
      onDone();
      onClose();
    } catch (e) { haptics.error(); Alert.alert('Pool', (e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <Screen edges={[]}>
        <PageHeader title="Start a pool" />
        <View style={{ padding: spacing.gutter }}>
          <Text variant="caption" tone="t3" style={styles.lbl}>WHAT IS IT FOR</Text>
          <TextInput
            value={title} onChangeText={setTitle}
            placeholder="A new kiln for the studio"
            placeholderTextColor={c.t4}
            accessibilityLabel="Pool title"
            style={[styles.input, { backgroundColor: c.s2, color: c.text, borderRadius: radius.pill }]}
          />
          <Text variant="caption" tone="t3" style={styles.lbl}>A LITTLE MORE (OPTIONAL)</Text>
          <TextInput
            value={desc} onChangeText={setDesc}
            placeholder="Why you are raising it"
            placeholderTextColor={c.t4}
            multiline
            accessibilityLabel="Description"
            style={[styles.input, { backgroundColor: c.s2, color: c.text, borderRadius: radius.bubble, minHeight: 84, textAlignVertical: 'top' }]}
          />
          <Text variant="caption" tone="t3" style={styles.lbl}>GOAL (OPTIONAL)</Text>
          <TextInput
            value={goal} onChangeText={setGoal}
            placeholder="500"
            placeholderTextColor={c.t4}
            keyboardType="decimal-pad"
            accessibilityLabel="Goal amount in dollars"
            style={[styles.input, { backgroundColor: c.s2, color: c.text, borderRadius: radius.pill }]}
          />
          <View style={{ height: 20 }} />
          <Button title="Start it" onPress={go} loading={busy} disabled={title.trim().length < 2} />
        </View>
      </Screen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: 40 },
  row: { padding: 14, marginHorizontal: spacing.gutter, marginBottom: 10 },
  rowTop: { flexDirection: 'row', alignItems: 'center' },
  bar: { height: 5, borderRadius: 999, marginTop: 12, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 999 },
  lbl: { marginTop: 16, marginBottom: 8, letterSpacing: 0.6 },
  input: { paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
});
