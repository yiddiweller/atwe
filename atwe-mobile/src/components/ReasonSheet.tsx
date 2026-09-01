import { useEffect, useState } from 'react';
import { Modal, View, TextInput, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { Button } from './Button';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { HapticInput } from '@/components/HapticInput';

/**
 * "Tell us what went wrong" — a few lines of text and a confirm.
 *
 * It exists instead of `Alert.prompt` because that is **iOS only**: on Android
 * it is simply undefined, so the guarded call does nothing and the button reads
 * as dead. A sheet works the same on both.
 */
export function ReasonSheet({
  visible, title, sub, placeholder, confirmLabel, destructive, busy, onCancel, onConfirm,
}: {
  visible: boolean;
  title: string;
  sub?: string;
  placeholder?: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const { c } = useTheme();
  const [text, setText] = useState('');
  // Start empty each time it opens — a leftover reason from a previous attempt
  // is the sort of thing that gets sent by accident.
  useEffect(() => { if (visible) setText(''); }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.scrim} onPress={onCancel} accessibilityLabel="Close">
        <Pressable style={[styles.card, { backgroundColor: c.bg }]} onPress={() => {}}>
          <View style={styles.head}>
            <Text variant="title" style={{ flex: 1 }}>{title}</Text>
            <Pressable onPress={onCancel} hitSlop={10}
              accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={c.t2} />
            </Pressable>
          </View>
          {!!sub && <Text variant="body" tone="t2" style={{ marginTop: 6 }}>{sub}</Text>}
          <HapticInput
            value={text}
            onChangeText={setText}
            multiline
            autoFocus
            placeholder={placeholder}
            placeholderTextColor={c.t3}
            style={[styles.input, { backgroundColor: c.s1, color: c.text }]}
            accessibilityLabel={placeholder || title}
          />
          <Button
            title={confirmLabel}
            kind={destructive ? 'danger' : 'primary'}
            loading={busy}
            disabled={!text.trim() || busy}
            onPress={() => onConfirm(text.trim())}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  card: {
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing.gutter, paddingBottom: 34,
  },
  head: { flexDirection: 'row', alignItems: 'center' },
  input: {
    borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, minHeight: 96, textAlignVertical: 'top',
    marginTop: 14, marginBottom: 18,
  },
});
