import { useCallback, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/theme/ThemeProvider';
import { Glass } from './Glass';
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
const BLUR_LAYERS = 4;
const BLUR_STEP = 16;

/** How far the dissolve reaches PAST the chrome, into the page. Without it the
 *  fade would have to be gone by the bottom of the bar — which is exactly where
 *  the controls sit, so they would be left standing on nothing. */
const FADE_TAIL = 30;

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
  /* Plus the tail: a conversation rests AGAINST the bottom, so without it the
     newest message would sit permanently half-dissolved. The dissolve should
     only be something you see while scrolling.
     `height` is handed back so the thread can scroll to the end AGAIN once the
     measurement lands — a list already sitting at the bottom does not re-scroll
     by itself when its padding grows, and the newest message ends up tucked
     under the composer by exactly the difference. */
  return { pad: { paddingBottom: h + FADE_TAIL } as ViewStyle, onLayout, height: h };
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
}

/**
 * The bar. Real Liquid Glass on iOS 26; the system chrome material below that
 * (the exact blur UIKit's own navigation bar uses, so it is indistinguishable);
 * a near-opaque fill everywhere else, since a blur nobody can render reads as a
 * smear rather than as glass.
 */
export function ChromeBar({ children, style, edge = 'top', onLayout, inset = true, retract }: Props) {
  const insets = useSafeAreaInsets();
  const { c, name } = useTheme();
  const top = edge === 'top';

  /* What slides is the bar's CONTENT — its own height less the safe-area strip
     — so a fully retracted bar still leaves that strip covering the clock. */
  const travel = useSharedValue(0);
  const slide = useAnimatedStyle(() => {
    if (!retract) return {};
    const d = travel.value * retract.value;
    return { transform: [{ translateY: top ? -d : d }] };
  });

  /* Held high across the whole bar so a control is legible over ANY content —
     a white photo included — and only then let go, over a short tail that
     reaches past the bar into the page. Two elements rather than one gradient
     because a single one has to place its stops as FRACTIONS, and the bars in
     this app run from 35pt to 190pt: the same fractions would leave a tall bar's
     controls sitting on almost nothing. */
  const blurs = Platform.OS === 'ios';
  const scrimTo = blurs ? SCRIM_BLURRED : SCRIM_FLAT;
  const scrim = [alpha(c.bg, blurs ? 0.9 : 0.97), alpha(c.bg, scrimTo), alpha(c.bg, scrimTo)] as const;
  const scrimStops = [0, 0.35, 1] as const;
  const tail = [alpha(c.bg, scrimTo), alpha(c.bg, 0)] as const;

  return (
    <Animated.View
      onLayout={(e) => {
        const h = e.nativeEvent.layout.height;
        travel.value = Math.max(0, h - (top ? insets.top : insets.bottom));
      }}
      style={[
        {
          position: 'absolute',
          left: 0,
          right: 0,
          zIndex: 20,
          ...(top ? { top: 0 } : { bottom: 0 }),
          ...(inset ? (top ? { paddingTop: insets.top } : { paddingBottom: insets.bottom }) : null),
        },
        style,
        slide,
      ]}
    >
      {/* The blur reaches past the bar too, so its own outer edge lands in the
          tail where the fade has already hidden it. */}
      {blurs && (
        <View
          style={{ position: 'absolute', left: 0, right: 0, ...(top ? { top: 0, bottom: -FADE_TAIL } : { bottom: 0, top: -FADE_TAIL }) }}
          pointerEvents="none"
        >
          {Array.from({ length: BLUR_LAYERS }, (_, i) => (
            <BlurView
              key={i}
              intensity={BLUR_STEP}
              tint={name === 'light' ? 'light' : 'dark'}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                ...(top ? { top: 0 } : { bottom: 0 }),
                height: `${100 - (i * 100) / BLUR_LAYERS}%`,
              }}
            />
          ))}
        </View>
      )}
      <LinearGradient
        colors={top ? scrim : ([...scrim].reverse() as unknown as typeof scrim)}
        locations={scrimStops}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <LinearGradient
        colors={top ? tail : ([...tail].reverse() as unknown as typeof tail)}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          height: FADE_TAIL,
          ...(top ? { top: '100%' } : { bottom: '100%' }),
        }}
        pointerEvents="none"
      />
      {onLayout ? <View onLayout={onLayout}>{children}</View> : children}
    </Animated.View>
  );
}

/**
 * A control that floats ON the chrome rather than sitting in a bar.
 *
 * Once the bar is gone there is nothing behind a bare glyph but the page's own
 * scrolling content, and a chevron over a photo is unreadable. So every chrome
 * control gets its own surface: Liquid Glass on iOS 26, a dark (or light)
 * tinted disc below that. It is the same material `BrandBar`'s ＋ · ⋯ · photo
 * already use, so the top of every screen reads as one family.
 *
 * TWO GRADES, which is Apple's own split and the thing these were missing.
 * Photos puts a quiet dark circle next to a lighter "Select" capsule; Voicemail
 * puts "Edit" beside a lighter "Greeting". The lighter one is `.glassProminent`
 * — the same material carrying a tint — and it marks the ONE action a screen is
 * actually for. Everything else is the quiet one. A screen with two prominent
 * buttons has none.
 */
export function ChromeButton({ children, onPress, label, size = 38, prominent, style }: {
  children: React.ReactNode;
  onPress: () => void;
  label: string;
  size?: number;
  prominent?: boolean;
  style?: ViewStyle;
}) {
  return (
    <ChromeSurface radius={size / 2} onPress={onPress} label={label} prominent={prominent}
      style={[{ width: size, height: size }, style]}>
      {children}
    </ChromeSurface>
  );
}

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

/** The same surface, any shape — a title pill, a segmented control, a disc. */
export function ChromeSurface({ children, onPress, label, radius, prominent, style }: {
  children: React.ReactNode;
  onPress?: () => void;
  label?: string;
  radius: number;
  /** Apple's `.glassProminent`: the lighter one, for the single action a screen
   *  is for. Never two on a screen. */
  prominent?: boolean;
  style?: ViewStyle | (ViewStyle | false | undefined)[];
}) {
  const { c, name } = useTheme();
  const light = name === 'light';
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
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
    >
      {body}
    </Pressable>
  );
}
