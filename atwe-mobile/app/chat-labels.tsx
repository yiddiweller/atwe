import { useState } from 'react';
import {
  View, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl, Alert, TextInput, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { PageHeader } from '@/components/PageHeader';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { useChatLabels, createChatLabel, deleteChatLabel, type ChatLabel } from '@/api/beam';
import { haptics } from '@/lib/haptics';

/**
 * Folders for conversations — "To ship", "Waiting on a quote". A business with
 * eighty chats cannot find anything without them.
 *
 * Labels are made here and PUT ON a chat from the chat's own menu, which is the
 * only place you know which chat you mean.
 */
export default function ChatLabels() {
  const { c } = useTheme();
  const [making, setMaking] = useState(false);
  const { data, isLoading, refetch, isRefetching } = useChatLabels();
  const rows = data?.labels ?? [];

  return (
    <Screen edges={['top']}>
      <PageHeader
        title="Labels"
        action={{ icon: 'add', label: 'New label', onPress: () => setMaking(true) }}
      />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => String(r.id)}
          renderItem={({ item }) => <Row label={item} onDone={refetch} />}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.accent} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="bookmarks-outline" size={44} color={c.t4} />
              <Text variant="body" tone="t3" style={{ marginTop: 12, textAlign: 'center' }}>
                Make a label, then put it on a chat from that chat's menu.
              </Text>
            </View>
          }
        />
      )}
      <NewLabel visible={making} onClose={() => setMaking(false)} onDone={refetch} />
    </Screen>
  );
}

function Row({ label, onDone }: { label: ChatLabel; onDone: () => void }) {
  const { c, radius } = useTheme();
  const remove = () => {
    Alert.alert(`Delete “${label.name}”?`, 'The chats it is on are not affected.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try { await deleteChatLabel(label.id); haptics.success(); onDone(); }
          catch (e) { haptics.error(); Alert.alert('Labels', (e as Error).message); }
        },
      },
    ]);
  };
  return (
    <View style={[styles.row, { backgroundColor: c.s1, borderRadius: radius.card }]}>
      <View style={[styles.dot, { backgroundColor: c.accent }]} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text variant="headline" numberOfLines={1}>{label.name}</Text>
        <Text variant="caption" tone="t3">
          on {label.count} {label.count === 1 ? 'chat' : 'chats'}
        </Text>
      </View>
      <Pressable onPress={remove} hitSlop={10} accessibilityLabel={`Delete ${label.name}`}>
        <Ionicons name="trash-outline" size={17} color={c.t3} />
      </Pressable>
    </View>
  );
}

function NewLabel({ visible, onClose, onDone }: { visible: boolean; onClose: () => void; onDone: () => void }) {
  const { c, radius, spacing } = useTheme();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    try {
      await createChatLabel(name.trim());
      haptics.success();
      setName('');
      onDone(); onClose();
    } catch (e) { haptics.error(); Alert.alert('Labels', (e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <Screen edges={['top']}>
        <PageHeader title="New label" />
        <View style={{ padding: spacing.gutter }}>
          <TextInput
            value={name} onChangeText={setName}
            placeholder="To ship" placeholderTextColor={c.t4} autoFocus
            accessibilityLabel="Label name"
            style={[styles.input, { backgroundColor: c.s2, color: c.text, borderRadius: radius.md }]}
          />
          <View style={{ height: 18 }} />
          <Button title="Make the label" onPress={go} loading={busy} disabled={name.trim().length < 1} />
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
  dot: { width: 12, height: 12, borderRadius: 6 },
  input: { paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
});
