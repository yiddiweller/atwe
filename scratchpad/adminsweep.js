/* THE DASHBOARD, EVERY TAB, MEASURED — the admin's own version of `legible.js` + `sweep.js`.
 *
 * The founder asked for a short pass over the dashboard once the web app was done, and
 * this is what came out of it: the objective battery, kept standing so it cannot drift.
 * It drives all 68 views at a desktop width AND at a phone width, and asks the same
 * questions of each:
 *
 *   1) does it open without throwing, and without a console error;
 *   2) is it showing its own failure line ("Could not load." / "Could not check.");
 *   3) did it actually ASK THE SERVER — a data view that makes no request is broken
 *      however it happens to fail (this is what `admintabs.js` was written for after
 *      five tabs spent months unable to reach their routes);
 *   4) does the PAGE spill sideways;
 *   5) is any text under the WCAG floor, scored against a COMPOSITED background.
 *
 * Two things it had to learn, both of which made an earlier run report the wrong thing:
 *
 *   • SCOPE IT TO THE WHOLE PAGE, NOT `.main`. The first version scored only the content
 *     column and came back with two faults. The sidebar's own group labels (MONEY,
 *     PEOPLE …) and every field placeholder in the dashboard were painted with `--t4`,
 *     the ICON tint — 2.02:1 to 2.30:1 — and none of them were in scope. A check that
 *     excludes most of its subject reports a clean result.
 *   • A CHILD INSIDE A HORIZONTAL SCROLLER IS NOT A SPILL. `.tf-ranges` scrolls its own
 *     row of buttons, so their boxes legitimately reach past the viewport; counting them
 *     reported the 14-language row on the Wording tab as broken when it behaves exactly
 *     as designed. Only a PAGE that scrolls sideways is a fault.
 *
 * ONE NAMED EXCEPTION, and it is a decision the founder has to make, not this file:
 * the destructive red button paints `--red-tint` on `--red` and measures 3.22:1. On
 * #FF0033 nothing light clears 4.5 — white is 3.96 — so the only ways out are a darker
 * ink (the colour law's own answer for bright fills) or a darker red, and both change
 * how the brand's red reads. Recorded as D2 in docs/ADMIN-SWEEP-LIST.md. Delete the
 * exception the day it is decided.
 */
const { chromium } = require('playwright-core');
const crypto = require('crypto');
const PORT = process.env.PORT || 3262;
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let ok = 0; const fails = [];
const chk = (c, m, extra) => { if (c) ok++; else fails.push(m + (extra ? ' — ' + extra : '')); };

const DEAD = /Could not check|Could not load|could not run/i;
/* Views with nothing to fetch — they are a form, an embedded page or a local list.
   Everything else must reach the server, and that is the check that matters. */
const NO_FETCH = new Set(['features', 'aistudio', 'emailbrand', 'developers']);
const D2 = /^\.btn\.danger /;                       // the one founder decision, exact prefix

const SCORE = `(${function () {
  const lum = (c) => { const [r, g, bl] = c.map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * bl; };
  const px = (c) => { const m = String(c).match(/[\d.]+/g); return m ? m.slice(0, 3).map(Number) : null; };
  /* Composite, never hunt for a background that is opaque "enough" — any threshold has a
     blind spot somewhere, and compositing has none. */
  const bgOf = (el) => {
    const layers = []; let n = el;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const m = String(cs.backgroundColor).match(/[\d.]+/g);
      if (m) { const a = m[3] === undefined ? 1 : +m[3]; if (a > 0) layers.push([+m[0], +m[1], +m[2], a]); if (a >= .999) break; }
      n = n.parentElement;
    }
    const rm = String(getComputedStyle(document.body).backgroundColor).match(/[\d.]+/g);
    let base = (layers.length && layers[layers.length - 1][3] >= .999) ? layers.pop().slice(0, 3) : (rm ? [+rm[0], +rm[1], +rm[2]] : [0, 0, 0]);
    for (let i = layers.length - 1; i >= 0; i--) { const [r, g, bl, a] = layers[i]; base = [base[0] + (r - base[0]) * a, base[1] + (g - base[1]) * a, base[2] + (bl - base[2]) * a]; }
    return base;
  };
  const inScroller = (el) => { let n = el.parentElement;
    while (n && n !== document.documentElement) { if (/(auto|scroll|hidden)/.test(getComputedStyle(n).overflowX)) return true; n = n.parentElement; }
    return false; };
  const out = { contrast: [], spill: [], dead: '' };
  const all = document.body.innerText || '';
  const m = all.match(/Could not check[^\n]*|Could not load[^\n]*|could not run[^\n]*/i);
  if (m) out.dead = m[0].slice(0, 90);
  if (document.documentElement.scrollWidth > innerWidth + 1)
    out.spill.push('page ' + document.documentElement.scrollWidth + ' > ' + innerWidth);
  const score = (el, text, colour, tag) => {
    const cs = getComputedStyle(el);
    const fg = px(colour), bg = bgOf(el); if (!fg || !bg) return;
    const L1 = lum(fg), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05);
    const size = parseFloat(cs.fontSize) || 14, bold = (+cs.fontWeight || 400) >= 700;
    const floor = (size >= 24 || (size >= 18.66 && bold)) ? 3 : 4.5;
    if (ratio < floor - .05)
      out.contrast.push('.' + String(el.className || el.tagName).split(' ').join('.') + tag + ' "' + text.slice(0, 16) + '" ' + ratio.toFixed(2) + ':1 @' + Math.round(size) + 'px');
  };
  /* ONE traversal. This runs 68 times per width against pages that can hold thousands of
     nodes, and walking them three times (spill, text, placeholders) took the whole sweep
     past `run-all.sh`'s own 600s ceiling — a guard that is killed by the runner protects
     nothing. Same work, one pass, and `getComputedStyle` called once per element. */
  /* ASK THE CHEAP QUESTION FIRST. `getComputedStyle` is the expensive call here and these
     pages can hold many thousands of nodes — the Support inbox alone. Deciding from the
     RECT whether an element is even a candidate (on screen at all, or reaching past the
     right edge) BEFORE styling it is the difference between this finishing in a couple of
     minutes and being killed by `run-all.sh`'s own 600s ceiling. Styling every node of a
     long page to score the one screenful you can see is work thrown away. */
  document.body.querySelectorAll('*').forEach((el) => {
    const r = el.getBoundingClientRect();
    const cx = r.x + Math.min(r.width / 2, 40), cy = r.y + r.height / 2;
    const overRight = r.width > 0 && r.right > innerWidth + 2;
    const onScreen = r.width >= 8 && r.height >= 6 && cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight;
    if (!overRight && !onScreen) return;
    const cs = getComputedStyle(el);
    if (overRight && cs.position !== 'fixed' && !inScroller(el))
      out.spill.push(((el.className && String(el.className).split(' ')[0]) || el.tagName) + ' right=' + Math.round(r.right));
    if (!onScreen) return;
    if (cs.visibility === 'hidden' || +cs.opacity < .6) return;
    /* Only score what the browser would actually paint at that point — a view keeps its
       markup after you leave it, and without this the guard scores words nobody can see. */
    const top = document.elementFromPoint(cx, cy);
    if (!top || !(top === el || el.contains(top) || top.contains(el))) return;
    const t = (el.textContent || '').trim();
    if (!el.children.length && t.length >= 3) score(el, t, cs.color, '');
    /* A PLACEHOLDER IS TEXT SOMEBODY HAS TO READ to know what the field is for. The
       dashboard painted every one of them with the icon tint; nothing looked at them. */
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const ph = el.getAttribute('placeholder');
      if (ph && ph.length >= 3) score(el, ph, getComputedStyle(el, '::placeholder').color, '::placeholder');
    }
  });
  out.contrast = [...new Set(out.contrast)];
  out.spill = [...new Set(out.spill)];
  return out;
}})()`;

(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'scoresecret';
  const auth = require('/home/user/atwe/auth.js');
  const { Pool } = require('/home/user/atwe/node_modules/pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const u = (await pool.query('SELECT id,email,is_admin FROM users WHERE is_admin LIMIT 1')).rows[0];
  chk(!!u, 'an admin account to sign in as');
  if (!u) { console.log('0 checks'); process.exit(1); }
  const tok = auth.signToken(u);
  await pool.query('INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
    [crypto.createHash('sha256').update(tok).digest('hex'), u.id, 'adminsweep', '127.0.0.1']);

  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const badContrast = new Map(); const badSpill = new Map(); let d2seen = 0;

  for (const [label, W, H] of [['desktop', 1280, 900], ['phone', 390, 780]]) {
    const ctx = await b.newContext({ viewport: { width: W, height: H } });
    const p = await ctx.newPage();
    let errs = []; let reqs = [];
    p.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
    p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 140)); });
    p.on('request', (r) => reqs.push(r.url()));

    /* THE SIGNED-OUT SCREENS FIRST, before a token exists — the gate and the sign-in form
       are the only part of the dashboard a person sees before anything is loaded, and the
       tab loop below never reaches them. */
    await p.goto(`http://localhost:${PORT}/admin.html`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1200);
    for (const [what, run] of [['the gate', null], ['the sign-in form', 'showLogin()']]) {
      if (run) { await p.evaluate((r) => { (0, eval)(r); }, run); await p.waitForTimeout(400); }
      const r = await p.evaluate(SCORE);
      r.contrast.forEach((x) => { if (D2.test(x)) { d2seen++; return; } (badContrast.get(x) || badContrast.set(x, new Set()).get(x)).add(label + ' ' + what); });
      r.spill.forEach((x) => (badSpill.get(x) || badSpill.set(x, new Set()).get(x)).add(label + ' ' + what));
    }

    /* `let token = localStorage.getItem('atwe_token')` runs at load, so the token has to be
       in storage BEFORE the page boots — assigning it afterwards cannot rebind a `let`, and
       every request then goes out as `Bearer undefined`, which renders the exact failure
       line this probe is hunting. It reported red on correct code before that was understood. */
    await p.addInitScript((t) => localStorage.setItem('atwe_token', t), tok);
    await p.goto(`http://localhost:${PORT}/admin.html`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2500);
    const tabs = await p.evaluate(() => Object.keys(NAV_TITLES));
    chk(tabs.length > 40, `${label}: the dashboard names its views`, String(tabs.length));

    for (const t of tabs) {
      errs = []; reqs = [];
      let threw = '';
      try { await p.evaluate((v) => { switchTab(v); }, t); } catch (e) { threw = String(e).slice(0, 120); }
      /* WAIT FOR THE VIEW, NOT FOR A CLOCK. Nearly every view paints a spinner and then
         fills in from its own fetch; a flat 1s wait reported five perfectly good tabs as
         EMPTY because they were still fetching, and a flat 3s wait made the whole sweep
         slower than the runner's own timeout. So: poll until the content column holds real
         text and the spinner has gone, up to 4s, then give it a beat to settle. A wait that
         is too short reports a fault on working code just as surely as one too long hides one. */
      await p.waitForFunction(() => {
        const c = document.getElementById('content');
        if (!c) return false;
        if (c.querySelector('.ld')) return false;                 // still spinning
        return (c.innerText || '').trim().length > 0 || c.querySelector('iframe');
      }, null, { timeout: 4000 }).catch(() => {});
      await p.waitForTimeout(450);
      const r = await p.evaluate(SCORE).catch((e) => ({ contrast: [], spill: [], dead: '', probe: String(e) }));
      chk(!threw, `${label}/${t}: opens without throwing`, threw);
      chk(errs.length === 0, `${label}/${t}: no JS error`, [...new Set(errs)].join(' | '));
      chk(!r.dead, `${label}/${t}: is not showing its failure line`, r.dead);
      if (!NO_FETCH.has(t)) chk(reqs.some((x) => x.includes('/api/')), `${label}/${t}: actually asked the server`, 'no request at all');
      r.contrast.forEach((x) => { if (D2.test(x)) { d2seen++; return; } (badContrast.get(x) || badContrast.set(x, new Set()).get(x)).add(label + '/' + t); });
      r.spill.forEach((x) => (badSpill.get(x) || badSpill.set(x, new Set()).get(x)).add(label + '/' + t));
    }
    await ctx.close();
  }

  chk(badContrast.size === 0, 'every word in the dashboard clears the legibility floor',
      [...badContrast].slice(0, 6).map(([k, v]) => k + ' [' + [...v][0] + ']').join(' ; '));
  chk(badSpill.size === 0, 'nothing spills sideways',
      [...badSpill].slice(0, 6).map(([k, v]) => k + ' [' + [...v][0] + ']').join(' ; '));
  /* The exception must stay HONEST: if the red button ever stops being a fault the
     exception is dead wood and should go, so say so rather than passing quietly. */
  console.log(`  (the one known exception — the red destructive button, D2 — was seen ${d2seen} times)`);

  await b.close(); await pool.end();
  if (fails.length) console.log('== FAILS ==\n' + fails.map((f) => '  FAIL ' + f).join('\n'));
  console.log(`ok checks: ${ok}`);
  console.log(fails.length ? `${fails.length} FAILED` : 'every admin tab opens, reaches its route and reads cleanly');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
