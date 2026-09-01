#!/usr/bin/env node
/**
 * The two splashes must agree.
 *
 * iOS draws its OWN launch screen first, from app.json's expo-splash-screen
 * block, and AnimatedSplash mounts over it. If the two disagree about which
 * file or what size, opening the app blinks: one logo is replaced by a
 * different-sized one, mid-launch, every single time. It shipped that way once —
 * splash.png at 104 handing off to logo-mark.png at 62 — and the founder called
 * it out on the first build they saw it in.
 *
 * Two numbers in two files is exactly the kind of pair that drifts, so this
 * checks them rather than trusting a comment.
 *
 * Run: node tools/check-splash.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8')).expo;
const src = fs.readFileSync(path.join(ROOT, 'src/components/AnimatedSplash.tsx'), 'utf8');

const plugin = (app.plugins || []).find((p) => Array.isArray(p) && p[0] === 'expo-splash-screen');
const fails = [];
if (!plugin) fails.push('app.json has no expo-splash-screen plugin block');

const mark = /const MARK = (\d+(?:\.\d+)?)/.exec(src);
const img = /source=\{require\('\.\.\/\.\.\/(assets\/[^']+)'\)\}/.exec(src);
if (!mark) fails.push('AnimatedSplash: could not find `const MARK = …` (the animated size)');
if (!img) fails.push('AnimatedSplash: could not find the require() for its image');

if (plugin && mark && img) {
  const cfg = plugin[1] || {};
  if (cfg.image !== './' + img[1]) {
    fails.push(`image: the launch screen draws ${cfg.image} but the animation draws ./${img[1]}`);
  }
  if (String(cfg.imageWidth) !== mark[1]) {
    fails.push(`size: the launch screen draws it at ${cfg.imageWidth} but the animation at ${mark[1]}`);
  }
  /* The background has to match too, or the black itself flashes. */
  if ((cfg.backgroundColor || '').toLowerCase() !== '#000000') {
    fails.push(`background: expected #000000, got ${cfg.backgroundColor}`);
  }
  if (!/backgroundColor: '#000000'/.test(src)) {
    fails.push("AnimatedSplash's own fill is no longer #000000");
  }
}

/* And it must START where the launch screen ENDS: full opacity, full scale,
   full white. Fading or growing in from nothing is the blink by another name. */
for (const [name, want] of [['logoOpacity', '1'], ['scale', '1'], ['pulse', '1']]) {
  const m = new RegExp(`const ${name} = useSharedValue\\(([^)]+)\\)`).exec(src);
  if (!m) fails.push(`AnimatedSplash: no \`${name}\` shared value`);
  else if (m[1].trim() !== want) {
    fails.push(
      `AnimatedSplash: ${name} starts at ${m[1].trim()}, not ${want} — ` +
      'it must begin at the launch screen\'s end state, not animate toward it',
    );
  }
}

if (fails.length) {
  console.error(`✗ ${fails.length} splash problem${fails.length === 1 ? '' : 's'}:\n`);
  for (const f of fails) console.error('  ' + f);
  process.exit(1);
}
console.log(`✓ splash: the launch screen and the animation are the same mark at ${mark[1]}pt, and it starts where the launch screen ends`);
