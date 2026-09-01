import { useState } from 'react';
import { View, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl, Alert, TextInput, Modal, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { PageHeader } from '@/components/PageHeader';
import { chromePad } from '@/components/Chrome';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { usePaymentLinks, createPaymentLink, setPaymentLinkActive, type PaymentLink } from '@/api/money';
import { money } from '@/api/wallet';
import { API_URL } from '@/api/config';
import { haptics } from '@/lib/haptics';

/**
 * A link that takes money. Give it to anybody — no invoice, no back and forth.
 * The full URL is built from the API origin rather than stored, so a link made
 * on a test server does not follow you to the real one.
 */
const linkUrl = (code: string) => `${API_URL.replace(/\/+$/, '')}/?paylink=${code}`;

export default function PaymentLinks() {
  const { c } = useTheme();
  const [making, setMaking] = useState(false);
  const { data, isLoading, refetch, isRefetching } = usePaymentLinks();
  const rows = data?.links ?? [];

  return (
    <Screen edges={[]}>
      <PageHeader
        title="Payment links"
        action={{ icon: 'add', label: 'New link', onPress: () => setMaking(true) }}
      />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => String(r.id)}
          renderItem={({ item }) => <Row link={item} onDone={refetch} />}
          contentContainerStyle={[{ paddingTop: 12, paddingBottom: 120 }, chromePad.header]}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.accent} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="link-outline" size={44} color={c.t4} />
              <Text variant="body" tone="t3" style={{ marginTop: 12, textAlign: 'center' }}>
                Make a link and anybody can pay you with it.
              </Text>
            </View>
          }
        />
      )}
      <NewLink visible={making} onClose={() => setMaking(false)} onDone={refetch} />
    </Screen>
  );
}

function Row({ link, onDone }: { link: PaymentLink; onDone: () => void }) {
  const { c, radius } = useTheme();
  const [busy, setBusy] = useState(false);
  const url = linkUrl(link.code);

  const copy = async () => {
    await Clipboard.setStringAsync(url);
    haptics.success();
    Alert.alert('Copied', 'The link is on your clipboard.');
  };
  /* No haptic — the <Button> already ticked on press-in. */
  const share = async () => {
    try { await Share.share({ message: url }); } catch { /* dismissed */ }
  };
  const toggle = async () => {
    setBusy(true);
    try { await setPaymentLinkActive(link.id, !link.active); haptics.success(); onDone(); }
    catch (e) { haptics.error(); Alert.alert('Payment link', (e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <View style={[styles.row, { backgroundColor: c.s1, borderRadius: radius.card }]}>
      <View style={styles.rowTop}>
        <View style={{ flex: 1 }}>
          <Text variant="headline" weight="800">
            {link.amountCents != null ? money(link.amountCents) : 'Any amount'}
          </Text>
          {!!link.note && <Text variant="caption" tone="t3" numberOfLines={1}>{link.note}</Text>}
        </View>
        {!link.active && (
          <View style={[styles.pill, { backgroundColor: c.s2 }]}>
            <Text variant="micro" tone="t3">Off</Text>
          </View>
        )}
      </View>

      <Pressable onPress={copy} hitSlop={6} style={{ marginTop: 10 }} accessibilityRole="button" accessibilityLabel="Copy the link">
        <Text variant="caption" tone="accent" numberOfLines={1}>{url}</Text>
      </Pressable>

      <Text variant="micro" tone="t3" style={{ marginTop: 8 }}>
        {link.payCount} {link.payCount === 1 ? 'payment' : 'payments'} · {money(link.collectedCents)} collected
      </Text>

      <View style={styles.acts}>
        <Button title="Share" kind="secondary" onPress={share} style={{ flex: 1, minHeight: 40 }} />
        <Button
          title={link.active ? 'Turn off' : 'Turn on'}
          kind="secondary"
          onPress={toggle}
          loading={busy}
          style={{ flex: 1, minHeight: 40 }}
        />
      </View>
    </View>
  );
}

function NewLink({ visible, onClose, onDone }: { visible: boolean; onClose: () => void; onDone: () => void }) {
  const { c, radius, spacing } = useTheme();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    try {
      const cents = Math.round(parseFloat(amount.replace(/[^0-9.]/g, '')) * 100);
      await createPaymentLink({
        amountCents: Number.isFinite(cents) && cents > 0 ? cents : undefined,
        note: note.trim() || undefined,
      });
      haptics.success();
      setAmount(''); setNote('');
      onDone(); onClose();
    } catch (e) { haptics.error(); Alert.alert('Payment link', (e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <Screen edges={[]}>
        <PageHeader title="New payment link" />
        <View style={{ padding: spacing.gutter }}>
          <Text variant="caption" tone="t3" style={styles.lbl}>AMOUNT (LEAVE EMPTY TO LET THEM CHOOSE)</Text>
          <TextInput
            value={amount} onChangeText={setAmount}
            placeholder="25"
            placeholderTextColor={c.t4}
            keyboardType="decimal-pad"
            accessibilityLabel="Amount in dollars"
            style={[styles.input, { backgroundColor: c.s2, color: c.text, borderRadius: radius.md }]}
          />
          <Text variant="caption" tone="t3" style={styles.lbl}>WHAT IT IS FOR</Text>
          <TextInput
            value={note} onChangeText={setNote}
            placeholder="Workshop deposit"
            placeholderTextColor={c.t4}
            accessibilityLabel="Note"
            style={[styles.input, { backgroundColor: c.s2, color: c.text, borderRadius: radius.md }]}
          />
          <View style={{ height: 20 }} />
          <Button title="Make the link" onPress={go} loading={busy} />
        </View>
      </Screen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: 40 },
  row: { padding: 14, marginHorizontal: spacing.gutter, marginBottom: 10 },
  rowTop: { flexDirection: 'row', alignItems: 'center' },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  acts: { flexDirection: 'row', gap: 10, marginTop: 12 },
  lbl: { marginTop: 16, marginBottom: 8, letterSpacing: 0.6 },
  input: { paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
});
