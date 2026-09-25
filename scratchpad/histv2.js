/* History v2 + NavEvent (Route Audit batch 2).
 *
 * Every history entry Atwe writes carries { atwe:2, idx, key, route, path }, and every
 * navigation is announced as ONE NavEvent (AtweHistory.log / 'atwe:navigate'). This probe
 * drives a real browser through push, replace, reload, Back, Forward, a two-step jump,
 * legacy and foreign entries, and a deep-link boot, at a phone and a desktop width.
 *
 *   node histv2.js           the checks
 *   node histv2.js --break   serves the page with direction detection broken (always
 *                            "back"); the direction checks must FAIL, or they prove nothing.
 *
 * Signs in with ONE navigation (token seeded by an init script), like navhandoff.
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
const say = (ok, what, extra) => { ok ? pass++ : fail++; console.log((ok ? '  ok   ' : '  FAIL ') + what + (extra !== undefined ? '   ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); };

async function freshPage(browser, token, viewport, first) {
  const ctx = await browser.newContext({ viewport });
  if (BREAK) {
    await ctx.route(/localhost:\d+\/(\?.*)?$|localhost:\d+\/[a-z/-]*$/, async (route) => {
      if (route.request().resourceType() !== 'document') return route.continue();
      const res = await route.fetch();
      const html = (await res.text()).split("direction = delta < 0 ? 'back' : delta > 0 ? 'forward' : 'none';").join("direction = 'back';");
      await route.fulfill({ response: res, body: html, headers: { ...res.headers(), 'content-length': undefined } });
    });
  }
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript((t) => {
    try { localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_intro_seen', JSON.stringify(['beam', 'circles', 'ai', 'wallet'])); } catch (e) {}
  }, token);
  await p.goto(BASE + (first || '/'), { waitUntil: 'domcontentloaded' });
  await QA.waitUntil(p, () => !!(window.S && S.user && S.user.id), null, 25000);
  await QA.waitUntil(p, () => window.AtweHistory && !AtweHistory.booting, null, 15000);
  await p.waitForTimeout(600);
  return { ctx, p, errs };
}
const st = (p) => p.evaluate(() => ({ state: history.state, len: history.length, path: location.pathname,
  last: AtweHistory.log[AtweHistory.log.length - 1] || null, n: AtweHistory.log.length }));
const lastEvent = (p, kind) => p.evaluate((k) => [...AtweHistory.log].reverse().find((e) => !k || e.kind === k) || null, kind);
const settle = (p, ms) => p.waitForTimeout(ms || 900);

async function run(browser, token, viewport) {
  const tag = viewport.width >= 1000 ? '[desktop]' : '[phone]';
  const { ctx, p, errs } = await freshPage(browser, token, viewport);
  const owned = (s) => !!(s && s.atwe === 2 && Number.isInteger(s.idx) && s.idx > 0 && typeof s.key === 'string');

  // 1. the initial entry is ours
  let a = await st(p);
  say(owned(a.state), tag + ' 1. the arrival entry carries atwe:2 + idx + key', a.state);
  const first = await p.evaluate(() => AtweHistory.log[0]);
  say(first && first.kind === 'initial', tag + ' 1b. the first NavEvent is "initial"', first && first.kind);

  // 2. a push takes the next position
  const idx0 = a.state.idx, keys = new Set([a.state.key]);
  await p.evaluate(() => appTab('chat')); await settle(p);
  let b = await st(p);
  say(owned(b.state) && b.state.idx === idx0 + 1, tag + ' 2. a push increments idx', [idx0, b.state && b.state.idx]);
  say(b.len === a.len + 1, tag + ' 2b. ...and adds exactly one history entry', [a.len, b.len]);
  const pushEv = await lastEvent(p);
  say(pushEv && (pushEv.kind === 'push' || pushEv.kind === 'root-change') && pushEv.direction === 'forward',
    tag + ' 2c. a push is announced as push/root-change, forward', pushEv && [pushEv.kind, pushEv.direction]);
  say(pushEv && pushEv.kind === 'root-change' && pushEv.family === 'root', tag + ' 2d. Home → Beam is a root change', pushEv && [pushEv.kind, pushEv.family]);
  keys.add(b.state.key);

  // 3. a replace keeps the position and the key
  await p.evaluate(() => acSetPath('/notifications')); await settle(p, 300);
  let c = await st(p);
  say(c.state.idx === b.state.idx && c.state.key === b.state.key, tag + ' 3. a replace preserves idx and key', [b.state.idx, c.state.idx]);
  say(c.len === b.len, tag + ' 3b. ...and adds no entry', [b.len, c.len]);
  say(c.state.path === '/notifications' && c.state.path === c.path, tag + ' 3c. the replaced entry\'s path is the real URL', c.state.path);
  await p.evaluate(() => acSetPath('/messages')); await settle(p, 300);

  // more pushes for the traversal checks: /messages -> /search -> Settings -> Security (same-URL push)
  await p.evaluate(() => appTab('search')); await settle(p);
  const sSearch = (await st(p)).state; keys.add(sSearch.key);
  await p.evaluate(() => openSettings()); await settle(p);
  const sSettings = (await st(p)).state; keys.add(sSettings.key);
  await p.evaluate(() => setNav('security')); await settle(p);
  const sSec = (await st(p)).state; keys.add(sSec.key);
  say(sSec.idx === sSettings.idx + 1 && sSec.setPage === 'security' && sSec.path === '/settings',
    tag + ' 3d. a same-URL Settings page is a real position (1874 bookkeeping kept)', [sSettings.idx, sSec.idx, sSec.setPage]);
  say(sSearch.idx < sSettings.idx && sSettings.idx < sSec.idx, tag + ' 3e. positions only ever increase', [sSearch.idx, sSettings.idx, sSec.idx]);

  // 12. keys unique per pushed entry
  say(keys.size === 5, tag + ' 12. every pushed entry has its own key', [...keys]);

  // 13. route metadata = the registry's name for the URL (debug information only)
  const routes = await p.evaluate(() => ({ r: history.state.route, m: ATWE_ROUTES.match(location.pathname).name }));
  say(routes.r === routes.m, tag + ' 13. state.route is the registry name of the URL', routes);

  // 6. Back reports back (Security -> Settings hub is one step)
  await p.goBack(); await settle(p);
  let ev = await lastEvent(p, 'traverse');
  say(ev && ev.direction === 'back' && ev.delta === -1, tag + ' 6. browser Back reports back, delta -1', ev && [ev.direction, ev.delta]);
  const setPage = await p.evaluate(() => _setPage);
  say(setPage === 'hub', tag + ' 6b. ...and the 1874 behaviour is intact: Back from Security shows the Settings hub', setPage);

  // 7. Forward reports forward
  await p.goForward(); await settle(p);
  ev = await lastEvent(p, 'traverse');
  say(ev && ev.direction === 'forward' && ev.delta === 1, tag + ' 7. browser Forward reports forward, delta +1', ev && [ev.direction, ev.delta]);
  say((await p.evaluate(() => _setPage)) === 'security', tag + ' 7b. ...and Forward restores Security');

  // 8. a two-step jump
  await p.evaluate(() => history.go(-2)); await settle(p, 1400);
  ev = await lastEvent(p, 'traverse');
  say(ev && ev.direction === 'back' && ev.delta === -2, tag + ' 8. history.go(-2) reports back, delta -2', ev && [ev.direction, ev.delta]);
  say((await st(p)).path === '/search', tag + ' 8b. ...and lands on /search', (await st(p)).path);

  // 4/5. reload keeps the position and adds nothing
  const beforeReload = await st(p);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await QA.waitUntil(p, () => !!(window.S && S.user && S.user.id), null, 25000);
  await QA.waitUntil(p, () => window.AtweHistory && !AtweHistory.booting, null, 15000);
  await settle(p, 800);
  const afterReload = await st(p);
  say(afterReload.state.idx === beforeReload.state.idx && afterReload.state.key === beforeReload.state.key,
    tag + ' 4. reload adopts the entry\'s own idx and key', [beforeReload.state.idx, afterReload.state.idx]);
  say(afterReload.len === beforeReload.len, tag + ' 5. reload adds no history entries', [beforeReload.len, afterReload.len]);
  const k0 = await p.evaluate(() => AtweHistory.log[0] && AtweHistory.log[0].kind);
  say(k0 === 'reload', tag + ' 4b. the first NavEvent after a reload is "reload"', k0);

  // 9. an older build's v1 entry → unknown, never guessed
  await p.evaluate(() => history.replaceState({ atwe: 1, path: location.pathname }, ''));
  await p.evaluate(() => appTab('home')); await settle(p);
  const afterV1Push = (await st(p)).state;
  await p.goBack(); await settle(p);
  ev = await lastEvent(p, 'traverse');
  say(ev && ev.direction === 'unknown' && ev.legacyEntry === true, tag + ' 9. Back onto a v1 entry reports unknown', ev && [ev.direction, ev.legacyEntry]);

  // 10. a {} entry → unknown
  await p.evaluate(() => history.replaceState({}, ''));
  await p.goForward(); await settle(p);
  await p.goBack(); await settle(p);
  ev = await lastEvent(p, 'traverse');
  say(ev && ev.direction === 'unknown', tag + ' 10. Back onto a {} entry reports unknown', ev && ev.direction);

  // 11. foreign/legacy entries never corrupt the counter: the next push is still above everything
  await p.evaluate(() => appTab('chat')); await settle(p);
  const after = (await st(p)).state;
  say(owned(after) && after.idx > afterV1Push.idx, tag + ' 11. the next push after a legacy entry still takes a fresh, higher idx', [afterV1Push.idx, after.idx]);

  // 14. the path is never stale again, across every kind of write
  const drift = await p.evaluate(async () => {
    const out = [];
    const check = (label) => { if (history.state && history.state.path !== location.pathname) out.push([label, history.state.path, location.pathname]); };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    appTab('home'); await wait(300); check('home');
    acSetPath('/someone'); await wait(50); check('replace to a profile path');
    acSetPath('/listing/15'); await wait(50); check('replace to a listing path');
    appTab('search'); await wait(300); check('search');
    acSetPath('/event/3'); await wait(50); check('replace to an event path');
    stripParam(); check('stripParam');
    appTab('home'); await wait(300); check('home again');
    return out;
  });
  say(drift.length === 0, tag + ' 14. state.path always equals the URL (the stale-path bug cannot recur)', drift);

  // 15. hasUAVisualTransition is carried through when the browser supports it
  const ua = await p.evaluate(() => {
    let supported = false;
    try { supported = new PopStateEvent('popstate', { hasUAVisualTransition: true }).hasUAVisualTransition === true; } catch (e) {}
    if (!supported) return { supported };
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state, hasUAVisualTransition: true }));
    const e = [...AtweHistory.log].reverse().find((x) => x.kind === 'traverse');
    return { supported, ua: e && e.uaTransition };
  });
  if (ua.supported) say(ua.ua === true, tag + ' 15. hasUAVisualTransition reaches the NavEvent', ua);
  else say(true, tag + ' 15. hasUAVisualTransition not constructible in this browser: nothing to carry (skipped by name)');

  // 16. no JS errors
  say(errs.length === 0, tag + ' 16. no JS errors', errs.slice(0, 3));
  await ctx.close();
}

/* A deep link boots with ONE entry, and reloading it adds none (the audit's B4). */
async function deepLink(browser, token, viewport) {
  const tag = viewport.width >= 1000 ? '[desktop]' : '[phone]';
  for (const target of ['/settings/security', '/wallet', '/devices']) {
    const { ctx, p, errs } = await freshPage(browser, token, viewport, target);
    const a = await st(p);
    const pushes = await p.evaluate(() => AtweHistory.log.filter((e) => e.kind === 'push' || e.kind === 'root-change').length);
    say(a.len === 2 && pushes === 0, tag + ' D. a deep link to ' + target + ' boots with ONE Atwe entry (no fabricated pushes)', [a.len, pushes]);
    await p.reload({ waitUntil: 'domcontentloaded' });
    await QA.waitUntil(p, () => !!(window.S && S.user && S.user.id), null, 25000);
    await settle(p, 1400);
    const b = await st(p);
    say(b.len === a.len, tag + ' D2. reloading ' + target + ' adds no entries', [a.len, b.len]);
    say(errs.length === 0, tag + ' D3. no JS errors on ' + target, errs.slice(0, 2));
    await ctx.close();
  }
}

/* The ban on hidden destination state is structural: nothing may read route bookkeeping back. */
function sourceChecks() {
  const html = require('fs').readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const script = html.slice(html.indexOf('</head>'));
  say(!/history\.state\.(route|idx|key|path)\b/.test(script), 'S1. no app code reads route/idx/key/path back out of history.state');
  const writers = (script.match(/history\.(pushState|replaceState)\(/g) || []).length;
  say(writers <= 6, 'S2. every history write is inside AtweHistory (or its fallbacks)', writers);
}

(async () => {
  let token = process.env.TOK;
  if (!token) {
    const pool = QA.newPool();
    const u = await QA.seedAccount(pool, { prefix: 'hv' });
    await pool.end();
    token = u.token;
  }
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  try {
    for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      await run(browser, token, vp);
      await deepLink(browser, token, vp);
    }
    sourceChecks();
  } finally { await browser.close(); }
  console.log(`\n${pass} passed, ${fail} FAILED${BREAK ? '   (--break: failures expected)' : ''}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
