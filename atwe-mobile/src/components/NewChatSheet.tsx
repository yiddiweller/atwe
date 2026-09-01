import { useState } from 'react';
import { View, Modal, TextInput, FlatList, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from './Text';
import { Screen } from './Screen';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { PageHeader } from './PageHeader';
import { chromePad } from '@/components/Chrome';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { useContacts, useFindPeople, type Person } from '@/api/beam';
import { haptics } from '@/lib/haptics';

/**
 * Start a conversation. Until this existed the ONLY way to message somebody from
 * the phone was to find their profile first — which means you had to already
 * know where they were, and the empty Beam screen said so out loud.
 *
 * At rest it shows your saved contacts, which is who you actually message; type
 * and it becomes a search over everybody.
 */
export function NewChatSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { c, radius } = useTheme();
  const router = useRouter();
  const [q, setQ] = useState('');
  const searching = q.trim().length > 0;
  const contacts = useContacts();
  const found = useFindPeople(q);

  const rows: Person[] = searching ? (found.data?.users ?? []) : (contacts.data?.contacts ?? []);
  const loading = searching ? found.isLoading : contacts.isLoading;

  const open = (p: Person) => {
    haptics.tap();
    onClose();
    setQ('');
    router.push(`/chat/${p.id}`);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <Screen edges={[]}>
        <PageHeader
          title="New chat"
          below={
          <View style={[styles.search, { backgroundColor: c.s2, borderRadius: radius.pill }]}>
            <Ionicons name="search" size={17} color={c.t3} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search for somebody"
              placeholderTextColor={c.t4}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Search for somebody to message"
              style={[styles.input, { color: c.text }]}
            />
            {!!q && (
              <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityLabel="Clear">
                <Ionicons name="close-circle" size={17} color={c.t3} />
              </Pressable>
            )}
          </View>
          }
        />

        {!searching && (
          <Text variant="caption" tone="t3" style={styles.lbl}>YOUR CONTACTS</Text>
        )}

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
        ) : (
          <FlatList
          contentContainerStyle={chromePad.header}
            data={rows}
            keyExtractor={(p) => String(p.id)}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                onPress={() => open(item)}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.s1 }]}
                accessibilityRole="button"
                accessibilityLabel={`Message ${item.name}`}
              >
                <Avatar
                  name={item.name}
                  avatar={item.avatar}
                  biz={item.accountType === 'business'}
                  size={42}
                />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <View style={styles.nameLine}>
                    <Text variant="headline" numberOfLines={1}>{item.name}</Text>
                    {item.verified && <VerifiedBadge size={14} />}
                  </View>
                  {item.username && <Text variant="caption" tone="t3">@{item.username}</Text>}
                </View>
                <Ionicons name="chevron-forward" size={17} color={c.t4} />
              </Pressable>
            )}
            ListEmptyComponent={
              <View style={styles.center}>
                <Text variant="body" tone="t3" style={{ textAlign: 'center' }}>
                  {searching
                    ? `Nobody matching "${q.trim()}".`
                    : 'No saved contacts yet. Search for somebody by name or @handle.'}
                </Text>
              </View>
            }
          />
        )}
      </Screen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: spacing.gutter, paddingHorizontal: 14, height: 42,
  },
  input: { flex: 1, fontSize: 16, paddingVertical: 0 },
  lbl: { marginHorizontal: spacing.gutter, marginTop: 18, marginBottom: 4, letterSpacing: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.gutter, paddingVertical: 12 },
  nameLine: { flexDirection: 'row', alignItems: 'center' },
  center: { alignItems: 'center', justifyContent: 'center', padding: 40 },
});
