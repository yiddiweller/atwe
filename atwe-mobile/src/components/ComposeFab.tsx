import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { haptics } from '@/lib/haptics';
import { GlassIcon } from './Glass';

/**
 * The web's compose ＋, on the phone — and it is the SAME GLASS as everything
 * else, not a white disc.
 *
 * It shipped white, under the colour law's "white is the one primary action per
 * screen". The founder rejected that on sight and the reason is sound: when you
 * scroll, iOS shrinks the tab bar into its little glass pill on the left, and a
 * solid white ball sitting opposite it is the one thing on the screen made of
 * paint. Two floating controls on the same line have to be the same substance.
 *
 * So it uses `GlassIcon` — the app's one glass button, the same material as the
 * chrome buttons and the minimised tab pill. Below iOS 26 it falls back to the
 * same near-opaque dark disc they do, which is still not a white ball.
 *
 * It floats clear of the tab bar and stays put when that bar minimises — which
 * is the whole reason it earns its place back. The bar shrinking away is what
 * leaves the screen with no way to compose.
 */
export function ComposeFab({ onPress, label = 'New post' }: {
  onPress: () => void;
  label?: string;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.host,
        /* Clear of the floating tab bar: its own inset plus its height. */
        { bottom: insets.bottom + 74, right: spacing.gutter },
      ]}
      pointerEvents="box-none"
    >
      <GlassIcon
        onPress={() => { haptics.tap(); onPress(); }}
        label={label}
        size={56}
      >
        <Ionicons name="add" size={30} color={c.text} />
      </GlassIcon>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    zIndex: 15,
    borderRadius: 28,
    /* A floating control needs to sit OFF the page, the way the tab bar does. */
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
});
