import { View, StyleSheet } from 'react-native';
import { Text } from './Text';
import { useTheme } from '@/theme/ThemeProvider';
import { reactionChips, type Reactions } from '@/api/beam';

/**
 * The reactions on a message, under its bubble. One chip per distinct emoji with
 * a count; the one you added is outlined in the accent so you can see at a glance
 * which is yours. Renders nothing at all when there are none, so it costs a
 * message with no reactions no height.
 */
export function ReactionChips({ reactions, myId, align = 'left' }: {
  reactions?: Reactions;
  myId?: number;
  align?: 'left' | 'right';
}) {
  const { c } = useTheme();
  const chips = reactionChips(reactions, myId);
  if (!chips.length) return null;
  return (
    <View style={[styles.row, { justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }]}>
      {chips.map((ch) => (
        <View
          key={ch.emoji}
          style={[
            styles.chip,
            { backgroundColor: c.s2 },
            ch.mine && { borderColor: c.accent, borderWidth: 1 },
          ]}
          accessibilityLabel={`${ch.emoji} ${ch.count}${ch.mine ? ', including you' : ''}`}
        >
          <Text style={styles.glyph}>{ch.emoji}</Text>
          {ch.count > 1 && (
            <Text variant="micro" style={{ color: c.t2, marginLeft: 3 }}>{ch.count}</Text>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4, marginHorizontal: 4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    height: 24,
    borderRadius: 12,
  },
  glyph: { fontSize: 13, lineHeight: 17 },
});
