#!/usr/bin/env node
/**
 * Every ROUND BUTTON in the app is made of real glass.
 *
 * The founder photographed one: a translucent disc floating over content with
 * the content showing through it, and asked for that everywhere. The failure
 * this catches is the easy one — a new screen hand-rolls
 *
 *     <Pressable style={[styles.disc, { backgroundColor: c.s2 }]}>
 *
 * which is a painted grey circle. It looks nearly right next to real glass and
 * completely wrong on top of it, and nothing else in the toolchain notices.
 *
 * The rule: a circular or capsule style used as a Pressable's own background
 * must not carry a NEUTRAL surface fill (s1/s2/s3, or a hand-mixed grey). Use
 * `GlassIcon` / `GlassSurface` / `Glass` instead.
 *
 * A SEMANTIC fill is allowed and is not a mistake — accent, primary, danger,
 * green. Those are colours doing a job (send is armed, this is destructive,
 * this is the chosen chip), and glass would take the job away. The rule is
 * about grey, which is glass pretending.
 *
 * Self-test: put `backgroundColor: c.s2` back on the composer's + and this
 * fails naming that line.
 */
const fs = require('fs');
const path = require('path');

const ROOTS = ['app', 'src'];
const NEUTRAL = /\bc\.(s1|s2|s3|bg)\b|backgroundColor: 'rgba\(255,255,255,0\.\d+\)'/;
/** Files that legitimately paint a grey disc: it is not a button there. */
const EXEMPT = new Set([
  // The play control lives INSIDE a message bubble and is tinted BY the bubble;
  // glass there would sample the bubble it is already sitting on.
  'src/components/VoiceNote.tsx',
]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const bad = [];
for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  for (const file of walk(root)) {
    if (EXEMPT.has(file.split(path.sep).join('/'))) continue;
    const src = fs.readFileSync(file, 'utf8');

    /* Which style keys are a round or capsule shape? */
    const round = new Set();
    for (const m of src.matchAll(/^\s*(\w+): \{([^}]*)\},/gm)) {
      const [, name, body] = m;
      const w = body.match(/width: (\d+)/);
      const h = body.match(/height: (\d+)/);
      const capsule = /radius\.pill|borderRadius: 999/.test(body);
      const circle = w && h && w[1] === h[1] && /borderRadius/.test(body);
      if (capsule || circle) round.add(name);
    }
    if (!round.size) continue;

    /* Is one of them used as a Pressable's own style WITH a neutral fill? */
    for (const m of src.matchAll(/<(?:Pressable|TouchableOpacity)\b[\s\S]{0,600}?\/?>/g)) {
      const tag = m[0];
      const used = [...round].find((n) => tag.includes(`styles.${n}`));
      if (!used) continue;
      if (!NEUTRAL.test(tag)) continue;
      const line = src.slice(0, m.index).split('\n').length;
      bad.push(`${file}:${line}  ${used} — a painted grey ${/radius\.pill|999/.test(src) ? 'capsule' : 'disc'}; use GlassIcon/GlassSurface`);
    }
  }
}

/**
 * A glass button whose glyph is a hardcoded white MUST declare `overContent`.
 *
 * The fallback material is chosen by THEME, so on a Light-theme phone it is a
 * near-white disc — and a white glyph on it is invisible. That shipped once, in
 * the story viewer: the close button was a white disc with a white cross on it.
 * `overContent` keeps the dark material whatever the theme is, which is what a
 * control over a photograph should always be.
 */
for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  for (const file of walk(root)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/<(GlassIcon|GlassSurface)\b([\s\S]*?)<\/\1>/g)) {
      const [whole, tag, inner] = m;
      /* Find where the OPENING tag ends. It cannot be the first '>' in the
         string — an arrow function in a prop (`onPress={() => ...}`) contains
         one, and slicing there hides every prop written after it. That is
         exactly how this check first reported two correctly-marked buttons as
         broken. Track brace depth and stop at the first '>' outside braces. */
      let depth = 0, end = 0;
      for (let i = 1; i < whole.length; i++) {
        const ch = whole[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        else if (ch === '>' && depth === 0) { end = i; break; }
      }
      const open = whole.slice(0, end + 1);
      if (!/color=["{]'?#fff/.test(inner)) continue;
      if (/\boverContent\b/.test(open)) continue;
      const line = src.slice(0, m.index).split('\n').length;
      bad.push(`${file}:${line}  ${tag} forces a white glyph but is not marked overContent — invisible in Light`);
    }
  }
}

if (bad.length) {
  console.error('Round buttons that are paint, not glass:\n' + bad.map((b) => '  ' + b).join('\n'));
  process.exit(1);
}
console.log('check-glass-buttons: every round button is real glass');
