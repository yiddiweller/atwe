import { Pressable, StyleSheet } from 'react-native';
import { Text } from './Text';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/lib/haptics';

/**
 * One word in a world's tab row — Home's For You / Following / Circles /
 * Collections, and Beam's Chats / Groups.
 *
 * The web is explicit that these must be IDENTICAL across worlds ("same size,
 * weight and colour so switching worlds never feels off"), so there is one
 * component rather than a copy per screen. Its numbers are the web's, exactly:
 *
 *     15px / weight 600 / --t2        at rest
 *     15px / weight 700 / --t1        active
 *
 * and there is NO UNDERLINE. The web draws one only in its non-solo top bar and
 * then explicitly turns it off for these rows (`.tb-feedtab.active::after
 * {display:none}`). The app had a 3px blue bar under the active tab, which is
 * both a shape the web does not have and a use of blue the colour law reserves
 * for identity.
 *
 * The size never changes between states — only the weight and the colour — so a
 * tab cannot shift the row as you move along it.
 */
export function FeedTab({ label, active, onPress }: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={() => { haptics.select(); onPress(); }}
      hitSlop={8}
      style={styles.tab}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      <Text
        style={[styles.word, {
          fontWeight: active ? '700' : '600',
          color: active ? c.text : c.t2,
        }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tab: { paddingVertical: 6, paddingHorizontal: 4 },
  word: { fontSize: 15 },
});
