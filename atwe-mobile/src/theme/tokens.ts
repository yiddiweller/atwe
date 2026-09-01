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
  s3: string;          // a step above s2            (web --s3)
  // text
  text: string;        // primary text               (web --text)
  t2: string;          // secondary                  (web --t2)
  t3: string;          // tertiary / meta            (web --t3)
  t4: string;          // faint icon tint            (web --t4)
  // lines
  b1: string;          // the faintest line          (web --b1)
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
  /* An engaged action on a post. On the web BOTH of these are the brand blue —
     `--rose` is #0088FF, not pink, and a repost uses --accent. The app was
     carrying X's palette here (pink #F91880 and green #00BA7C), which is two
     colours that appear nowhere in Atwe's law. Blue is the law's selected/
     toggle-on colour, so a lit action being blue is the rule, not an exception. */
  like: string;        // web --rose
  repost: string;      // web --accent
  /* TEXT in a semantic colour. These follow the web's --green-txt/--red-txt/
     --amber-txt: identical to the raw brand colour on Black, and darkened on
     Light where #88FF00 text on white would be unreadable. */
  danger: string;
  success: string;
  warning: string;
  /* The brand colours themselves, for a FILL. Same in both themes, because a
     green button is green everywhere — it is the INK on it that changes, which
     is what onGreen is for (the law: bright hues carry dark text, never white). */
  green: string;       // web --green
  red: string;         // web --red
  amber: string;       // web --amber
  onGreen: string;     // web --on-green
  purple: string;      // web --purple — reserve, not used yet
  /** The fill of a post's action pill, and the glyph on it. */
  postPill: string;
  postPillInk: string;
  /** A loading placeholder INSIDE a post card — deliberately the same value as
   *  postPill, so loading and loaded never change tone. (web --post-skel) */
  postSkel: string;
  // system
  statusBar: 'light' | 'dark';
}

// Black — the default "Lights out" theme (:root on web). True #000000 page bg
// (per founder), with slightly-raised surfaces above it for cards/inputs.
export const black: Palette = {
  bg: '#000000',
  s1: '#0B0B0D',
  s2: '#141416',   // the post card, and every settings-shaped card
  s3: '#1C1C1E',
  text: '#FFFFFF',
  t2: '#8E8E93',
  t3: '#7E7E83',
  t4: '#48484A',
  /* The web's --b1/--b2 are TRANSLUCENT WHITE, not opaque greys. The app had
     #242830, which is both lighter and noticeably blue — a hairline that reads
     as a colour rather than as a barely-there edge. */
  b1: 'rgba(255,255,255,0.05)',
  border: 'rgba(255,255,255,0.08)',
  // #0088FF is the brand blue named in the design law. The app was carrying X's
  // #1D9BF0, which is a different blue and never appears anywhere on the web.
  accent: '#0088FF',
  accentDim: 'rgba(0,136,255,0.10)',
  accentTint: '#FFFFFF',
  primary: '#FFFFFF',
  onPrimary: '#1D1D1F',
  verify: '#D3D5D7',
  like: '#0088FF',
  repost: '#0088FF',
  danger: '#FF0033',
  success: '#88FF00',
  warning: '#FFBB00',
  green: '#88FF00',
  red: '#FF0033',
  amber: '#FFBB00',
  onGreen: '#163300',
  purple: '#AA00FF',
  postPill: '#000000',      // an action pill reads as a hole punched in the card
  postPillInk: '#8E8E93',
  postSkel: '#000000',
  statusBar: 'light',
};

// Light — X.com-style white with hairline dividers (body.light on web).
export const light: Palette = {
  bg: '#FFFFFF',
  s1: '#F5F5F7',
  s2: '#F5F5F7',
  s3: '#E6ECF0',
  text: '#1D1D1F',
  t2: '#65656A',
  t3: '#6E6E73',
  t4: '#AAB8C2',
  b1: 'rgba(0,0,0,0.04)',
  border: '#EFF3F4',
  accent: '#006ACF',
  /* NB the web tints with #007AFF here, not with its own --accent. Copied as-is
     rather than "corrected", because matching the web is the point. */
  accentDim: 'rgba(0,122,255,0.10)',
  accentTint: '#FFFFFF',
  primary: '#111114',
  onPrimary: '#FFFFFF',
  verify: '#5B7083',
  like: '#007AFF',
  repost: '#006ACF',
  danger: '#C00020',
  success: '#2F7000',
  warning: '#805300',
  green: '#88FF00',
  red: '#FF0033',
  amber: '#FFBB00',
  onGreen: '#163300',
  purple: '#AA00FF',
  // Light takes the pill DOWN from the card, not up: the card is already within a
  // hair of white, so a white pill would be invisible.
  postPill: '#DFE4EA',
  postPillInk: '#5A5A5F',
  postSkel: '#DFE4EA',
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
  xs: 7,
  sm: 11,
  md: 14,
  /** Media and previews INSIDE something — a photo in a form, a story preview.
   *  Not a card corner; see `card` below. */
  lg: 18,
  /**
   * THE card corner, and there is only one. The web settled this — post cards,
   * settings-shaped cards, the Account page and the nav bar all turn on the same
   * number, and four near-misses on one screen is exactly what the founder kept
   * spotting and could not name. `card` is the semantic name; `xl` is kept as
   * its alias so nothing that already used it has to change.
   */
  card: 30,
  /** The modal / bottom-sheet family (web --r-xl). Deliberately NOT the card
   *  corner: a sheet is an overlay, not a card sitting on a page. It used to be
   *  an alias for `card`, which made every sheet 30. */
  xl: 24,
  /**
   * A bubble corner: a capsule when there is one line, and EQUAL ROUNDED
   * CORNERS the moment there are two.
   *
   * iOS clamps a corner to half the shorter side, and that one fact does all
   * the work here. A one-line bubble is 41pt tall, so anything at or above
   * 20.5 renders it as a perfect capsule. A two-line bubble is 62pt tall, so
   * anything WELL BELOW 31 renders it as a rounded rectangle instead of a
   * lozenge with semicircular ends.
   *
   * 22 sits just above the first bound and well under the second, which is
   * exactly the behaviour asked for: *"if it's more than one line it should be
   * equal, only rounded corners, instead of the whole rounded sides."* It is
   * also the web's own `.msg-bubble` number, so the two products agree.
   *
   * It shipped once at 44 — chosen as the largest radius whose curve still
   * clears the first line of text — and that made every multi-line bubble a
   * stadium. The constraint that matters is not how large it CAN be; it is
   * where a bubble stops reading as a rectangle.
   *
   * Use it for message bubbles and for anything multi-line you type into.
   * A single-line field is `pill` — it can never be too round.
   */
  bubble: 22,
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

/** The web's --t-fast / --t-base / --t-slow, to the millisecond. The app had
 *  160/220/320, which is slower on the short end and quicker on the long one —
 *  enough that the same gesture felt different on the two. */
export const timing = {
  fast: 120,
  base: 200,
  slow: 350,
} as const;

/** How far the floating nav pill is inset from the screen edge (web --nav-inset).
 *  Deliberately MORE than the content gutter, so the bar reads as sitting inside
 *  the cards rather than lining up with them. */
export const nav = { inset: 23 } as const;
