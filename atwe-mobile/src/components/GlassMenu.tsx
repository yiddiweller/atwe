import { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
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
 * PROMISE a list of things, and on the phone they were silently a shortcut to
 * one of them. This is that list, drawn the way iOS 26 draws a context menu:
 * a card of Apple's real Liquid Glass that GROWS OUT OF the button it belongs
 * to, rather than a sheet sliding up from the bottom of the screen.
 *
 * Growing from the button is the part that makes it read as native. The card's
 * transform origin is the corner nearest the anchor, so it appears to unfold
 * from under the finger; a card that scales from its own middle reads as a
 * dialog. `anchor` is the button's own on-screen rect, measured by the caller.
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

export function GlassMenu({ visible, onClose, anchor, items, align = 'right' }: {
  visible: boolean;
  onClose: () => void;
  /** The button's rect on screen: `measureInWindow`. */
  anchor: { x: number; y: number; width: number; height: number } | null;
  items: GlassMenuItem[];
  /** Which edge of the card lines up with the button. */
  align?: 'left' | 'right';
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

  if (!anchor) return null;
  const right = align === 'right';
  const pos: ViewStyle = {
    position: 'absolute',
    top: anchor.y + anchor.height + 8,
    ...(right ? { right: 0 } : { left: anchor.x }),
    // The scrim is inset by the gutter, so a right-aligned card lands under the
    // button rather than off the edge of the screen.
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close menu">
        <View style={styles.field} pointerEvents="box-none">
          <Animated.View style={[pos, card, { transformOrigin: right ? 'top right' : 'top left' }]}>
            <Glass
              radius={radius.xl}
              fallback={{
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
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  /* No dim. An iOS context menu darkens NOTHING behind it — the glass and the
     shadow are what separate it, and a scrim would make it read as a dialog. */
  scrim: { flex: 1 },
  field: { flex: 1, marginHorizontal: 14 },
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
