import { ScrollView, Pressable, StyleSheet } from 'react-native';
import { Text } from './Text';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { haptics } from '@/lib/haptics';

/**
 * The row of chips that says WHICH SHELF you are looking at — Upcoming/Going,
 * Discover/Subscribed/Mine, and so on. White for the chosen one, because it is
 * the "where am I" control and the colour law gives white to the one primary
 * thing on a screen.
 *
 * Owns its own selection tick, so no caller can add a shelf without one. And it
 * is a plain ScrollView with `flexShrink: 0`: a horizontal FlatList in a flex
 * column gets squashed to less than its own content height (measured 24 against
 * 35), which is what made two stacked filter rows visibly overlap on Jobs.
 */
export function Shelf<T extends string>({ options, value, onChange }: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const { c } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.strip}
      contentContainerStyle={styles.row}
    >
      {options.map((o) => {
        const on = value === o.key;
        return (
          <Pressable
            key={o.key}
            onPress={() => { haptics.select(); onChange(o.key); }}
            style={[styles.chip, { backgroundColor: on ? c.primary : c.s2 }]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
          >
            <Text variant="callout" style={{ color: on ? c.onPrimary : c.t2 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { flexGrow: 0, flexShrink: 0 },
  row: { paddingHorizontal: spacing.gutter, gap: 8, paddingVertical: 12 },
  chip: { paddingHorizontal: spacing.gutter, paddingVertical: 8, borderRadius: 999 },
});
