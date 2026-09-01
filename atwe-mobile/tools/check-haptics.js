#!/usr/bin/env node
/**
 * The haptics guard.
 *
 * Feel is the one thing you cannot see in a screenshot, so it is the one thing
 * that rots quietly. Three rules, each of which has already caught a real bug:
 *
 *  1. NOBODY CALLS expo-haptics DIRECTLY. One vocabulary, one place. A screen
 *     that reaches past `@/lib/haptics` is picking an intensity by hand, which
 *     is how one button ends up heavier than the identical button next door.
 *
 *  2. NOTHING FIRES TWICE FOR ONE GESTURE. <Button> and <AuthButton> already
 *     tap on the way down; a handler passed to one that fires its own tap/press
 *     buzzes again on the way up, ~100ms later. That is the "long, muddy"
 *     feeling, and it shipped in three places (Add to cart, Pay, Book it)
 *     before this check existed.
 *
 *  3. EVERY CHOICE TICKS. Anything declaring itself a tab or a radio is a value
 *     changing under the finger and owes a selection tick.
 *
 * Run: node tools/check-haptics.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MODULE = path.join('src', 'lib', 'haptics.ts');
/* These two OWN the press haptic; their own internals are allowed to call it. */
const BUTTONS = ['src/components/Button.tsx', 'src/components/AuthButton.tsx'];
const SELF = new Set([MODULE, ...BUTTONS, 'src/components/HapticInput.tsx']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'src'))];
const fails = [];

for (const abs of files) {
  const rel = path.relative(ROOT, abs);
  const src = fs.readFileSync(abs, 'utf8');

  // 1 — no direct dependency
  if (rel !== MODULE && /from ['"]expo-haptics['"]/.test(src)) {
    fails.push(`${rel}: imports expo-haptics directly — go through @/lib/haptics`);
  }

  // 2 — a handler that a Button already taps for must not tap again.
  //     Find `onPress={someName}` on a <Button…>/<AuthButton…>, then look at
  //     that name's own body for a press-shaped haptic. (success/error/warning
  //     are fine: they land after the work, a whole round-trip later.)
  const handlers = new Set();
  for (const m of src.matchAll(/<(?:Button|AuthButton)\b[\s\S]{0,600}?onPress=\{(\w+)\}/g)) {
    handlers.add(m[1]);
  }
  for (const name of handlers) {
    const decl = new RegExp(
      `const ${name}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>\\s*\\{([\\s\\S]*?)\\n  \\};`,
    );
    const body = src.match(decl)?.[1];
    if (body && /haptics\.(tap|press)\(\)/.test(body)) {
      fails.push(
        `${rel}: ${name}() fires its own haptic but is a <Button> onPress — ` +
        `the button already tapped on press-in, so this is a second buzz`,
      );
    }
  }

  // 3 — a choice control ticks
  if (!SELF.has(rel)) {
    for (const m of src.matchAll(/accessibilityRole=["'](tab|radio)["']/g)) {
      // the enclosing element: back up to its opening "<", forward to its ">"
      const start = src.lastIndexOf('<', m.index);
      const end = src.indexOf('>', m.index);
      const tag = src.slice(start, end);
      // the tick may be in the tag, or in the named handler the tag points at
      let ok = /haptics\.(select|tap)\(\)/.test(tag);
      if (!ok) {
        /* Follow the handler. Two shapes count, and BOTH are ordinary:
             onPress={pick}              — a named handler
             onPress={() => pick(x)}     — an arrow calling one, which is what
                                           you write the moment the choice has
                                           an argument, i.e. most of the time.
           Only the second was invisible, so a correct control was reported as
           missing its tick and the fix would have been to add a SECOND one. */
        const named = tag.match(/onPress=\{(\w+)\}/)?.[1]
          ?? tag.match(/onPress=\{\s*\(\)\s*=>\s*(\w+)\s*\(/)?.[1];
        if (named) {
          const body = src.match(new RegExp(`const ${named}\\s*=[\\s\\S]{0,400}`))?.[0];
          ok = !!body && /haptics\.(select|tap)\(\)/.test(body);
        }
      }
      if (!ok) {
        const line = src.slice(0, m.index).split('\n').length;
        fails.push(`${rel}:${line}: a ${m[1]} with no selection tick`);
      }
    }
  }
}

if (fails.length) {
  console.error(`✗ ${fails.length} haptics problem${fails.length === 1 ? '' : 's'}:\n`);
  for (const f of fails) console.error('  ' + f);
  process.exit(1);
}
console.log(`✓ haptics: ${files.length} files — one vocabulary, no double-fires, every choice ticks`);
