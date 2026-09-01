import { useState } from 'react';
import { Modal, View, TextInput, Pressable, Alert, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { Button } from './Button';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { CARRIERS, shipOrder, type Carrier } from '@/api/orders';
import { HapticInput } from '@/components/HapticInput';
import { haptics } from '@/lib/haptics';

/**
 * The seller marking an order sent. Carrier and tracking number are the two
 * things the buyer actually sees afterwards, and a recognised carrier is what
 * turns the number into a link they can tap — so the carrier is a choice from
 * the list the server accepts rather than free text that would land as "Other".
 *
 * A tracking number is optional: plenty of small sellers post something without
 * one, and refusing to let them mark it sent would leave the order looking
 * unfulfilled forever.
 */
export function ShipSheet({ visible, orderId, onClose, onShipped }: {
  visible: boolean;
  orderId: number;
  onClose: () => void;
  onShipped: () => void;
}) {
  const { c } = useTheme();
  const [carrier, setCarrier] = useState<Carrier>('USPS');
  const [tracking, setTracking] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    try {
      await shipOrder(orderId, carrier, tracking.trim());
      haptics.success();
      onShipped();
    } catch (e) {
      haptics.error(); Alert.alert('Order', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close">
        <Pressable style={[styles.card, { backgroundColor: c.bg }]} onPress={() => {}}>
          <View style={styles.head}>
            <Text variant="title" style={{ flex: 1 }}>Mark as sent</Text>
            <Pressable onPress={onClose} hitSlop={10}
              accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={c.t2} />
            </Pressable>
          </View>

          <Text variant="callout" tone="t2" style={{ marginTop: 14, marginBottom: 8 }}>Carrier</Text>
          <View style={styles.chips}>
            {CARRIERS.map((k) => (
              <Pressable
                key={k}
                onPress={() => { haptics.select(); setCarrier(k); }}
                style={[styles.chip, { backgroundColor: carrier === k ? c.accent : c.s1 }]}
                accessibilityRole="radio"
                accessibilityState={{ selected: carrier === k }}
              >
                <Text variant="callout" weight="600"
                  style={{ color: carrier === k ? c.accentTint : c.text }}>
                  {k}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text variant="callout" tone="t2" style={{ marginTop: 16, marginBottom: 8 }}>
            Tracking number (optional)
          </Text>
          <HapticInput
            value={tracking}
            onChangeText={setTracking}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="e.g. 9400 1000 0000 0000 0000 00"
            placeholderTextColor={c.t3}
            style={[styles.input, { backgroundColor: c.s1, color: c.text }]}
            accessibilityLabel="Tracking number"
          />

          <View style={{ marginTop: 20, gap: 10 }}>
            <Button title="Mark as sent" kind="primary" loading={busy} onPress={go} />
          </View>
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, height: 38, borderRadius: radius.pill, justifyContent: 'center' },
  input: { borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16 },
});
