import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { haptics } from '@/lib/haptics';
import { Glass, hasGlass } from './Glass';

/**
 * The web's compose ＋, back on the phone — and on iOS 26 it is Apple's own
 * `.glassProminent`: real Liquid Glass carrying the brand's `--primary` as its
 * tint. That is not a softening of the design law, it IS the law expressed in
 * the platform's own material: white is still the one loud action per screen,
 * and prominent glass is how iOS 26 draws a loud action. Below 26 it collapses
 * to exactly the solid white disc it always was.
 *
 * The same treatment `Button` gives its primary, so the app's loudest control
 * cannot end up made of a different substance depending on which file drew it.
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
  /* Real glass bends and dims under the finger by itself; painting our own
     press treatment over it is what makes a material read as a sticker. */
  const real = hasGlass();
  const [down, setDown] = useState(false);

  return (
    <Pressable
      onPress={() => { haptics.tap(); onPress(); }}
      onPressIn={() => setDown(true)}
      onPressOut={() => setDown(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.host,
        /* Clear of the floating tab bar: its own inset plus its height. */
        { bottom: insets.bottom + 74, right: spacing.gutter },
        down && !real && { transform: [{ scale: 0.94 }], opacity: 0.92 },
      ]}
    >
      <Glass
        prominent
        tint={c.primary}
        radius={28}
        fallback={{ backgroundColor: c.primary }}
        style={styles.fab}
      >
        {/* On the fallback the disc IS the brand fill; on glass the tint is
            translucent over the page. The same ink reads on both. */}
        <Ionicons name="add" size={30} color={c.onPrimary} />
      </Glass>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    zIndex: 15,
    borderRadius: 28,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  fab: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
