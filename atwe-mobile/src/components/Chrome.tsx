import { useCallback, useState } from 'react';
import { Platform, StyleSheet, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { useTheme } from '@/theme/ThemeProvider';
import { GlassSurface, GlassIcon } from './Glass';
import { Text } from './Text';
import { SHELF_H } from './Shelf';

/**
 * The edge, not a bar.
 *
 * A bar — even a translucent one — still has an edge, and an edge is a line
 * across the screen that says "the app stops here". What a modern phone does
 * instead is DISSOLVE the content at the top and bottom of the screen: it goes
 * behind, blurs, darkens, and is gone, with no boundary anywhere. The controls
 * then float on top of that as their own rounded pieces.
 *
 * So `ChromeBar` draws no fill and no hairline. It draws two things:
 *
 *   1. **A progressive blur.** `BLUR_LAYERS` blur views stacked at the edge,
 *      each shorter than the last, so they overlap most at the very edge and
 *      taper to one thin layer at the inner boundary. Stacked blurs compound —
 *      each samples what is already drawn beneath it — which is how you get a
 *      blur that RAMPS without a native masked view (the only other way, and a
 *      new native dependency). iOS only: Android's blur is unreliable and the
 *      browser has none, so both fall through to the gradient alone.
 *   2. **A fade to the page colour**, opaque enough at the very edge that the
 *      status bar clock stays legible over anything, and gone by the inner
 *      boundary — which is exactly where the content underneath begins, so
 *      nothing is ever dimmed at rest.
 *
 * Two halves, and BOTH are needed or the effect is wrong:
 *   1. `ChromeBar` — the edge, absolutely positioned, carrying its own
 *      safe-area inset (the screen no longer insets for it).
 *   2. `chromePad` — the top padding the scrolling surface underneath needs,
 *      so its content STARTS below the chrome and then travels under it.
 *
 * The pad is a plain constant rather than a hook so a list can reserve exactly
 * the right space on its first render — a measured height arrives a frame late
 * and the whole page visibly jumps. It is safe as a constant because the app is
 * portrait-locked (`app.json` `orientation: "portrait"`), so the top inset
 * never changes after launch.
 */

/** How many blur layers make the ramp, and how much each one adds. More layers
 *  is a smoother ramp and more work per frame; four is where it stops reading
 *  as steps. */
/**
 * ONE material, with a crisp edge. There is no stack of blurs any more, and
 * that removal is the whole point of this pass.
 *
 * WHAT WAS WRONG. The bar used to draw four `BlurView`s at 100/75/50/25% of its
 * height to fake a progressive blur. Every one of them ends at a HARD
 * horizontal line, so stacking them put four different blur strengths in four
 * bands with three visible seams across the top and bottom of every screen —
 * plus a fourth boundary where a 30pt gradient tail ended below the bar. The
 * founder called it "not professional" and that is exactly right: it reads as a
 * dirty smear, not as glass.
 *
 * WHY NOT JUST ADD MORE LAYERS. Smaller steps would hide the banding and cost a
 * stacked blur per frame while the feed scrolls — the one thing this app has
 * already been burned by on iOS (see the memory notes on repeated per-item
 * blurs). And it would still be an imitation.
 *
 * WHAT APPLE ACTUALLY DOES. A nav bar has ONE material. Its scroll-edge effect
 * is either `.hard` — a crisp edge — or `.soft`, which is a genuinely smooth
 * native mask that no arrangement of views can reproduce. Since the smooth one
 * is out of reach, the honest choice is the other real one: a single uniform
 * material ending on a clean line.
 *
 * AND THAT MATERIAL IS THE STANDARD BLUR, NOT LIQUID GLASS. This bar did use
 * `GlassView`, and the founder photographed the result in a conversation: the
 * blue bubbles bloomed into a bright smeared haze above and below, "layers of
 * blurry and darkness". That is `UIGlassEffect` behaving correctly — it LENSES,
 * bending and brightening what is near its edges, which is wonderful on a 38pt
 * disc and wrong stretched 390pt across a field of saturated blue.
 *
 * It is also Apple's own division, not a retreat: iOS 26 puts Liquid Glass on
 * CONTROLS — buttons, the tab bar, floating pills — while Messages and Mail
 * back their nav bars with the plain material. So the bars are a uniform
 * `BlurView` and every BUTTON on them stays real glass.
 */
const BLUR_INTENSITY = 55;

/**
 * How much of the page colour sits behind a control.
 *
 * TWO VALUES, and the difference is the point. Where the blur runs, IT is what
 * makes a label legible over a white photo — the tint only has to take the edge
 * off, and a heavy one turns the glass back into the black band the whole thing
 * exists to remove. Where there is no blur at all (the browser, Android) the
 * tint is the only thing standing between a label and the photo behind it, so
 * it carries the whole job.
 */
const SCRIM_BLURRED = 0.42;
const SCRIM_FLAT = 0.86;

/** `#rrggbb` at an opacity. The fade has to be the page colour exactly, or the
 *  dissolve ends on a different black than the page it lands on. */
function alpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}


/**
 * Every bar's height BELOW its safe-area inset. Each is a fixed row of
 * fixed-size controls — the components pin their own heights — so these are
 * exact, not estimates, and a list can reserve the space on its first render.
 */
export const PAGE_HEADER_H = 48;   // a 40pt icon + 8 bottom padding
export const BRAND_BAR_H = 59;     // 11 top + a 36pt circle + 12 bottom
export const FEED_TABS_H = 43;     // a 33pt tab + 10 bottom padding
export const BEAM_TABS_H = 55;     // 12 bottom + a 10 gap + a 33pt tab
export const ENGINE_SEARCH_H = 50; // a 40pt field + 10 bottom padding
export const ALERTS_HEAD_H = 35;   // a 25pt title + 10 bottom padding
export const CHAT_HEAD_H = 48;     // a 38pt floating control + 10 bottom padding
export const GROUP_HEAD_H = 56;    // its pill carries a second line (the member count)
export const SEARCH_ROW_H = 52;    // a 42pt search field + a 10 gap under it

const TOP = initialWindowMetrics?.insets.top ?? 0;

/** What each kind of bar occupies, measured from the very top of the screen. */
const BARS = {
  /** A `PageHeader` on its own. */
  header: PAGE_HEADER_H,
  /** A `PageHeader` carrying a filter shelf. */
  headerShelf: PAGE_HEADER_H + SHELF_H,
  /** A `PageHeader` carrying a search field. */
  headerSearch: PAGE_HEADER_H + SEARCH_ROW_H,
  /** A bare `BrandBar`. */
  brand: BRAND_BAR_H,
  /** Home: the brand row over the four feed tabs. */
  home: BRAND_BAR_H + FEED_TABS_H,
  /** Beam: the brand row over All · Chats · Calls · Contacts. */
  beam: BRAND_BAR_H + BEAM_TABS_H,
  /** Engine: the brand row over the search field. */
  engine: BRAND_BAR_H + ENGINE_SEARCH_H,
  /** Alerts: its own title row. */
  alerts: ALERTS_HEAD_H,
  /** An open 1:1 conversation. */
  chat: CHAT_HEAD_H,
  /** An open group — its pill is a line taller. */
  group: GROUP_HEAD_H,
};

type Bar = keyof typeof BARS;

/** The distance from the top of the screen to the bottom of each bar. */
export const chromeTop = {
  inset: TOP,
  ...(Object.fromEntries(
    Object.entries(BARS).map(([k, v]) => [k, TOP + v]),
  ) as Record<Bar, number>),
};

/** Ready-made top padding for the surface that scrolls under each bar. */
export const chromePad = Object.fromEntries(
  Object.entries(BARS).map(([k, v]) => [k, { paddingTop: TOP + v }]),
) as Record<Bar, ViewStyle>;

/**
 * For a screen whose bar is bespoke rather than one of the shapes above — most
 * of the inside pages have their own back-arrow-and-title row, and they are not
 * all the same height. The bar measures itself and hands the surface underneath
 * the padding it needs; `estimate` is what the first frame uses, so a right
 * guess means nothing moves at all.
 *
 * What is measured is the bar's CONTENT, not the bar — the safe-area inset is
 * added here. `ChromeBar` puts `onLayout` on a plain wrapper INSIDE its own
 * padding for exactly that reason: measuring the bar would mean trusting a
 * native blur wrapper to forward the prop, and one that quietly drops it leaves
 * every bespoke page hidden behind its own header.
 */
export function useFloatingChrome(estimate: number = PAGE_HEADER_H) {
  const [h, setH] = useState(estimate);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const n = Math.round(e.nativeEvent.layout.height);
    setH((cur) => (Math.abs(cur - n) > 0.5 ? n : cur));
  }, []);
  return { pad: { paddingTop: TOP + h } as ViewStyle, onLayout };
}

/**
 * The same idea at the bottom, for a composer. It measures the WHOLE foot —
 * safe-area inset included, because a composer carries its own — and hands back
 * the bottom padding the conversation needs, so the last message clears the
 * pill and everything above it travels underneath.
 */
export function useFloatingFoot(estimate: number) {
  const [h, setH] = useState(estimate);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const n = Math.round(e.nativeEvent.layout.height);
    setH((cur) => (Math.abs(cur - n) > 0.5 ? n : cur));
  }, []);
  /* The bar's own height and nothing more — there is no tail to clear now that
     the material ends on a clean line.
     `height` is handed back so the thread can scroll to the end AGAIN once the
     measurement lands — a list already sitting at the bottom does not re-scroll
     by itself when its padding grows, and the newest message ends up tucked
     under the composer by exactly the difference. */
  return { pad: { paddingBottom: h } as ViewStyle, onLayout, height: h };
}

interface Props {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  /** Which edge it hugs. A composer or toolbar rides the bottom. */
  edge?: 'top' | 'bottom';
  /** Paired with `useFloatingChrome` when the bar's height isn't a constant. */
  onLayout?: (e: LayoutChangeEvent) => void;
  /** Off when the CONTENT already carries the safe-area inset itself — the chat
   *  composer does, and adding a second one lifts it off the bottom. */
  inset?: boolean;
  /** From `useChromeRetract()`. The bar slides out of the way as the page
   *  scrolls down, and comes back on the way up. */
  retract?: SharedValue<number>;
  /** Bottom bars only: how far the keyboard has pushed it up. */
  lift?: number;
}

/**
 * The bar. Real Liquid Glass on iOS 26; the system chrome material below that
 * (the exact blur UIKit's own navigation bar uses, so it is indistinguishable);
 * a near-opaque fill everywhere else, since a blur nobody can render reads as a
 * smear rather than as glass.
 */
export function ChromeBar({ children, style, edge = 'top', onLayout, inset = true, retract, lift = 0 }: Props) {
  const insets = useSafeAreaInsets();
  const { c, name } = useTheme();
  const top = edge === 'top';

  /* The bar retracts by its FULL height and leaves the screen.
     It used to stop short — height LESS the safe-area inset — believing the
     leftover box would keep covering the clock. The box did; its CONTENTS did
     not, since they sit after `paddingTop: inset` and ride up with everything
     else. Measured on Home: a 98pt bar with a 59pt inset put the tab row at
     y=20..59 against a status bar at 0..59, and the founder photographed "For
     You" printed across the time. `StatusScrim` covers the clock now, so this
     has no reason to stop short. */
  const travel = useSharedValue(0);
  const slide = useAnimatedStyle(() => {
    if (!retract) return {};
    const d = travel.value * retract.value;
    return { transform: [{ translateY: top ? -d : d }] };
  });

  /* A FLAT tint, not a gradient. A gradient across the bar is what made the old
     one read as a smear; the material is uniform, so the tint over it has to be
     uniform too. How much of it there is depends on what is underneath doing
     the legibility work — see the three constants. */
  const blurs = Platform.OS === 'ios';
  const tint = alpha(c.bg, blurs ? SCRIM_BLURRED : SCRIM_FLAT);

  return (
    <Animated.View
      onLayout={(e) => {
        const h = e.nativeEvent.layout.height;
        travel.value = h;
      }}
      style={[
        {
          position: 'absolute',
          left: 0,
          right: 0,
          zIndex: 20,
          ...(top ? { top: 0 } : { bottom: lift }),
          ...(inset ? (top ? { paddingTop: insets.top } : { paddingBottom: insets.bottom }) : null),
        },
        style,
        slide,
      ]}
    >
      {/* ONE uniform blur, filling the bar exactly — the STANDARD material, not
          Liquid Glass. See the note on BLUR_INTENSITY for why. */}
      {blurs ? (
        <BlurView
          intensity={BLUR_INTENSITY}
          tint={name === 'light' ? 'light' : 'dark'}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      ) : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: tint }]} pointerEvents="none" />
      {onLayout ? <View onLayout={onLayout}>{children}</View> : children}
    </Animated.View>
  );
}
/**
 * A bar's own surfaces and buttons ARE the app's glass surfaces — the same
 * object, cut to the same shapes. They keep these names because someone
 * reading a chrome bar is thinking about chrome, but there is exactly ONE
 * implementation of each and it lives in `Glass.tsx`.
 *
 * Do not re-implement either here. Two copies of a glass disc is how a back
 * arrow ends up a visibly different button from a composer's +.
 */
export const ChromeSurface = GlassSurface;
export const ChromeButton = GlassIcon;

/**
 * The same control with a WORD in it. Apple names a chrome action wherever the
 * word is shorter than the explanation an icon would need — Select, Edit,
 * Greeting, Cancel, Post — and it becomes a capsule sized to its own label
 * rather than a glyph squeezed into a circle.
 */
export function ChromePill({ text, onPress, prominent, disabled, style }: {
  text: string;
  onPress: () => void;
  prominent?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const { c } = useTheme();
  return (
    <ChromeSurface
      radius={19}
      onPress={disabled ? undefined : onPress}
      label={text}
      prominent={prominent}
      style={[{ height: 38, paddingHorizontal: 18 }, disabled ? { opacity: 0.45 } : undefined, style]}
    >
      <Text variant="callout" weight="700" style={{ fontSize: 16, color: c.text }} numberOfLines={1}>
        {text}
      </Text>
    </ChromeSurface>
  );
}
