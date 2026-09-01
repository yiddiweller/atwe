import { View, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';

/**
 * A surface made of Apple's real Liquid Glass, with an honest fallback.
 *
 * WHY THIS IS DIFFERENT FROM THE TAB BAR, which had to be handed to the system
 * outright. A tab bar is a COMPONENT — the system draws it with behaviours no
 * view can imitate (a tint derived from the content, its own scroll-edge state,
 * its own morph). A button is a SURFACE, and Liquid Glass on a surface is a
 * material: `GlassView` is `UIGlassEffect`, the same thing SwiftUI's
 * `.glassEffect()` applies. So here the material really is ours to use, and
 * using it is not an imitation.
 *
 * The rules, from Apple's own two button styles:
 *
 *   `.glass`          — secondary. Translucent, see-through, NO tint.
 *   `.glassProminent` — primary. The same material carrying a tint, which is
 *                       what makes it read as the loud one.
 *
 * TINT IS FOR PROMINENCE, NEVER FOR COLOUR. That is the lesson the nav bar
 * taught three times over: a tint heavy enough to become the surface's colour
 * has replaced the material with paint, and it stops being glass. A secondary
 * surface gets none at all.
 *
 * `isInteractive` is not optional. It is what makes the glass bend and catch
 * the light UNDER THE FINGER, and it is off by default — without it the surface
 * is a static pane, which is most of what "it doesn't look like Apple's" means.
 */
export function Glass({
  prominent, tint, radius, style, children, fallback, plain,
}: {
  /** Apple's `.glassProminent` — the one loud action. */
  prominent?: boolean;
  /** Only meaningful when prominent. The brand colour the emphasis is made of. */
  tint?: string;
  /** The shape the glass is cut to. A capsule wants half its own height. */
  radius: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  /** What to paint on iOS 25 and below, where there is no glass to use. */
  fallback: ViewStyle;
  /** Force the fallback even where glass IS available — for a surface that must
   *  not be see-through at all. A destructive button is the case: it has to be
   *  unmistakable, and translucency is the opposite of that. */
  plain?: boolean;
}) {
  if (plain || !isLiquidGlassAvailable()) {
    return <View style={[{ borderRadius: radius }, fallback, style]}>{children}</View>;
  }
  return (
    <GlassView
      glassEffectStyle="regular"
      isInteractive
      /* Prominent carries the tint; plain glass carries nothing, so what shows
         through is the content behind it rather than our own fill. */
      {...(prominent && tint ? { tintColor: tint } : null)}
      style={[{ borderRadius: radius, overflow: 'hidden' }, style]}
    >
      {children}
    </GlassView>
  );
}

/** True when the phone can actually draw it — so a caller can pick a label
 *  colour, or skip an effect that only makes sense on the fallback. */
export const hasGlass = isLiquidGlassAvailable;

export const glassStyles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject },
});
