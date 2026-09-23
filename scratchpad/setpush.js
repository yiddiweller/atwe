/* A ROUTED CHILD OPENED FROM A ROUTED PARENT MUST PUSH, NOT REPLACE.
 *
 * `acSyncPath` is rAF-debounced and the FIRST caller in a frame decided the history
 * intent. A Settings handover makes two calls in one frame:
 *
 *     closeSettings(true)  -> closeOverlay(id, true) -> acSyncPath()            push:false
 *     openDevices()        -> showOverlay(...)       -> acSyncPath({push:true}) DISCARDED
 *
 * so the child REPLACED the parent's entry instead of pushing its own. Measured on 1872:
 *
 *     acSyncPath({push:true})   _pathSyncQueued=false   ->  PUSH    /settings
 *     acSyncPath({push:false})  _pathSyncQueued=false
 *     acSyncPath({push:true})   _pathSyncQueued=true    <-- discarded
 *                                                       ->  REPLACE /devices
 *
 * With /settings overwritten, Back from the child skips Settings entirely: browser Back
 * and device Back both landed on /me. Devices only LOOKED right because `closeDevices()`
 * re-opens Settings on a 180ms timer - a hand-rolled workaround at one call site, not
 * general correctness. Settings -> Manage store, which has no such timer, failed on all
 * three Backs.
 *
 * Run:  DATABASE_URL=... JWT_SECRET=... node setpush.js [--break]
 *       --break restores the first-caller-wins behaviour.
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
const say = (ok, what, extra) => { ok ? pass++ : fail++; console.log((ok ? '  ok   ' : '  FAIL ') + what + (extra ? '   ' + extra : '')); };

async function serveOld(ctx) {
  await ctx.route('**/', async (route) => {
    const res = await route.fetch();
    let html = await res.text();
    html = html.replace(
      "  if (_pathSyncQueued) { if (wantPush) _pathSyncWantPush = true; return; }",
      "  if (_pathSyncQueued) return;");
    await route.fulfill({ response: res, body: html, headers: { ...res.headers(), 'content-length': undefined } });
  });
}

const SCR = ['acHomeScreen','acSearchScreen','acListScreen','acProfileScreen','acMeScreen','acPostViewScreen','acThreadScreen'];
const state = (p) => p.evaluate((SCR) => {
  const open = [...document.querySelectorAll('.overlay:not(.hidden):not(.closing)')].map((o) => o.id);
  const seen = {}, dupes = [];
  document.querySelectorAll('.overlay:not(.hidden)').forEach((o) => { if (seen[o.id]) dupes.push(o.id); seen[o.id] = 1; });
  const trapping = [...document.querySelectorAll('.overlay:not(.hidden)')].filter((o) => {
    const cs = getComputedStyle(o); return (cs.opacity === '0' || cs.visibility === 'hidden') && cs.pointerEvents !== 'none';
  }).map((o) => o.id);
  return { path: location.pathname, hist: history.length, open, dupes, trapping,
           tab: typeof _appTab !== 'undefined' ? _appTab : null,
           screen: SCR.find((id) => { const s = document.getElementById(id); return s && !s.classList.contains('hidden'); }) || null };
}, SCR);

async function freshPage(browser, u, viewport) {
  const ctx = await browser.newContext({ viewport });
  if (BREAK) await serveOld(ctx);
  const p = await ctx.newPage();
  await p.addInitScript((t) => {
    try { localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_intro_seen', JSON.stringify(['beam','circles','ai','wallet'])); } catch (e) {}
  }, u.token);
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await QA.waitUntil(p, () => !!(window.S && S.user && S.user.id), null, 25000);
  await p.waitForTimeout(1200);
  await p.evaluate(() => {
    window.__L = [];
    const ps = history.pushState.bind(history), rs = history.replaceState.bind(history);
    history.pushState = function (s, t, u2) { window.__L.push('PUSH ' + u2); return ps(s, t, u2); };
    history.replaceState = function (s, t, u2) { window.__L.push('REPLACE ' + u2); return rs(s, t, u2); };
  });
  return { ctx, p };
}

const CHILDREN = [
  ['Devices & sessions', '/devices', 'devicesOverlay',
   (p) => p.evaluate(() => {
     const b = [...document.querySelectorAll('#settingsOverlay .iset-body')].find((x) => getComputedStyle(x).display !== 'none');
     const r = b && [...b.querySelectorAll('.iset-row')].find((x) => (x.textContent || '').trim().startsWith('Devices & sessions'));
     if (!r) return false; r.click(); return true;
   }), 'security'],
  ['Manage store', '/store', 'storeManageView',
   (p) => p.evaluate(() => {
     const r = [...document.querySelectorAll('#settingsOverlay .iset-row')].find((x) => /Manage store/.test(x.textContent || ''));
     if (!r) return false; r.click(); return true;
   }), null],
];

/* open Settings (optionally a sub-page), then the routed child */
async function toChild(p, page, open) {
  await p.evaluate(() => { [...document.querySelectorAll('.overlay:not(.hidden)')].forEach((o) => { try { closeOverlay(o.id, true); } catch (e) {} }); });
  await p.waitForTimeout(400);
  await p.evaluate(() => appTab('profile'));
  await p.waitForTimeout(800);
  await p.evaluate(() => { window.__L = []; });
  await p.evaluate(() => openSettings());
  await p.waitForTimeout(1400);
  if (page) { await p.evaluate((pg) => setNav(pg), page); await p.waitForTimeout(1100); }
  const at = await state(p);
  const drove = await open(p);
  await p.waitForTimeout(2200);
  return { atSettings: at, drove };
}

async function drive(browser, u, viewport, tag) {
  for (const [label, route, view, open, page] of CHILDREN) {
    const { ctx, p } = await freshPage(browser, u, viewport);
    const { atSettings, drove } = await toChild(p, page, open);
    if (!drove) { say(false, `${tag} Settings -> ${label}: could not drive its real row`); await ctx.close(); continue; }
    const child = await state(p);
    const ledger = await p.evaluate(() => window.__L);
    say(atSettings.path === '/settings' && atSettings.open.includes('settingsOverlay'), `${tag} Settings -> ${label}: Settings was open on /settings first`, JSON.stringify(atSettings));
    say(child.open.includes(view) && child.path === route, `${tag} Settings -> ${label}: the child opens on ${route}`, JSON.stringify(child));

    /* THE LEDGER IS THE ROOT CAUSE MADE VISIBLE: the child must PUSH its own entry,
       never REPLACE the parent's. */
    const pushedChild = ledger.some((l) => l === 'PUSH ' + route);
    const replacedChild = ledger.some((l) => l === 'REPLACE ' + route);
    say(pushedChild && !replacedChild, `${tag} Settings -> ${label}: the child PUSHES, it does not REPLACE Settings`, JSON.stringify(ledger));

    /* one Back, three ways - each must land back on Settings */
    for (const [how, act] of [
      ['in-app', async () => p.evaluate((v) => { const o = document.getElementById(v); const btn = o && o.querySelector('.sheet-close,.msg-back,.iset-back,[aria-label^="Back"],[aria-label^="Close"]'); if (btn) btn.click(); }, view)],
      ['browser', async () => p.goBack().catch(() => {})],
      ['device', async () => p.evaluate(() => { try { return appGoBack(); } catch (e) { return 'threw'; } })],
    ]) {
      if (how !== 'in-app') { await toChild(p, page, open); }
      await act(); await p.waitForTimeout(2300);
      const b = await state(p);
      say(b.open.includes('settingsOverlay'), `${tag} Settings -> ${label}: ${how} Back restores SETTINGS`, JSON.stringify(b));
      say(b.path === '/settings', `${tag} Settings -> ${label}: ${how} Back restores /settings`, b.path);
      say(!b.open.includes(view), `${tag} Settings -> ${label}: ${how} Back closes the child`);
      say(b.dupes.length === 0 && b.trapping.length === 0, `${tag} Settings -> ${label}: ${how} Back leaves no duplicate/trapping overlay`, JSON.stringify([b.dupes, b.trapping]));
    }

    /* Forward must rebuild the child exactly once */
    await toChild(p, page, open);
    await p.goBack().catch(() => {}); await p.waitForTimeout(1900);
    await p.goForward().catch(() => {}); await p.waitForTimeout(2100);
    const f = await state(p);
    say(f.open.includes(view), `${tag} Settings -> ${label}: Forward rebuilds the child`, JSON.stringify(f));
    say(f.dupes.length === 0, `${tag} Settings -> ${label}: Forward makes no duplicate`, JSON.stringify(f.dupes));
    await ctx.close();
  }
}

(async () => {
  const pool = QA.newPool();
  const u = await QA.seedAccount(pool, { business: true, prefix: 'sp', balanceCents: 9000 });
  await pool.query("UPDATE users SET name='QA Bakery' WHERE id=$1", [u.id]);
  await QA.assertServerSees(u.token, u.username);
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  try {
    await drive(browser, u, { width: 390, height: 844 }, '[mobile]');
    await drive(browser, u, { width: 1440, height: 900 }, '[desktop]');
  } finally { await browser.close(); await pool.end().catch(() => {}); }
  console.log('\n' + pass + ' passed, ' + fail + ' FAILED');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
