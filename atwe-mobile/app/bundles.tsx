import { useState } from 'react';
import {
  View, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl, Alert, TextInput, Modal, ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { PageHeader } from '@/components/PageHeader';
import { chromePad } from '@/components/Chrome';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { useMyBundles, createBundle, deleteBundle, type Bundle } from '@/api/seller';
import { useMyListings } from '@/api/selling';
import { money } from '@/api/wallet';
import { mediaUri } from '@/lib/media';
import { haptics } from '@/lib/haptics';

/**
 * Several of your own things sold together for one price. The saving IS the
 * product, so it is the number the card leads with — not the price.
 */
export default function Bundles() {
  const { c } = useTheme();
  const [making, setMaking] = useState(false);
  const { data, isLoading, refetch, isRefetching } = useMyBundles();
  const rows = data?.bundles ?? [];

  return (
    <Screen edges={[]}>
      <PageHeader
        title="Bundles"
        action={{ icon: 'add', label: 'New bundle', onPress: () => setMaking(true) }}
      />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => String(r.id)}
          renderItem={({ item }) => <Row bundle={item} onDone={refetch} />}
          contentContainerStyle={[{ paddingTop: 12, paddingBottom: 120 }, chromePad.header]}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.accent} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="cube-outline" size={44} color={c.t4} />
              <Text variant="body" tone="t3" style={{ marginTop: 12, textAlign: 'center' }}>
                Put a few of your things together and sell them for one price.
              </Text>
            </View>
          }
        />
      )}
      <NewBundle visible={making} onClose={() => setMaking(false)} onDone={refetch} />
    </Screen>
  );
}

function Row({ bundle, onDone }: { bundle: Bundle; onDone: () => void }) {
  const { c, radius } = useTheme();
  const router = useRouter();

  const remove = () => {
    Alert.alert('Delete this bundle?', 'The items in it are not affected.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try { await deleteBundle(bundle.id); haptics.success(); onDone(); }
          catch (e) { haptics.error(); Alert.alert('Bundle', (e as Error).message); }
        },
      },
    ]);
  };

  return (
    <View style={[styles.row, { backgroundColor: c.s1, borderRadius: radius.card }]}>
      <Pressable onPress={() => router.push(`/bundle/${bundle.id}`)} style={styles.rowTop}>
        <View style={{ flex: 1 }}>
          <Text variant="headline" numberOfLines={1}>{bundle.name}</Text>
          <Text variant="caption" tone="t3">{bundle.itemCount} items</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="headline" weight="800">{money(bundle.priceCents)}</Text>
          {bundle.savingsCents > 0 && (
            <Text variant="micro" tone="success">save {money(bundle.savingsCents)}</Text>
          )}
        </View>
      </Pressable>
      {bundle.soldOut && (
        <Text variant="caption" tone="warning" style={{ marginTop: 8 }}>
          Something in it is out of stock.
        </Text>
      )}
      <View style={styles.acts}>
        <Button title="View" kind="secondary" onPress={() => router.push(`/bundle/${bundle.id}`)}
          style={{ flex: 1, minHeight: 40 }} />
        <Button title="Delete" kind="danger" onPress={remove} style={{ flex: 1, minHeight: 40 }} />
      </View>
    </View>
  );
}

function NewBundle({ visible, onClose, onDone }: { visible: boolean; onClose: () => void; onDone: () => void }) {
  const { c, radius, spacing } = useTheme();
  const listings = useMyListings();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [price, setPrice] = useState('');
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);

  /* Only the seller's OWN active, non-variant listings can go in a bundle — the
     server refuses anything else, and a picker that offers what will be rejected
     is worse than one that does not offer it. */
  const eligible = (listings.data?.products ?? []).filter((p) => p.active && !p.hasVariants);
  const chosen = Object.entries(picked).filter(([, q]) => q > 0);
  const retail = chosen.reduce((sum, [id, q]) => {
    const p = eligible.find((x) => x.id === Number(id));
    return sum + (p ? p.priceCents * q : 0);
  }, 0);
  const cents = Math.round(parseFloat(price.replace(/[^0-9.]/g, '')) * 100);
  const saving = Number.isFinite(cents) && cents > 0 ? retail - cents : 0;

  const go = async () => {
    setBusy(true);
    try {
      await createBundle({
        name: name.trim(),
        description: desc.trim() || undefined,
        priceCents: cents,
        items: chosen.map(([id, qty]) => ({ productId: Number(id), qty })),
      });
      haptics.success();
      setName(''); setDesc(''); setPrice(''); setPicked({});
      onDone(); onClose();
    } catch (e) { haptics.error(); Alert.alert('Bundle', (e as Error).message); }
    finally { setBusy(false); }
  };

  const valid = name.trim().length >= 2 && chosen.length >= 2 && Number.isFinite(cents) && cents > 0;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <Screen edges={[]}>
        <PageHeader title="New bundle" />
        <ScrollView contentContainerStyle={[{ padding: spacing.gutter, paddingBottom: 60 }, chromePad.header]} keyboardShouldPersistTaps="handled">
          <Text variant="caption" tone="t3" style={styles.lbl}>WHAT IS IT CALLED</Text>
          <TextInput
            value={name} onChangeText={setName}
            placeholder="Starter set" placeholderTextColor={c.t4}
            accessibilityLabel="Bundle name"
            style={[styles.input, { backgroundColor: c.s2, color: c.text, borderRadius: radius.md }]}
          />

          <Text variant="caption" tone="t3" style={styles.lbl}>WHAT IS IN IT (PICK AT LEAST TWO)</Text>
          {listings.isLoading ? (
            <ActivityIndicator color={c.accent} style={{ marginVertical: 20 }} />
          ) : eligible.length === 0 ? (
            <Text variant="caption" tone="t3">
              You need at least two active listings without size or colour options.
            </Text>
          ) : eligible.map((p) => {
            const qty = picked[p.id] ?? 0;
            return (
              <View key={p.id} style={[styles.pick, { borderBottomColor: c.border }]}>
                <Pressable
                  onPress={() => { haptics.select(); setPicked((s) => ({ ...s, [p.id]: qty > 0 ? 0 : 1 })); }}
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: qty > 0 }}
                  accessibilityLabel={p.name}
                >
                  <Ionicons
                    name={qty > 0 ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color={qty > 0 ? c.accent : c.t4}
                  />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text variant="body" numberOfLines={1}>{p.name}</Text>
                    <Text variant="micro" tone="t3">{money(p.priceCents)}</Text>
                  </View>
                </Pressable>
                {qty > 0 && (
                  <View style={styles.qty}>
                    <Pressable onPress={() => setPicked((s) => ({ ...s, [p.id]: Math.max(1, qty - 1) }))}
                      hitSlop={8} accessibilityLabel="One fewer">
                      <Ionicons name="remove-circle-outline" size={22} color={c.t2} />
                    </Pressable>
                    <Text variant="callout" style={{ minWidth: 20, textAlign: 'center' }}>{qty}</Text>
                    <Pressable onPress={() => setPicked((s) => ({ ...s, [p.id]: Math.min(20, qty + 1) }))}
                      hitSlop={8} accessibilityLabel="One more">
                      <Ionicons name="add-circle-outline" size={22} color={c.t2} />
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}

          <Text variant="caption" tone="t3" style={styles.lbl}>BUNDLE PRICE</Text>
          <TextInput
            value={price} onChangeText={setPrice}
            placeholder="70" placeholderTextColor={c.t4} keyboardType="decimal-pad"
            accessibilityLabel="Bundle price in dollars"
            style={[styles.input, { backgroundColor: c.s2, color: c.text, borderRadius: radius.md }]}
          />
          {retail > 0 && (
            <Text variant="caption" tone={saving > 0 ? 'success' : 't3'} style={{ marginTop: 8 }}>
              {saving > 0
                ? `Bought separately that is ${money(retail)} — a ${money(saving)} saving.`
                : `Bought separately that is ${money(retail)}.`}
            </Text>
          )}

          <Text variant="caption" tone="t3" style={styles.lbl}>A LITTLE MORE (OPTIONAL)</Text>
          <TextInput
            value={desc} onChangeText={setDesc}
            placeholder="Why they go well together" placeholderTextColor={c.t4} multiline
            accessibilityLabel="Description"
            style={[styles.input, { backgroundColor: c.s2, color: c.text, borderRadius: radius.md, minHeight: 84, textAlignVertical: 'top' }]}
          />

          <View style={{ height: 20 }} />
          <Button title="Make the bundle" onPress={go} loading={busy} disabled={!valid} />
        </ScrollView>
      </Screen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: 40 },
  row: { padding: 14, marginHorizontal: spacing.gutter, marginBottom: 10 },
  rowTop: { flexDirection: 'row', alignItems: 'center' },
  acts: { flexDirection: 'row', gap: 10, marginTop: 12 },
  lbl: { marginTop: 18, marginBottom: 8, letterSpacing: 0.6 },
  input: { paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  pick: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  qty: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 10 },
});
