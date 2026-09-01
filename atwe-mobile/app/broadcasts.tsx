import { useState } from 'react';
import {
  View, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl, Alert, TextInput, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { PageHeader } from '@/components/PageHeader';
import { chromePad } from '@/components/Chrome';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { useBroadcasts, createBroadcast, deleteBroadcast, useContacts, type BroadcastList } from '@/api/beam';
import { haptics } from '@/lib/haptics';

/**
 * A saved set of people you send to at once — and each of them gets it as a
 * PRIVATE message that they reply to alone. It is not a group, and the screen
 * says so, because that is the one thing somebody could get wrong here and it
 * is the sort of mistake you cannot take back.
 */
export default function Broadcasts() {
  const { c } = useTheme();
  const [making, setMaking] = useState(false);
  const { data, isLoading, refetch, isRefetching } = useBroadcasts();
  const rows = data?.lists ?? [];

  return (
    <Screen edges={[]}>
      <PageHeader
        title="Broadcast lists"
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
          ListHeaderComponent={
            rows.length ? (
              <Text variant="caption" tone="t3" style={styles.note}>
                Everybody gets it as a private message. They cannot see each other.
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="megaphone-outline" size={44} color={c.t4} />
              <Text variant="body" tone="t3" style={{ marginTop: 12, textAlign: 'center' }}>
                Save a set of people and message them all at once — privately,
                one to one.
              </Text>
            </View>
          }
        />
      )}
      <NewList visible={making} onClose={() => setMaking(false)} onDone={refetch} />
    </Screen>
  );
}

function Row({ list, onDone }: { list: BroadcastList; onDone: () => void }) {
  const { c, radius } = useTheme();
  const router = useRouter();

  const remove = () => {
    Alert.alert(`Delete “${list.name}”?`, 'The people in it are not affected.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try { await deleteBroadcast(list.id); haptics.success(); onDone(); }
          catch (e) { haptics.error(); Alert.alert('Broadcast', (e as Error).message); }
        },
      },
    ]);
  };

  return (
    <Pressable
      onPress={() => router.push(`/broadcast/${list.id}`)}
      style={({ pressed }) => [
        styles.row, { backgroundColor: c.s1, borderRadius: radius.card }, pressed && { opacity: 0.9 },
      ]}
    >
      <View style={[styles.disc, { backgroundColor: c.accentDim }]}>
        <Ionicons name="megaphone-outline" size={18} color={c.accent} />
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text variant="headline" numberOfLines={1}>{list.name}</Text>
        <Text variant="caption" tone="t3">
          {list.count} {list.count === 1 ? 'person' : 'people'}
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
  const contacts = useContacts();
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  const toggle = (id: number) => {
    haptics.select();
    setPicked((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const go = async () => {
    setBusy(true);
    try {
      /* `members`, not `memberIds` — the wrong name does not fail, the list is
         simply created empty and nobody finds out until they send to it. */
      await createBroadcast(name.trim(), picked);
      haptics.success();
      setName(''); setPicked([]);
      onDone(); onClose();
    } catch (e) { haptics.error(); Alert.alert('Broadcast', (e as Error).message); }
    finally { setBusy(false); }
  };

  const rows = contacts.data?.contacts ?? [];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <Screen edges={[]}>
        <PageHeader title="New broadcast list" />
        <View style={{ paddingHorizontal: spacing.gutter }}>
          <TextInput
            value={name} onChangeText={setName}
            placeholder="What is this list?" placeholderTextColor={c.t4}
            accessibilityLabel="List name"
            style={[styles.input, { backgroundColor: c.s2, color: c.text, borderRadius: radius.md }]}
          />
          <Text variant="caption" tone="t3" style={{ marginTop: 14, letterSpacing: 0.6 }}>
            WHO IS ON IT ({picked.length})
          </Text>
        </View>
        {contacts.isLoading ? (
          <ActivityIndicator color={c.accent} style={{ marginTop: 30 }} />
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(p) => String(p.id)}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[{ paddingBottom: 24 }, chromePad.header]}
            renderItem={({ item }) => {
              const on = picked.includes(item.id);
              return (
                <Pressable
                  onPress={() => toggle(item.id)}
                  style={[styles.pick, { borderBottomColor: c.border }]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={item.name}
                >
                  <Ionicons
                    name={on ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color={on ? c.accent : c.t4}
                  />
                  <View style={{ marginLeft: 10 }}>
                    <Avatar name={item.name} avatar={item.avatar}
                      biz={item.accountType === 'business'} size={34} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text variant="body" numberOfLines={1}>{item.name}</Text>
                    {item.username && <Text variant="micro" tone="t3">@{item.username}</Text>}
                  </View>
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <Text variant="caption" tone="t3" style={{ padding: 30, textAlign: 'center' }}>
                Save some contacts first.
              </Text>
            }
          />
        )}
        <View style={{ padding: spacing.gutter }}>
          <Button title="Make the list" onPress={go} loading={busy}
            disabled={name.trim().length < 2 || picked.length === 0} />
        </View>
      </Screen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: 40 },
  note: { marginHorizontal: spacing.gutter, marginBottom: 12 },
  row: {
    flexDirection: 'row', alignItems: 'center', padding: 14,
    marginHorizontal: spacing.gutter, marginBottom: 10,
  },
  disc: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  input: { paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  pick: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.gutter, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
