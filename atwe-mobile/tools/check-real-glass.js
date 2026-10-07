#!/usr/bin/env node
/**
 * There is no imitation Liquid Glass in this app.
 *
 * `Glass` used to paint a hand-made translucent disc whenever
 * `isLiquidGlassAvailable()` was false, so on any phone below iOS 26 the whole
 * app quietly wore a lookalike and nothing on screen said which one you were
 * looking at. The founder: "I don't need a fake version of liquid glass and I'm
 * fine with only one design. I want everything to be real."
 *
 * So: the app requires iOS 26, and nothing may branch on whether glass is
 * available — a branch like that IS the fallback coming back.
 *
 * What is NOT a violation, and must not be "fixed":
 *   - `BlurView` — a real `UIVisualEffectView`, the system material Messages
 *     and Mail put behind a nav bar. Liquid Glass LENSES and blooms across a
 *     full-width bar; the plain material is Apple's own answer there.
 *   - `plain` / a solid fill — a destructive button and a CHOSEN filter chip
 *     are solid on purpose. Translucency cannot say "this is destructive" or
 *     "this is the one you picked".
 *
 * Self-test: put `isLiquidGlassAvailable()` back into Glass.tsx and this fails.
 */
const fs = require('fs');
const path = require('path');

const problems = [];

/* 1. the build actually requires iOS 26 */
const app = JSON.parse(fs.readFileSync('app.json', 'utf8')).expo;
const bp = (app.plugins || []).find((p) => Array.isArray(p) && p[0] === 'expo-build-properties');
const target = bp && bp[1] && bp[1].ios && bp[1].ios.deploymentTarget;
if (target !== '26.0') {
  problems.push(`app.json: iOS deploymentTarget is ${target || 'unset'} — must be "26.0", or phones ` +
    'below 26 install an app whose every glass surface renders as nothing');
}

/* 2. nothing asks whether glass is available */
/* Blank out block and line comments, keeping newlines so any future line
   numbers stay honest. Crude on purpose: a `//` inside a string literal would
   also be blanked, which can only ever HIDE a match — and no string in this app
   carries one of these names. */
function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}
for (const root of ['app', 'src']) {
  if (!fs.existsSync(root)) continue;
  for (const f of walk(root)) {
    /* Strip comments FIRST. Glass.tsx's own doc comment names the function it
       is explaining not to use, and matching raw text reported that file as a
       violation of the rule it documents. Same lesson as
       tools/find-duplicate-vars.py: strip, then match. */
    const src = strip(fs.readFileSync(f, 'utf8'));
    if (/isLiquidGlassAvailable|isGlassEffectAPIAvailable|\bhasGlass\b/.test(src)) {
      problems.push(`${f}: branches on whether Liquid Glass is available — that IS the fallback`);
    }
  }
}

if (problems.length) {
  console.error(`real-glass: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log('real-glass: ok — iOS 26 required, and nothing imitates the material');
