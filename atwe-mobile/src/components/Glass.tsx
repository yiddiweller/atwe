import { View, Pressable, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import { GlassView } from 'expo-glass-effect';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Apple's real Liquid Glass. There is no imitation of it in this app.
 *
 * THE FALLBACK IS GONE, AND THAT IS THE POINT. `Glass` used to paint a
 * hand-made translucent disc whenever `isLiquidGlassAvailable()` was false, so
 * on any phone below iOS 26 the whole app quietly wore a lookalike — and there
 * was nothing on screen to say which one you were looking at. The founder:
 * *"I don't need a fake version of liquid glass and I'm fine with only one
 * design. I want everything to be real."*
 *
 * So the app now REQUIRES iOS 26 (`deploymentTarget: 26.0` in `app.json`), the
 * fallback is deleted, and `GlassView` — `UIGlassEffect`, the same thing
 * SwiftUI's `.glassEffect()` applies — is the only thing here.
 *
 * **The trade:** the App Store will not offer the app to anyone below iOS 26.
 * That is a real cost at launch and it is the founder's decision, taken twice
 * and in plain words. Do not quietly reinstate a fallback to widen reach; raise
 * it with them instead.
 *
 * The rules, from Apple's own two button styles:
 *
 *   `.glass`          — secondary. Translucent, see-through, NO tint.
 *   `.glassProminent` — primary. The same material carrying a tint, which is
 *                       what makes it read as the loud one.
 *
 * TINT IS FOR PROMINENCE, NEVER FOR COLOUR. A tint heavy enough to become the
 * surface's colour has replaced the material with paint, and it stops being
 * glass. A secondary surface gets none at all.
 *
 * `isInteractive` is not optional. It is what makes the glass bend and catch
 * the light UNDER THE FINGER, and it is off by default — without it the surface
 * is a static pane, which is most of what "it doesn't look like Apple's" means.
 *
 * NOT EVERY SURFACE IN THE APP IS GLASS, and that is not a fallback either.
 * A full-bleed bar uses the plain system material (`BlurView` = a real
 * `UIVisualEffectView`, what Messages and Mail put behind a nav bar) because
 * Liquid Glass LENSES and blooms at that width; a drawer is a solid panel. Both
 * are Apple's own division: glass on CONTROLS, plain material behind a PANEL.
 */
export function Glass({
  prominent, tint, radius, style, children, plain, fill, scheme,
}: {
  /** Apple's `.glassProminent` — the one loud action. */
  prominent?: boolean;
  /** Only meaningful when prominent. The brand colour the emphasis is made of. */
  tint?: string;
  /** The shape the glass is cut to. A capsule wants half its own height. */
  radius: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  /** Render a SOLID fill instead of glass — a deliberate design choice, not a
   *  fallback. A destructive button has to be unmistakable and translucency is
   *  the opposite of that; a chosen filter chip's fill IS the answer to "which
   *  one am I on", and a see-through selected state cannot say it. */
  plain?: boolean;
  /** What `plain` paints. */
  fill?: ViewStyle;
  /** Which appearance the material takes. Left unset the glass follows the
   *  PHONE, which is wrong here: Atwe carries its own theme, so a Black app on
   *  a phone in Light mode would wear bright glass on every button. Callers
   *  pass the app's own theme — or force `dark` for a control sitting on a
   *  photograph, which is what Apple's own full-screen viewers do. */
  scheme?: 'light' | 'dark';
}) {
  if (plain) {
    return <View style={[{ borderRadius: radius }, fill, style]}>{children}</View>;
  }
  return (
    <GlassView
      glassEffectStyle="regular"
      isInteractive
      /* Prominent carries the tint; plain glass carries nothing, so what shows
         through is the content behind it rather than our own fill. */
      {...(prominent && tint ? { tintColor: tint } : null)}
      {...(scheme ? { colorScheme: scheme } : null)}
      style={[{ borderRadius: radius, overflow: 'hidden' }, style]}
    >
      {children}
    </GlassView>
  );
}

/**
 * A round-cornered pane of real glass, pressable — THE round icon button of
 * this app: a translucent disc floating over the content with the content
 * visible through it.
 *
 * It lives here rather than in `Chrome.tsx` because a glass button is not
 * chrome. A story viewer's close, a composer's +, a quantity stepper and a
 * bar's back arrow are all the same object, and there must be exactly one
 * implementation of it — `ChromeSurface`/`ChromeButton` are now this.
 */
export function GlassSurface({
  children, onPress, label, radius, prominent, disabled, overContent, style,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  label?: string;
  radius: number;
  /** Greys out and stops responding — a stepper mid-request, say. Without this
   *  a converted button silently loses the guard its Pressable used to carry,
   *  which is a double-tap firing the same change twice. */
  disabled?: boolean;
  /** This disc sits on a PHOTOGRAPH, not on the app's own background — a story's
   *  close, a composer's remove-photo. Its glyph has to be white whatever is
   *  underneath, so the material is forced DARK regardless of the app's theme,
   *  the way Apple's own full-screen photo controls are. Without it a white ✕
   *  can land on bright glass over a bright photo and disappear. Any new
   *  control over full-bleed media needs this. */
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
      scheme={light ? 'light' : 'dark'}
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
 * its real glass but the material is forced dark, because it is sampling a
 * photograph and the glyph on it has to be white.
 */
export function GlassIcon({
  children, onPress, label, size = 38, prominent, disabled, overContent, raised, style,
}: {
  children: React.ReactNode;
  onPress: () => void;
  label: string;
  size?: number;
  prominent?: boolean;
  disabled?: boolean;
  /** See `GlassSurface` — a control sitting on a story or a photo. */
  overContent?: boolean;
  /** Off for a disc that sits INSIDE something (a stepper in a card). */
  raised?: boolean;
  style?: ViewStyle;
}) {
  /* DEPTH IS PART OF THE MATERIAL, not decoration. Apple's floating glass
     controls cast a soft shadow — that is what separates a lens hovering over
     the page from a circle painted on it. The shadow goes on the OUTER view:
     the glass clips its own contents, so one declared on it is cut off at its
     own edge. */
  const disc = (
    <GlassSurface radius={size / 2} onPress={onPress} label={label} prominent={prominent}
      disabled={disabled} overContent={overContent} style={[{ width: size, height: size }, style]}>
      {children}
    </GlassSurface>
  );
  if (raised === false) return disc;
  return <View style={[glassStyles.lift, { borderRadius: size / 2 }]}>{disc}</View>;
}

export const glassStyles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject },
  /* Soft and low — a control resting just above the page, not a card thrown
     onto it. Deliberately quieter than the menu's own shadow. */
  lift: {
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
});
