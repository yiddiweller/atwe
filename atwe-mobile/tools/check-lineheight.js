#!/usr/bin/env node
/**
 * A bigger font needs a bigger line box.
 *
 * `Text` applies the `body` variant by default, and body carries
 * `lineHeight: 21`. A style that raises `fontSize` to 26 or 29 or 40 without
 * ALSO raising lineHeight is drawing a tall glyph inside a short box — and on
 * iOS that CLIPS: the bottom of every letter is sliced off. It shipped that way
 * across thirteen styles, and the founder photographed three of them in one go:
 * the wallet balance, the @handle echoed on the password screen, and the @
 * beside the username field.
 *
 * `components/Text` now drops the inherited line box when a style would be
 * crushed by it, so this cannot render wrong any more. This check is the second
 * line: a style that names a size should name the box it lives in, so the
 * spacing is a decision rather than whatever the font happens to do.
 *
 * WHY A SOURCE CHECK AND NOT A SCREENSHOT. A browser does not clip a short
 * line-height, it lets the text overflow — so the web preview the rest of this
 * app is checked in cannot show this class of bug at all. It is only visible on
 * a real phone, which means it has to be caught in the source or not at all.
 *
 * Run: node tools/check-lineheight.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
/* The default line box every un-varianted Text inherits. Read from the tokens
   rather than typed here, so changing the type scale moves this too. */
const tokens = fs.readFileSync(path.join(ROOT, 'src/theme/tokens.ts'), 'utf8');
const BODY_LH = Number(/body:\s*\{[^}]*lineHeight:\s*(\d+)/.exec(tokens)?.[1]);
if (!BODY_LH) {
  console.error('✗ could not read body.lineHeight out of src/theme/tokens.ts');
  process.exit(1);
}

/* A TextInput has no inherited line height to be crushed by, and setting one on
   iOS shifts the caret — so those styles are deliberately exempt. */
const INPUT_STYLE = /input|Input|field|Field|box$|Box$|amount$/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist-web', '.expo', '.git'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const fails = [];
for (const abs of [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'src'))]) {
  const rel = path.relative(ROOT, abs);
  const src = fs.readFileSync(abs, 'utf8');
  // a StyleSheet entry written on one line: `name: { … },`
  for (const m of src.matchAll(/^\s*([A-Za-z0-9_]+):\s*\{([^}\n]*)\},?\s*$/gm)) {
    const [name, body] = [m[1], m[2]];
    const fs_ = /fontSize:\s*([0-9.]+)/.exec(body);
    if (!fs_ || /lineHeight/.test(body)) continue;
    const size = Number(fs_[1]);
    if (size < BODY_LH) continue;              // fits the inherited box
    if (INPUT_STYLE.test(name)) continue;      // a TextInput, see above
    const line = src.slice(0, m.index).split('\n').length;
    fails.push(`${rel}:${line}: \`${name}\` is ${size}px inside a ${BODY_LH}px line box — give it a lineHeight`);
  }
}

if (fails.length) {
  console.error(`✗ ${fails.length} style${fails.length === 1 ? '' : 's'} that would be clipped on a phone:\n`);
  for (const f of fails) console.error('  ' + f);
  process.exit(1);
}
console.log(`✓ line heights: nothing is drawn bigger than the ${BODY_LH}px box it sits in`);
