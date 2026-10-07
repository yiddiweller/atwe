import { useState } from 'react';
import { View, Pressable, StyleSheet, Alert } from 'react-native';
import { Text } from './Text';
import { useTheme } from '@/theme/ThemeProvider';
import { votePoll, type Poll } from '@/api/social';
import { haptics } from '@/lib/haptics';

/**
 * A poll on a post. One vote each, it cannot be changed, and it closes on a
 * date — so the screen shows RESULTS the moment you have voted or it has
 * closed, and hides them before that. Showing the counts to somebody who has
 * not voted is how you get a poll that measures the first answer.
 */
export function PostPoll({ postId, poll }: { postId: number; poll: Poll }) {
  const { c, radius } = useTheme();
  const [live, setLive] = useState(poll);
  const [busy, setBusy] = useState<number | null>(null);

  const voted = live.myVote != null;
  const done = voted || live.closed;

  const vote = async (optionId: number) => {
    if (done || busy != null) return;
    haptics.select();
    setBusy(optionId);
    try {
      const r = await votePoll(postId, optionId);
      /* The server hands the whole post back with the counts already in it,
         so there is nothing to recompute — and nothing to get wrong. */
      if (r.post.poll) setLive(r.post.poll);
    } catch (e) { haptics.error(); Alert.alert('Poll', (e as Error).message); }
    finally { setBusy(null); }
  };

  return (
    <View style={{ marginTop: 10 }}>
      {live.options.map((o) => {
        const pct = live.total > 0 ? Math.round((o.votes / live.total) * 100) : 0;
        const mine = live.myVote === o.id;
        return (
          <Pressable
            key={o.id}
            onPress={() => vote(o.id)}
            disabled={done || busy != null}
            style={[styles.opt, { backgroundColor: c.s2, borderRadius: radius.md }]}
            accessibilityRole="button"
            accessibilityState={{ selected: mine, disabled: done }}
            accessibilityLabel={done ? `${o.text}, ${pct} percent` : `Vote for ${o.text}`}
          >
            {/* The bar is behind the text, not beside it — a result reads as one
                row with a fill, not as a label with a chart next to it. */}
            {done && (
              <View style={[styles.fill, {
                width: `${pct}%`,
                backgroundColor: mine ? c.accentDim : c.s3,
                borderRadius: radius.md,
              }]} />
            )}
            <Text variant="body" style={{ flex: 1, fontWeight: mine ? '700' : '400' }} numberOfLines={1}>
              {o.text}
            </Text>
            {done && <Text variant="callout" tone="t2">{pct}%</Text>}
          </Pressable>
        );
      })}
      <Text variant="micro" tone="t3" style={{ marginTop: 6 }}>
        {live.total} {live.total === 1 ? 'vote' : 'votes'}
        {live.closed ? ' · closed' : live.endsAt ? ` · ${endsIn(live.endsAt)}` : ''}
      </Text>
    </View>
  );
}

/** "2 days left" is what a voter wants; a date is what an archivist wants. */
function endsIn(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'closed';
  const days = Math.floor(ms / 86400000);
  if (days >= 1) return `${days} ${days === 1 ? 'day' : 'days'} left`;
  const hrs = Math.floor(ms / 3600000);
  if (hrs >= 1) return `${hrs} ${hrs === 1 ? 'hour' : 'hours'} left`;
  return 'closes soon';
}

const styles = StyleSheet.create({
  opt: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 11, marginBottom: 8,
    overflow: 'hidden',
  },
  fill: { ...StyleSheet.absoluteFillObject, right: undefined },
});
