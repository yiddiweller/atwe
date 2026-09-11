/* NOTHING IN ATWE READS AS MACHINE-WRITTEN — the guard for build 1856's sweep.
 *
 * `tools/aitells.js` is the SCANNER: nine categories, reports, changes nothing, and most
 * of what it finds is deliberate. This is the GUARD, and it covers only the three the
 * founder asked to be cleaned, so it can never go red on a judgement call:
 *
 *   1. the AI sparkle, which is the visual cliche of the last two years and which Atwe
 *      does not need because it has a mark of its own;
 *   2. an emoji doing an ICON's job in app chrome (the app's own design rule 8);
 *   3. a 500 that says "Something went wrong" and hands back nothing to trace it by.
 *
 * WHAT IT DELIBERATELY DOES NOT GUARD, because each is correct as it stands: the server's
 * boot log (a console line is for the team), demo.js's sample posts and the emoji picker's
 * own data (a member's words), and the four tick marks in confirmations (a tick is
 * punctuation, not an emoji tell).
 *
 * Reads the files, so it needs no server and no token. Self-tests on every run: it
 * re-injects one of each and requires itself to notice.
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');           // run-all.sh cd's into scratchpad/
let pass = 0, fail = 0;
const ok = (c, m, d) => { c ? pass++ : fail++; console.log('  ' + (c ? 'ok  ' : 'FAIL') + ' ' + m + (d ? '   (' + d + ')' : '')); };

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* THE SPARKLE, IN EVERY DISGUISE. A source file can spell it `✨` in six plain ASCII
   bytes and the browser still paints a sparkle, which is exactly how twenty em dashes
   survived their own sweep -- so the escape forms are part of the pattern, not an
   afterthought. */
/* THE `u` FLAG IS NOT OPTIONAL HERE, and leaving it off cost an hour. Without it a
   character class holding an emoji is read as a set of UTF-16 CODE UNITS, so the high
   surrogate D83D that starts the crystal ball also starts the ladybird, the light bulb
   and two hundred others -- the first run of this guard reported a sparkle on every line
   of the feedback picker. */
const SPARK = /[\u{2728}\u{2726}\u{2727}\u{2734}\u{1FA84}\u{1F916}\u{1F52E}]|\\u(2728|2726|2727|2734|1FA84|1F916|1F52E)/iu;

/* An emoji doing an ICON's job. Ticks, arrows and the chevron are marks, not emoji, and
   they are excluded by name rather than by a fuzzy range. */
const CHROME_EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F900}-\u{1F9FF}\u{2B00}-\u{2BFF}]|[\u{2600}-\u{27BF}](?<!✓)(?<!✗)/u;
const DATA_ROW = (t) => ((t.match(/[\u{1F300}-\u{1FAFF}]/gu) || []).length >= 3);   // a picker's own list

function prose(rel) {
  const { readableRanges } = require(path.join(ROOT, 'tools/jstext.js'));
  const src = read(rel);
  const out = [];
  let ranges; try { ranges = readableRanges(src, rel.endsWith('.html')); } catch (e) { return out; }
  for (const [a, b] of ranges) {
    const t = src.slice(a, b);
    if (t.trim().length < 4 || t.length > 400) continue;
    if (!/[a-z]{2}/i.test(t) || !/\s/.test(t)) continue;
    if (/[<>{}]|\$\{|=>/.test(t)) continue;
    out.push({ line: src.slice(0, a).split('\n').length, t: t.trim().replace(/\s+/g, ' ') });
  }
  return out;
}

console.log('\n── 1. the sparkle is gone from every surface a member sees ──');
for (const rel of ['public/index.html', 'public/admin.html', 'server.js']) {
  const src = read(rel);
  const bad = src.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => SPARK.test(l))
    .filter(([, l]) => !DATA_ROW(l));   // the emoji picker's own data is a member's words, not chrome
  ok(bad.length === 0, rel + ' carries no AI sparkle', bad.length ? bad.slice(0, 3).map(([n]) => 'line ' + n).join(', ') : '0');
}
ok(read('public/index.html').includes('class="ai-mk"'), 'the Atwe mark stands in its place');
const mk = (read('public/index.html').match(/<i class="ai-mk"><\/i>/g) || []).length;
ok(mk >= 15, 'the mark is used everywhere the sparkle was', mk + ' places');

console.log('\n── 2. no emoji doing an icon\'s job in app chrome ──');
for (const rel of ['public/index.html', 'public/admin.html']) {
  const bad = prose(rel).filter((r) => CHROME_EMOJI.test(r.t) && !DATA_ROW(r.t)
    && !/e\.g\. /.test(r.t));                       // a placeholder showing a MEMBER what to type
  ok(bad.length === 0, rel + ' has no emoji standing in for an icon',
     bad.length ? bad.slice(0, 3).map((r) => r.line + ': ' + r.t.slice(0, 44)).join(' | ') : '0');
}
/* The chat-list preview is PLAIN TEXT in three places at once -- an escaped row, a reply
   bar, and the .txt file acExportChat writes -- so an icon was never an option there and
   the word on its own is the fix. Assert the label functions by name: they are the ones
   that drifted into two standards, with `Video` and `Voice note` beside a `File`. */
const src = read('public/index.html');
for (const fn of ['function acMetaLabel(', 'function acMediaLabel(', 'function _pinPreview(']) {
  const i = src.indexOf(fn);
  const body = src.slice(i, src.indexOf('\n}', i) > 0 ? Math.min(src.indexOf('\n}', i), i + 4000) : i + 4000);
  ok(i > 0 && !CHROME_EMOJI.test(body), fn.replace('function ', '').replace('(', '') + ' returns words, not emoji');
}

console.log('\n── 3. every server fault can be traced ──');
const srv = read('server.js');
ok(/function fault\(res/.test(srv), 'there is one shared 500 helper');
ok(/quote reference/.test(srv), 'it hands the member a reference');
const raw = (srv.match(/'Something went wrong\. Please try again\.'|'Something went wrong\.'/g) || []).length;
ok(raw === 0, 'no route answers 500 with an untraceable sentence', raw + ' left');
const faults = (srv.match(/\bfault\(res/g) || []).length;
ok(faults > 150, 'every last-resort 500 goes through it', faults + ' call sites');

console.log('\n── self-test: the guard can actually fail ──');
{
  const line = "  showNotif('✨ Done');";
  ok(SPARK.test(line), 'a re-injected sparkle is caught');
  ok(SPARK.test("  const x = '\\u2728 Done';"), 'a sparkle written as an escape is caught too');
  ok(CHROME_EMOJI.test('\u{1F389} Your ad is live'), 'a re-injected emoji is caught');
  ok(!CHROME_EMOJI.test('✓ Wholesale price applied.'), 'a tick is not called an emoji');
  ok(!DATA_ROW('\u{1F389} one'), "one emoji is not a picker's data row");
  ok(DATA_ROW('\u{1F600}\u{1F601}\u{1F602}'), "a picker's data row is recognised");
  ok(/'Something went wrong\. Please try again\.'/.test(
       "res.status(500).json({ error: 'Something went wrong. Please try again.' })"),
     'a re-introduced untraceable 500 is caught');
  ok(!/'Something went wrong\. Please try again\.'|'Something went wrong\.'/.test(
       "error: 'Something went wrong on our side. If it keeps happening, quote reference '"),
     "fault()'s own honest wording is not mistaken for the old one");
}

console.log('\n═══ ' + pass + ' passed, ' + fail + ' failed ═══');
process.exit(fail ? 1 : 0);
