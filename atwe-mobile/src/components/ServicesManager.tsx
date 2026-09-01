import { useState } from 'react';
import {
  View, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { Button } from './Button';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { money } from '@/api/wallet';
import { useServices, addService, deleteService } from '@/api/appointments';
import { useAuth } from '@/auth/AuthProvider';
import { HapticInput } from '@/components/HapticInput';
import { haptics } from '@/lib/haptics';

/**
 * What a business offers, and for how long.
 *
 * The duration is not a detail — it is what the open times are CUT from. A
 * 30-minute service on a nine-to-five day produces sixteen bookable slots; an
 * hour produces eight. So it says that out loud rather than presenting a number
 * with no consequence.
 *
 * A deposit is optional and held from the customer's balance when they book,
 * released to the business when the appointment is marked done and returned if
 * it is declined or cancelled — so it is described that way, not as a charge.
 */
export function ServicesManager({ onDone }: { onDone: () => void }) {
  const { c } = useTheme();
  const { user } = useAuth();
  const q = useServices(user?.id);
  const services = q.data?.services ?? [];
  const [name, setName] = useState('');
  const [mins, setMins] = useState('30');
  const [deposit, setDeposit] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await addService({
        name: name.trim(),
        durationMin: Math.max(5, Math.min(1440, Math.round(Number(mins)) || 30)),
        depositCents: Math.round((Number(deposit.replace(/[^0-9.]/g, '')) || 0) * 100),
      });
      haptics.success();
      setName(''); setMins('30'); setDeposit('');
      await q.refetch();
    } catch (e) {
      haptics.error(); Alert.alert('Service', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = (id: number, label: string) => {
    Alert.alert(`Remove "${label}"?`, 'Appointments already booked are not affected.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          haptics.warning();
          try { await deleteService(id); await q.refetch(); }
          catch (e) { haptics.error(); Alert.alert('Service', (e as Error).message); }
        },
      },
    ]);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Pressable onPress={onDone} hitSlop={10} style={styles.back}
          accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={c.text} />
        </Pressable>
        <Text variant="headline">What you offer</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text variant="body" tone="t2">
          People book these from your profile. The open times come from your opening
          hours, cut into pieces the length of the service.
        </Text>

        {q.isLoading ? (
          <ActivityIndicator color={c.accent} style={{ marginTop: 20 }} />
        ) : (
          services.map((s) => (
            <View key={s.id} style={[styles.row, { backgroundColor: c.s1 }]}>
              <View style={{ flex: 1 }}>
                <Text variant="headline" numberOfLines={1}>{s.name}</Text>
                <Text variant="caption" tone="t3">
                  {s.durationMin} min
                  {s.depositCents > 0 ? ` · ${money(s.depositCents)} deposit` : ''}
                  {s.reviewCount > 0 ? ` · ★ ${s.rating} (${s.reviewCount})` : ''}
                </Text>
              </View>
              <Pressable onPress={() => remove(s.id, s.name)} hitSlop={8}
                accessibilityRole="button" accessibilityLabel={`Remove ${s.name}`}>
                <Text variant="callout" style={{ color: c.danger }}>Remove</Text>
              </Pressable>
            </View>
          ))
        )}

        <Text variant="callout" tone="t2" style={{ marginTop: 20, marginBottom: 8 }}>
          Add something
        </Text>
        <HapticInput value={name} onChangeText={setName}
          placeholder="Haircut, consultation, delivery…" placeholderTextColor={c.t3}
          style={[styles.input, { backgroundColor: c.s1, color: c.text }]}
          accessibilityLabel="Service name" />
        <View style={styles.pair}>
          <View style={{ flex: 1 }}>
            <Text variant="caption" tone="t3" style={styles.lbl}>How long (minutes)</Text>
            <HapticInput value={mins} onChangeText={setMins} keyboardType="number-pad"
              style={[styles.input, { backgroundColor: c.s1, color: c.text }]}
              accessibilityLabel="Minutes" />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="caption" tone="t3" style={styles.lbl}>Deposit (optional)</Text>
            <HapticInput value={deposit} onChangeText={setDeposit} keyboardType="decimal-pad"
              placeholder="0.00" placeholderTextColor={c.t3}
              style={[styles.input, { backgroundColor: c.s1, color: c.text }]}
              accessibilityLabel="Deposit" />
          </View>
        </View>
        <Text variant="caption" tone="t3" style={{ marginTop: 6 }}>
          A deposit is held from the customer when they book, comes to you when you
          mark it done, and goes back to them if it is declined or cancelled.
        </Text>

        <View style={{ marginTop: 16 }}>
          <Button title="Add" kind="primary" loading={busy}
            disabled={!name.trim()} onPress={add} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingBottom: 8,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  body: { padding: spacing.gutter, paddingBottom: 40 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: radius.card, padding: 14, marginTop: 10,
  },
  lbl: { marginBottom: 5 },
  pair: { flexDirection: 'row', gap: 10, marginTop: 12 },
  input: { borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16 },
});
