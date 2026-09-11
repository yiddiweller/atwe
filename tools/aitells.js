/* WHAT IN THIS APP READS AS "A MACHINE WROTE IT"?
 *
 * The founder's own brief. The em dash was the first one they met and it is now swept and
 * guarded; this looks for the rest of the family in the SAME place -- the text a member
 * can actually see, never comments, never code.
 *
 * Every category below is a real tell that appears in text people recognise as generated:
 * the sparkle for anything clever, chirpy exclamation marks, emoji standing in for icons,
 * consultant vocabulary, "Oops!", and the semicolon nobody uses in an interface.
 *
 * It REPORTS. It changes nothing: some of these are deliberate and some are wrong, and
 * that is a judgement to put in front of the founder rather than a sweep to run.
 *
 *   node tools/aitells.js            summary
 *   node tools/aitells.js <category> every hit with its file and line
 */
'use strict';
const fs = require('fs'), path = require('path');
const { readableRanges } = require('./jstext.js');
const ROOT = path.resolve(__dirname, '..');

const FILES = ['public/index.html', 'public/admin.html', 'server.js', 'db.js', 'auth.js',
  'mailer.js', 'billing.js', 'demo.js', 'push.js', 'storage.js', 'stt.js', 'shiptax.js',
  'shiplabels.js', 'finance.js', 'geoip.js', 'features-data.js'];

/* Is this run of text something a PERSON reads, or is it a class name, a selector, a URL,
   a SQL query, a key? Getting this wrong is how a scan reports a clean app or a broken
   one: the first version counted every `--accent` and every `/api/...` as prose. */
function looksLikeProse(t) {
  const s = t.trim();
  if (s.length < 4 || s.length > 400) return false;
  if (!/[a-z]{2}/.test(s)) return false;
  if (!/\s/.test(s)) return false;                          // one word is a token, not a sentence
  if (/[<>{}]|\$\{|\bfunction\b|=>|\(\)/.test(s)) return false;
  if (/^[\s|:;,.\-]*$/.test(s)) return false;
  if (/\/(api|assets)\//.test(s) || /^https?:/i.test(s)) return false;
  if (/\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN|COALESCE|ON CONFLICT)\b/.test(s)) return false;
  if (/^[a-z0-9-]+(\s+[a-z0-9-]+)*$/.test(s) && /-/.test(s)) return false;   // "ac-post-btn ac-x"
  if (/^[.#][a-zA-Z]/.test(s)) return false;                // a selector
  if (/;\s*[a-z-]+\s*:/.test(s)) return false;              // inline CSS
  const words = s.split(/\s+/).filter((w) => /^[A-Za-z'’]{2,}$/.test(w));
  return words.length >= 2;
}

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2728}]/u;

const CATEGORIES = [
  ['emdash',  'an em or en dash used as punctuation', (s) => /\s[–—]\s|[a-z][–—][a-z]/i.test(s)],
  ['sparkle', 'the sparkle, wand or robot standing for "clever"', (s) => /[✨✦✧✴\u{1FA84}\u{1F916}\u{1F52E}]/u.test(s)],
  ['emoji',   'an emoji doing an icon\'s job', (s) => EMOJI.test(s)],
  ['exclaim', 'a cheerful exclamation mark', (s) => /[a-z]!(\s|$|["’”])/i.test(s) && !/^[A-Z\s]+!$/.test(s.trim())],
  ['buzz',    'consultant vocabulary', (s) => /\b(seamless(ly)?|effortless(ly)?|supercharge|unlock (your|the|more)|elevate your|empower(s|ing)? (you|your)|dive (in|into)|leverage|robust|comprehensive|cutting[- ]edge|game[- ]chang|take it to the next level|in today's|delve|tapestry|realm of|testament to|embark)\b/i.test(s)],
  ['oops',    '"Oops" and friends', (s) => /\b(oops|uh[- ]oh|whoops|yikes)\b/i.test(s)],
  ['vague',   '"Something went wrong" with no reason', (s) => /something went wrong/i.test(s)],
  /* Strip HTML entities FIRST. `&amp;` is a semicolon followed by a space and a letter,
     so an unguarded test reported "Hire &amp; recruit" as a semicolon in a sentence -- 192
     of them, almost all of them entities. */
  ['semi',    'a semicolon in a sentence on screen', (s) => /[a-z];\s+[a-z]/i.test(s.replace(/&[a-zA-Z]+;|&#\d+;/g, '&'))],
  ['weask',   '"we" and "our" speaking as the company', (s) => /\b(we(’|')(ll|re|ve)|we will|our team|we recommend|we suggest|let(’|')s)\b/i.test(s)],
];

function hits() {
  const found = new Map(CATEGORIES.map(([k]) => [k, []]));
  for (const rel of FILES) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf8');
    const isHtml = rel.endsWith('.html');
    let ranges; try { ranges = readableRanges(src, isHtml); } catch (e) { continue; }
    const lineOf = (i) => src.slice(0, i).split('\n').length;
    for (const [a, b] of ranges) {
      const t = src.slice(a, b);
      if (!looksLikeProse(t)) continue;
      for (const [key, , test] of CATEGORIES) {
        let ok = false; try { ok = test(t); } catch (e) {}
        if (ok) found.get(key).push({ file: rel, line: lineOf(a), text: t.trim().replace(/\s+/g, ' ').slice(0, 120) });
      }
    }
  }
  return found;
}

const found = hits();
const want = process.argv[2];
if (want) {
  const rows = found.get(want) || [];
  console.log(want + ': ' + rows.length + ' in text a member can see\n');
  for (const r of rows) console.log('  ' + r.file + ':' + r.line + '  ' + r.text);
} else {
  console.log('WHAT READS AS MACHINE-WRITTEN — text a member can see\n');
  for (const [key, label] of CATEGORIES) {
    const rows = found.get(key);
    console.log('  ' + String(rows.length).padStart(5) + '  ' + key.padEnd(9) + label);
  }
  console.log('\n  node tools/aitells.js <category>   to see every one');
}
