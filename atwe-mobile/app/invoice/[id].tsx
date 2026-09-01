import { useState } from 'react';
import { View, ScrollView, StyleSheet, ActivityIndicator, Alert, Linking } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { PageHeader } from '@/components/PageHeader';
import { useTheme } from '@/theme/ThemeProvider';
import { useInvoice, payInvoice, cancelInvoice } from '@/api/money';
import { invoiceState } from '../invoices';
import { money } from '@/api/wallet';
import { haptics } from '@/lib/haptics';

/**
 * One bill. The customer pays it from their balance; the issuer can withdraw it
 * while it is still unpaid. Paying can answer with a Stripe URL instead of
 * settling on the spot — that opens in the browser, same as a ticketed event.
 */
export default function InvoiceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, radius, spacing } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useInvoice(id);
  const inv = data?.invoice;
  const [busy, setBusy] = useState<'pay' | 'cancel' | null>(null);

  const pay = async () => {
    if (!inv) return;
    setBusy('pay');
    try {
      const r = await payInvoice(inv.id);
      if (r.url) { await Linking.openURL(r.url); return; }
      haptics.success();
      qc.invalidateQueries({ queryKey: ['wallet'] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      refetch();
    } catch (e) { haptics.error(); Alert.alert('Invoice', (e as Error).message); }
    finally { setBusy(null); }
  };

  const withdraw = () => {
    if (!inv) return;
    Alert.alert('Withdraw this invoice?', 'The customer will no longer be able to pay it.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Withdraw', style: 'destructive', onPress: async () => {
          setBusy('cancel');
          try {
            await cancelInvoice(inv.id);
            haptics.success();
            qc.invalidateQueries({ queryKey: ['invoices'] });
            router.back();
          } catch (e) { haptics.error(); Alert.alert('Invoice', (e as Error).message); }
          finally { setBusy(null); }
        },
      },
    ]);
  };

  const st = inv ? invoiceState(inv) : null;
  const other = inv ? (inv.mine ? inv.customer : inv.issuer) : null;

  return (
    <Screen edges={['top']}>
      <PageHeader title="Invoice" />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : isError || !inv ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">This invoice is not available.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.gutter, paddingBottom: 60 }}>
          <View style={[styles.hero, { backgroundColor: c.s1, borderRadius: radius.card }]}>
            <Text variant="caption" tone="t3">{inv.mine ? 'You billed' : 'You owe'}</Text>
            <Text variant="display" weight="800" style={{ marginTop: 4 }}>{money(inv.amountCents)}</Text>
            {!!st && <Text variant="callout" tone={st.tone} style={{ marginTop: 4 }}>{st.label}</Text>}
          </View>

          <Text variant="title" style={{ marginTop: 18 }}>{inv.title}</Text>

          {!!other && (
            <View style={[styles.who, { backgroundColor: c.s1, borderRadius: radius.card }]}>
              <Avatar name={other.name} avatar={other.avatar} biz={other.accountType === 'business'} size={38} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text variant="headline" numberOfLines={1}>{other.name}</Text>
                {other.username && <Text variant="caption" tone="t3">@{other.username}</Text>}
              </View>
            </View>
          )}

          {inv.items.length > 0 && (
            <View style={{ marginTop: 18 }}>
              <Text variant="caption" tone="t3" style={styles.lbl}>WHAT FOR</Text>
              {inv.items.map((it, i) => (
                <View key={i} style={[styles.line, { borderBottomColor: c.border }]}>
                  <Text variant="body" tone="t2" style={{ flex: 1 }}>{it.description}</Text>
                  <Text variant="body">{money(it.amountCents)}</Text>
                </View>
              ))}
              <View style={styles.line}>
                <Text variant="headline" style={{ flex: 1 }}>Total</Text>
                <Text variant="headline" weight="800">{money(inv.amountCents)}</Text>
              </View>
            </View>
          )}

          {!!inv.note && (
            <Text variant="body" tone="t2" style={{ marginTop: 16, lineHeight: 22 }}>{inv.note}</Text>
          )}

          {!!inv.dueAt && inv.status === 'sent' && (
            <Text variant="caption" tone="t3" style={{ marginTop: 12 }}>
              Due {new Date(inv.dueAt).toLocaleDateString()}
            </Text>
          )}

          <View style={{ marginTop: 24, gap: 10 }}>
            {!inv.mine && inv.status === 'sent' && (
              <Button title={`Pay ${money(inv.amountCents)}`} onPress={pay} loading={busy === 'pay'} />
            )}
            {inv.mine && inv.status === 'sent' && (
              <Button title="Withdraw this invoice" kind="danger" onPress={withdraw} loading={busy === 'cancel'} />
            )}
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  hero: { padding: 20 },
  who: { flexDirection: 'row', alignItems: 'center', padding: 12, marginTop: 16 },
  lbl: { marginBottom: 8, letterSpacing: 0.6 },
  line: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, gap: 12,
  },
});
