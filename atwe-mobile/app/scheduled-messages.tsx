import { View, FlatList, StyleSheet, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { PageHeader } from '@/components/PageHeader';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { useScheduledMessages, cancelScheduledMessage, type ScheduledMessage } from '@/api/beam';
import { haptics } from '@/lib/haptics';

/**
 * Messages waiting to go. The only two things anybody wants here are to read
 * what they wrote and to stop it, so those are the only two things on the row.
 */
export default function ScheduledMessages() {
  const { c } = useTheme();
  const { data, isLoading, refetch, isRefetching } = useScheduledMessages();
  const rows = data?.scheduled ?? [];

  return (
    <Screen edges={['top']}>
      <PageHeader title="Scheduled" />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => String(r.id)}
          renderItem={({ item }) => <Row m={item} onDone={refetch} />}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.accent} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="time-outline" size={44} color={c.t4} />
              <Text variant="body" tone="t3" style={{ marginTop: 12, textAlign: 'center' }}>
                Nothing waiting. You can schedule a message from a conversation.
              </Text>
            </View>
          }
        />
      )}
    </Screen>
  );
}

/** "Tomorrow at 09:00" beats a date somebody has to decode. */
export function whenLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (sameDay) return `Today at ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow at ${time}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${time}`;
}

function Row({ m, onDone }: { m: ScheduledMessage; onDone: () => void }) {
  const { c, radius } = useTheme();
  const who = m.peer ?? m.group;

  const stop = () => {
    Alert.alert('Cancel this message?', 'It will not be sent.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel it', style: 'destructive', onPress: async () => {
          try { await cancelScheduledMessage(m.id); haptics.success(); onDone(); }
          catch (e) { haptics.error(); Alert.alert('Scheduled', (e as Error).message); }
        },
      },
    ]);
  };

  return (
    <View style={[styles.row, { backgroundColor: c.s1, borderRadius: radius.card }]}>
      <View style={styles.rowTop}>
        <Avatar name={who?.name} avatar={(who as { avatar?: string | null })?.avatar ?? null} size={34} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text variant="callout" weight="700" numberOfLines={1}>{who?.name ?? 'Conversation'}</Text>
          <Text variant="micro" tone="accent">{whenLabel(m.sendAt)}</Text>
        </View>
      </View>
      <Text variant="body" tone="t2" style={{ marginTop: 10 }}>{m.body}</Text>
      <Button title="Cancel it" kind="danger" onPress={stop} style={{ marginTop: 12, minHeight: 38 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: 40 },
  row: { padding: 14, marginHorizontal: spacing.gutter, marginBottom: 10 },
  rowTop: { flexDirection: 'row', alignItems: 'center' },
});
