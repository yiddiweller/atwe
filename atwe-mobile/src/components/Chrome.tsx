import { useCallback, useState } from 'react';
import { Platform, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import { initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useTheme } from '@/theme/ThemeProvider';
import { SHELF_H } from './Shelf';

/**
 * Floating chrome — the bar the content slides UNDER.
 *
 * Every bar in this app used to be a solid row sitting ABOVE the scroll view,
 * so the screen read as three stacked blocks: a black slab, the content, a
 * black slab. A modern iOS app has one continuous surface with translucent
 * chrome floating over it — content passes beneath the bar and shows through
 * it blurred, which is the whole reason the bar reads as glass rather than as
 * paint. Messages, Mail and Photos all work this way, and on iOS 26 the
 * material is Liquid Glass.
 *
 * Two halves, and BOTH are needed or the effect is wrong:
 *   1. `ChromeBar` — the bar itself, absolutely positioned, carrying its own
 *      safe-area inset (the screen no longer insets for it).
 *   2. `chromePad` — the top padding the scrolling surface underneath needs,
 *      so its content STARTS below the bar and then travels under it.
 *
 * The pad is a plain constant rather than a hook so a list can reserve exactly
 * the right space on its first render — a measured height arrives a frame late
 * and the whole page visibly jumps. It is safe as a constant because the app is
 * portrait-locked (`app.json` `orientation: "portrait"`), so the top inset
 * never changes after launch.
 */

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
export const CHAT_HEAD_H = 44;     // a 34pt avatar row + 10 bottom padding
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
  /** An open conversation, DM or group. */
  chat: CHAT_HEAD_H,
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
 */
export function useFloatingChrome(estimate: number = PAGE_HEADER_H) {
  const [h, setH] = useState(TOP + estimate);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const n = Math.round(e.nativeEvent.layout.height);
    setH((cur) => (Math.abs(cur - n) > 0.5 ? n : cur));
  }, []);
  return { pad: { paddingTop: h } as ViewStyle, onLayout };
}

interface Props {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  /** Which edge it hugs. A composer or toolbar rides the bottom. */
  edge?: 'top' | 'bottom';
  /** Paired with `useFloatingChrome` when the bar's height isn't a constant. */
  onLayout?: (e: LayoutChangeEvent) => void;
}

/**
 * The bar. Real Liquid Glass on iOS 26; the system chrome material below that
 * (the exact blur UIKit's own navigation bar uses, so it is indistinguishable);
 * a near-opaque fill everywhere else, since a blur nobody can render reads as a
 * smear rather than as glass.
 */
export function ChromeBar({ children, style, edge = 'top', onLayout }: Props) {
  const insets = useSafeAreaInsets();
  const { name } = useTheme();
  const body = onLayout ? <View onLayout={onLayout}>{children}</View> : children;
  const box: ViewStyle = {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 20,
    ...(edge === 'top' ? { top: 0 } : { bottom: 0 }),
    ...(edge === 'top' ? { paddingTop: insets.top } : { paddingBottom: insets.bottom }),
  };

  if (isLiquidGlassAvailable()) {
    return (
      <GlassView glassEffectStyle="regular" style={[box, style]}>
        {body}
      </GlassView>
    );
  }
  if (Platform.OS === 'ios') {
    return (
      <BlurView
        intensity={72}
        tint={name === 'light' ? 'systemChromeMaterialLight' : 'systemChromeMaterialDark'}
        style={[box, style]}
      >
        {body}
      </BlurView>
    );
  }
  return (
    <View
      style={[
        box,
        { backgroundColor: name === 'light' ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.84)' },
        style,
      ]}
    >
      {body}
    </View>
  );
}
