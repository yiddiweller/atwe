import { useState } from 'react';
import { View, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { PageHeader } from '@/components/PageHeader';
import { chromePad } from '@/components/Chrome';
import { useTheme } from '@/theme/ThemeProvider';
import { useQuote, acceptQuote, declineQuote, cancelQuote } from '@/api/money';
import { quoteState } from '../quotes';
import { money } from '@/api/wallet';
import { haptics } from '@/lib/haptics';

/**
 * One quote. Accepting it is not just a status flip — the server turns it into
 * a real invoice with the same lines, so the screen goes straight there to pay
 * rather than leaving somebody wondering what happened.
 */
export default function QuoteDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, radius, spacing } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuote(id);
  const q = data?.quote;
  const [busy, setBusy] = useState<'yes' | 'no' | 'cancel' | null>(null);

  const bump = () => {
    qc.invalidateQueries({ queryKey: ['quotes'] });
    qc.invalidateQueries({ queryKey: ['invoices'] });
  };

  const accept = async () => {
    if (!q) return;
    setBusy('yes');
    try {
      const r = await acceptQuote(q.id);
      haptics.success();
      bump();
      router.replace(`/invoice/${r.invoice.id}`);
    } catch (e) { haptics.error(); Alert.alert('Quote', (e as Error).message); }
    finally { setBusy(null); }
  };

  const decline = () => {
    if (!q) return;
    Alert.alert('Decline this quote?', '', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Decline', style: 'destructive', onPress: async () => {
          setBusy('no');
          try { await declineQuote(q.id); haptics.success(); bump(); refetch(); }
          catch (e) { haptics.error(); Alert.alert('Quote', (e as Error).message); }
          finally { setBusy(null); }
        },
      },
    ]);
  };

  const withdraw = () => {
    if (!q) return;
    Alert.alert('Withdraw this quote?', '', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Withdraw', style: 'destructive', onPress: async () => {
          setBusy('cancel');
          try { await cancelQuote(q.id); haptics.success(); bump(); router.back(); }
          catch (e) { haptics.error(); Alert.alert('Quote', (e as Error).message); }
          finally { setBusy(null); }
        },
      },
    ]);
  };

  const st = q ? quoteState(q) : null;
  const other = q ? (q.mine ? q.customer : q.issuer) : null;
  const open = q?.status === 'sent';

  return (
    <Screen edges={[]}>
      <PageHeader title="Quote" />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : isError || !q ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">This quote is not available.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[{ padding: spacing.gutter, paddingBottom: 60 }, chromePad.header]}>
          <View style={[styles.hero, { backgroundColor: c.s1, borderRadius: radius.card }]}>
            <Text variant="caption" tone="t3">{q.mine ? 'You quoted' : 'Quoted to you'}</Text>
            <Text variant="display" weight="800" style={{ marginTop: 4 }}>{money(q.amountCents)}</Text>
            {!!st && <Text variant="callout" tone={st.tone} style={{ marginTop: 4 }}>{st.label}</Text>}
          </View>

          <Text variant="title" style={{ marginTop: 18 }}>{q.title}</Text>

          {!!other && (
            <View style={[styles.who, { backgroundColor: c.s1, borderRadius: radius.card }]}>
              <Avatar name={other.name} avatar={other.avatar} biz={other.accountType === 'business'} size={38} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text variant="headline" numberOfLines={1}>{other.name}</Text>
                {other.username && <Text variant="caption" tone="t3">@{other.username}</Text>}
              </View>
            </View>
          )}

          {q.items.length > 0 && (
            <View style={{ marginTop: 18 }}>
              <Text variant="caption" tone="t3" style={styles.lbl}>WHAT IS INCLUDED</Text>
              {q.items.map((it, i) => (
                <View key={i} style={[styles.line, { borderBottomColor: c.border }]}>
                  <Text variant="body" tone="t2" style={{ flex: 1 }}>{it.description}</Text>
                  <Text variant="body">{money(it.amountCents)}</Text>
                </View>
              ))}
              <View style={styles.line}>
                <Text variant="headline" style={{ flex: 1 }}>Total</Text>
                <Text variant="headline" weight="800">{money(q.amountCents)}</Text>
              </View>
            </View>
          )}

          {!!q.note && (
            <Text variant="body" tone="t2" style={{ marginTop: 16, lineHeight: 22 }}>{q.note}</Text>
          )}

          {!!q.validUntil && open && (
            <Text variant="caption" tone="t3" style={{ marginTop: 12 }}>
              Good until {new Date(q.validUntil).toLocaleDateString()}
            </Text>
          )}

          <View style={{ marginTop: 24, gap: 10 }}>
            {!q.mine && open && (
              <>
                <Button title="Accept and pay" onPress={accept} loading={busy === 'yes'} />
                <Button title="Decline" kind="secondary" onPress={decline} loading={busy === 'no'} />
              </>
            )}
            {q.mine && open && (
              <Button title="Withdraw this quote" kind="danger" onPress={withdraw} loading={busy === 'cancel'} />
            )}
            {q.invoiceId != null && (
              <Button title="Open the invoice" kind="secondary" onPress={() => router.push(`/invoice/${q.invoiceId}`)} />
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
