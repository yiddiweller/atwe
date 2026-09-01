import { useState } from 'react';
import { View, ScrollView, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { HapticInput } from '@/components/HapticInput';
import { PageHeader } from '@/components/PageHeader';
import { chromePad } from '@/components/Chrome';
import { ListingCard } from '@/components/ListingCard';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { aiShop, type AiShopResult } from '@/api/discover';
import { haptics } from '@/lib/haptics';

const EXAMPLES = [
  'a gift for someone who bakes, under $40',
  'something for a new flat',
  'a wedding photographer in Brooklyn',
];

/**
 * Shopping with Atwe AI — say what you want in your own words.
 *
 * Without an API key the server still answers, with plain retrieval instead of a
 * ranked shortlist, and says so (`ai:false`). That is worth surfacing rather than
 * silently passing off a keyword match as a recommendation.
 */
export default function AiShop() {
  const { c } = useTheme();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<AiShopResult | null>(null);

  const go = async (query: string) => {
    const text = query.trim();
    if (!text) return;
    setQ(text);
    setBusy(true);
    try { setRes(await aiShop(text)); haptics.success(); }
    catch (e) { haptics.error(); Alert.alert('Atwe AI', (e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Screen edges={[]}>
      <PageHeader title="Shop with Atwe AI" />
      <ScrollView contentContainerStyle={[{ paddingBottom: 120 }, chromePad.header]} keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={{ paddingHorizontal: spacing.gutter }}>
          <HapticInput
            value={q}
            onChangeText={setQ}
            placeholder="What are you after?"
            placeholderTextColor={c.t3}
            multiline
            style={[styles.input, { backgroundColor: c.s1, color: c.text }]}
            accessibilityLabel="What are you after"
            onSubmitEditing={() => go(q)}
          />
          <View style={{ height: 10 }} />
          <Button title={busy ? 'Looking…' : 'Find it'} kind="primary" loading={busy}
            onPress={() => go(q)} />

          {!res && !busy && (
            <View style={{ marginTop: 22 }}>
              <Text variant="caption" tone="t3" style={{ marginBottom: 8 }}>Try</Text>
              {EXAMPLES.map((e) => (
                <Text
                  key={e}
                  variant="callout"
                  onPress={() => go(e)}
                  style={[styles.example, { color: c.accent }]}
                >
                  {e}
                </Text>
              ))}
            </View>
          )}
        </View>

        {busy && <View style={styles.center}><ActivityIndicator color={c.accent} /></View>}

        {!!res && !busy && (
          <View style={{ marginTop: 22 }}>
            {!!res.summary && (
              <Text variant="body" tone="t2"
                style={{ paddingHorizontal: spacing.gutter, marginBottom: 14, lineHeight: 22 }}>
                {res.summary}
              </Text>
            )}
            {!res.ai && (
              <Text variant="micro" tone="t4" style={{ paddingHorizontal: spacing.gutter, marginBottom: 12 }}>
                Matched on words rather than meaning — Atwe AI isn’t switched on here.
              </Text>
            )}
            {res.items.length === 0 ? (
              <View style={styles.center}>
                <Text variant="body" tone="t3">Nothing matched that.</Text>
              </View>
            ) : res.items.map(({ listing, reason }) => (
              <View key={listing.id}>
                <ListingCard listing={listing} />
                {!!reason && (
                  <Text variant="caption" tone="t3" style={styles.reason}>{reason}</Text>
                )}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    borderRadius: radius.bubble, paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 16, minHeight: 88, textAlignVertical: 'top',
  },
  example: { paddingVertical: 7 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 32 },
  reason: {
    marginHorizontal: spacing.gutter, marginTop: -8, marginBottom: 14,
    fontStyle: 'italic',
  },
});
