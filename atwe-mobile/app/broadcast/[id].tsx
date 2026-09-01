import { useState } from 'react';
import { View, ScrollView, TextInput, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { PageHeader } from '@/components/PageHeader';
import { useTheme } from '@/theme/ThemeProvider';
import { useBroadcast, sendBroadcast } from '@/api/beam';
import { haptics } from '@/lib/haptics';

/**
 * Write once, and everybody on the list gets it as their own private message.
 *
 * The confirm is deliberate and it names the number. Sending to twenty people is
 * twenty conversations you cannot un-start, and there is no "delete for
 * everyone" that reaches twenty threads.
 */
export default function BroadcastDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, radius, spacing } = useTheme();
  const bid = Number(id);
  const { data, isLoading, isError } = useBroadcast(Number.isFinite(bid) ? bid : undefined);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const n = data?.members.length ?? 0;

  const send = () => {
    const text = body.trim();
    if (!text) return;
    Alert.alert(
      `Send to ${n} ${n === 1 ? 'person' : 'people'}?`,
      'Each of them gets it as a private message. It cannot be unsent.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send', onPress: async () => {
            setBusy(true);
            try {
              const r = await sendBroadcast(bid, text);
              haptics.success();
              setBody('');
              Alert.alert('Sent', `${r.sent} ${r.sent === 1 ? 'person has' : 'people have'} it.`);
            } catch (e) { haptics.error(); Alert.alert('Broadcast', (e as Error).message); }
            finally { setBusy(false); }
          },
        },
      ],
    );
  };

  return (
    <Screen edges={['top']}>
      <PageHeader title={data?.name ?? 'Broadcast'} />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : isError || !data ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">This list is not available.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.gutter, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <View style={[styles.notice, { backgroundColor: c.accentDim, borderRadius: radius.card }]}>
            <Ionicons name="lock-closed-outline" size={17} color={c.accent} />
            <Text variant="caption" tone="accent" style={{ flex: 1, marginLeft: 10 }}>
              Everybody gets this privately. They cannot see each other, and each
              reply comes back to you alone.
            </Text>
          </View>

          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="What do you want to tell them?"
            placeholderTextColor={c.t4}
            multiline
            accessibilityLabel="Your message"
            style={[styles.input, { backgroundColor: c.s2, color: c.text, borderRadius: radius.card }]}
          />

          <Button
            title={`Send to ${n} ${n === 1 ? 'person' : 'people'}`}
            onPress={send}
            loading={busy}
            disabled={!body.trim() || n === 0}
            style={{ marginTop: 14 }}
          />

          <Text variant="caption" tone="t3" style={{ marginTop: 26, marginBottom: 8, letterSpacing: 0.6 }}>
            ON THIS LIST
          </Text>
          {data.members.map((m) => (
            <View key={m.id} style={[styles.member, { borderBottomColor: c.border }]}>
              <Avatar name={m.name} avatar={m.avatar} biz={m.accountType === 'business'} size={34} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text variant="body" numberOfLines={1}>{m.name}</Text>
                {m.username && <Text variant="micro" tone="t3">@{m.username}</Text>}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  notice: { flexDirection: 'row', alignItems: 'center', padding: 14, marginBottom: 16 },
  input: { paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, minHeight: 130, textAlignVertical: 'top' },
  member: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
});
