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
/* Either the static table or — better — a bar that measured itself and handed
   its own height down (`useFloatingChrome`, whose result the worlds call
   `bar`). The measured form is what the four worlds use: a constant plus a
   module-level safe-area inset is two numbers that both have to be right, and
   when they disagreed the founder photographed ~88pt of dead black. */
const PAD = /chromePad\.|chrome\.pad|bar\.pad|\bpad\]/;

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
      problems.push(`${f}:${line}: <${m[1]}> under a floating bar that reserves no room for it`);
    }
  }
}

for (const f of WORLDS) {
  const s = fs.readFileSync(f, 'utf8');
  const body = s.slice(s.indexOf('<Screen'));
  /* The top chrome has to get out of the way as the page scrolls, or the screen
     never gives its whole height to the content — the founder's own complaint,
     twice. Account has no chrome to retract, so it is the one exception. */
  if (/<ChromeBar/.test(body) && !/retract=\{/.test(body)) {
    problems.push(`${f}: its chrome never retracts — pass useChromeRetract()'s value`);
  }
  // a scroller behind a loading/error ternary is a scroller iOS cannot find
  if (/\{\s*(isLoading|loading)[\s\S]{0,400}?\?[\s\S]{0,600}?<(FlatList|ScrollView|SectionList)/.test(body)) {
    problems.push(`${f}: its list is behind a loading branch — the tab bar cannot minimise against a scroller that is not mounted`);
  }
  if (!/<(FlatList|ScrollView|SectionList)/.test(body)) {
    problems.push(`${f}: a world with no scroll view at all`);
  }
}

/**
 * The chrome draws ONE material layer, never a stack.
 *
 * It used to fake a progressive blur with four `BlurView`s at 100/75/50/25% of
 * the bar's height. Each ends on a hard line, so the bar carried three visible
 * seams — plus a fourth where a 30pt gradient tail ended below it. The founder
 * called it "not professional" and that was exactly right.
 *
 * A stack is also the expensive way to be wrong: a blur per layer, recomposited
 * every frame while the feed scrolls, on the one platform this app has already
 * been burned by for repeated blurs.
 *
 * So: at most one `BlurView` and one `GlassView` in `Chrome.tsx` (the glass and
 * blur branches of a single ternary), and no `.map`/`Array.from` producing
 * them. Self-test: restore the four-layer loop and this fails.
 */
{
  const src = fs.readFileSync('src/components/Chrome.tsx', 'utf8');
  const blurs = (src.match(/<BlurView\b/g) || []).length;
  const glasses = (src.match(/<GlassView\b/g) || []).length;
  const looped = /Array\.from\([^)]*\)[\s\S]{0,120}<(BlurView|GlassView)\b/.test(src)
    || /\.map\([^)]*\)[\s\S]{0,120}<(BlurView|GlassView)\b/.test(src);
  if (blurs > 1) problems.push(`Chrome.tsx draws ${blurs} BlurViews — the bar is one material, not a stack`);
  if (glasses > 1) problems.push(`Chrome.tsx draws ${glasses} GlassViews — the bar is one material, not a stack`);
  if (looped) problems.push('Chrome.tsx builds its blur in a loop — that is the stepped stack coming back');
}

/**
 * The chrome menu is NOT inside a Modal.
 *
 * A React Native `Modal` presents its own view controller, so a `GlassView`
 * inside one has nothing of the app behind it to sample and collapses to a
 * flat, dull pane — the founder's "it looks fake". Apple's own context menus
 * are overlays in the same window, not modals. `GlassMenu` is an in-tree
 * overlay for exactly that reason; putting it back in a Modal would undo it
 * silently, since nothing else would break.
 */
{
  const src = fs.readFileSync('src/components/GlassMenu.tsx', 'utf8');
  if (/<Modal\b/.test(src)) {
    problems.push('GlassMenu is inside a <Modal> — real glass cannot sample the app from there');
  }
  if (!/right:\s*Math\.max\([^)]*anchor\.x \+ anchor\.width/.test(src)) {
    problems.push("GlassMenu no longer pins its right edge to the button's — it will unfold from the screen corner");
  }
}

/**
 * Nothing uses `KeyboardAvoidingView`.
 *
 * `src/lib/keyboard.ts` records why: KAV works out its own lift by measuring
 * its frame against the keyboard's, and inside a safe-area view that already
 * claims the bottom inset the two measurements disagree. It left the signup
 * button half-covered, was replaced there — and was still sitting in the three
 * screens people actually type in, where it hid the composer behind the
 * keyboard. Read the keyboard's height (`useKeyboardHeight`) and lift by
 * exactly that; there is no measurement to get wrong.
 */
for (const file of walk('app').concat(walk('src'))) {
  const src = fs.readFileSync(file, 'utf8');
  /* Only real usage — the three messaging screens name it in a comment
     explaining why they do NOT use it, and matching that would be absurd. */
  if (/<KeyboardAvoidingView\b/.test(src) || /^\s*KeyboardAvoidingView,/m.test(src)) {
    problems.push(`${file}: uses KeyboardAvoidingView — use useKeyboardHeight instead`);
  }
}

if (problems.length) {
  console.error(`chrome: ${problems.length} problem(s) across ${checked} screens\n`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}

console.log(`chrome: ok — ${checked} screens float their bar and reserve its height, and all ${WORLDS.length} worlds keep a scroller mounted for the bar to minimise against`);
