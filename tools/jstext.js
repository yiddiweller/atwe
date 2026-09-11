/* WHICH CHARACTERS IN A FILE CAN A PERSON ACTUALLY READ?
 *
 * Written for the em-dash sweep and kept because the guard that stops it coming back
 * needs the same answer forever. The naive version of this — track quotes, skip //
 * and slash-star — is WRONG on this codebase in three ways that each let real comments
 * through and each made the first scan report code as user-facing copy:
 *
 *   1. A REGEX LITERAL CONTAINING A SLASH. `/https?:\/\//` is not the start of a
 *      comment, and `/'/` is not the start of a string. Telling a regex from a
 *      division sign needs the PREVIOUS significant token, which is the one genuinely
 *      hard part of tokenising JavaScript and the reason a two-line stripper cannot work.
 *   2. A TEMPLATE LITERAL WITH ${...} IN IT. Inside the braces it is code again — with
 *      its own strings, comments and nested templates — and this app builds almost every
 *      screen out of exactly that.
 *   3. AN APOSTROPHE IN A COMMENT. "doesn't" ends the comment as far as a quote-counter
 *      is concerned, and everything after it reads as a string.
 *
 * It returns the source with every comment blanked to spaces (so byte offsets and line
 * numbers still line up with the real file) and, separately, the ranges that are string
 * or template TEXT — which is what a person can read.
 */
'use strict';

const RE_OK_BEFORE = /[({[,;:=!&|?+\-*%~^<>]$/;      // a regex may follow these
const KEYWORD_BEFORE = /\b(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;

function scan(src) {
  const out = Buffer.from(src, 'utf8').toString('utf8').split('');   // char array copy
  const text = [];                                                   // [start,end) readable runs
  const n = src.length;
  let i = 0;
  let prevSig = '';           // the last significant (non-comment, non-space) chunk seen
  const stack = [];           // template-literal nesting: each entry is a brace depth

  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };

  while (i < n) {
    const c = src[i], d = src[i + 1];

    // ── comments ───────────────────────────────────────────────────────────
    if (c === '/' && d === '/') { const s = i; while (i < n && src[i] !== '\n') i++; blank(s, i); continue; }
    if (c === '/' && d === '*') { const s = i; i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i = Math.min(n, i + 2); blank(s, i); continue; }

    // ── strings ────────────────────────────────────────────────────────────
    if (c === '"' || c === "'") {
      const q = c; i++; const s = i;
      while (i < n) { if (src[i] === '\\') { i += 2; continue; } if (src[i] === q || src[i] === '\n') break; i++; }
      text.push([s, i]); if (src[i] === q) i++; prevSig = q; continue;
    }

    // ── template literals (and the code inside ${ }) ───────────────────────
    if (c === '`') {
      i++; let s = i;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '`') { text.push([s, i]); i++; break; }
        if (src[i] === '$' && src[i + 1] === '{') {
          text.push([s, i]);
          i += 2; stack.push(1);
          // hand control back to the main loop for the expression
          break;
        }
        i++;
      }
      if (stack.length && src[i - 1] === '{') { prevSig = '{'; continue; }
      prevSig = '`'; continue;
    }
    if (c === '}' && stack.length) {
      stack[stack.length - 1]--;
      if (stack[stack.length - 1] === 0) {                 // back into the template's text
        stack.pop(); i++; const s = i;
        while (i < n) {
          if (src[i] === '\\') { i += 2; continue; }
          if (src[i] === '`') { text.push([s, i]); i++; prevSig = '`'; break; }
          if (src[i] === '$' && src[i + 1] === '{') { text.push([s, i]); i += 2; stack.push(1); prevSig = '{'; break; }
          i++;
        }
        continue;
      }
      i++; prevSig = '}'; continue;
    }
    if (c === '{' && stack.length) { stack[stack.length - 1]++; i++; prevSig = '{'; continue; }

    // ── a regex literal, or a division sign? ───────────────────────────────
    if (c === '/') {
      const p = prevSig;
      const isRegex = p === '' || RE_OK_BEFORE.test(p) || KEYWORD_BEFORE.test(p);
      if (isRegex) {
        i++; let cls = false;
        while (i < n) {
          if (src[i] === '\\') { i += 2; continue; }
          if (src[i] === '[') cls = true;
          else if (src[i] === ']') cls = false;
          else if (src[i] === '/' && !cls) break;
          else if (src[i] === '\n') break;
          i++;
        }
        i++; while (i < n && /[a-z]/.test(src[i])) i++;
        prevSig = '/re/'; continue;
      }
      i++; prevSig = '/'; continue;
    }

    if (!/\s/.test(c)) prevSig = (prevSig + c).slice(-12);
    i++;
  }
  return { code: out.join(''), text };
}

/* HTML: the same job, plus <!-- --> and the two languages inside <script>/<style>.
   Readable = text nodes and the human-readable attributes, never markup or CSS. */
function scanHtml(src) {
  let out = src.split('');
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  // HTML comments first
  let i = 0;
  while ((i = src.indexOf('<!--', i)) !== -1) { const e = src.indexOf('-->', i); const end = e === -1 ? src.length : e + 3; blank(i, end); i = end; }
  let s = out.join('');
  // then each <script> / <style> body, scanned as JS / blanked as CSS
  const rescan = (tag, fn) => {
    const re = new RegExp('<' + tag + '[^>]*>', 'gi');
    let m;
    while ((m = re.exec(s))) {
      const a = m.index + m[0].length;
      const b = s.toLowerCase().indexOf('</' + tag, a);
      if (b === -1) break;
      const body = s.slice(a, b);
      s = s.slice(0, a) + fn(body) + s.slice(b);
      re.lastIndex = b;
    }
  };
  rescan('script', (b) => scan(b).code);
  rescan('style', (b) => b.replace(/\/\*[\s\S]*?\*\//g, (x) => x.replace(/[^\n]/g, ' ')));
  return s;
}

/* THE READABLE RUNS, as [start, end) offsets into the original source.
   A rewrite has to work on a whole RUN, never on a line: deciding whether a dash is one
   of a parenthetical PAIR, and whether the word after it should be capitalised, needs the
   sentence around it, and a line is neither. Splicing by offset also means a file with
   forty thousand lines of code comes back byte-identical apart from the runs touched. */
function readableRanges(src, isHtml) {
  if (!isHtml) return scan(src).text;
  const out = [];
  const lower = src.toLowerCase();
  // Attributes a person reads. `value` is deliberately absent: it is a form's DATA far
  // more often than its label, and rewriting one would change what a field submits.
  const ATTRS = /\b(placeholder|title|aria-label|aria-placeholder|alt|data-i18n|data-i18n-ph|data-i18n-aria|label)\s*=\s*(["'])([^"']*)\2/gi;
  let i = 0;
  while (i < src.length) {
    if (src.startsWith('<!--', i)) { const e = src.indexOf('-->', i); i = e === -1 ? src.length : e + 3; continue; }
    if (src[i] === '<') {
      const tagEnd = src.indexOf('>', i);
      if (tagEnd === -1) break;
      const tag = src.slice(i, tagEnd + 1);
      const closing = /^<\s*\//.test(tag);
      const name = (tag.match(/^<\s*\/?\s*([a-z0-9-]+)/i) || [, ''])[1].toLowerCase();
      ATTRS.lastIndex = 0; let am;
      while ((am = ATTRS.exec(tag))) {
        const vStart = i + am.index + am[0].length - am[3].length - 1;
        out.push([vStart, vStart + am[3].length]);
      }
      /* Only an OPENING <script>/<style> starts a raw-text run. Treating the CLOSING tag
         as one too made it hunt for the next </style> in the file, find none, and swallow
         everything after it — which silently dropped every string in the app's own script
         block because one <style> happened to come first. */
      if (!closing && (name === 'script' || name === 'style')) {
        const close = lower.indexOf('</' + name, tagEnd);
        const bodyEnd = close === -1 ? src.length : close;
        if (name === 'script') for (const [a, b] of scan(src.slice(tagEnd + 1, bodyEnd)).text)
          out.push([tagEnd + 1 + a, tagEnd + 1 + b]);
        i = bodyEnd; continue;                       // CSS carries nothing a person reads
      }
      i = tagEnd + 1; continue;
    }
    const next = src.indexOf('<', i);
    const end = next === -1 ? src.length : next;
    if (end > i) out.push([i, end]);                 // a text node
    i = end;
  }
  return out;
}

/* Rewrite every readable run with `fn`, leaving every other byte exactly as it was. */
function rewriteReadable(src, fn, isHtml) {
  const ranges = readableRanges(src, isHtml).slice().sort((a, b) => a[0] - b[0]);
  let out = '', at = 0, changed = 0;
  for (const [a, b] of ranges) {
    if (a < at) continue;                            // ranges can nest; first one wins
    const was = src.slice(a, b), now = fn(was);
    if (now !== was) changed++;
    out += src.slice(at, a) + now; at = b;
  }
  return { text: out + src.slice(at), changed };
}

module.exports = { scan, scanHtml, readableRanges, rewriteReadable };
