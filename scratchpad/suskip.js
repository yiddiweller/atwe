/* "SKIP FOR NOW" ON THE SIGN-UP PASSWORD STEP MUST DO SOMETHING (route batch 4.1).
 *
 * The defect: the button carried onclick="suPassSkip()". An inline handler runs with its
 * <form> in the scope chain, and a form exposes every control it holds BY ID — so inside
 * #suPassStep the name `suPassSkip` resolved to the button itself, and a tap threw
 * "suPassSkip is not a function" and did nothing. Google sign-ups, the only people who
 * see the button, were stuck on the password step unless they typed one.
 *
 * What this holds to, each asked of a REAL browser press (Playwright's click / keyboard,
 * never a synthesised event, which is untrusted and can skip default actions):
 *   1. a tap on the visible button runs the skip ONCE and throws nothing;
 *   2. Enter and Space on the focused button each run it once;
 *   3. Enter in the password field still SUBMITS the form (Continue), never the skip;
 *   4. no <form> in the app holds a control whose id/name equals a function an inline
 *      handler in that same form calls — the whole class of this bug, not just this row.
 *
 *   node suskip.js           the checks
 *   node suskip.js --break   serves the pre-fix markup (inline onclick, no listener);
 *                            checks 1, 2 and 4 must FAIL, or they prove nothing.
 */
'use strict';
const path = require('path');
const QA = require(path.join(__dirname, 'qa-fixture.js'));
const { chromium } = require(process.env.PW_SCRATCH
  ? path.join(process.env.PW_SCRATCH, 'node_modules/playwright-core')
  : path.join(__dirname, 'node_modules/playwright-core'));

const BREAK = process.argv.includes('--break');
const BASE = QA.base();
let pass = 0, fail = 0;
const say = (ok, what, extra) => { ok ? pass++ : fail++; console.log((ok ? '  ok   ' : '  FAIL ') + what + (extra !== undefined ? '   ' + JSON.stringify(extra) : '')); };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  try {
    for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      const tag = vp.width >= 1000 ? '[desktop]' : '[phone]';
      const ctx = await browser.newContext({ viewport: vp });
      if (BREAK) {
        await ctx.route(/localhost:\d+\/(\?.*)?$/, async (route) => {
          if (route.request().resourceType() !== 'document') return route.continue();
          const res = await route.fetch();
          const html = (await res.text())
            .split('id="suPassSkip">Skip for now').join('id="suPassSkip" onclick="suPassSkip()">Skip for now')
            .split("if (b) b.addEventListener('click', (e) => { e.preventDefault(); suPassSkip(); });").join('');
          await route.fulfill({ response: res, body: html, headers: { ...res.headers(), 'content-length': undefined } });
        });
      }
      const p = await ctx.newPage();
      const errs = [];
      p.on('pageerror', (e) => errs.push(e.message));
      await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await QA.waitUntil(p, () => typeof window.suShow === 'function' && typeof window.SU === 'object', null, 20000);
      await p.waitForTimeout(1500);

      /* Put a Google sign-up on the password step (the only case that shows Skip) and
         count the skip's effect rather than letting it walk on through the wizard. */
      await p.evaluate(() => {
        SU.oauth = true; SU.mode = 'google'; SU.email = 'skip@example.com'; SU.password = 'x';
        window.__skips = 0; window.__submits = 0;
        window.suGoToCategories = () => { window.__skips++; };
        window.suPassContinue = () => { window.__submits++; };
        showOverlay('signupOverlay'); suShow('suPassStep'); suPassGoogleUI();
      });
      await p.waitForTimeout(500);
      const vis = await p.evaluate(() => { const r = document.getElementById('suPassSkip').getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      say(vis, tag + ' 0. Skip for now is on screen for a Google sign-up');

      const errs0 = errs.length;
      await p.click('#suPassSkip', { timeout: 5000 }).catch((e) => errs.push('click: ' + e.message));
      await p.waitForTimeout(300);
      const a = await p.evaluate(() => ({ skips: window.__skips, submits: window.__submits, pw: SU.password }));
      say(a.skips === 1 && a.pw === '' && a.submits === 0 && errs.length === errs0, tag + ' 1. a tap runs the skip exactly once and throws nothing', { ...a, errs: errs.slice(errs0) });

      await p.focus('#suPassSkip'); await p.keyboard.press('Enter'); await p.waitForTimeout(250);
      const b = await p.evaluate(() => window.__skips);
      await p.focus('#suPassSkip'); await p.keyboard.press('Space'); await p.waitForTimeout(250);
      const c = await p.evaluate(() => ({ skips: window.__skips, submits: window.__submits }));
      say(b === 2 && c.skips === 3 && c.submits === 0, tag + ' 2. Enter and Space on the focused button each run it once', [b, c]);

      await p.evaluate(() => { const pw = document.getElementById('suPass'); pw.value = 'a-good-password-123'; pw.focus(); });
      await p.keyboard.press('Enter'); await p.waitForTimeout(300);
      const d = await p.evaluate(() => ({ skips: window.__skips, submits: window.__submits }));
      say(d.submits === 1 && d.skips === 3, tag + ' 3. Enter in the password field still submits Continue, not the skip', d);

      const clashes = await p.evaluate(() => {
        const out = [];
        for (const f of document.querySelectorAll('form')) {
          const names = new Set();
          for (const el of f.querySelectorAll('[id],[name]')) { if (el.id) names.add(el.id); if (el.name) names.add(el.name); }
          for (const el of [f, ...f.querySelectorAll('*')]) {
            for (const at of el.getAttributeNames()) {
              if (!/^on/.test(at)) continue;
              for (const m of (el.getAttribute(at) || '').matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) if (names.has(m[1])) out.push((f.id || 'form') + ': ' + m[1]);
            }
          }
        }
        return out;
      });
      say(clashes.length === 0, tag + ' 4. no form holds a control named like a function its own inline handlers call', clashes);
      say(errs.length === 0, tag + ' 5. no JS errors', errs.slice(0, 3));
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(`\n${pass} passed, ${fail} FAILED${BREAK ? '   (--break: failures expected)' : ''}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
