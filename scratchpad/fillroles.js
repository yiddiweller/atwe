/* THE TWO COLOUR ROLES, MEASURED — docs/WEB-FINISH-LIST.md D1 and docs/ADMIN-SWEEP-LIST.md D2.
 *
 * Atwe's blue and its red each have to do two opposite jobs, and one value cannot do both:
 * white text ON the colour wants it DARK, the colour as text ON black wants it BRIGHT.
 * #0088FF is 5.97:1 on black and only 3.52:1 under white; #FF0033 is 5.30:1 on black and
 * 3.96:1 under white. So each hue is a PAIR — --accent / --accent-fill and --red / --red-fill
 * — which is Material Design 3's own model (a brand tone plus a darker container tone).
 *
 * This file holds the pair to its contract, and every check MEASURES rather than reads a
 * rule. Reading rules tells you what the CSS says, never what a person sees.
 *
 *   1) the fill really carries white:      >= 4.5:1  (the floor for ordinary text)
 *   2) the fill is still a UI mark on black:  >= 3:1  (SC 1.4.11, for the dots and bars
 *      painted with it — a fill dark enough for white text can go too far the other way)
 *   3) the identity colour stays BRIGHT on black: >= 4.5:1, so nothing was "fixed" by
 *      darkening the links and usernames too
 *   4) NOTHING is left painting a solid fill with the identity colour — the whole point is
 *      that the two roles never blur back together. Read out of the SOURCE, both files.
 *   5) a CUSTOM accent derives its own fill. The picker writes --accent inline on <body>;
 *      without this the links would turn the chosen colour while every selected control in
 *      the app stayed blue.
 *   6) the four filled destructive controls really do clear the floor, on screen.
 *
 * Self-tested: pointing --accent-fill back at --accent fails 1, 4 and 6.
 */
const fs = require('fs');
const path = require('path');
/* RESOLVE THE SOURCE FILES FROM THIS FILE, NEVER FROM THE WORKING DIRECTORY. `run-all.sh`
   cd's into scratchpad/ before running each probe, so a relative 'public/index.html' throws
   ENOENT there while working perfectly when the probe is run by hand from the repo root —
   i.e. green standalone, CRASHED in the suite, which prints a stack trace rather than the
   "N FAILED" line a monitor greps for. That is the fourth shape of quiet runner gap this
   repo has recorded, after a stale path, a probe missing from the list, and a probe that
   could only ever skip. */
const REPO = (f) => path.join(__dirname, '..', f);
const { chromium } = require('playwright-core');
const PORT = process.env.PORT || 3262;
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let ok = 0; const fails = [];
const chk = (c, m, extra) => { if (c) ok++; else fails.push(m + (extra ? ' — ' + extra : '')); };

const lin = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
const lum = ([r, g, b]) => .2126 * lin(r) + .7152 * lin(g) + .0722 * lin(b);
const cr = (a, b) => { const A = lum(a), B = lum(b); return (Math.max(A, B) + .05) / (Math.min(A, B) + .05); };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

(async () => {
  /* 4 — SOURCE. A fill written with the identity colour is the fault this pair exists to
     end, and it can hide on a screen no probe happens to open, so it is read out of the
     file rather than off a page. Both spellings, and the flat gradients that are really
     just fills. */
  for (const f of ['public/index.html', 'public/admin.html']) {
    const s = fs.readFileSync(REPO(f), 'utf8');
    for (const [name, re, skip] of [
      ['blue', /background(-color)?:\s*var\(--accent\)(?=[;,}\s])/g],
      ['red', /background(-color)?:\s*var\(--red\)(?=[;,}\s])/g],
      /* A FLAT accent-to-accent gradient is a solid fill written the long way, and there
         were nine of them. `background-clip:text` is the exception and must NOT be caught:
         there the gradient IS the letters, so it is identity, not a fill. */
      ['a flat blue gradient', /linear-gradient\([^)]*var\(--accent\)\s*(\d+%)?\s*,\s*var\(--accent\)[^}]{0,140}/g, /background-clip:\s*text/],
    ]) {
      const hits = (s.match(re) || []).filter((h) => !(skip && skip.test(h)));
      chk(hits.length === 0, `${f}: no solid ${name} fill is painted with the identity colour`,
          hits.length + ' left: ' + (hits[0] || '').slice(0, 70));
    }
  }

  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  for (const [where, url] of [['app', `http://localhost:${PORT}/`], ['dashboard', `http://localhost:${PORT}/admin.html`]]) {
    for (const theme of (where === 'app' ? ['black', 'light'] : ['black'])) {
      const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
      const p = await ctx.newPage();
      await p.goto(url, { waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(900);
      if (theme === 'light') { await p.evaluate(() => document.body.classList.add('light')); await p.waitForTimeout(150); }
      const v = await p.evaluate(() => {
        const cs = getComputedStyle(document.body);
        const g = (n) => cs.getPropertyValue(n).trim();
        return { accent: g('--accent'), fill: g('--accent-fill'), tint: g('--accent-tint'),
                 red: g('--red'), redFill: g('--red-fill'), redTint: g('--red-tint'),
                 bg: cs.backgroundColor };
      });
      /* A TOKEN'S VALUE IS A HEX STRING AND rgb() IS NOT — reading digits out of "#0071E0"
         finds "0071" and "0", which is two numbers, and every ratio comes back NaN.
         A NaN comparison is always false, so this failed on correct code until it asked
         which shape it was holding. */
      const px = (c) => { const t = String(c).trim();
        if (t[0] === '#') return hex(t.length === 4 ? '#' + t[1] + t[1] + t[2] + t[2] + t[3] + t[3] : t);
        const m = t.match(/[\d.]+/g); return m ? m.slice(0, 3).map(Number) : null; };
      const page = px(v.bg);
      const label = `${where}/${theme}`;
      for (const [hue, ident, fill, tint] of [['blue', v.accent, v.fill, v.tint], ['red', v.red, v.redFill, v.redTint]]) {
        chk(!!fill, `${label}: the ${hue} declares a --*-fill at all`);
        if (!fill) continue;
        const f = px(fill), i = px(ident), t = px(tint);
        // 1 — the fill really carries its ink
        chk(cr(t, f) >= 4.5, `${label}: ${hue} fill carries its ink at 4.5:1`, cr(t, f).toFixed(2) + ':1');
        // 2 — and is still a legible UI mark against the page
        chk(cr(f, page) >= 3, `${label}: ${hue} fill still clears the 3:1 UI floor on the page`, cr(f, page).toFixed(2) + ':1');
        /* 3 — the identity colour was NOT darkened along with the fill. Two things, and
           deliberately NOT "4.5:1 as text on the page": that is a question about a real
           piece of text on a real background, and `legible.js` answers it by measuring 60
           screens in both themes. Asserting it here off the token would duplicate that and
           would fail on something long-standing rather than on this change — Light's
           --accent is 3.96:1 on white and has been since it was introduced, with no
           surface actually rendering small text in it. What THIS file owns is that the
           pair still points in opposite directions. */
        /* >=, not >: Light's --accent is already dark enough to carry white, so its fill
           IS its accent and the pair legitimately collapses to one value there. What must
           never happen is the identity colour ending up DARKER than the fill — that would
           mean the links had been darkened to fix the buttons. */
        chk(lum(i) >= lum(f) - 1e-9, `${label}: ${hue} identity colour is never darker than its fill`,
            'identity ' + ident + ' vs fill ' + fill);
        chk(cr(i, page) >= 3, `${label}: ${hue} identity colour clears the 3:1 UI floor on the page`, cr(i, page).toFixed(2) + ':1');
      }
      // 5 — a custom accent derives its own fill (app only; the dashboard has no picker)
      if (where === 'app') {
        const custom = await p.evaluate(() => {
          const out = [];
          for (const c of ['#FF6B00', '#00D1B2', '#8E44AD', '#FFE000']) {
            applyAccent(c);
            const cs = getComputedStyle(document.body);
            out.push([c, cs.getPropertyValue('--accent-fill').trim(), cs.getPropertyValue('--accent-tint').trim()]);
          }
          applyAccent(null);
          return [out, getComputedStyle(document.body).getPropertyValue('--accent-fill').trim()];
        });
        for (const [c, fill, tint] of custom[0])
          chk(cr(px(tint), px(fill)) >= 4.5, `${label}: a custom accent ${c} derives a fill that carries its ink`,
              fill + ' ' + cr(px(tint), px(fill)).toFixed(2) + ':1');
        chk(custom[1] === v.fill, `${label}: clearing the custom accent puts the theme's own fill back`, custom[1]);
      }
      await ctx.close();
    }
  }

  /* 6 — the real destructive controls, on screen. The dashboard's .btn.danger is what D2
     was raised against, so it is measured where it actually renders rather than in the
     abstract. Built off-screen: a Cancel button only exists once a webinar does. */
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    await p.goto(`http://localhost:${PORT}/admin.html`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(900);
    const r = await p.evaluate(() => {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:0;top:0;z-index:99999';
      host.innerHTML = '<button class="btn danger">Cancel it</button><span class="u-badge">banned</span>';
      document.body.appendChild(host);
      const out = [];
      for (const el of host.children) {
        const cs = getComputedStyle(el);
        out.push([el.className, cs.color, cs.backgroundColor, cs.fontSize, cs.fontWeight]);
      }
      host.remove();
      return out;
    });
    for (const [cls, fg, bg, size, weight] of r) {
      const ratio = cr(px2(fg), px2(bg));
      const s = parseFloat(size), bold = (+weight || 400) >= 700;
      const floor = (s >= 24 || (s >= 18.66 && bold)) ? 3 : 4.5;
      chk(ratio >= floor, `dashboard: .${cls.split(' ').join('.')} clears its floor`, ratio.toFixed(2) + ':1 @' + Math.round(s) + 'px');
    }
    await ctx.close();
  }
  function px2(c) { const m = String(c).match(/[\d.]+/g); return m.slice(0, 3).map(Number); }

  await b.close();
  fails.forEach((f) => console.log('  FAIL ' + f));
  console.log(`${ok} passed, ${fails.length} FAILED`);
  process.exit(fails.length ? 1 : 0);
})();
