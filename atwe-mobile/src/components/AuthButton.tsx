import { useState } from 'react';
import { Pressable, View, StyleSheet, type ViewStyle, type GestureResponderEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, Easing } from 'react-native-reanimated';
import { haptics } from '@/lib/haptics';
import { Text } from './Text';
import { useTheme } from '@/theme/ThemeProvider';

/** The web's own press-hold curve — the same one the bottom nav uses. */
const HOLD_EASE = Easing.bezier(0.4, 0.02, 0.28, 1);

/**
 * The sign-in button, matched to the web's `.auth-btn` exactly: 56 tall, a 30
 * corner, an icon and a label centred together with an 11 gap, 16px at weight
 * 700.
 *
 * Two kinds, and the difference is the colour law, not decoration. The ONE
 * primary action per screen is a solid WHITE pill with a dark label
 * (`--primary` / `--on-primary`); everything beside it is grey glass — a
 * translucent fill with a half-pixel inset hairline, never an outline-only
 * button, which rule 3 forbids.
 *
 * PRESSING IT DOES TWO THINGS, both of which the web does and neither of which
 * this had:
 *
 *  1. It GROWS (`scale 1.04`, the web's `.auth-hold`) on the same slow curve as
 *     the bottom nav, and eases back on release. A hold that never becomes a tap
 *     still eases back — the grow is feedback, not a commitment.
 *  2. It LIGHTS UP AT THE FINGER — the web's `.tap-lit` radial wash, white at
 *     the centre falling through a blue tint to nothing. There is no radial
 *     gradient in React Native, so it is three concentric circles at the touch
 *     point: white, then the blue, then the fade. Clipped to the pill.
 */
export function AuthButton({ label, icon, primary, onPress, disabled, style }: {
  label: string;
  icon?: React.ReactNode;
  primary?: boolean;
  onPress: () => void;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const { c, name } = useTheme();
  // The grey-glass fill is a translucent WHITE on the dark theme and a
  // translucent BLACK on the light one — the same fill the web uses, read from
  // the theme rather than sniffed from a colour value.
  const glass = name === 'light' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)';

  const scale = useSharedValue(1);
  const lit = useSharedValue(0);
  const [touch, setTouch] = useState<{ x: number; y: number } | null>(null);

  const grow = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const glow = useAnimatedStyle(() => ({ opacity: lit.value }));

  const down = (e: GestureResponderEvent) => {
    if (disabled) return;
    haptics.tap();
    setTouch({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY });
    scale.value = withTiming(1.04, { duration: 420, easing: HOLD_EASE });
    lit.value = withTiming(0.85, { duration: 120 });
  };
  const up = () => {
    scale.value = withTiming(1, { duration: 420, easing: HOLD_EASE });
    lit.value = withTiming(0, { duration: 350 });
  };

  return (
    <Animated.View style={[grow, style]}>
      <Pressable
        // Down, not up — see Button. The sign-in screen is the first thing anyone
        // touches, so it is the first thing that has to feel like a real button.
        onPressIn={down}
        onPressOut={up}
        onPress={() => { if (!disabled) onPress(); }}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !!disabled }}
        style={({ pressed }) => [
          styles.btn,
          primary
            ? { backgroundColor: c.primary }
            : { backgroundColor: glass,
                borderWidth: StyleSheet.hairlineWidth, borderColor: c.border },
          disabled && { opacity: 0.4 },
          pressed && !disabled && { opacity: 0.94 },
        ]}
      >
        {/* The wash, under the label so it never dims the text. */}
        {!!touch && !disabled && (
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, glow]}>
            <View style={[styles.ring, {
              left: touch.x - 90, top: touch.y - 90, width: 180, height: 180, borderRadius: 90,
              backgroundColor: 'rgba(120,160,255,0.06)',
            }]} />
            <View style={[styles.ring, {
              left: touch.x - 58, top: touch.y - 58, width: 116, height: 116, borderRadius: 58,
              backgroundColor: 'rgba(120,160,255,0.13)',
            }]} />
            <View style={[styles.ring, {
              left: touch.x - 32, top: touch.y - 32, width: 64, height: 64, borderRadius: 32,
              backgroundColor: 'rgba(255,255,255,0.20)',
            }]} />
          </Animated.View>
        )}
        {!!icon && <View style={styles.ic}>{icon}</View>}
        <Text style={[styles.label, { color: primary ? c.onPrimary : c.text }]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

/** The @ / envelope / brand glyphs, at the web's 22px icon size. */
export function AuthIcon({ name, color }: {
  name: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
}) {
  return <Ionicons name={name} size={22} color={color} />;
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 11, height: 56, borderRadius: 30,
    /* Clips the wash to the pill — without it the circles spill past the
       corners and the button reads as a square of light. */
    overflow: 'hidden',
  },
  ring: { position: 'absolute' },
  ic: { alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 16, fontWeight: '700' },
});
