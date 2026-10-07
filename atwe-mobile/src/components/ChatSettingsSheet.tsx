import { useState } from 'react';
import { View, Modal, Pressable, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Text } from './Text';
import { Screen } from './Screen';
import { PageHeader } from './PageHeader';
import { chromePad } from '@/components/Chrome';
import { useTheme } from '@/theme/ThemeProvider';
import {
  useDisappearing, setDisappearing, DISAPPEAR_OPTS,
  useChatLabels, assignChatLabel,
  useChatPrefs, setChatLocked, threadKey,
} from '@/api/beam';
import { haptics } from '@/lib/haptics';

/**
 * What you can set ABOUT one conversation: how long its messages live, what
 * folder it is in, and whether it is hidden behind a passcode.
 *
 * All three belong to the chat, not to Beam as a whole, which is why they are
 * here and not in the tools menu — you have to be looking at a conversation to
 * know which one you mean.
 */
export function ChatSettingsSheet({ visible, kind, id, name, onClose }: {
  visible: boolean;
  kind: 'dm' | 'group';
  id: number;
  name: string;
  onClose: () => void;
}) {
  const { c, radius, spacing } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const key = threadKey(kind, id);

  const disappear = useDisappearing(kind, visible ? id : undefined);
  const labels = useChatLabels();
  const prefs = useChatPrefs();
  const [busy, setBusy] = useState(false);

  const seconds = disappear.data?.seconds ?? 0;
  const locked = (prefs.data?.locked ?? []).includes(key);
  const hasPin = !!prefs.data?.hasLockPin;

  const pickTimer = async (secs: number) => {
    haptics.select();
    setBusy(true);
    try {
      await setDisappearing(kind, id, secs);
      disappear.refetch();
      /* The thread is already on screen behind this sheet, and its bubbles carry
         the timer — it has to re-read or the change is invisible until you
         leave and come back. */
      qc.invalidateQueries({ queryKey: kind === 'group' ? ['group', id] : ['thread', id] });
    } catch (e) { haptics.error(); Alert.alert('Disappearing messages', (e as Error).message); }
    finally { setBusy(false); }
  };

  const toggleLabel = async (labelId: number, on: boolean) => {
    haptics.select();
    setBusy(true);
    try { await assignChatLabel(labelId, kind, id, on); labels.refetch(); }
    catch (e) { haptics.error(); Alert.alert('Labels', (e as Error).message); }
    finally { setBusy(false); }
  };

  const toggleLock = async () => {
    if (!hasPin) {
      onClose();
      Alert.alert(
        'Set a passcode first',
        'Locked chats need a passcode before one can be hidden.',
        [{ text: 'Not now', style: 'cancel' }, { text: 'Set one', onPress: () => router.push('/locked-chats') }],
      );
      return;
    }
    setBusy(true);
    try {
      await setChatLocked(key, !locked);
      haptics.success();
      prefs.refetch();
      qc.invalidateQueries({ queryKey: ['conversations'] });
      if (!locked) {
        onClose();
        Alert.alert('Locked', `${name} is hidden from your chat list until you enter your passcode.`);
      }
    } catch (e) { haptics.error(); Alert.alert('Locked chats', (e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <Screen edges={[]}>
        <PageHeader title={name} />
        <ScrollView contentContainerStyle={[{ padding: spacing.gutter, paddingBottom: 60 }, chromePad.header]}>
          <Text variant="caption" tone="t3" style={styles.lbl}>DISAPPEARING MESSAGES</Text>
          {disappear.isLoading ? (
            <ActivityIndicator color={c.accent} style={{ marginVertical: 16 }} />
          ) : (
            <View style={{ backgroundColor: c.s1, borderRadius: radius.card, paddingHorizontal: 14 }}>
              {DISAPPEAR_OPTS.map((o) => (
                <Pressable
                  key={o.seconds}
                  onPress={() => pickTimer(o.seconds)}
                  disabled={busy}
                  style={[styles.opt, { borderBottomColor: c.bg }]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: seconds === o.seconds }}
                  accessibilityLabel={o.label}
                >
                  <Ionicons
                    name={seconds === o.seconds ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={seconds === o.seconds ? c.accent : c.t4}
                  />
                  <Text variant="body" style={{ flex: 1, marginLeft: 10 }}>{o.label}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <Text variant="micro" tone="t3" style={{ marginTop: 8 }}>
            New messages disappear after this. Ones already sent are not affected.
          </Text>

          <Text variant="caption" tone="t3" style={styles.lbl}>LABELS</Text>
          {(labels.data?.labels ?? []).length === 0 ? (
            <Pressable onPress={() => { onClose(); router.push('/chat-labels'); }}
              accessibilityRole="button" accessibilityLabel="Make a label">
              <Text variant="caption" tone="accent">Make a label first</Text>
            </Pressable>
          ) : (
            <View style={{ backgroundColor: c.s1, borderRadius: radius.card, paddingHorizontal: 14 }}>
              {(labels.data?.labels ?? []).map((l) => {
                const on = l.items.some((it) => it.kind === kind && it.targetId === id);
                return (
                  <Pressable
                    key={l.id}
                    onPress={() => toggleLabel(l.id, !on)}
                    disabled={busy}
                    style={[styles.opt, { borderBottomColor: c.bg }]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={l.name}
                  >
                    <Ionicons
                      name={on ? 'checkmark-circle' : 'ellipse-outline'}
                      size={20}
                      color={on ? c.accent : c.t4}
                    />
                    <Text variant="body" style={{ flex: 1, marginLeft: 10 }}>{l.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          <Text variant="caption" tone="t3" style={styles.lbl}>PRIVACY</Text>
          <Pressable
            onPress={toggleLock}
            disabled={busy}
            style={[styles.lock, { backgroundColor: c.s1, borderRadius: radius.card }]}
            accessibilityRole="switch"
            accessibilityState={{ checked: locked }}
            accessibilityLabel="Lock this chat"
          >
            <Ionicons name={locked ? 'lock-closed' : 'lock-open-outline'} size={20}
              color={locked ? c.accent : c.t2} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text variant="body">{locked ? 'Locked' : 'Lock this chat'}</Text>
              <Text variant="micro" tone="t3" style={{ marginTop: 2 }}>
                {locked
                  ? 'Hidden from your chat list until you enter your passcode'
                  : 'Hide it behind your passcode'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color={c.t4} />
          </Pressable>
        </ScrollView>
      </Screen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  lbl: { marginTop: 22, marginBottom: 8, letterSpacing: 0.6 },
  opt: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  lock: { flexDirection: 'row', alignItems: 'center', padding: 14 },
});
