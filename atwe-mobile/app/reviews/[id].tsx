import { useEffect, useState } from 'react';
import {
  View, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { Stars } from '@/components/Stars';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { useReviews, writeReview, deleteReview, type Review } from '@/api/business';
import { timeAgo } from '@/lib/format';
import { HapticInput } from '@/components/HapticInput';
import { haptics } from '@/lib/haptics';

/**
 * What people said about a business, and saying it yourself.
 *
 * A review that came from a real dealing — an order, a stay, a finished
 * appointment — is marked, because that is what separates one with weight from
 * one without, and a reader should be able to tell at a glance.
 *
 * There is one review per person per business: writing again replaces what you
 * said, so the form opens with your own words already in it rather than blank.
 */
export default function Reviews() {
  const { c } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const bid = Number(id);
  const q = useReviews(Number.isFinite(bid) ? bid : undefined);
  const reviews = q.data?.reviews ?? [];
  const summary = q.data?.summary;
  const mine = reviews.find((r) => r.mine);

  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  // Open with what you said last time, not a blank form — until you touch it.
  useEffect(() => {
    if (mine && !touched) { setRating(mine.rating); setBody(mine.body); }
  }, [mine, touched]);

  const send = async () => {
    if (!rating || busy) return;
    setBusy(true);
    try {
      await writeReview(bid, rating, body.trim());
      haptics.success();
      setTouched(false);
      await q.refetch();
      qc.invalidateQueries({ queryKey: ['profile'] });
    } catch (e) {
      haptics.error(); Alert.alert('Review', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (!mine) return;
    Alert.alert('Delete your review?', '', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          haptics.warning();
          try {
            await deleteReview(mine.id);
            setRating(0); setBody(''); setTouched(false);
            await q.refetch();
            qc.invalidateQueries({ queryKey: ['profile'] });
          } catch (e) { haptics.error(); Alert.alert('Review', (e as Error).message); }
        },
      },
    ]);
  };

  return (
    <Screen edges={['top']}>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}
          accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={c.text} />
        </Pressable>
        <Text variant="headline" numberOfLines={1}>{name || 'Reviews'}</Text>
        <View style={styles.back} />
      </View>

      {q.isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {!!summary && summary.count > 0 && (
            <View style={[styles.summary, { backgroundColor: c.s1 }]}>
              <Text variant="display" weight="800">{summary.average.toFixed(1)}</Text>
              <Stars n={Math.round(summary.average)} size={16} />
              <Text variant="caption" tone="t3" style={{ marginTop: 4 }}>
                {summary.count} review{summary.count === 1 ? '' : 's'}
              </Text>
            </View>
          )}

          <View style={[styles.card, { backgroundColor: c.s1 }]}>
            <Text variant="headline">{mine ? 'Your review' : 'Say how it went'}</Text>
            <View style={styles.picker}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable key={n} onPress={() => { haptics.select(); setRating(n); setTouched(true); }} hitSlop={4}
                  accessibilityRole="radio" accessibilityState={{ selected: rating === n }}
                  accessibilityLabel={`${n} star${n === 1 ? '' : 's'}`}>
                  <Ionicons name={n <= rating ? 'star' : 'star-outline'} size={30}
                    color={n <= rating ? c.warning : c.t4} />
                </Pressable>
              ))}
            </View>
            <HapticInput
              value={body}
              onChangeText={(t) => { setBody(t); setTouched(true); }}
              multiline maxLength={2000}
              placeholder="What was it like? (optional)"
              placeholderTextColor={c.t3}
              style={[styles.input, { backgroundColor: c.bg, color: c.text }]}
              accessibilityLabel="Your review"
            />
            <View style={{ marginTop: 10, gap: 8 }}>
              <Button title={mine ? 'Update' : 'Post review'} kind="primary"
                loading={busy} disabled={!rating} onPress={send} />
              {!!mine && <Button title="Delete mine" kind="secondary" onPress={remove} />}
            </View>
          </View>

          {reviews.filter((r) => !r.mine).map((r) => <Row key={r.id} r={r} />)}

          {reviews.length === 0 && (
            <Text variant="body" tone="t3" style={{ textAlign: 'center', marginTop: 20 }}>
              Nobody has said anything yet.
            </Text>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

function Row({ r }: { r: Review }) {
  const { c } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: c.s1 }]}>
      <View style={styles.who}>
        <Avatar name={r.reviewer.name} avatar={r.reviewer.avatar} size={32} />
        <View style={{ flex: 1, marginLeft: 9 }}>
          <View style={styles.nameLine}>
            <Text variant="callout" weight="700" numberOfLines={1}>{r.reviewer.name}</Text>
            {r.reviewer.verified && <VerifiedBadge size={13} />}
          </View>
          <Text variant="micro" tone="t3">{timeAgo(r.createdAt)}</Text>
        </View>
        <Stars n={r.rating} size={13} />
      </View>
      {r.verified && (
        <View style={styles.badgeRow}>
          <Ionicons name="checkmark-circle" size={13} color={c.repost} />
          <Text variant="micro" style={{ color: c.repost, marginLeft: 4 }}>
            {r.forWhat ? `Bought: ${r.forWhat}` : 'From a real dealing'}
          </Text>
        </View>
      )}
      {!!r.body && <Text variant="body" style={{ marginTop: 8 }}>{r.body}</Text>}
      {!!r.response && (
        <View style={[styles.reply, { borderLeftColor: c.accent }]}>
          <Text variant="micro" style={{ color: c.accent }}>They replied</Text>
          <Text variant="body" tone="t2">{r.response}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingBottom: 8,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: spacing.gutter, paddingBottom: 40, gap: 12 },
  summary: { borderRadius: radius.card, padding: 18, alignItems: 'center' },
  card: { borderRadius: radius.card, padding: 14 },
  picker: { flexDirection: 'row', gap: 8, marginTop: 10, marginBottom: 10 },
  input: {
    borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, minHeight: 74, textAlignVertical: 'top',
  },
  who: { flexDirection: 'row', alignItems: 'center' },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  reply: { marginTop: 10, paddingLeft: 10, borderLeftWidth: 3 },
});
