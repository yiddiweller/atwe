import { Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { haptics } from '@/lib/haptics';

/**
 * The web's compose ＋, back on the phone.
 *
 * It is WHITE, not glass, and that is the design law rather than a preference:
 * white is the ONE primary action on a screen, and writing something is that
 * action on Home and in Beam. Glass is for the quiet controls around it.
 *
 * It floats clear of the tab bar and stays put when iOS minimises that bar into
 * its little pill on the LEFT — which is the whole reason it earns its place
 * back. The bar shrinking away is what leaves the screen with no way to compose.
 */
export function ComposeFab({ onPress, label = 'New post' }: {
  onPress: () => void;
  label?: string;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      onPress={() => { haptics.tap(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.fab,
        {
          backgroundColor: c.primary,
          /* Clear of the floating tab bar: its own inset plus its height. */
          bottom: insets.bottom + 74,
          right: spacing.gutter,
        },
        pressed && { transform: [{ scale: 0.94 }], opacity: 0.92 },
      ]}
    >
      <Ionicons name="add" size={30} color={c.onPrimary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 15,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
});
