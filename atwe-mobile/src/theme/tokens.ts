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
  /** The fill of a post's action pill, and the glyph on it. */
  postPill: string;
  postPillInk: string;
  // system
  statusBar: 'light' | 'dark';
}

// Black — the default "Lights out" theme (:root on web). True #000000 page bg
// (per founder), with slightly-raised surfaces above it for cards/inputs.
export const black: Palette = {
  bg: '#000000',
  s1: '#0B0B0D',
  s2: '#141416',   // the post card, and every settings-shaped card
  text: '#FFFFFF',
  t2: '#8E8E93',
  t3: '#7E7E83',
  t4: '#48484A',
  border: '#242830',
  // #0088FF is the brand blue named in the design law. The app was carrying X's
  // #1D9BF0, which is a different blue and never appears anywhere on the web.
  accent: '#0088FF',
  accentDim: 'rgba(0,136,255,0.14)',
  accentTint: '#FFFFFF',
  primary: '#FFFFFF',
  onPrimary: '#1D1D1F',
  verify: '#D3D5D7',
  like: '#F91880',
  repost: '#00BA7C',
  danger: '#FF0033',
  success: '#88FF00',
  warning: '#FFBB00',
  postPill: '#000000',      // an action pill reads as a hole punched in the card
  postPillInk: '#8E8E93',
  statusBar: 'light',
};

// Light — X.com-style white with hairline dividers (body.light on web).
export const light: Palette = {
  bg: '#FFFFFF',
  s1: '#F5F5F7',
  s2: '#F5F5F7',
  text: '#1D1D1F',
  t2: '#65656A',
  t3: '#6E6E73',
  t4: '#AAB8C2',
  border: '#EFF3F4',
  accent: '#006ACF',
  accentDim: 'rgba(0,106,207,0.12)',
  accentTint: '#FFFFFF',
  primary: '#111114',
  onPrimary: '#FFFFFF',
  verify: '#5B7083',
  like: '#F91880',
  repost: '#00BA7C',
  danger: '#C00020',
  success: '#2F7000',
  warning: '#805300',
  // Light takes the pill DOWN from the card, not up: the card is already within a
  // hair of white, so a white pill would be invisible.
  postPill: '#DFE4EA',
  postPillInk: '#5A5A5F',
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
  gutter: 14, // the web's --feed-gutter on a phone. It was 16 here; the web moved to 14.
} as const;

/* THE POST CARD, straight from the web's CLASSIC preset. Two numbers decide it and
   everything else is derived, exactly as in public/index.html — pad and cardRadius.
       innerRadius = cardRadius - pad     (what makes a shape nested in the corner
                                           concentric with it)
       shape       = innerRadius * 2      (a capsule's radius IS half its height, so
                                           this is the only height at which an action
                                           pill's corner matches the photo's)
   Change pad or cardRadius and the rest follows. Never type these sizes separately. */
export const post = {
  pad: 12,
  cardRadius: 30,
  get innerRadius() { return this.cardRadius - this.pad; },   // 18
  get shape() { return this.innerRadius * 2; },               // 36: avatar, ⋯, pill height
  gap: 12,      // between one card and the next
  rowGap: 12,   // between the action pills
} as const;

/** Every text button is at least as substantial as the profile editor's Save (32). */
export const button = { minHeight: 32 } as const;
/** Every settings-shaped option row, and the search bar at the top of one. */
export const row = { height: 55 } as const;

/** Corner radii — mirrors the web --r-* tokens. */
export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  /** The one card corner: post cards, settings cards, the Account page. Was 26. */
  xl: 30,
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
