import { useState } from 'react';
import {
  View, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl, Alert, TextInput, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { PageHeader } from '@/components/PageHeader';
import { chromePad } from '@/components/Chrome';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { useLists, createList, deleteList, type UserList } from '@/api/social';
import { haptics } from '@/lib/haptics';

/**
 * A curated timeline — the people you want to read without unfollowing anybody
 * else. Yours alone; nobody is told they are on one.
 */
export default function Lists() {
  const { c } = useTheme();
  const [making, setMaking] = useState(false);
  const { data, isLoading, refetch, isRefetching } = useLists();
  const rows = data?.lists ?? [];

  return (
    <Screen edges={[]}>
      <PageHeader
        title="Lists"
        action={{ icon: 'add', label: 'New list', onPress: () => setMaking(true) }}
      />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => String(r.id)}
          renderItem={({ item }) => <Row list={item} onDone={refetch} />}
          contentContainerStyle={[{ paddingTop: 12, paddingBottom: 120 }, chromePad.header]}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.accent} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="list-outline" size={44} color={c.t4} />
              <Text variant="body" tone="t3" style={{ marginTop: 12, textAlign: 'center' }}>
                A list is a feed of just the people you pick. Nobody is told they
                are on one.
              </Text>
            </View>
          }
        />
      )}
      <NewList visible={making} onClose={() => setMaking(false)} onDone={refetch} />
    </Screen>
  );
}

function Row({ list, onDone }: { list: UserList; onDone: () => void }) {
  const { c, radius } = useTheme();
  const router = useRouter();
  const remove = () => {
    Alert.alert(`Delete “${list.name}”?`, 'The people on it are not affected.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try { await deleteList(list.id); haptics.success(); onDone(); }
          catch (e) { haptics.error(); Alert.alert('Lists', (e as Error).message); }
        },
      },
    ]);
  };
  return (
    <Pressable
      onPress={() => router.push(`/list/${list.id}`)}
      style={({ pressed }) => [
        styles.row, { backgroundColor: c.s1, borderRadius: radius.card }, pressed && { opacity: 0.9 },
      ]}
    >
      <View style={[styles.disc, { backgroundColor: c.accentDim }]}>
        <Ionicons name="list-outline" size={18} color={c.accent} />
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text variant="headline" numberOfLines={1}>{list.name}</Text>
        <Text variant="caption" tone="t3">
          {list.members} {list.members === 1 ? 'person' : 'people'}
        </Text>
      </View>
      <Pressable onPress={remove} hitSlop={10} accessibilityLabel={`Delete ${list.name}`}>
        <Ionicons name="trash-outline" size={17} color={c.t3} />
      </Pressable>
    </Pressable>
  );
}

function NewList({ visible, onClose, onDone }: { visible: boolean; onClose: () => void; onDone: () => void }) {
  const { c, radius, spacing } = useTheme();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await createList(name.trim()); haptics.success(); setName(''); onDone(); onClose(); }
    catch (e) { haptics.error(); Alert.alert('Lists', (e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <Screen edges={[]}>
        <PageHeader title="New list" />
        <View style={{ padding: spacing.gutter }}>
          <TextInput
            value={name} onChangeText={setName}
            placeholder="Makers, suppliers, people I learn from…"
            placeholderTextColor={c.t4} autoFocus
            accessibilityLabel="List name"
            style={[styles.input, { backgroundColor: c.s2, color: c.text, borderRadius: radius.pill }]}
          />
          <Text variant="caption" tone="t3" style={{ marginTop: 10 }}>
            Add people to it from their profile.
          </Text>
          <View style={{ height: 18 }} />
          <Button title="Make the list" onPress={go} loading={busy} disabled={name.trim().length < 1} />
        </View>
      </Screen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: 40 },
  row: {
    flexDirection: 'row', alignItems: 'center', padding: 14,
    marginHorizontal: spacing.gutter, marginBottom: 10,
  },
  disc: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  input: { paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
});
