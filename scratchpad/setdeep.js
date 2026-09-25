/* EVERY MEANINGFUL SETTINGS LEVEL UNWINDS ONE STEP AT A TIME.
 *
 * Settings is ONE routed overlay (/settings). Its pages - Privacy, Security, Premium... -
 * are panels inside it, switched by setNav(), and a leaf opened from a page is a sheet
 * that either sits OVER Settings or is a handover that closes Settings first. A chain is
 *
 *     Settings hub  ->  a page  ->  a leaf  ->  (sometimes) a leaf's own child
 *
 * and Back from any level must land on the level directly above it, by the app's own
 * back arrow, by browser Back and by device Back (appGoBack) alike - never on the hub
 * when a page was open, never on the Account page when Settings was, never on Home.
 *
 * Every step is driven by a REAL control, found by its visible text, from a single
 * navigation sign-in. Each Back mechanism is measured from a fresh drive of the chain,
 * so one mechanism's leftovers can never be read as another's result.
 *
 * Two more shapes are covered. A LANDED page (Settings opened straight onto a page from
 * elsewhere, e.g. Notifications' own menu) never showed the hub, so Back returns to where
 * it came from on all three mechanisms. And after unwinding to the hub, Forward must
 * rebuild the page it came back from.
 *
 * Measured on 1873 before the fix: 178 passed, 90 FAILED - browser and device Back from
 * every page skipped the hub; every handover leaf returned to the hub or the Account page
 * instead of its page; returning from the Wallet reset Settings to the hub.
 *
 * Run:  DATABASE_URL=... JWT_SECRET=... node setdeep.js [--only=<chain prefix>] [--break]
 *       --break serves the page with the fix's three load-bearing parts removed
 *       (page history entries, restore-to-page, device Back through setBack).
 */
'use strict';
const path = require('path');
const QA = require(path.join(__dirname, 'qa-fixture.js'));
const { chromium } = require(process.env.PW_SCRATCH
  ? path.join(process.env.PW_SCRATCH, 'node_modules/playwright-core')
  : path.join(__dirname, 'node_modules/playwright-core'));

const BREAK = process.argv.includes('--break');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const BASE = QA.base();

/* --break: take out the page's own history entry, the restore-to-page, and device Back's
   route through setBack. Each alone is enough to fail named checks. */
async function serveOld(ctx) {
  await ctx.route('**/', async (route) => {
    const res = await route.fetch();
    let html = await res.text();
    const cuts = [
      ['  _setHistWrite(prevPage, pageName, opts);\n', ''],
      ["  if (_histRestoring && location.pathname === '/settings') {", '  if (false) {'],
      ["  if (ov && ov.id === 'settingsOverlay') { setBack(); return 'x'; }\n", ''],
    ];
    for (const [a, b] of cuts) { if (!html.includes(a)) throw new Error('--break could not find: ' + a.slice(0, 50)); html = html.replace(a, b); }
    await route.fulfill({ response: res, body: html, headers: { ...res.headers(), 'content-length': undefined } });
  });
}
let pass = 0, fail = 0;
const say = (ok, what, extra) => { ok ? pass++ : fail++; console.log((ok ? '  ok   ' : '  FAIL ') + what + (extra ? '   ' + extra : '')); };

const SCR = ['acHomeScreen', 'acSearchScreen', 'acListScreen', 'acProfileScreen', 'acMeScreen', 'acPostViewScreen', 'acThreadScreen'];
const state = (p) => p.evaluate((SCR) => {
  const open = [...document.querySelectorAll('.overlay:not(.hidden):not(.closing)')].map((o) => o.id);
  const seen = {}, dupes = [];
  document.querySelectorAll('.overlay:not(.hidden)').forEach((o) => { if (seen[o.id]) dupes.push(o.id); seen[o.id] = 1; });
  const trapping = [...document.querySelectorAll('.overlay:not(.hidden)')].filter((o) => {
    const cs = getComputedStyle(o); return (cs.opacity === '0' || cs.visibility === 'hidden') && cs.pointerEvents !== 'none';
  }).map((o) => o.id);
  return {
    path: location.pathname, hist: history.length, open, top: open[open.length - 1] || null, dupes, trapping,
    page: typeof _setPage !== 'undefined' ? _setPage : null,
    tab: typeof _appTab !== 'undefined' ? _appTab : null,
    screen: SCR.find((id) => { const s = document.getElementById(id); return s && !s.classList.contains('hidden'); }) || null,
  };
}, SCR);

/* ── real controls, by visible text ─────────────────────────────────────────── */
const tapIn = (scope, re) => (p) => p.evaluate(([scope, re]) => {
  const rx = new RegExp(re);
  const root = document.querySelector(scope);
  if (!root) return false;
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const el = [...root.querySelectorAll('.iset-row, .me-row, button, [onclick]')].filter(vis)
    .find((x) => rx.test((x.textContent || '').trim().replace(/\s+/g, ' ')));
  if (!el) return false; el.click(); return true;
}, [scope, re]);
const hubRow = (re) => tapIn('#settingsOverlay .iset-body[data-page="hub"]', re);
const pageRow = (page, re) => tapIn(`#settingsOverlay .iset-body[data-page="${page}"]`, re);

/* the app's OWN back control on whatever is on top */
const inAppBack = (p) => p.evaluate(() => {
  const open = [...document.querySelectorAll('.overlay:not(.hidden):not(.closing)')];
  const top = open[open.length - 1];
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  if (!top) return 'none';
  const SEL = '.iset-back, .sheet-close, .msg-back, .pf-top-x, .plans-close, [aria-label^="Back"], [aria-label^="Close"]';
  const b = [...top.querySelectorAll(SEL)].find(vis);
  if (!b) return 'no-control:' + top.id;
  b.click(); return 'clicked:' + top.id;
});

/* ── the chains ─────────────────────────────────────────────────────────────
   Each level: [label, drive, expectation]. An expectation names the surface that must
   be on top and, for Settings itself, the page it must be showing.            */
const S = (page) => ({ top: 'settingsOverlay', page });
const L = (id) => ({ top: id });
function chains() {
  return [
    // ── pages whose leaf sits OVER Settings
    ['P1 Privacy -> Blocked accounts',     [['Privacy & safety', hubRow('^Privacy & safety'), S('privacy')], ['Blocked accounts', pageRow('privacy', '^Blocked accounts'), L('blockedOverlay')]]],
    ['P2 Privacy -> Muted words',          [['Privacy & safety', hubRow('^Privacy & safety'), S('privacy')], ['Muted words', pageRow('privacy', '^Muted words'), L('mutedWordsOverlay')]]],
    ['P3 Security -> Two-factor',          [['Security & access', hubRow('^Security & access'), S('security')], ['Two-factor', pageRow('security', '^Two-factor'), L('twoFaView')]]],
    ['P4 Display -> Language',             [['Display & accessibility', hubRow('^Display & accessibility'), S('display')], ['Language', pageRow('display', '^Language'), L('langView')]]],
    ['P5 About -> Report a problem',       [['About & legal', hubRow('^About & legal'), S('about')], ['Report a problem', pageRow('about', '^Report a problem'), L('feedbackView')]]],
    ['P6 Premium -> Creator subscriptions', [['Premium', hubRow('^Premium & verification'), S('premium')], ['Creator subscriptions', pageRow('premium', '^Creator subscriptions'), L('creatorSubView')]]],
    // ── pages whose leaf is a HANDOVER that closes Settings
    ['H1 Security -> Devices & sessions',  [['Security & access', hubRow('^Security & access'), S('security')], ['Devices & sessions', pageRow('security', '^Devices & sessions'), L('devicesOverlay')]]],
    ['H2 Security -> Locked sections',     [['Security & access', hubRow('^Security & access'), S('security')], ['Locked sections', pageRow('security', '^Locked sections'), L('lockedSectionsOverlay')]]],
    ['H3 Privacy -> Who can contact you',  [['Privacy & safety', hubRow('^Privacy & safety'), S('privacy')], ['Who can contact you', pageRow('privacy', '^Who can contact you'), L('privacyOverlay')]]],
    ['H4 Premium -> Your plan',            [['Premium', hubRow('^Premium & verification'), S('premium')], ['Your plan', pageRow('premium', '^Your plan'), L('plansOverlay')]]],
    ['H5 Assistant -> Ask about your data', [['Atwe Assistant', hubRow('^Atwe Assistant'), S('assistant')], ['Ask about your data', pageRow('assistant', '^Ask about your data'), L('aiAskView')]]],
    ['H6 Data -> Posts you have read',     [['Your data', hubRow('^Your data & storage'), S('data')], ['Posts you have read', pageRow('data', '^Posts you'), L('historyView')]]],
    ['H7 Account -> Username',             [['Your account', hubRow('^Your account'), S('account')], ['Username', pageRow('account', '^Username'), L('profileOverlay')]]],
    // ── a hub row that is itself a handover, with a level below it
    ['S1 Manage store -> Vacation mode',   [['Manage store', hubRow('^Manage store'), L('storeManageView')], ['Vacation mode', tapIn('#storeManageView', '^Vacation mode'), L('vacationView')]]],
    // ── a routed destination over Settings, with four real levels
    ['W1 Premium -> Wallet -> Request',    [['Premium', hubRow('^Premium & verification'), S('premium')], ['Wallet', pageRow('premium', '^Wallet'), L('walletView')], ['Request', tapIn('#walletView', '^Request$'), L('requestMoneyView')]]],
    ['W2 Premium -> Wallet -> Money requests', [['Premium', hubRow('^Premium & verification'), S('premium')], ['Wallet', pageRow('premium', '^Wallet'), L('walletView')], ['Money requests', tapIn('#walletView', '^Money requests'), L('moneyRequestsView')]]],
  ];
}

/* Wait until what is on screen stops changing, rather than sleeping a fixed two seconds
   after every step. A step here can trigger a deferred history walk (a microtask), a
   popstate restore that holds _histRestoring for 260ms, a 180ms reopen timer and a 360ms
   slide, so "unchanged for 600ms" is the bar - with a 4s ceiling and a floor, so a
   surface that is still arriving is never read half-drawn. */
async function settle(p, floor = 450) {
  await p.waitForTimeout(floor);
  const sig = () => p.evaluate(() => [location.pathname, history.length,
    [...document.querySelectorAll('.overlay:not(.hidden):not(.closing)')].map((o) => o.id).join(','),
    typeof _setPage !== 'undefined' ? _setPage : '',
    typeof _histRestoring !== 'undefined' ? String(_histRestoring) : ''].join('|'));
  let last = await sig(), stableSince = Date.now();
  const end = Date.now() + 4000;
  while (Date.now() < end) {
    await p.waitForTimeout(120);
    const cur = await sig();
    if (cur !== last) { last = cur; stableSince = Date.now(); }
    else if (Date.now() - stableSince >= 600 && !cur.endsWith('|true')) return;
  }
}

const matches = (st, want) => st.top === want.top && (want.page === undefined || st.page === want.page);
const clean = (st) => st.dupes.length === 0 && st.trapping.length === 0;

const _ctxs = {};
async function freshPage(browser, u, viewport) {
  const key = viewport.width + 'x' + viewport.height;
  /* serviceWorkers:'block' is load-bearing. With one context per viewport the app's service
     worker registers on the first page and serves every later page's shell itself, from
     /__shell/<stamp> - a path the --break route never sees - so the self-test silently ran
     the REAL code on every page after the first and reported a clean result. */
  if (!_ctxs[key]) { _ctxs[key] = await browser.newContext({ viewport, serviceWorkers: 'block' }); if (BREAK) await serveOld(_ctxs[key]); }
  const p = await _ctxs[key].newPage();
  const ctx = { close: () => p.close() };   // a fresh PAGE has its own history; the context only shares cache
  await p.addInitScript((t) => {
    try { localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_intro_seen', JSON.stringify(['beam', 'circles', 'ai', 'wallet'])); } catch (e) {}
  }, u.token);
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  /* `S` is a top-level let in the app, NOT a window property: `window.S` is always
     undefined, so a check written that way never passes and QA.waitUntil simply runs out
     its clock (it returns false, it does not throw). That was 35 silent seconds per page. */
  const signedIn = await QA.waitUntil(p, () => typeof S !== 'undefined' && !!(S.user && S.user.id), null, 20000);
  if (!signedIn) throw new Error('not signed in after 20s');
  await p.waitForTimeout(1200);
  return { ctx, p };
}

/* Settings is opened from the Account page's own Settings row, so the world under it is
   the one a member really has: Account (/me). Returns false if a level could not be driven. */
async function drive(p, levels) {
  await p.evaluate(() => { [...document.querySelectorAll('.overlay:not(.hidden)')].forEach((o) => { try { closeOverlay(o.id, true); } catch (e) {} }); });
  await p.waitForTimeout(350);
  await p.evaluate(() => appTab('profile'));
  await settle(p, 700);
  if (!(await tapIn('#acMeBody', '^Settings$')(p))) return { ok: false, at: 'the Account page Settings row' };
  await settle(p);
  const trail = [{ label: 'Settings', st: await state(p), want: S('hub') }];
  for (const [label, go, want] of levels) {
    if (!(await go(p))) return { ok: false, at: label };
    await settle(p);
    trail.push({ label, st: await state(p), want });
  }
  return { ok: true, trail };
}

/* A LANDED page: Settings opened straight onto a page from somewhere else. The hub was
   never on screen, so Back returns to that somewhere else, by every mechanism. */
function landings() {
  return [
    ['N1 Notifications menu -> Notification settings', {
      origin: async (p) => { await p.evaluate(() => appTab('home')); await p.waitForTimeout(700); await p.evaluate(() => acNavNotifs()); await p.waitForTimeout(1300); },
      originWant: { top: 'notifOverlay' }, originPath: '/notifications',
      go: async (p) => {
        if (!(await p.evaluate(() => { const b = document.getElementById('notifMoreBtn'); if (!b) return false; b.click(); return true; }))) return false;
        await p.waitForTimeout(500);
        return p.evaluate(() => { const i = [...document.querySelectorAll('.aimp-item')].find((x) => /acNotifMenuPick\('settings'\)/.test(x.getAttribute('onclick') || '')); if (!i) return false; i.click(); return true; });
      },
      want: S('notifications') }],
  ];
}

async function runLandings(browser, u, viewport, tag) {
  for (const [name, c] of landings()) {
    if (ONLY && !name.startsWith(ONLY)) continue;
    for (const how of ['in-app', 'browser', 'device']) {
      const { ctx, p } = await freshPage(browser, u, viewport);
      try {
        await p.evaluate(() => { [...document.querySelectorAll('.overlay:not(.hidden)')].forEach((o) => { try { closeOverlay(o.id, true); } catch (e) {} }); });
        await p.waitForTimeout(350);
        await c.origin(p);
        const o = await state(p);
        if (!(await c.go(p))) { say(false, `${tag} ${name} [${how}]: could not drive its real control`); continue; }
        await settle(p);
        const at = await state(p);
        if (how === 'in-app') say(matches(at, c.want), `${tag} ${name}: lands straight on the page`, JSON.stringify({ top: at.top, page: at.page, path: at.path }));
        const via = how === 'in-app' ? await inAppBack(p)
          : how === 'browser' ? (await p.goBack().catch(() => {}), 'goBack')
          : await p.evaluate(() => { try { return appGoBack(); } catch (e) { return 'threw'; } });
        await settle(p);
        const b = await state(p);
        say(matches(b, c.originWant) && b.path === c.originPath && !b.open.includes('settingsOverlay') && clean(b),
          `${tag} ${name} [${how}]: Back returns to where Settings was opened from`,
          JSON.stringify({ via, top: b.top, page: b.page, path: b.path, open: b.open, origin: o.path }));
      } catch (e) {
        say(false, `${tag} ${name} [${how}]: threw ${String(e).slice(0, 120)}`);
      } finally { await ctx.close(); }
    }
  }
}

async function run(browser, u, viewport, tag) {
  for (const [name, levels] of chains()) {
    if (ONLY && !name.startsWith(ONLY)) continue;
    for (const how of ['in-app', 'browser', 'device']) {
      const { ctx, p } = await freshPage(browser, u, viewport);
      try {
        const d = await drive(p, levels);
        if (!d.ok) { say(false, `${tag} ${name} [${how}]: could not drive its real control (${d.at})`); continue; }
        // the chain opened where it should, level by level
        if (how === 'in-app') {
          d.trail.forEach((t, i) => say(matches(t.st, t.want), `${tag} ${name}: level ${i + 1} (${t.label}) opens on its own surface`,
            JSON.stringify({ top: t.st.top, page: t.st.page, path: t.st.path })));
        }
        // unwind one level at a time, back to the Settings hub
        let reachedHub = false;
        for (let i = d.trail.length - 1; i >= 1; i--) {
          const from = d.trail[i].label, want = d.trail[i - 1].want;
          const via = how === 'in-app' ? await inAppBack(p)
            : how === 'browser' ? (await p.goBack().catch(() => {}), 'goBack')
            : await p.evaluate(() => { try { return appGoBack(); } catch (e) { return 'threw'; } });
          await settle(p);
          const st = await state(p);
          say(matches(st, want) && clean(st),
            `${tag} ${name} [${how}]: Back from ${from} lands on ${d.trail[i - 1].label}`,
            JSON.stringify({ via, top: st.top, page: st.page, path: st.path, open: st.open, screen: st.screen, dupes: st.dupes, trap: st.trapping }));
          if (!matches(st, want)) break;   // one wrong turn; later levels would only repeat it
          if (i === 1) reachedHub = true;
        }
        // from the hub, one more Back leaves Settings for the world it was opened from
        if (reachedHub) {
          if (how === 'in-app') await inAppBack(p);
          else if (how === 'browser') await p.goBack().catch(() => {});
          else await p.evaluate(() => { try { appGoBack(); } catch (e) {} });
          await settle(p);
          const out = await state(p);
          say(!out.open.includes('settingsOverlay') && out.screen === 'acMeScreen' && out.path === '/me' && clean(out),
            `${tag} ${name} [${how}]: Back from the hub leaves Settings for the Account page`,
            JSON.stringify({ open: out.open, path: out.path, screen: out.screen }));
          // Forward rebuilds Settings, then the level it came back from - never a stale sheet
          if (how === 'browser') {
            await p.goForward().catch(() => {}); await settle(p);
            const f1 = await state(p);
            say(matches(f1, S('hub')) && clean(f1), `${tag} ${name} [browser]: Forward reopens the Settings hub`,
              JSON.stringify({ top: f1.top, page: f1.page, path: f1.path, dupes: f1.dupes }));
            const lvl1 = d.trail[1].want;
            if (lvl1.page) {
              await p.goForward().catch(() => {}); await settle(p);
              const f2 = await state(p);
              say(matches(f2, lvl1) && clean(f2), `${tag} ${name} [browser]: Forward again rebuilds ${d.trail[1].label}`,
                JSON.stringify({ top: f2.top, page: f2.page, path: f2.path, dupes: f2.dupes }));
            }
          }
        }
      } catch (e) {
        say(false, `${tag} ${name} [${how}]: threw ${String(e).slice(0, 120)}`);
      } finally { await ctx.close(); }
    }
  }
}

(async () => {
  const pool = QA.newPool();
  const u = await QA.seedAccount(pool, { business: true, prefix: 'sd', balanceCents: 9000 });
  await pool.query("UPDATE users SET name='QA Bakery' WHERE id=$1", [u.id]);
  await QA.assertServerSees(u.token, u.username);
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  try {
    await run(browser, u, { width: 390, height: 844 }, '[mobile]');
    await runLandings(browser, u, { width: 390, height: 844 }, '[mobile]');
    await run(browser, u, { width: 1440, height: 900 }, '[desktop]');
    await runLandings(browser, u, { width: 1440, height: 900 }, '[desktop]');
  } finally { await browser.close(); await pool.end(); }
  console.log(`\n${pass} passed, ${fail} FAILED`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('CRASH', e); process.exit(1); });
