/**
 * Atwe design tokens — ported 1:1 from the web app's CSS custom properties so
 * the native app is unmistakably Atwe. Components must reference these tokens
 * only (never hardcode a hex), exactly like the web rule "components reference
 * variables only; each theme sets the values".
 *
 * Design law (from the web blueprint): "white acts, blue identifies."
 *   - `primary`  = the ONE white call-to-action per screen (label = onPrimary)
 *   - `accent`   = identity only (links, active tab, selected/toggle-on,
 *                  verified/AI). Never a generic button fill.
 */

export type ThemeName = 'black' | 'light';

export interface Palette {
  // surfaces
  bg: string;          // page background            (web --bg)
  s1: string;          // raised surface / sheet     (web --s1)
  s2: string;          // input / chip fill          (web --s2)
  // text
  text: string;        // primary text               (web --text)
  t2: string;          // secondary                  (web --t2)
  t3: string;          // tertiary / meta            (web --t3)
  t4: string;          // faint icon tint            (web --t4)
  // lines
  border: string;      // hairline divider           (web --b2)
  // identity (blue) — links, active tab, selected, AI, OTW ring
  accent: string;      // web --accent
  accentDim: string;   // soft accent disc/tint      (web --accent-dim)
  accentTint: string;  // readable text on solid accent
  // white-primary CTA
  primary: string;     // the single white action    (web --primary)
  onPrimary: string;   // label on the white action  (web --on-primary)
  // semantics
  verify: string;      // neutral verified seal (NOT blue) (web --verify)
  like: string;        // rose
  repost: string;      // green
  danger: string;      // destructive red
  success: string;
  warning: string;
  // system
  statusBar: 'light' | 'dark';
}

// Black — the default "Lights out" theme (:root on web).
export const black: Palette = {
  bg: '#07080A',
  s1: '#121417',
  s2: '#1C1F24',
  text: '#E7E9EA',
  t2: '#AEB4BC',
  t3: '#71767B',
  t4: '#5A5F66',
  border: '#242830',
  accent: '#1D9BF0',
  accentDim: 'rgba(29,155,240,0.14)',
  accentTint: '#FFFFFF',
  primary: '#FFFFFF',
  onPrimary: '#1D1D1F',
  verify: '#D3D5D7',
  like: '#F91880',
  repost: '#00BA7C',
  danger: '#F4212E',
  success: '#00BA7C',
  warning: '#D9A406',
  statusBar: 'light',
};

// Light — X.com-style white with hairline dividers (body.light on web).
export const light: Palette = {
  bg: '#FFFFFF',
  s1: '#FFFFFF',
  s2: '#F1F3F5',
  text: '#0F1419',
  t2: '#536471',
  t3: '#66757F',
  t4: '#8B98A5',
  border: '#EFF3F4',
  accent: '#1D9BF0',
  accentDim: 'rgba(29,155,240,0.12)',
  accentTint: '#FFFFFF',
  primary: '#111114',
  onPrimary: '#FFFFFF',
  verify: '#5B7083',
  like: '#F91880',
  repost: '#00BA7C',
  danger: '#F4212E',
  success: '#009E6D',
  warning: '#B8860B',
  statusBar: 'dark',
};

export const palettes: Record<ThemeName, Palette> = { black, light };

/** 4-pt spacing scale. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  gutter: 16, // web --feed-gutter equivalent for phone
} as const;

/** Corner radii — mirrors the web --r-* tokens. */
export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 26,
  pill: 999,
} as const;

/** Type scale — pairs with iOS Dynamic Type; sizes are the base (unscaled) rung. */
export const type = {
  display: { fontSize: 28, fontWeight: '800' as const, lineHeight: 34 },
  title: { fontSize: 20, fontWeight: '800' as const, lineHeight: 25 },
  headline: { fontSize: 17, fontWeight: '700' as const, lineHeight: 22 },
  body: { fontSize: 15, fontWeight: '400' as const, lineHeight: 21 },
  callout: { fontSize: 14, fontWeight: '600' as const, lineHeight: 19 },
  caption: { fontSize: 13, fontWeight: '400' as const, lineHeight: 17 },
  micro: { fontSize: 11, fontWeight: '600' as const, lineHeight: 14 },
} as const;

export const timing = {
  fast: 160,
  base: 220,
  slow: 320,
} as const;
