import { useState } from 'react';
import { View, ScrollView, TextInput, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { PageHeader } from '@/components/PageHeader';
import { chromePad } from '@/components/Chrome';
import { useTheme } from '@/theme/ThemeProvider';
import { useChatPrefs, setLockPin, unlockChats } from '@/api/beam';
import { haptics } from '@/lib/haptics';

/**
 * Chats hidden behind a passcode. They are absent from the chat list until the
 * passcode is entered — the SERVER withholds them, so nothing on the phone is
 * filtering a list that already contained them.
 *
 * A chat is locked from its own menu; this screen sets the passcode and is the
 * way back in.
 */
export default function LockedChats() {
  const { c, radius, spacing } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useChatPrefs();
  const hasPin = !!data?.hasLockPin;

  const [pin, setPin] = useState('');
  const [current, setCurrent] = useState('');
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<string[] | null>(null);

  const save = async () => {
    setBusy(true);
    try {
      await setLockPin(pin, hasPin ? current : undefined);
      haptics.success();
      setPin(''); setCurrent('');
      refetch();
      Alert.alert('Saved', hasPin ? 'Your passcode is changed.' : 'Your passcode is set.');
    } catch (e) { haptics.error(); Alert.alert('Locked chats', (e as Error).message); }
    finally { setBusy(false); }
  };

  const unlock = async () => {
    setBusy(true);
    try {
      const r = await unlockChats(current);
      haptics.success();
      setRevealed(r.locked);
      setCurrent('');
      /* The chat list is what actually shows them, and it has to ask again now
         that this session is unlocked. */
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['chat-prefs'] });
    } catch (e) { haptics.error(); Alert.alert('Locked chats', (e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Screen edges={[]}>
      <PageHeader title="Locked chats" />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <ScrollView contentContainerStyle={[{ padding: spacing.gutter, paddingBottom: 60 }, chromePad.header]} keyboardShouldPersistTaps="handled">
          <View style={[styles.notice, { backgroundColor: c.s1, borderRadius: radius.card }]}>
            <Ionicons name="lock-closed-outline" size={19} color={c.t2} />
            <Text variant="caption" tone="t2" style={{ flex: 1, marginLeft: 12, lineHeight: 19 }}>
              A locked chat is hidden from your list until you enter the
              passcode. Lock one from that chat's own menu.
            </Text>
          </View>

          {hasPin ? (
            <>
              <Text variant="caption" tone="t3" style={styles.lbl}>SHOW LOCKED CHATS</Text>
              <TextInput
                value={current}
                onChangeText={setCurrent}
                placeholder="Your passcode"
                placeholderTextColor={c.t4}
                secureTextEntry
                keyboardType="number-pad"
                accessibilityLabel="Your passcode"
                style={[styles.input, { backgroundColor: c.s2, color: c.text, borderRadius: radius.pill }]}
              />
              <View style={{ height: 12 }} />
              <Button title="Unlock" onPress={unlock} loading={busy} disabled={current.length < 4} />

              {revealed != null && (
                <Text variant="callout" tone={revealed.length ? 'success' : 't3'} style={{ marginTop: 14 }}>
                  {revealed.length
                    ? `${revealed.length} ${revealed.length === 1 ? 'chat is' : 'chats are'} showing in your list now.`
                    : 'Unlocked — but you have not locked any chats yet.'}
                </Text>
              )}

              <Text variant="caption" tone="t3" style={styles.lbl}>CHANGE THE PASSCODE</Text>
              <TextInput
                value={pin}
                onChangeText={setPin}
                placeholder="New passcode"
                placeholderTextColor={c.t4}
                secureTextEntry
                keyboardType="number-pad"
                accessibilityLabel="New passcode"
                style={[styles.input, { backgroundColor: c.s2, color: c.text, borderRadius: radius.pill }]}
              />
              <Text variant="micro" tone="t3" style={{ marginTop: 8 }}>
                Enter your current one above first.
              </Text>
              <View style={{ height: 12 }} />
              <Button title="Change it" kind="secondary" onPress={save} loading={busy}
                disabled={pin.length < 4 || current.length < 4} />
            </>
          ) : (
            <>
              <Text variant="caption" tone="t3" style={styles.lbl}>SET A PASSCODE</Text>
              <TextInput
                value={pin}
                onChangeText={setPin}
                placeholder="At least 4 digits"
                placeholderTextColor={c.t4}
                secureTextEntry
                keyboardType="number-pad"
                accessibilityLabel="Passcode"
                style={[styles.input, { backgroundColor: c.s2, color: c.text, borderRadius: radius.pill }]}
              />
              <Text variant="micro" tone="t3" style={{ marginTop: 8 }}>
                There is no way to recover this. If you forget it, the chats stay
                hidden.
              </Text>
              <View style={{ height: 16 }} />
              <Button title="Set the passcode" onPress={save} loading={busy} disabled={pin.length < 4} />
            </>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  notice: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  lbl: { marginTop: 24, marginBottom: 8, letterSpacing: 0.6 },
  input: { paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
});
