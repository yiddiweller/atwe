import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * A strip behind the clock, battery and signal. Always there, never moves.
 *
 * WHY IT EXISTS. A chrome bar retracts by sliding up, and it used to stop
 * short — travelling its own height LESS the safe-area inset — on the reasoning
 * that the leftover box would go on covering the status bar. The box did. Its
 * CONTENTS did not: they are laid out after `paddingTop: inset`, so they ride
 * up with everything else. On a 98pt bar with a 59pt inset the tab row landed
 * at y=20..59 against a status bar occupying 0..59 — a 39pt overlap, and the
 * founder photographed "For You" printed straight across 5:48, with the story
 * tray showing through the blur underneath. That is the "layers".
 *
 * So the bar now retracts by its FULL height and leaves entirely, and this
 * covers the clock instead. It is the same answer the web reached — see
 * `#statusScrim` in CLAUDE.md, which is a direct `<body>` child for exactly the
 * same reason this is a root-level sibling of the navigator: a per-screen strip
 * would slide away with the screen it belongs to.
 *
 * It is blurred rather than opaque so content passing beneath reads as passing
 * beneath, not as hitting a lid — and tinted enough that a white photo can
 * never take the clock with it.
 */
export function StatusScrim() {
  const insets = useSafeAreaInsets();
  const { c, name } = useTheme();
  if (!insets.top) return null;
  return (
    <View style={[styles.host, { height: insets.top }]} pointerEvents="none">
      {Platform.OS === 'ios' && (
        <BlurView
          intensity={55}
          tint={name === 'light' ? 'light' : 'dark'}
          style={StyleSheet.absoluteFill}
        />
      )}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: c.bg, opacity: 0.55 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  /* Above every screen's own chrome (zIndex 20) so a retracting bar passes
     UNDER it, and below the overlays, which own the whole screen when open. */
  host: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30 },
});
