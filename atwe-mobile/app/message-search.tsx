import { useState } from 'react';
import { View, FlatList, Pressable, TextInput, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Avatar } from '@/components/Avatar';
import { PageHeader } from '@/components/PageHeader';
import { chromePad } from '@/components/Chrome';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { useMessageSearch, type MessageHit } from '@/api/beam';
import { hitPreview } from './starred';
import { timeAgo } from '@/lib/format';

/**
 * Find something that was SAID. Different from the chat list's own filter,
 * which searches names — this searches the words, across every conversation.
 *
 * The server applies the same visibility rules the read routes do, so a deleted,
 * cleared or expired message can never surface here.
 */
export default function MessageSearch() {
  const { c, radius, spacing } = useTheme();
  const [q, setQ] = useState('');
  const { data, isLoading } = useMessageSearch(q);
  const rows = data?.items ?? [];
  const asked = q.trim().length >= 2;

  return (
    <Screen edges={[]}>
      <PageHeader
        title="Search messages"
        below={
        <View style={[styles.search, { backgroundColor: c.s2, borderRadius: radius.pill }]}>
          <Ionicons name="search" size={17} color={c.t3} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="What was said…"
            placeholderTextColor={c.t4}
            autoFocus
            autoCorrect={false}
            accessibilityLabel="Search your messages"
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

      {!asked ? (
        <View style={[styles.center, chromePad.headerSearch]}>
          <Text variant="body" tone="t3" style={{ textAlign: 'center' }}>
            Type at least two letters.
          </Text>
        </View>
      ) : isLoading ? (
        <View style={[styles.center, chromePad.headerSearch]}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => `${r.scope}-${r.id}`}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => <Hit hit={item} term={q.trim()} />}
          contentContainerStyle={[{ paddingTop: 12, paddingBottom: 120 }, chromePad.headerSearch]}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text variant="body" tone="t3" style={{ textAlign: 'center' }}>
                Nothing matching “{q.trim()}”.
              </Text>
            </View>
          }
        />
      )}
    </Screen>
  );
}

function Hit({ hit, term }: { hit: MessageHit; term: string }) {
  const { c, radius } = useTheme();
  const router = useRouter();
  const who = hit.peer ?? hit.group;
  const open = () => {
    if (hit.scope === 'group' && hit.group) router.push(`/group/${hit.group.id}`);
    else if (hit.peer) router.push(`/chat/${hit.peer.id}`);
  };

  /* The match is the reason the row is here, so it is marked. Split rather than
     styled with a regex replace: a message is somebody's own words and must not
     be run through anything that could interpret them. */
  const body = hitPreview(hit);
  const at = body.toLowerCase().indexOf(term.toLowerCase());
  const before = at >= 0 ? body.slice(0, at) : body;
  const hitText = at >= 0 ? body.slice(at, at + term.length) : '';
  const after = at >= 0 ? body.slice(at + term.length) : '';

  return (
    <Pressable
      onPress={open}
      style={({ pressed }) => [
        styles.row, { backgroundColor: c.s1, borderRadius: radius.card }, pressed && { opacity: 0.9 },
      ]}
    >
      <Avatar name={who?.name} avatar={(who as { avatar?: string | null })?.avatar ?? null} size={38} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text variant="callout" weight="700" numberOfLines={1}>{who?.name ?? 'Conversation'}</Text>
        <Text variant="body" tone="t2" numberOfLines={2} style={{ marginTop: 2 }}>
          {hit.mine ? 'You: ' : ''}{before}
          <Text variant="body" style={{ color: c.accent, fontWeight: '700' }}>{hitText}</Text>
          {after}
        </Text>
        <Text variant="micro" tone="t3" style={{ marginTop: 3 }}>{timeAgo(hit.created_at)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: 40 },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: spacing.gutter, paddingHorizontal: 14, height: 42,
  },
  input: { flex: 1, fontSize: 16, paddingVertical: 0 },
  row: {
    flexDirection: 'row', alignItems: 'flex-start', padding: 14,
    marginHorizontal: spacing.gutter, marginBottom: 10,
  },
});
