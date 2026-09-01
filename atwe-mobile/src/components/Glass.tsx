import { View, Pressable, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useTheme } from '@/theme/ThemeProvider';

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

/**
 * A round-cornered pane of real glass, pressable — THE round icon button of
 * this app, and the shape the founder photographed: a translucent disc floating
 * over the content with a faint rim, the content visible through it.
 *
 * It lives here rather than in `Chrome.tsx` because a glass button is not
 * chrome. A story viewer's close, a composer's +, a quantity stepper and a
 * bar's back arrow are all the same object, and there must be exactly one
 * implementation of it — `ChromeSurface`/`ChromeButton` are now this.
 *
 * The fallback matters as much as the glass, because most phones in the wild
 * are not on iOS 26: a near-opaque dark disc with a 1px rim, which is what the
 * material collapses to when there is nothing to sample. Never a flat brand
 * fill — that is the thing that reads as "not Apple".
 */
export function GlassSurface({ children, onPress, label, radius, prominent, disabled, overContent, style }: {
  children: React.ReactNode;
  onPress?: () => void;
  label?: string;
  radius: number;
  /** Greys out and stops responding — a stepper mid-request, say. Without this
   *  a converted button silently loses the guard its Pressable used to carry,
   *  which is a double-tap firing the same change twice. */
  disabled?: boolean;
  /** The button sits on FULL-BLEED content — a story, a photo viewer — rather
   *  than on the app's own background. It then keeps the DARK material in both
   *  themes, because what is behind it is a photograph and not the page.
   *
   *  This is not a nicety. The fallback is picked by THEME, so a Light-theme
   *  phone drew a near-white disc, and the glyph on a photo has to be white —
   *  which is a white ✕ on a white disc, invisible. Caught in the story
   *  viewer; any new control over full-bleed media needs this. */
  overContent?: boolean;
  /** Apple's `.glassProminent`: the lighter one, for the single action a screen
   *  is for. Never two on a screen. */
  prominent?: boolean;
  style?: ViewStyle | (ViewStyle | false | undefined)[];
}) {
  const { c, name } = useTheme();
  /* Over a photograph the material is dark whatever the app's theme is. */
  const light = overContent ? false : name === 'light';
  const body = (
    <Glass
      radius={radius}
      prominent={prominent}
      /* Neutral, not the brand colour: in Apple's own bars the prominent pill is
         a lighter GLASS, and what tints it is whatever is scrolling behind. */
      tint={light ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.22)'}
      fallback={{
        backgroundColor: prominent
          ? (light ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.20)')
          : (light ? 'rgba(255,255,255,0.82)' : 'rgba(28,28,30,0.92)'),
        borderWidth: 1,
        borderColor: light ? c.border : 'rgba(255,255,255,0.06)',
      }}
      style={[{ alignItems: 'center', justifyContent: 'center' }, style]}
    >
      {children}
    </Glass>
  );
  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => ({ opacity: disabled ? 0.5 : pressed ? 0.7 : 1 })}
    >
      {body}
    </Pressable>
  );
}

/**
 * The same thing cut to a circle. `size` is the diameter and the radius is
 * derived from it, so a caller can never hand it a corner that does not close —
 * iOS clamps a radius to half the shorter side anyway, and a hand-typed 17 next
 * to a 34 is one edit away from an oval.
 *
 * On a FULL-BLEED surface (a story, a photo) pass `overContent`: the disc keeps
 * its glass but its icon is forced white, because the material there is
 * sampling a photograph and a theme-coloured glyph can land on anything.
 */
export function GlassIcon({ children, onPress, label, size = 38, prominent, disabled, overContent, style }: {
  children: React.ReactNode;
  onPress: () => void;
  label: string;
  size?: number;
  prominent?: boolean;
  disabled?: boolean;
  /** See `GlassSurface` — a control sitting on a story or a photo. */
  overContent?: boolean;
  style?: ViewStyle;
}) {
  return (
    <GlassSurface radius={size / 2} onPress={onPress} label={label} prominent={prominent}
      disabled={disabled} overContent={overContent} style={[{ width: size, height: size }, style]}>
      {children}
    </GlassSurface>
  );
}

export const glassStyles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject },
});
