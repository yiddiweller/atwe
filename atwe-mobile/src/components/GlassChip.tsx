import { Pressable, StyleSheet, type ViewStyle } from 'react-native';
import { Text } from './Text';
import { Glass } from './Glass';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, radius } from '@/theme/tokens';
import { haptics } from '@/lib/haptics';

/**
 * A filter capsule — "For you / Following", "All / Physical / Digital", a
 * category, a stage. There were six near-identical copies of this across the
 * screens and every one of them painted a grey capsule.
 *
 * UNCHOSEN it is real glass, because these rows ride INSIDE a chrome bar with
 * the page scrolling under it: a painted grey capsule sitting on glass reads as
 * a sticker stuck to a window, which is most of what "it doesn't look like an
 * Apple app" means in practice.
 *
 * CHOSEN it is a solid fill and deliberately not glass. The fill IS the answer
 * to "which one am I on", and a see-through selected state cannot say that. The
 * colour is the caller's: white for a "where am I" shelf per the colour law,
 * accent where the choice is an identity rather than a place.
 */
export function GlassChip({ label, on, onPress, fill, ink, icon, style }: {
  label: string;
  on: boolean;
  onPress: () => void;
  /** What the chosen state fills with. Defaults to the colour law's white. */
  fill?: string;
  /** The ink that reads on that fill. */
  ink?: string;
  icon?: React.ReactNode;
  style?: ViewStyle;
}) {
  const { c } = useTheme();
  const bg = fill ?? c.primary;
  const fg = on ? (ink ?? c.onPrimary) : c.t2;
  return (
    <Pressable
      onPress={() => { haptics.select(); onPress(); }}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
    >
      <Glass
        radius={radius.pill}
        /* Chosen = a real fill, so force the fallback even where glass exists. */
        plain={on}
        fill={{ backgroundColor: on ? bg : c.s2 }}
        style={[styles.chip, style]}
      >
        {icon}
        <Text variant="callout" style={{ color: fg }}>{label}</Text>
      </Glass>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.gutter,
    paddingVertical: 8,
  },
});
