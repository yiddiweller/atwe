import { useState } from 'react';
import { View, Modal, ScrollView, Pressable, TextInput, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { Screen } from './Screen';
import { Button } from './Button';
import { PageHeader } from './PageHeader';
import { chromePad } from '@/components/Chrome';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { getLabelRates, buyLabel, DEFAULT_PARCEL, type ShipRate, type Parcel } from '@/api/bizops';
import { money } from '@/api/wallet';
import { haptics } from '@/lib/haptics';

/**
 * Buy a real shipping label. Two steps, because that is how it actually works:
 * say what the parcel is, then pick from what the carriers come back with.
 *
 * The box starts on a small-package default rather than blank — Atwe stores no
 * per-product weight or dimensions, so there is nothing honest to prefill from,
 * and an empty form is a worse guess than a sensible one.
 *
 * NB the phone never sends a PRICE. The server re-fetches the chosen rate's
 * authoritative amount before charging, so a stale rate cannot become the
 * charge — which is also why buying is idempotent on `clientId` rather than on
 * anything the sheet holds.
 */
export function LabelSheet({ visible, orderId, kind = 'out', onClose, onBought }: {
  visible: boolean;
  orderId: number;
  /** `return` buys the label for sending it BACK — the addresses swap. */
  kind?: 'out' | 'return';
  onClose: () => void;
  onBought: () => void;
}) {
  const { c, radius, spacing } = useTheme();
  const [p, setP] = useState<Parcel>(DEFAULT_PARCEL);
  const [rates, setRates] = useState<ShipRate[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clientId] = useState(() => `label-${orderId}-${kind}-${Math.random().toString(36).slice(2, 8)}`);

  const num = (v: number) => (v ? String(v) : '');
  const set = (k: keyof Parcel) => (t: string) => {
    const n = parseFloat(t.replace(/[^0-9.]/g, ''));
    setP((s) => ({ ...s, [k]: Number.isFinite(n) ? n : 0 }));
    /* Changing the box invalidates every price already quoted for the old one —
       leaving them on screen would let somebody buy a rate for a parcel they no
       longer have. */
    setRates(null);
    setPicked(null);
  };

  const fetchRates = async () => {
    setBusy(true);
    try {
      const r = await getLabelRates(orderId, p, kind);
      setRates(r.rates);
      setPicked(r.rates[0]?.id ?? null);
      haptics.success();
    } catch (e) {
      haptics.error();
      const msg = (e as Error).message;
      const err = e as { body?: { needAddress?: boolean } };
      Alert.alert(
        'Shipping',
        err.body?.needAddress
          ? 'Add your own address in the address book first — a label needs somewhere to come from.'
          : msg,
      );
    } finally { setBusy(false); }
  };

  const buy = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      const r = await buyLabel(orderId, picked, clientId, kind);
      haptics.success();
      onClose();
      onBought();
      Alert.alert(
        'Label bought',
        `${money(r.costCents)} came out of your balance. The order is marked shipped, and ${r.carrier} ${r.tracking} is on it.`,
      );
    } catch (e) { haptics.error(); Alert.alert('Shipping', (e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <Screen edges={[]}>
        <PageHeader title={kind === 'return' ? 'Return label' : 'Buy a label'} />
        <ScrollView contentContainerStyle={[{ padding: spacing.gutter, paddingBottom: 60 }, chromePad.header]} keyboardShouldPersistTaps="handled">
          <Text variant="caption" tone="t3" style={styles.lbl}>THE PARCEL</Text>
          <View style={styles.grid}>
            <Field label="Weight (lb)" value={num(p.weightLb)} onChange={set('weightLb')} />
            <Field label="Length (in)" value={num(p.lengthIn)} onChange={set('lengthIn')} />
            <Field label="Width (in)" value={num(p.widthIn)} onChange={set('widthIn')} />
            <Field label="Height (in)" value={num(p.heightIn)} onChange={set('heightIn')} />
          </View>

          {rates == null ? (
            <>
              <Text variant="caption" tone="t3" style={{ marginTop: 14 }}>
                We do not keep weights or sizes for your items, so this is per parcel.
              </Text>
              <View style={{ height: 18 }} />
              <Button title="See prices" onPress={fetchRates} loading={busy} />
            </>
          ) : rates.length === 0 ? (
            <Text variant="body" tone="t2" style={{ marginTop: 20 }}>
              No carrier could quote for that address and parcel.
            </Text>
          ) : (
            <>
              <Text variant="caption" tone="t3" style={styles.lbl}>PICK ONE</Text>
              {rates.map((r) => {
                const on = picked === r.id;
                return (
                  <Pressable
                    key={r.id}
                    onPress={() => { haptics.select(); setPicked(r.id); }}
                    style={[styles.rate, { backgroundColor: c.s1, borderRadius: radius.card,
                      borderColor: on ? c.accent : 'transparent', borderWidth: on ? 1.5 : 0 }]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${r.carrier} ${r.service}, ${money(r.amountCents)}`}
                  >
                    <Ionicons
                      name={on ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={on ? c.accent : c.t4}
                    />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text variant="headline" numberOfLines={1}>{r.carrier}</Text>
                      <Text variant="micro" tone="t3" numberOfLines={1}>
                        {r.service}{r.days ? ` · about ${r.days} days` : ''}
                      </Text>
                    </View>
                    <Text variant="headline" weight="800">{money(r.amountCents)}</Text>
                  </Pressable>
                );
              })}
              <Text variant="caption" tone="t3" style={{ marginTop: 12 }}>
                The cost comes out of your Atwe balance. A label cannot be
                un-bought, so check the parcel before you buy.
              </Text>
              <View style={{ height: 18 }} />
              <Button title="Buy the label" onPress={buy} loading={busy} disabled={!picked} />
            </>
          )}
        </ScrollView>
      </Screen>
    </Modal>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (t: string) => void }) {
  const { c, radius } = useTheme();
  return (
    <View style={styles.cell}>
      <Text variant="micro" tone="t3" style={{ marginBottom: 5 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        accessibilityLabel={label}
        style={[styles.input, { backgroundColor: c.s2, color: c.text, borderRadius: radius.pill }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  lbl: { marginTop: 18, marginBottom: 8, letterSpacing: 0.6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cell: { flexBasis: '47%', flexGrow: 1 },
  input: { paddingHorizontal: 12, paddingVertical: 11, fontSize: 16 },
  rate: { flexDirection: 'row', alignItems: 'center', padding: 14, marginBottom: 10 },
});
