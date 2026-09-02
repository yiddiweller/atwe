import { useEffect } from 'react';
import { Dimensions, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withSpring, Easing,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { Glass } from './Glass';
import { useTheme } from '@/theme/ThemeProvider';
import { radius } from '@/theme/tokens';
import { haptics } from '@/lib/haptics';

/**
 * The menu that opens from a chrome button.
 *
 * A ＋ or a ⋯ that navigates straight somewhere is not a ⋯ — the three dots
 * PROMISE a list of things. This is that list, drawn the way iOS 26 draws a
 * context menu: a card of Apple's real Liquid Glass that GROWS OUT OF the
 * button it belongs to.
 *
 * IT IS NOT IN A MODAL, AND THAT IS THE WHOLE REASON IT LOOKS REAL. It used to
 * be, and the founder said the glass "looks fake". They were right: a React
 * Native `Modal` presents its own view controller, so a `GlassView` inside one
 * has nothing of the app behind it to sample and collapses to a flat, dull
 * pane. Apple's own context menus are not modals either — they are overlays in
 * the same window, which is exactly what this is now. Rendering in-tree is what
 * lets the material pick up the feed scrolling underneath it.
 *
 * `origin` is the host's own position in window coordinates, so the overlay can
 * cancel it and lay everything out in WINDOW space — the same space
 * `measureInWindow` reports the anchor in. Without it the card would be placed
 * relative to a bar that is itself inset by the notch and the gutter.
 *
 * The card's right edge lines up with the BUTTON's right edge, not the screen's,
 * so it unfolds from under the finger. Pinning it to the gutter is what made it
 * appear to come from the corner rather than from the profile picture.
 *
 * Label left, icon right — Apple's own order, and the same one the web's glide
 * menu uses, so the two products agree.
 */
export interface GlassMenuItem {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  /** Red, and always last. */
  destructive?: boolean;
}

export function GlassMenu({ visible, onClose, anchor, origin, items }: {
  visible: boolean;
  onClose: () => void;
  /** The button's rect in WINDOW coordinates: `measureInWindow`. */
  anchor: { x: number; y: number; width: number; height: number } | null;
  /** The host's own window position, so the overlay can lay out in window space. */
  origin: { x: number; y: number } | null;
  items: GlassMenuItem[];
}) {
  const { c, name } = useTheme();
  const grow = useSharedValue(0);

  useEffect(() => {
    grow.value = visible
      ? withSpring(1, { damping: 18, stiffness: 260, mass: 0.6 })
      : withTiming(0, { duration: 120, easing: Easing.out(Easing.quad) });
  }, [visible, grow]);

  const card = useAnimatedStyle(() => ({
    opacity: grow.value,
    transform: [
      { scale: 0.86 + grow.value * 0.14 },
      // Nudge it back toward the anchor while small, so it unfolds FROM there.
      { translateY: (1 - grow.value) * -10 },
    ],
  }));

  if (!visible || !anchor || !origin) return null;
  const win = Dimensions.get('window');

  /* Everything below is in window space: the overlay cancels the host's own
     offset, so `anchor` can be used exactly as measured. */
  const field: ViewStyle = {
    position: 'absolute',
    left: -origin.x,
    top: -origin.y,
    width: win.width,
    height: win.height,
    zIndex: 40,
  };
  const pos: ViewStyle = {
    position: 'absolute',
    top: anchor.y + anchor.height + 8,
    /* The card's right edge on the button's right edge — iOS's own alignment. */
    right: Math.max(10, win.width - (anchor.x + anchor.width)),
  };

  return (
    <View style={field}>
      {/* Catches the tap that dismisses. It darkens NOTHING: an iOS context
          menu dims nothing behind it — the glass and the shadow are what
          separate it, and a scrim would make it read as a dialog. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close menu" />
      <Animated.View style={[pos, card, { transformOrigin: 'top right' }]}>
        <Glass
          radius={radius.xl}
          fill={{
            backgroundColor: name === 'light' ? 'rgba(250,250,252,0.96)' : 'rgba(30,30,32,0.96)',
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: name === 'light' ? c.border : 'rgba(255,255,255,0.08)',
          }}
          style={styles.card}
        >
          {items.map((it, i) => (
            <Pressable
              key={it.label}
              onPress={() => { haptics.tap(); onClose(); setTimeout(it.onPress, 90); }}
              accessibilityRole="button"
              accessibilityLabel={it.label}
              style={({ pressed }) => [
                styles.row,
                i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
                pressed && { backgroundColor: name === 'light' ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.10)' },
              ]}
            >
              <Text
                variant="body"
                weight="600"
                style={{ color: it.destructive ? c.danger : c.text, flex: 1 }}
                numberOfLines={1}
              >
                {it.label}
              </Text>
              <Ionicons name={it.icon} size={19} color={it.destructive ? c.danger : c.text} />
            </Pressable>
          ))}
        </Glass>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    minWidth: 208,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.34,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    minHeight: 46,
  },
});
