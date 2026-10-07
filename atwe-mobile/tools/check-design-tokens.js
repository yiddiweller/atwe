#!/usr/bin/env node
/**
 * Is the phone still the same colour as the website?
 *
 * The phone's tokens were "ported 1:1 from the web" once, and then the web moved
 * on. By the time anybody looked, the hairline was an opaque blue-grey where the
 * web's is translucent white, a LIKED post lit up X's pink where the web lights
 * up Atwe blue, every bottom sheet was 30 where the web's are 24, and all three
 * motion durations were wrong. None of that is visible in a diff of either file
 * alone — only in a comparison.
 *
 * So this reads the REAL values out of public/index.html and asserts the phone
 * matches. Run it after touching either side's design values.
 *
 *   node tools/check-design-tokens.js
 */
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', '..', 'public', 'index.html');
const TOK = path.join(__dirname, '..', 'src', 'theme', 'tokens.ts');
if (!fs.existsSync(WEB)) {
  console.log('· skipped: the web app is not in this checkout');
  process.exit(0);
}
const web = fs.readFileSync(WEB, 'utf8');
const tok = fs.readFileSync(TOK, 'utf8');

/** Declarations from rules whose selector is EXACTLY `sel` — never a descendant.
 *  Matching `body.light` loosely also catches `body.light .sf-look-warm`, whose
 *  cream surfaces are a STOREFRONT option, not the app's Light theme. That very
 *  mistake nearly got the phone's Light palette "fixed" to the wrong colours. */
function vars(sel) {
  const out = {};
  const re = new RegExp('(?:^|\\n)\\s*' + sel + '\\s*\\{([^}]*)\\}', 'g');
  let m;
  while ((m = re.exec(web))) {
    for (const d of m[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+)/g)) out[d[1]] = d[2].trim();
  }
  return out;
}
const B = vars(':root');
const L = vars('body\\.light');

/** The phone's value for `key` inside the `black`/`light` palette object. */
function phone(palette, key) {
  const m = new RegExp('export const ' + palette + ': Palette = \\{([\\s\\S]*?)\\n\\};').exec(tok);
  if (!m) return null;
  const d = new RegExp('(?:^|\\n)\\s*' + key + ":\\s*'([^']*)'").exec(m[1]);
  return d ? d[1] : null;
}
/** A plain `export const NAME = { … }` number. */
function num(obj, key) {
  /* Stop at `} as const`, not at the first `}`. `post` contains getters with
     their own braces, so a lazy match to the first one truncates the object and
     silently reports its later keys as missing. And a one-liner like
     `export const nav = { inset: 23 } as const;` has no newline before its brace,
     so `\n}` misses it entirely. This terminator handles both. */
  const m = new RegExp('export const ' + obj + '[^=]*=\\s*\\{([\\s\\S]*?)\\}\\s*as const').exec(tok);
  if (!m) return null;
  const d = new RegExp('(?:^|\\n)\\s*' + key + ':\\s*(\\d+)').exec(m[1]);
  return d ? Number(d[1]) : null;
}

/* CSS writes the same number two ways — `rgba(0,0,0,.04)` and `rgba(0,0,0,0.04)`
   are identical, and a checker that calls them different is worse than none. So
   strip a leading zero from EVERY decimal, not just one at the start. */
const norm = (v) => String(v).toLowerCase().replace(/\s+/g, '').replace(/\b0(\.\d+)/g, '$1');
const px = (v) => (v == null ? null : Number(String(v).replace(/px|ms/, '')));

const fails = [];
const eq = (what, wv, pv) => {
  if (wv == null) return;                       // the web does not define it
  if (norm(wv) !== norm(pv)) fails.push(`${what}: web ${wv}  ·  phone ${pv}`);
};

/* colours, both themes */
const COLOURS = [
  ['bg', '--bg'], ['s1', '--s1'], ['s2', '--s2'], ['s3', '--s3'],
  ['text', '--t1'], ['t2', '--t2'], ['t3', '--t3'], ['t4', '--t4'],
  ['b1', '--b1'], ['border', '--b2'],
  ['accent', '--accent'], ['accentTint', '--accent-tint'],
  ['primary', '--primary'], ['onPrimary', '--on-primary'], ['verify', '--verify'],
  ['like', '--rose'], ['repost', '--accent'],
  ['green', '--green'], ['red', '--red'], ['amber', '--amber'], ['onGreen', '--on-green'],
  ['purple', '--purple'],
  ['postPill', '--post-pill'], ['postPillInk', '--post-pill-ink'], ['postSkel', '--post-skel'],
];
for (const [p, w] of COLOURS) {
  eq(`black.${p}`, B[w], phone('black', p));
  eq(`light.${p}`, L[w] ?? B[w], phone('light', p));
}

/* geometry + motion */
eq('spacing.gutter', px(B['--feed-gutter']), num('spacing', 'gutter'));
eq('nav.inset', px(B['--nav-inset']), num('nav', 'inset'));
eq('post.pad', px(B['--post-pad']), num('post', 'pad'));
eq('post.cardRadius', px(B['--post-card-r']), num('post', 'cardRadius'));
eq('post.gap', px(B['--post-gap']), num('post', 'gap'));
eq('post.rowGap', px(B['--post-row-gap']), num('post', 'rowGap'));
for (const [p, w] of [['xs', '--r-xs'], ['sm', '--r-sm'], ['md', '--r-md'], ['lg', '--r-lg'], ['xl', '--r-xl']]) {
  eq(`radius.${p}`, px(B[w]), num('radius', p));
}
for (const [p, w] of [['fast', '--t-fast'], ['base', '--t-base'], ['slow', '--t-slow']]) {
  eq(`timing.${p}`, px(B[w]), num('timing', p));
}

if (fails.length) {
  console.error(`✗ ${fails.length} value${fails.length === 1 ? '' : 's'} drifted from the web:\n`);
  for (const f of fails) console.error('  ' + f);
  process.exit(1);
}
console.log(`✓ design tokens: ${COLOURS.length * 2} colours + geometry + motion all match the web`);
