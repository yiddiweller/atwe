import { useState } from 'react';
import { View, ScrollView, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { AddressForm } from '@/components/AddressForm';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { useAddresses, addressLine, deleteAddress, setDefaultAddress } from '@/api/checkout';

/**
 * The address book. Checkout can add one, but a saved address that is WRONG has
 * to be fixable somewhere, and this is that somewhere: set which one is the
 * default, or delete one. Editing in place is deliberately absent for now —
 * delete-and-re-add is two taps and cannot half-apply.
 */
export default function Addresses() {
  const { c } = useTheme();
  const router = useRouter();
  const q = useAddresses();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const addresses = q.data?.addresses ?? [];

  const makeDefault = async (id: number) => {
    setBusy(id);
    try { await setDefaultAddress(id); await q.refetch(); }
    catch (e) { Alert.alert('Address', (e as Error).message); }
    finally { setBusy(null); }
  };

  const remove = (id: number) => {
    Alert.alert('Delete this address?', 'It will not change any order already placed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          setBusy(id);
          try { await deleteAddress(id); await q.refetch(); }
          catch (e) { Alert.alert('Address', (e as Error).message); }
          finally { setBusy(null); }
        },
      },
    ]);
  };

  if (adding) {
    return (
      <Screen edges={['top']}>
        <AddressForm onCancel={() => setAdding(false)}
          onSaved={() => { setAdding(false); q.refetch(); }} />
      </Screen>
    );
  }

  return (
    <Screen edges={['top']}>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}
          accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={c.text} />
        </Pressable>
        <Text variant="headline">Delivery addresses</Text>
        <View style={styles.back} />
      </View>

      {q.isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {addresses.length === 0 && (
            <Text variant="body" tone="t3" style={{ textAlign: 'center', marginVertical: 30 }}>
              No saved addresses yet.
            </Text>
          )}
          {addresses.map((a) => (
            <View key={a.id} style={[styles.card, { backgroundColor: c.s1 }]}>
              <View style={styles.cardTop}>
                <Text variant="headline" style={{ flex: 1 }} numberOfLines={1}>{a.fullName}</Text>
                {a.isDefault && (
                  <View style={[styles.tag, { backgroundColor: c.accentDim }]}>
                    <Text variant="micro" style={{ color: c.accent }}>Default</Text>
                  </View>
                )}
              </View>
              <Text variant="body" tone="t2" style={{ marginTop: 3 }}>{addressLine(a)}</Text>
              {!!a.country && <Text variant="caption" tone="t3">{a.country}</Text>}
              {!!a.instructions && (
                <Text variant="caption" tone="t3" style={{ marginTop: 4 }}>{a.instructions}</Text>
              )}
              <View style={styles.actions}>
                {!a.isDefault && (
                  <Pressable onPress={() => makeDefault(a.id)} disabled={busy === a.id} hitSlop={6}
                    accessibilityRole="button" accessibilityLabel="Use as default">
                    <Text variant="callout" style={{ color: c.accent }}>Use as default</Text>
                  </Pressable>
                )}
                <View style={{ flex: 1 }} />
                <Pressable onPress={() => remove(a.id)} disabled={busy === a.id} hitSlop={6}
                  accessibilityRole="button" accessibilityLabel="Delete address">
                  <Text variant="callout" style={{ color: c.danger }}>Delete</Text>
                </Pressable>
              </View>
            </View>
          ))}
          <Button title="Add an address" kind="primary" onPress={() => setAdding(true)} />
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingBottom: 8,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: spacing.gutter, paddingBottom: 32, gap: 12 },
  card: { borderRadius: radius.lg, padding: 14 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tag: { paddingHorizontal: 8, height: 20, borderRadius: 10, justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
});
