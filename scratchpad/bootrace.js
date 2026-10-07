/**
 * bootrace.js — the direct-entry boot race, reproduced on purpose (Batch 12B).
 *
 * A direct load opens its destination ~80ms into consumePendingRoute, and the destination's
 * address is written by acSyncPath on the NEXT animation frame. Boot ends on a 500ms timer.
 * When the main thread stalls, that frame lands after the timer and the arrival write —
 * asked for as a push by showOverlay — became a real push: a fabricated entry behind a
 * direct link, so App Back and browser Back both walked into it. Random timing found it
 * 1 run in 6 (release tree) and 2 in 6 (the tree before it).
 *
 * Here the race is forced: for the 450ms after consumePendingRoute starts, every animation
 * frame callback is held back 650ms, so the queued arrival write is guaranteed to run AFTER
 * the 500ms timer. Each case then runs twice:
 *   CONTROL — the page's boot-end line swapped back to the pre-fix one. The bad outcome MUST
 *             appear (a push, a fabricated entry, browser Back walking into it); otherwise the
 *             harness is not reproducing the race and the real checks would prove nothing.
 *   REAL    — the shipped page. No boot push, canonical written by replace, no extra depth,
 *             App Back lands on the logical Account parent by replace, browser Back leaves
 *             to the page before, and a normal navigation afterwards is exactly one push.
 *
 *   node bootrace.js           # expect all ok
 *   node bootrace.js --break   # the REAL pass also gets the pre-fix line: its checks must fail
 *
 * Owns its fixture (a seeded business account). 390x844 and 1440x900.
 */
const path = require('path');
const QA = require(path.join(__dirname, 'qa-fixture.js'));
const R = require(path.join(__dirname, '..', 'public', 'atwe-routes.js'));
const { chromium } = require(process.env.PW_SCRATCH
  ? path.join(process.env.PW_SCRATCH, 'node_modules/playwright-core')
  : path.join(__dirname, 'node_modules/playwright-core'));

const BREAK = process.argv.includes('--break');
const BASE = QA.base();
let pass = 0, fail = 0;
const say = (ok, what, extra) => { ok ? pass++ : fail++; console.log((ok ? '  ok   ' : '  FAIL ') + what + (extra !== undefined ? '   ' + JSON.stringify(extra) : '')); };
const ctl = (ok, what, extra) => say(ok, 'CONTROL (pre-fix line reproduces the race): ' + what, extra);

/* The pre-fix boot-end line, by the exact current source. */
const NOW_LINE = 'setTimeout(acEndBootWhenWritten, 500);';
const OLD_LINE = 'setTimeout(() => { try { AtweHistory.endBoot(); } catch (e) {} }, 500);';

/* Cases: a canonical Account tool, and two legacy aliases. Parents come from the registry. */
const TOOL = Object.fromEntries(R.ACCOUNT_TOOLS.map(([name, sub, view, section, , alias]) => [name, { path: '/account/' + sub, view, section, alias }]));
const CASES = [
  { load: TOOL.invoices.path, want: TOOL.invoices.path, view: TOOL.invoices.view, parent: '/account/' + TOOL.invoices.section, kind: 'canonical tool' },
  { load: TOOL.ads.alias, want: TOOL.ads.path, view: TOOL.ads.view, parent: '/account/' + TOOL.ads.section, kind: 'legacy alias' },
  { load: TOOL.team.alias, want: TOOL.team.path, view: TOOL.team.view, parent: '/account/' + TOOL.team.section, kind: 'legacy alias' },
];

/* Test-only harness, installed before any page script: a per-document id, the history length
   the document started with, and — the point — frames held back across the boot boundary. */
function harness() {
  window.__doc = Math.random().toString(36).slice(2);
  window.__len0 = history.length;
  window.__br = { consume: null, writes: [] };
  const raf = window.requestAnimationFrame.bind(window);
  let slowUntil = -1;
  window.requestAnimationFrame = (cb) => {
    if (performance.now() < slowUntil) return raf((t) => setTimeout(() => raf(cb), 650));
    return raf(cb);
  };
  const hook = setInterval(() => {
    let H; try { H = AtweHistory; } catch (e) { return; }
    if (!H || typeof window.consumePendingRoute !== 'function') return;
    clearInterval(hook);
    const c = window.consumePendingRoute;
    window.consumePendingRoute = function () { window.__br.consume = performance.now(); slowUntil = performance.now() + 450; return c.apply(this, arguments); };
    const w = H.write;
    H.write = function (p, push) { const r = w.apply(this, arguments); window.__br.writes.push({ t: performance.now(), path: p, pushed: r }); return r; };
  }, 1);
}

async function page(browser, token, vp, old) {
  const ctx = await browser.newContext({ viewport: vp, serviceWorkers: 'block' });
  await ctx.route(/localhost:\d+\/[^.]*$/, async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const res = await route.fetch();
    let html = await res.text();
    if (!html.includes(NOW_LINE)) throw new Error('bootrace: the boot-end line was not found, the probe is stale');
    if (old) html = html.split(NOW_LINE).join(OLD_LINE);
    await route.fulfill({ response: res, body: html, headers: { ...res.headers(), 'content-length': undefined } });
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript((t) => {
    try { localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_intro_seen', JSON.stringify(['beam', 'circles', 'ai', 'wallet'])); } catch (e) {}
  }, token);
  await p.addInitScript(harness);
  return { ctx, p, errs };
}
const booted = async (p) => {
  await QA.waitUntil(p, () => typeof S !== 'undefined' && !!(S.user && S.user.id), null, 25000);
  await QA.waitUntil(p, () => window.AtweHistory && !AtweHistory.booting, null, 15000);
  await p.waitForTimeout(900);
};
const state = (p) => p.evaluate(() => {
  const open = [...document.querySelectorAll('.overlay:not(.hidden):not(.closing)')].map((o) => o.id);
  const kinds = AtweHistory.log.map((e) => e.kind);
  const firstWrite = window.__br.writes.find((w) => w.path === location.pathname) || null;
  return { path: location.pathname, top: open[open.length - 1] || null, idx: (history.state || {}).idx, prev: (history.state || {}).prev,
    len: history.length, len0: window.__len0, doc: window.__doc, kinds, events: AtweHistory.log.length,
    lateBy: firstWrite && window.__br.consume != null ? Math.round(firstWrite.t - window.__br.consume) : null };
});

/* One case, one pass. Returns the observations; the caller decides what they must be. */
async function runCase(browser, token, vp, C, old) {
  const o = {};
  // (a) a fresh tab, the link opened directly.
  {
    const { ctx, p, errs } = await page(browser, token, vp, old);
    await p.goto(BASE + C.load, { waitUntil: 'domcontentloaded' }); await booted(p);
    const s = await state(p);
    o.arrive = s;
    const n = s.events;
    await p.evaluate(() => appGoBack()); await p.waitForTimeout(1000);
    const b = await state(p);
    o.appBack = { path: b.path, idx: b.idx, sameIdx: b.idx === s.idx, kinds: b.kinds.slice(n), len: b.len, top: b.top };
    // A normal in-app navigation after boot: exactly one push.
    const m = b.events;
    await p.evaluate(() => appTab('search')); await p.waitForTimeout(1000);
    const c = await state(p);
    o.after = { path: c.path, kinds: c.kinds.slice(m), lenGrew: c.len - b.len };
    o.errs = errs.slice();
    await ctx.close();
  }
  // (b) a tab with a page behind it: browser Back from the link must leave to that page.
  {
    const { ctx, p, errs } = await page(browser, token, vp, old);
    await p.goto(BASE + '/engine', { waitUntil: 'domcontentloaded' }); await booted(p);
    const before = await state(p);
    await p.goto(BASE + C.load, { waitUntil: 'domcontentloaded' }); await booted(p);
    const s = await state(p);
    await p.goBack({ timeout: 8000 }).catch(() => {}); await p.waitForTimeout(1500);
    const b = await p.evaluate(() => ({ path: location.pathname, doc: window.__doc })).catch(() => ({}));
    o.browserBack = { arrived: s.path, landed: b.path, newDocument: b.doc !== s.doc, backToBefore: b.doc === before.doc || (b.path === before.path && b.doc !== s.doc) };
    o.errs = o.errs.concat(errs);
    await ctx.close();
  }
  return o;
}

(async () => {
  const pool = QA.newPool();
  let acct;
  try { acct = await QA.seedAccount(pool, { business: true, prefix: 'br' }); } finally { await pool.end(); }
  const seen = await QA.serverSees(acct.token);
  if (!seen.ok) { console.log('  FAIL fixture: the server does not see the seeded account (HTTP ' + seen.status + ')'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const t0 = Date.now();
  try {
    for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      const tag = vp.width >= 1000 ? '[desktop]' : '[phone]';
      for (const C of CASES) {
        const t = `${tag} ${C.load} (${C.kind})`;
        console.log(`\n${t}`);
        // CONTROL: the pre-fix line must reproduce the bad outcome under the same forced timing.
        const k = await runCase(browser, acct.token, vp, C, true);
        ctl(k.arrive.lateBy > 500, `${t}: the arrival write was held past the 500ms boundary`, { lateBy: k.arrive.lateBy });
        ctl(k.arrive.kinds.includes('push') && k.arrive.prev != null, `${t}: boot pushed a fabricated entry`, { kinds: k.arrive.kinds, prev: k.arrive.prev });
        ctl(!k.browserBack.newDocument, `${t}: browser Back walked into the fabricated entry`, k.browserBack);
        // REAL: the shipped page under the same forced timing (or the pre-fix line under --break).
        const r = await runCase(browser, acct.token, vp, C, BREAK);
        const a = r.arrive;
        say(a.lateBy > 500, `${t}: the arrival write was held past the 500ms boundary (the race is exercised)`, { lateBy: a.lateBy });
        say(a.path === C.want && a.top === C.view, `${t}: lands on ${C.want} with the tool on top`, { path: a.path, top: a.top });
        say(!a.kinds.includes('push') && !a.kinds.includes('root-change'), `${t}: boot never pushes`, a.kinds);
        say(a.kinds[a.kinds.length - 1] === 'replace' && a.prev == null, `${t}: the canonical destination is written by replace, nothing behind it`, { kinds: a.kinds, prev: a.prev });
        say(a.len === a.len0, `${t}: exactly the expected history depth (no entry added)`, { len: a.len, len0: a.len0 });
        say(r.appBack.path === C.parent && r.appBack.sameIdx && r.appBack.kinds.length === 1 && r.appBack.kinds[0] === 'replace' && r.appBack.top !== C.view,
          `${t}: App Back -> ${C.parent} (the logical Account parent) by replace`, r.appBack);
        say(r.after.kinds.length === 1 && ['push', 'root-change'].includes(r.after.kinds[0]) && r.after.lenGrew === 1 && r.after.path === '/engine',
          `${t}: a normal navigation after boot is exactly one push`, r.after);
        say(r.browserBack.arrived === C.want && r.browserBack.newDocument && r.browserBack.landed === '/engine',
          `${t}: browser Back leaves to the page before (no fabricated boot entry)`, r.browserBack);
        say(r.errs.length === 0, `${t}: no JS errors`, r.errs.slice(0, 2));
      }
    }
  } finally { await browser.close(); }
  console.log(`\n${pass} passed, ${fail} FAILED${BREAK ? '   (--break: failures expected)' : ''}   (${Math.round((Date.now() - t0) / 1000)}s)`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
