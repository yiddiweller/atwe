import { useEffect, useMemo, useState } from 'react';
import {
  Modal, View, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Text } from './Text';
import { Button } from './Button';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { money, useWallet } from '@/api/wallet';
import { useServices, useSlots, bookAppointment, type Service } from '@/api/appointments';

/**
 * Book a business.
 *
 * The times offered are real: generated from the business's own opening hours,
 * cut into pieces the length of the service, with anything already booked
 * removed. Taking one of them is CONFIRMED on the spot, because publishing it
 * was the approval — so the button says "Book" rather than "Request", and means
 * it.
 *
 * A service with a deposit says so before anything is tapped, and the button
 * turns into a top-up when the balance will not cover it. Being told after
 * choosing a time is the version of this that annoys people.
 */
export function BookSheet({ visible, onClose, businessId, businessName }: {
  visible: boolean;
  onClose: () => void;
  businessId: number;
  businessName: string;
}) {
  const { c } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const svcQ = useServices(visible ? businessId : undefined);
  const services = useMemo(() => svcQ.data?.services ?? [], [svcQ.data]);
  const [serviceId, setServiceId] = useState<number | null>(null);
  const service: Service | undefined = services.find((s) => s.id === serviceId) ?? services[0];
  const slotQ = useSlots(visible ? businessId : undefined, service?.id);
  const walletQ = useWallet();
  const [slot, setSlot] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (serviceId == null && services.length) setServiceId(services[0].id);
  }, [services, serviceId]);
  // A time from the previous service is not a time this one has.
  useEffect(() => { setSlot(null); }, [serviceId]);

  const slots = slotQ.data?.slots ?? [];
  const deposit = service?.depositCents ?? 0;
  const balance = walletQ.data?.balanceCents ?? 0;
  const short = deposit > balance;

  /* Slots arrive as a flat list of times; people think in days. */
  const byDay = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const iso of slots) {
      const d = new Date(iso);
      const key = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
      (m.get(key) ?? m.set(key, []).get(key)!).push(iso);
    }
    return [...m.entries()];
  }, [slots]);

  const book = async () => {
    if (!service || !slot || busy) return;
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      await bookAppointment(businessId, {
        serviceId: service.id, service: service.name,
        whenAt: slot, note: note.trim(), slot: true,
      });
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['slots'] });
      qc.invalidateQueries({ queryKey: ['wallet'] });
      onClose();
      Alert.alert(
        'Booked',
        `You're in with ${businessName}. They can see it and so can you.`,
        [{ text: 'See it', onPress: () => router.push('/appointments') }, { text: 'Done' }],
      );
    } catch (e) {
      // Somebody else can take a time between it being drawn and being tapped.
      const msg = (e as Error).message;
      Alert.alert('Booking', msg);
      slotQ.refetch();
      setSlot(null);
    } finally {
      setBusy(false);
    }
  };

  const reason = slotQ.data?.reason;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.wrap, { backgroundColor: c.bg }]}>
        <View style={[styles.head, { borderBottomColor: c.border }]}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.x}
            accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={24} color={c.text} />
          </Pressable>
          <Text variant="headline" numberOfLines={1}>Book {businessName}</Text>
          <View style={styles.x} />
        </View>

        {svcQ.isLoading ? (
          <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
        ) : !services.length ? (
          <View style={styles.center}>
            <Text variant="body" tone="t2" style={{ textAlign: 'center' }}>
              {businessName} hasn't set out what they offer yet.
            </Text>
            <View style={{ marginTop: 18, alignSelf: 'stretch' }}>
              <Button title="Message them instead" kind="primary"
                onPress={() => { onClose(); router.push(`/chat/${businessId}`); }} />
            </View>
          </View>
        ) : (
          <>
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              <Text variant="callout" tone="t2" style={styles.lbl}>What for</Text>
              <View style={styles.chips}>
                {services.map((s) => (
                  <Pressable key={s.id} onPress={() => setServiceId(s.id)}
                    style={[styles.chip, { backgroundColor: s.id === service?.id ? c.accent : c.s1 }]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: s.id === service?.id }}>
                    <Text variant="callout" weight="600"
                      style={{ color: s.id === service?.id ? c.accentTint : c.text }}>
                      {s.name}
                    </Text>
                    <Text variant="micro"
                      style={{ color: s.id === service?.id ? c.accentTint : c.t3 }}>
                      {s.durationMin} min{s.depositCents ? ` · ${money(s.depositCents)} deposit` : ''}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text variant="callout" tone="t2" style={styles.lbl}>When</Text>
              {slotQ.isLoading ? (
                <ActivityIndicator color={c.accent} style={{ marginVertical: 16 }} />
              ) : !slots.length ? (
                <Text variant="body" tone="t3">
                  {reason === 'no-hours'
                    ? `${businessName} hasn't put up their opening hours, so there is nothing to pick from yet.`
                    : 'Nothing free in the next fortnight.'}
                </Text>
              ) : (
                byDay.map(([day, times]) => (
                  <View key={day} style={{ marginBottom: 14 }}>
                    <Text variant="caption" tone="t3" style={{ marginBottom: 6 }}>{day}</Text>
                    <View style={styles.times}>
                      {times.map((iso) => {
                        const on = slot === iso;
                        return (
                          <Pressable key={iso} onPress={() => setSlot(iso)}
                            style={[styles.time, { backgroundColor: on ? c.accent : c.s1 }]}
                            accessibilityRole="radio" accessibilityState={{ selected: on }}>
                            <Text variant="callout" weight="600"
                              style={{ color: on ? c.accentTint : c.text }}>
                              {new Date(iso).toLocaleTimeString(undefined,
                                { hour: 'numeric', minute: '2-digit' })}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ))
              )}

              {!!slots.length && (
                <>
                  <Text variant="callout" tone="t2" style={styles.lbl}>Anything they should know</Text>
                  <TextInput value={note} onChangeText={setNote} multiline maxLength={500}
                    placeholder="Optional" placeholderTextColor={c.t3}
                    style={[styles.input, { backgroundColor: c.s1, color: c.text }]}
                    accessibilityLabel="Note" />
                </>
              )}
            </ScrollView>

            <View style={[styles.foot, { borderTopColor: c.border }]}>
              {deposit > 0 && (
                <Text variant="caption" tone={short ? 'warning' : 't3'} style={styles.note}>
                  {short
                    ? `${money(deposit)} deposit — ${money(deposit - balance)} more than your balance.`
                    : `${money(deposit)} deposit held now, and released to them when it is done.`}
                </Text>
              )}
              {short ? (
                <Button title="Top up balance" kind="primary"
                  onPress={() => { onClose(); router.push('/wallet-topup'); }} />
              ) : (
                <Button title={slot ? 'Book it' : 'Pick a time'} kind="primary"
                  loading={busy} disabled={!slot || busy} onPress={book} />
              )}
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  x: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  body: { padding: spacing.gutter, paddingBottom: 28 },
  lbl: { marginTop: 16, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.card },
  times: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  time: { paddingHorizontal: 14, height: 40, borderRadius: radius.pill, justifyContent: 'center' },
  input: {
    borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, minHeight: 76, textAlignVertical: 'top',
  },
  foot: { padding: spacing.gutter, paddingBottom: 26, borderTopWidth: StyleSheet.hairlineWidth },
  note: { marginBottom: 10, textAlign: 'center' },
});
