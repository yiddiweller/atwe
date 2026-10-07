#!/usr/bin/env node
/**
 * The rounding law.
 *
 *   A message bubble is round on ALL FOUR corners, and a box you type into is
 *   a capsule.
 *
 * Bubbles used to carry one squared-off 4pt corner — the old chat "tail" — which
 * is exactly what stopped them reading as fully rounded, and text fields were a
 * 14pt rounded rectangle. Both are easy to reintroduce by copying an old style
 * block, and neither shows up in a type-check, so they are checked here.
 *
 * Two rules:
 *   1. Nothing that draws a message may set a per-corner radius. (A bottom
 *      SHEET may: its top corners are round and its bottom sits on the screen
 *      edge — those are listed by name.)
 *   2. A style whose name says it is something you type into may only be
 *      `radius.pill` (single line — it can never be too round) or
 *      `radius.bubble` (multi-line — as round as it can be before the curve
 *      starts eating the first line; see the token).
 */
const fs = require('fs');
const path = require('path');

const ROOTS = ['app', 'src'];
/** Bottom sheets: round on top, flush to the screen at the bottom. */
const SHEETS = new Set([
  'src/components/PostMenu.tsx', 'src/components/ApplySheet.tsx',
  'src/components/ReasonSheet.tsx', 'src/components/BeamToolsMenu.tsx',
  'src/components/ShipSheet.tsx', 'app/workers.tsx',
]);
/** Style names that hold something you type into. */
const FIELD = /^(input|.*Input|.*In|textarea|.*Field|field|ask.*|pw.*|search|.*Search)$/;
const OK_RADIUS = /radius\.(pill|bubble)/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const problems = [];
let fields = 0;
let files = 0;

for (const root of ROOTS) {
  for (const f of walk(root)) {
    const s = fs.readFileSync(f, 'utf8');
    files++;

    // 1 — per-corner radii
    if (!SHEETS.has(f)) {
      const re = /border(Top|Bottom)(Left|Right)Radius/g;
      let m;
      while ((m = re.exec(s))) {
        problems.push(`${f}:${s.slice(0, m.index).split('\n').length}: ${m[0]} — a bubble is round on all four corners`);
      }
    }

    // 2 — anything you type into is a capsule (or the bubble corner if it grows)
    const re2 = /^\s*([A-Za-z][\w]*): \{([^}]*)\}/gm;
    let m2;
    while ((m2 = re2.exec(s))) {
      const [, name, body] = m2;
      if (!FIELD.test(name)) continue;
      const r = body.match(/borderRadius: ([^,}]+)/);
      if (!r) continue;
      fields++;
      if (!OK_RADIUS.test(r[1])) {
        problems.push(`${f}:${s.slice(0, m2.index).split('\n').length}: ${name} is ${r[1].trim()} — a field is radius.pill, or radius.bubble when multi-line`);
      }
    }
  }
}

if (problems.length) {
  console.error(`rounding: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`rounding: ok — no squared corner on anything that holds a message, and ${fields} named fields across ${files} files are all capsule-round`);
