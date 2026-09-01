#!/usr/bin/env node
/**
 * The floating-chrome invariant.
 *
 * A bar that floats over the page only works if three things agree, and if any
 * one is missed the screen looks broken in a way the type-checker cannot see:
 *   1. the bar is a `ChromeBar` (a `PageHeader` is one),
 *   2. the screen no longer insets for the notch itself — `<Screen edges={[]}>`,
 *      because the bar carries that inset now, and a second one double-spaces it,
 *   3. every vertical scroller under the bar reserves the bar's height, or its
 *      first rows sit behind it and cannot be read.
 *
 * The browser preview cannot render glass at all, so this is checked at the
 * source instead. See `src/components/Chrome.tsx`.
 */
const fs = require('fs');
const path = require('path');

const ROOTS = ['app', 'src'];
const SCROLLERS = /<(FlatList|ScrollView|SectionList|Animated\.FlatList|Animated\.ScrollView)(?=[\s/>])/g;
const PAD = /chromePad\.|chrome\.pad/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** End of a JSX opening tag's attribute region. Braces only: JSX text is full
 *  of apostrophes, and tracking quotes swallows the whole tag. */
function tagEnd(s, i) {
  let d = 0;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') d++;
    else if (ch === '}') d--;
    else if (ch === '>' && d === 0) return i;
  }
  return -1;
}

/* The five worlds. iOS minimises the tab bar against the scroll view it finds
   in a tab ONCE, so each of these must keep exactly one vertical scroller
   mounted at all times — swap it out for a spinner and the bar never shrinks
   again on that world, which is precisely how Home and Beam ended up the two
   that did not do it. */
const WORLDS = ['app/(tabs)/index.tsx', 'app/(tabs)/beam.tsx', 'app/(tabs)/engine.tsx',
  'app/(tabs)/notifications.tsx', 'app/(tabs)/profile.tsx'];

const problems = [];
let checked = 0;

for (const root of ROOTS) {
  for (const f of walk(root)) {
    const s = fs.readFileSync(f, 'utf8');
    if (!/<ChromeBar|<PageHeader/.test(s)) continue;
    if (f.endsWith('Chrome.tsx') || f.endsWith('PageHeader.tsx')) continue;
    checked++;

    // 2 — a screen may hold a second, non-floating <Screen> (a form shown
    // instead of the list), so only complain when every one of them insets.
    const insets = (s.match(/<Screen edges=\{\['top'/g) || []).length;
    const flat = (s.match(/<Screen edges=\{\[\]\}/g) || []).length;
    if (insets > 0 && flat === 0) {
      problems.push(`${f}: floats a bar but every <Screen> still insets the top`);
    }

    // 3
    let m;
    SCROLLERS.lastIndex = 0;
    while ((m = SCROLLERS.exec(s))) {
      const end = tagEnd(s, m.index);
      if (end < 0) continue;
      const attrs = s.slice(m.index, end);
      if (/(?:^|\s)horizontal(?:\s|=|$)/.test(attrs)) continue;  // a chrome strip
      if (/maxHeight/.test(attrs)) continue;                      // a sheet's own box
      if (PAD.test(attrs)) continue;
      const line = s.slice(0, m.index).split('\n').length;
      problems.push(`${f}:${line}: <${m[1]}> under a floating bar with no chromePad`);
    }
  }
}

for (const f of WORLDS) {
  const s = fs.readFileSync(f, 'utf8');
  const body = s.slice(s.indexOf('<Screen'));
  // a scroller behind a loading/error ternary is a scroller iOS cannot find
  if (/\{\s*(isLoading|loading)[\s\S]{0,400}?\?[\s\S]{0,600}?<(FlatList|ScrollView|SectionList)/.test(body)) {
    problems.push(`${f}: its list is behind a loading branch — the tab bar cannot minimise against a scroller that is not mounted`);
  }
  if (!/<(FlatList|ScrollView|SectionList)/.test(body)) {
    problems.push(`${f}: a world with no scroll view at all`);
  }
}

if (problems.length) {
  console.error(`chrome: ${problems.length} problem(s) across ${checked} screens\n`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`chrome: ok — ${checked} screens float their bar and reserve its height, and all ${WORLDS.length} worlds keep a scroller mounted for the bar to minimise against`);
