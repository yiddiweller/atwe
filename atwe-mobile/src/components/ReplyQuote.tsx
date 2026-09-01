import { View, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

/**
 * The message being answered, quoted INSIDE the reply's own bubble: a coloured
 * spine, the name, and one line of what was said. On your own (accent) bubble it
 * goes white-on-translucent; on theirs it takes the theme's colours — the same
 * component reading correctly on both sides.
 */
export function ReplyQuote({ name, preview, mine }: {
  name: string | null;
  preview: string;
  mine?: boolean;
}) {
  const { c } = useTheme();
  const spine = mine ? 'rgba(255,255,255,0.7)' : c.accent;
  const nameInk = mine ? '#fff' : c.accent;
  const bodyInk = mine ? 'rgba(255,255,255,0.8)' : c.t2;
  return (
    <View style={[styles.quote, { backgroundColor: mine ? 'rgba(255,255,255,0.14)' : c.bg }]}>
      <View style={[styles.spine, { backgroundColor: spine }]} />
      <View style={styles.qtext}>
        <Text variant="micro" style={{ color: nameInk }} numberOfLines={1}>
          {name || 'Message'}
        </Text>
        <Text variant="caption" style={{ color: bodyInk }} numberOfLines={1}>
          {preview}
        </Text>
      </View>
    </View>
  );
}

/**
 * The strip above the composer while you are writing a reply — what you are
 * answering, and an x to change your mind. Placed between the list and the
 * composer so it rides up with the keyboard rather than being covered by it.
 */
export function ReplyStrip({ name, preview, onCancel }: {
  name: string | null;
  preview: string;
  onCancel: () => void;
}) {
  const { c } = useTheme();
  return (
    <View style={[styles.strip, { backgroundColor: c.s1 }]}>
      <View style={[styles.spine, { backgroundColor: c.accent }]} />
      <View style={styles.qtext}>
        <Text variant="micro" style={{ color: c.accent }} numberOfLines={1}>
          Replying to {name || 'this message'}
        </Text>
        <Text variant="caption" tone="t2" numberOfLines={1}>{preview}</Text>
      </View>
      <Pressable onPress={onCancel} hitSlop={10} style={styles.x}
        accessibilityRole="button" accessibilityLabel="Cancel reply">
        <Ionicons name="close" size={18} color={c.t2} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  quote: {
    flexDirection: 'row',
    /* It sits INSIDE a fully-rounded bubble, so a 10pt box read as a square
       pasted into a capsule. */
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: 6,
    paddingRight: 8,
  },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.gutter,
    marginBottom: 6,
    /* A capsule, like the composer it sits on top of. */
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  spine: { width: 3, alignSelf: 'stretch' },
  qtext: { flex: 1, paddingVertical: 6, paddingLeft: 8, minWidth: 0 },
  x: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
});
