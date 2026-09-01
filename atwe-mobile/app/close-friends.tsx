import { useState } from 'react';
import { View, FlatList, Pressable, TextInput, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Avatar } from '@/components/Avatar';
import { PageHeader } from '@/components/PageHeader';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { useCloseFriends, setCloseFriend } from '@/api/social';
import { useFindPeople } from '@/api/beam';
import { haptics } from '@/lib/haptics';

/**
 * Who sees a "close friends" story. The one thing worth stating outright is
 * that nobody is TOLD — a private audience that quietly notified the people on
 * it would be the opposite of what it says.
 */
export default function CloseFriends() {
  const { c, radius, spacing } = useTheme();
  const [q, setQ] = useState('');
  const list = useCloseFriends();
  const found = useFindPeople(q);
  const [busy, setBusy] = useState<number | null>(null);

  const on = new Set((list.data?.friends ?? []).map((f) => f.id));
  const searching = q.trim().length > 0;
  const rows = searching ? (found.data?.users ?? []) : (list.data?.friends ?? []);

  const toggle = async (id: number, add: boolean) => {
    haptics.select();
    setBusy(id);
    try { await setCloseFriend(id, add); list.refetch(); }
    catch (e) { haptics.error(); Alert.alert('Close friends', (e as Error).message); }
    finally { setBusy(null); }
  };

  return (
    <Screen edges={['top']}>
      <PageHeader title="Close friends" />
      <View style={[styles.notice, { backgroundColor: c.s1, borderRadius: radius.card }]}>
        <Ionicons name="eye-off-outline" size={18} color={c.t2} />
        <Text variant="caption" tone="t2" style={{ flex: 1, marginLeft: 12, lineHeight: 19 }}>
          A close-friends story is only shown to these people. They are never
          told they are on the list.
        </Text>
      </View>

      <View style={[styles.search, { backgroundColor: c.s2, borderRadius: radius.pill }]}>
        <Ionicons name="search" size={17} color={c.t3} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Add somebody"
          placeholderTextColor={c.t4}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Find somebody to add"
          style={[styles.input, { color: c.text }]}
        />
        {!!q && (
          <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityLabel="Clear">
            <Ionicons name="close-circle" size={17} color={c.t3} />
          </Pressable>
        )}
      </View>

      {(searching ? found.isLoading : list.isLoading) ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(p) => String(p.id)}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 120 }}
          renderItem={({ item }) => {
            const isOn = on.has(item.id);
            return (
              <Pressable
                onPress={() => toggle(item.id, !isOn)}
                disabled={busy === item.id}
                style={styles.row}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isOn }}
                accessibilityLabel={item.name}
              >
                <Avatar name={item.name} avatar={item.avatar}
                  biz={item.accountType === 'business'} size={40} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text variant="body" numberOfLines={1}>{item.name}</Text>
                  {item.username && <Text variant="micro" tone="t3">@{item.username}</Text>}
                </View>
                <Ionicons
                  name={isOn ? 'checkmark-circle' : 'add-circle-outline'}
                  size={24}
                  color={isOn ? c.repost : c.t3}
                />
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text variant="body" tone="t3" style={{ textAlign: 'center' }}>
                {searching ? `Nobody matching “${q.trim()}”.` : 'Nobody on the list yet.'}
              </Text>
            </View>
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: 40 },
  notice: {
    flexDirection: 'row', alignItems: 'center', padding: 14,
    marginHorizontal: spacing.gutter, marginBottom: 14,
  },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: spacing.gutter, paddingHorizontal: 14, height: 42,
  },
  input: { flex: 1, fontSize: 16, paddingVertical: 0 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.gutter, paddingVertical: 11,
  },
});
