/* Route batch 11 — navigation motion OBSERVES navigation.
 *
 * Every chain is run twice: with motion and with AtweMotion.off = true. The semantic result
 * (address, history position, the visible scene) must be identical; motion may only add
 * presentation. While a motion runs: at most one leaving plane per motion plane, every
 * leaving plane inert + aria-hidden and never under a hit-test. After it settles: no
 * .mo-leaving, no .mo-shade, no inline transform / will-change left by the motion layer,
 * focus somewhere real. Plus: families and directions, rapid / interrupted navigation,
 * failure injection (animate throws, animate missing), reduced motion (OS and the app's own
 * switch), direct load / reload (no motion), slow destination, page hidden, breakpoint
 * change, uaTransition, scroll restore, and a performance comparison at 4x CPU.
 *
 *   node navmotion.js            the checks (390x844, 844x390, 768x1024, 1440x900)
 *   node navmotion.js --break    motion delays navigation and leaves its leaving plane
 *                                interactive (the defects this batch forbids); must FAIL
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
const say = (ok, what, extra) => { ok ? pass++ : fail++; console.log((ok ? '  ok   ' : '  FAIL ') + what + (!ok && extra !== undefined ? '   ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); };
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'landscape', width: 844, height: 390 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

/* --break: the two defects the batch forbids — navigation delayed behind motion, and a
   leaving plane left interactive. */
const BREAK_JS = `
  (() => {
    const orig = window.appGoBack;
    window.appGoBack = function () { const a = arguments; setTimeout(() => orig.apply(this, a), 400); };
    const mo = new MutationObserver(() => document.querySelectorAll('.mo-leaving').forEach((e) => { e.inert = false; e.removeAttribute('aria-hidden'); }));
    document.addEventListener('DOMContentLoaded', () => mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] }));
  })();`;

let browser;
async function newPage(viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: opts.reduced ? 'reduce' : 'no-preference' });
  if (BREAK) await ctx.addInitScript(BREAK_JS);
  if (opts.init) await ctx.addInitScript(opts.init);
  const page = await ctx.newPage();
  page._errs = [];
  page.on('pageerror', (e) => page._errs.push(e.message));
  return page;
}
const settle = (p) => p.evaluate(() => (window.AtweMotion ? AtweMotion.settled() : true));
const lastMo = (p) => p.evaluate(() => { const r = window.__mo || []; const e = r[r.length - 1]; return e ? { family: e.family, dir: e.dir, from: e.from, to: e.to, reduced: e.reduced, dur: e.t1 && e.t0 ? Math.round(e.t1 - e.t0) : null, planes: e.planes } : null; });
const moCount = (p) => p.evaluate(() => (window.__mo || []).length);

/* What the member is looking at, semantically. */
const STATE = () => {
  const vis = (e) => e && !e.classList.contains('hidden') && !e.classList.contains('closing') && !e.classList.contains('mo-leaving');
  const ovs = [...document.querySelectorAll('body > .overlay')].filter(vis).map((o) => o.id);
  const scr = (window.AC_SCREENS || []).length ? null : null;
  let screen = null;
  try { screen = AC_SCREENS.find((id) => vis(document.getElementById(id))) || null; } catch (e) {}
  const panel = document.querySelector('#settingsOverlay:not(.hidden) .iset-body[data-page]:not(.hidden)');
  return { path: location.pathname, idx: (AtweHistory.current || {}).idx, prev: (AtweHistory.current || {}).prev || null,
    ovs, screen, panel: panel ? panel.getAttribute('data-page') : null, tab: typeof _appTab !== 'undefined' ? _appTab : null };
};
const state = (p) => p.evaluate(STATE);

/* During a motion: planes inert, aria-hidden, never hit; at most one per plane. */
async function midChecks(p, label) {
  const r = await p.evaluate(() => {
    const L = [...document.querySelectorAll('.mo-leaving')];
    const bad = L.filter((e) => !(e.inert === true && e.getAttribute('aria-hidden') === 'true')).map((e) => e.id || e.className);
    const hit = [];
    for (const [x, y] of [[0.5, 0.5], [0.25, 0.4], [0.75, 0.6], [0.5, 0.15], [0.5, 0.85]]) {
      const el = document.elementFromPoint(innerWidth * x, innerHeight * y);
      if (el && el.closest('.mo-leaving')) hit.push(el.closest('.mo-leaving').id || 'anon');
    }
    const ovLeaving = L.filter((e) => e.classList.contains('overlay')).length;
    const scrLeaving = L.filter((e) => e.classList.contains('ac-screen') || e.id === 'chatWrap').length;
    const panLeaving = L.filter((e) => e.classList.contains('iset-body')).length;
    return { n: L.length, bad, hit, ovLeaving, scrLeaving, panLeaving };
  });
  const ok = !r.bad.length && !r.hit.length && r.ovLeaving <= 1 && r.scrLeaving <= 1 && r.panLeaving <= 1;
  say(ok, label + ': mid-motion — leaving planes inert + aria-hidden, never hit, ≤1 per plane', r);
  return r;
}
/* After settle: nothing left behind. */
async function cleanChecks(p, label) {
  const r = await p.evaluate(() => {
    const leaving = document.querySelectorAll('.mo-leaving').length;
    const shades = document.querySelectorAll('.mo-shade').length;
    const styled = [...document.querySelectorAll('.ac-screen,.iset-body,#chatWrap,#setSearchBar,body > .overlay,body > .overlay > *')]
      .filter((e) => e._moWas || /will-change|--mo-d/.test(e.getAttribute('style') || ''))
      .map((e) => e.id || e.className.slice(0, 30));
    const moving = document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.closest &&
      (a.effect.target.classList.contains('mo-shade') || a instanceof Animation && !(a instanceof CSSAnimation) && !(a instanceof CSSTransition))).length;
    const inertLeft = [...document.querySelectorAll('.ac-screen,.iset-body,body > .overlay')].filter((e) => e.inert && !e.classList.contains('hidden')).map((e) => e.id);
    const ae = document.activeElement;
    const focusOk = !ae || ae === document.body || (ae.isConnected && !ae.closest('.hidden,.mo-leaving,.closing,[inert]'));
    return { leaving, shades, styled, moving, inertLeft, focusOk, focus: ae && (ae.id || ae.tagName) };
  });
  const ok = !r.leaving && !r.shades && !r.styled.length && !r.moving && !r.inertLeft.length && r.focusOk;
  say(ok, label + ': settled — no ghost plane, shade, inline transform/will-change, script animation or stray inert; focus not on a hidden plane', r);
}

/* The chains. Each step: an action, then what to expect. */
function chains(fx) {
  return [
    { name: 'Settings → Security → Devices → Back ×2', steps: [
      { act: () => openSettings(), family: 'hierarchy', dir: 'forward' },
      { act: () => setNav('security'), family: 'hierarchy', dir: 'forward' },
      { act: () => openDevices(), family: 'hierarchy', dir: 'forward' },
      { act: () => appGoBack(), family: 'hierarchy', dir: 'back' },
      { act: () => appGoBack(), family: 'hierarchy', dir: 'back' },
    ] },
    { name: 'Premium → Wallet → Request → Back', steps: [
      { act: () => openSettings('premium'), family: 'hierarchy', dir: 'forward' },
      { act: () => acOpenWallet(), family: 'hierarchy', dir: 'forward' },
      { act: () => acOpenRequestMoney(), family: null },                 // an unrouted SHEET: no page motion
      { act: () => appGoBack(), family: null },                         // dismisses the sheet first
      { act: () => appGoBack(), family: 'hierarchy', dir: 'back' },
    ] },
    { name: 'Engine → Marketplace → listing → Back', steps: [
      { act: () => appTab('search'), family: 'root' },
      { act: () => acOpenMarketplace(), family: 'hierarchy', dir: 'forward' },
      { act: (id) => acOpenListing(id), arg: fx.listingId, family: 'hierarchy', dir: 'forward', wait: 1500 },
      { act: () => appGoBack(), family: 'hierarchy', dir: 'back' },
    ] },
    { name: 'Beam → thread → Back', steps: [
      { act: () => appTab('chat'), family: 'root' },
      { act: (id) => acOpenChat(id), arg: fx.b.id, family: 'hierarchy', dir: 'forward', wait: 1500 },
      { act: () => acBackToList(), family: 'hierarchy', dir: 'back' },
    ] },
    { name: 'Account → Selling → Manage store → Back', steps: [
      { act: () => appTab('profile'), family: 'root' },
      { act: () => acMeSection('selling'), family: null },               // in-place section re-render (its own CSS slide)
      { act: () => acOpenStoreManage(), family: 'hierarchy', dir: 'forward' },
      { act: () => appGoBack(), family: 'hierarchy', dir: 'back' },
    ] },
    { name: 'Home → post → profile → Back', steps: [
      { act: () => appTab('home'), family: null },                     // already Home
      { act: (id) => acOpenPostView(id), arg: fx.postId, family: 'hierarchy', dir: 'forward', wait: 1200 },
      { act: (u) => acGoProfile(u), arg: fx.b.username, family: 'hierarchy', dir: 'forward', wait: 1200 },
      { act: () => appGoBack(), family: 'hierarchy', dir: 'back', wait: 600 },
    ] },
    { name: 'Notifications → destination → Back', steps: [
      { act: () => acNavNotifs(), family: null, wait: 1500 },              // the panel's own fade
      { act: (id) => acNotifGo(id), arg: fx.notifId, family: 'hierarchy', dir: 'forward', wait: 1200 },
      { act: () => appGoBack(), family: 'hierarchy', dir: 'back', wait: 800 },
    ] },
    { name: 'World switches Home ↔ Beam ↔ Engine', steps: [
      { act: () => appTab('home'), family: null },
      { act: () => appTab('chat'), family: 'root' },
      { act: () => appTab('search'), family: 'root' },
      { act: () => appTab('home'), family: 'root' },
    ] },
    { name: 'Sheet over sheet', steps: [
      { act: () => acOpenWallet(), family: 'hierarchy', dir: 'forward' },
      { act: () => acOpenRequestMoney(), family: null },
      { act: () => acOpenAddMoney && acOpenAddMoney(), family: null },
      { act: () => appGoBack(), family: null },
      { act: () => appGoBack(), family: null },
    ] },
  ];
}

async function home(p) {
  await p.evaluate(() => { try { document.querySelectorAll('body > .overlay:not(.hidden)').forEach((o) => { if (o.id !== 'loginOverlay') closeOverlay(o.id, true); }); } catch (e) {} });
  await p.waitForTimeout(250);
  await p.evaluate(() => { appTab('home'); });
  await p.waitForTimeout(500);
  await settle(p);
}

async function runChain(p, ch, opts = {}) {
  const out = [];
  for (let i = 0; i < ch.steps.length; i++) {
    const st = ch.steps[i];
    const before = await moCount(p);
    await p.evaluate(({ f, a }) => { (0, eval)('(' + f + ')')(a); }, { f: st.act.toString(), a: st.arg });
    if (opts.mid && st.family === 'hierarchy') { await p.waitForTimeout(110); await midChecks(p, ch.name + ' step ' + (i + 1)); }
    await p.waitForTimeout(st.wait || 450);
    await settle(p);
    const mo = (await moCount(p)) > before ? await lastMo(p) : null;
    out.push({ state: await state(p), mo });
  }
  return out;
}

async function viewportPass(vp, fx, acct) {
  console.log(`\n── ${vp.name} ${vp.width}x${vp.height}`);
  const p = await newPage(vp);
  await QA.signIn(p, acct, { waitMs: 4500 });
  const C = chains(fx);
  for (const ch of C) {
    await home(p);
    const on = await runChain(p, ch, { mid: true });
    await cleanChecks(p, ch.name);
    // The same chain with motion OFF: the destination must be identical at every step.
    await home(p);
    await p.evaluate(() => { AtweMotion.off = true; });
    const off = await runChain(p, ch);
    await p.evaluate(() => { AtweMotion.off = false; });
    const sem = (s) => ({ path: s.path, ovs: s.ovs, screen: s.screen, panel: s.panel, tab: s.tab });
    const diff = on.map((x, i) => JSON.stringify(sem(x.state)) === JSON.stringify(sem(off[i].state)) ? null : { step: i + 1, on: sem(x.state), off: sem(off[i].state) }).filter(Boolean);
    say(!diff.length, ch.name + ': semantic destination identical with and without motion', diff);
    // Families and directions.
    const bad = [];
    ch.steps.forEach((st, i) => {
      const mo = on[i].mo;
      if (st.family === null) { if (mo && mo.family === 'hierarchy') bad.push({ step: i + 1, want: 'no page motion', got: mo }); return; }
      if (!mo) { bad.push({ step: i + 1, want: st.family + '/' + (st.dir || '*'), got: null }); return; }
      if (mo.family !== st.family || (st.dir && mo.dir !== st.dir)) bad.push({ step: i + 1, want: st.family + '/' + (st.dir || '*'), got: mo.family + '/' + mo.dir, planes: mo.planes });
    });
    say(!bad.length, ch.name + ': family / direction', bad);
  }
  say(!p._errs.length, vp.name + ': no page errors', p._errs.slice(0, 3));
  await p.context().close();
}

async function edgeCases(fx, acct) {
  console.log('\n── edge cases (390x844)');
  const vp = VIEWPORTS[0];
  let p = await newPage(vp);
  await QA.signIn(p, acct, { waitMs: 4500 });

  const hub = async () => { await home(p); await p.evaluate(() => openSettings()); await p.waitForTimeout(500); await settle(p); };
  // Rapid push/pop ×10 — must land exactly where the same taps land with motion off.
  const rapid = async () => {
    await hub();
    await p.evaluate(async () => {
      for (let i = 0; i < 10; i++) { setNav(i % 2 ? 'privacy' : 'security'); await new Promise((r) => setTimeout(r, 45)); appGoBack(); await new Promise((r) => setTimeout(r, 45)); }
    });
    await p.waitForTimeout(800); await settle(p);
    return state(p);
  };
  const rOn = await rapid();
  await p.evaluate(() => { AtweMotion.off = true; });
  const rOff = await rapid();
  await p.evaluate(() => { AtweMotion.off = false; });
  say(rOn.path === rOff.path && rOn.panel === rOff.panel && JSON.stringify(rOn.ovs) === JSON.stringify(rOff.ovs), 'rapid ×10 push/pop lands exactly where it does with motion off', { on: rOn, off: rOff });
  await cleanChecks(p, 'rapid ×10');
  let s;
  await hub();

  // Back halfway through a forward motion.
  await p.evaluate(() => setNav('security'));
  await p.waitForTimeout(140);
  await midChecks(p, 'back-halfway (forward running)');
  await p.evaluate(() => appGoBack());
  await p.waitForTimeout(500); await settle(p);
  s = await state(p);
  say(s.panel === 'hub' && s.path === '/settings', 'Back halfway through forward → the hub', s);
  await cleanChecks(p, 'back-halfway');

  // Forward immediately after Back.
  await hub();
  await p.evaluate(() => setNav('privacy')); await p.waitForTimeout(450); await settle(p);
  await p.evaluate(() => { history.back(); setTimeout(() => history.forward(), 20); });
  await p.waitForTimeout(900); await settle(p);
  s = await state(p);
  say(s.panel === 'privacy' && s.path === '/settings/privacy', 'Forward immediately after Back → privacy', s);
  await cleanChecks(p, 'forward-after-back');

  // An overlay opened mid-transition.
  await hub();
  await p.evaluate(() => setNav('security'));
  await p.waitForTimeout(60);
  await p.evaluate(() => acOpenWallet());
  await p.waitForTimeout(600); await settle(p);
  s = await state(p);
  say(s.ovs.includes('walletView') && s.path === '/account/wallet', 'overlay opened mid-transition lands on the wallet', s);
  await cleanChecks(p, 'overlay-mid');

  // A world change mid-transition.
  await home(p);
  await p.evaluate((id) => acOpenPostView(id), fx.postId);
  await p.waitForTimeout(70);
  await p.evaluate(() => appTab('chat'));
  await p.waitForTimeout(700); await settle(p);
  s = await state(p);
  say(s.tab === 'chat' && s.screen === 'acListScreen', 'world change mid-transition lands in Beam', s);
  await cleanChecks(p, 'world-mid');

  // Orientation / breakpoint change mid-transition.
  await home(p);
  await p.evaluate(() => openSettings()); await p.waitForTimeout(450); await settle(p);
  await p.evaluate(() => setNav('privacy'));
  await p.waitForTimeout(60);
  await p.setViewportSize({ width: 844, height: 390 });
  await p.waitForTimeout(500); await settle(p);
  s = await state(p);
  say(s.panel === 'privacy', 'rotation mid-transition keeps the destination', s);
  await cleanChecks(p, 'rotate-mid');
  await p.setViewportSize({ width: 390, height: 844 });

  // Page hidden mid-transition.
  await hub();
  await p.evaluate(() => setNav('security'));
  await p.waitForTimeout(40);
  const hid = await p.evaluate(async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    const left = document.querySelectorAll('.mo-leaving').length;
    delete document.hidden;
    return left;
  });
  await settle(p);
  say(hid === 0, 'page hidden finishes every motion at once', { leavingAfterHide: hid });
  await cleanChecks(p, 'hidden');

  // Focus. After a tap (no keyboard) nothing is focused by script — that would draw the focus
  // ring on a phone; after keyboard use, focus goes INTO the incoming page, and back to the
  // control that opened it on Back.
  await hub();
  await p.mouse.click(5, 5);
  await p.evaluate(() => setNav('security')); await p.waitForTimeout(450); await settle(p);
  let fo = await p.evaluate(() => { const a = document.activeElement; return { tag: a && a.tagName, id: a && a.id, cls: a && String(a.className).slice(0, 30), visible: a && a.matches && a.matches(':focus-visible') }; });
  say(!fo.visible, 'after a tap: no programmatic focus ring', fo);
  await hub();
  await p.keyboard.press('Shift');
  await p.evaluate(() => setNav('security')); await p.waitForTimeout(450); await settle(p);
  fo = await p.evaluate(() => { const a = document.activeElement; const ov = document.getElementById('settingsOverlay'); return { inside: !!(a && ov.contains(a) && !a.closest('.hidden,.mo-leaving')), tag: a && a.tagName, cls: a && String(a.className).slice(0, 30) }; });
  say(fo.inside, 'after keyboard use: focus moves into the incoming page', fo);

  // uaTransition: a browser-animated traverse is never animated again.
  const ua = await p.evaluate(() => {
    const before = (window.__mo || []).length;
    window.dispatchEvent(new CustomEvent('atwe:navigate', { detail: { kind: 'traverse', direction: 'back', uaTransition: true, from: null, to: null } }));
    setNav('privacy');
    return new Promise((r) => setTimeout(() => r({ added: (window.__mo || []).length - before }), 60));
  });
  say(ua.added === 0, 'hasUAVisualTransition: the change is applied without an Atwe animation', ua);
  await settle(p);
  await p.context().close();

  // Slow destination: motion never waits for data.
  p = await newPage(vp);
  await QA.signIn(p, acct, { waitMs: 4500 });
  await home(p);
  await p.route('**/api/listings/**', (route) => setTimeout(() => route.continue(), 3000));
  await p.evaluate(() => acOpenMarketplace()); await p.waitForTimeout(450); await settle(p);
  const t0 = Date.now();
  await p.evaluate((id) => { acOpenListing(id); }, fx.listingId);
  await p.waitForTimeout(80);
  const midSlow = await p.evaluate(() => ({ open: !document.getElementById('listingView').classList.contains('hidden'), animated: (window.__mo || []).slice(-1).map((e) => e.planes && e.planes.incoming)[0] }));
  await settle(p);
  const took = Date.now() - t0;
  say(midSlow.open && midSlow.animated === 'listingView' && took < 1500, 'slow destination: the sheet is open at once and motion lands while the data is still loading', { midSlow, took });
  await cleanChecks(p, 'slow');
  await p.unroute('**/api/listings/**');
  await p.context().close();

  // Direct load and reload: no navigation animation.
  p = await newPage(vp);
  await QA.signIn(p, acct, { waitMs: 300 });
  await p.goto(BASE + '/settings/security', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(4000);
  let n = await p.evaluate(() => (window.__mo || []).filter((e) => e.family === 'hierarchy' || e.family === 'root').length);
  say(n === 0, 'direct load /settings/security: no navigation animation', { animated: n });
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(4000);
  n = await p.evaluate(() => (window.__mo || []).filter((e) => e.family === 'hierarchy' || e.family === 'root').length);
  say(n === 0, 'reload: no navigation animation', { animated: n });
  s = await state(p);
  say(s.panel === 'security', 'reload restores the destination', s);
  await p.context().close();

  // Failure injection: animate() throws / animate() missing → navigation identical.
  for (const [label, init] of [['animate throws', 'Element.prototype.animate = function () { throw new Error("no animation for you"); };'],
                               ['animate missing', 'delete Element.prototype.animate;']]) {
    p = await newPage(vp, { init });
    await QA.signIn(p, acct, { waitMs: 4500 });
    await home(p);
    const res = await runChain(p, chains(fx)[0]);
    const paths = res.map((r) => r.state.path + '|' + (r.state.panel || '') + '|' + r.state.ovs.join(','));
    const want = ['/settings|hub|settingsOverlay', '/settings/security|security|settingsOverlay', '/settings/security/devices|security|settingsOverlay,devicesOverlay', '/settings/security|security|settingsOverlay', '/settings|hub|settingsOverlay'];
    say(JSON.stringify(paths) === JSON.stringify(want), label + ': Settings chain lands on every destination', paths);
    await cleanChecks(p, label);
    say(!p._errs.length, label + ': no page errors', p._errs.slice(0, 2));
    await p.context().close();
  }

  // Reduced motion: the OS setting, and the app's own switch.
  for (const [label, opts, setup] of [['OS reduced motion', { reduced: true }, null], ['app Reduce motion switch', {}, () => document.body.classList.add('reduce-motion')]]) {
    p = await newPage(vp, opts);
    await QA.signIn(p, acct, { waitMs: 4500 });
    if (setup) await p.evaluate(setup);
    await home(p);
    await p.evaluate(() => openSettings()); await p.waitForTimeout(450); await settle(p);
    await p.evaluate(() => {
      window.__moFrames = [];
      const orig = Element.prototype.animate;
      Element.prototype.animate = function (k, o) { window.__moFrames.push(JSON.stringify(k)); return orig.call(this, k, o); };
    });
    await p.evaluate(() => setNav('security'));
    await p.waitForTimeout(450); await settle(p);
    await p.evaluate(() => appGoBack());
    await p.waitForTimeout(450); await settle(p);
    const r = await p.evaluate(() => ({ frames: window.__moFrames, mo: (window.__mo || []).slice(-2).map((e) => ({ reduced: e.reduced, dur: Math.round(e.t1 - e.t0) })), cls: document.documentElement.classList.contains('mo-reduced') }));
    const noTravel = r.frames.length > 0 && r.frames.every((f) => !/transform/.test(f));
    say(noTravel && r.mo.every((m) => m.reduced && m.dur <= 200) && r.cls, label + ': dissolve only (no transform), ≤150ms motion, mo-reduced class set', r);
    s = await state(p);
    say(s.panel === 'hub' && s.path === '/settings', label + ': navigation unchanged', s);
    await p.context().close();
  }
}

/* Scroll restored on Back, and performance at 4x CPU, motion on vs off. */
async function scrollAndPerf(fx, acct) {
  console.log('\n── scroll restore (390x844)');
  const p = await newPage(VIEWPORTS[0]);
  await QA.signIn(p, acct, { waitMs: 4500 });
  await home(p);
  await p.evaluate(() => openSettings('privacy'));
  await p.waitForTimeout(600); await settle(p);
  await p.evaluate(() => { document.getElementById('settingsOverlay').scrollTop = 220; });
  await p.waitForTimeout(100);
  const before = await p.evaluate(() => document.getElementById('settingsOverlay').scrollTop);
  await p.evaluate(() => openSettings('privacy', 'blocked'));
  await p.waitForTimeout(500); await settle(p);
  await p.evaluate(() => appGoBack());
  await p.waitForTimeout(500); await settle(p);
  const after = await p.evaluate(() => document.getElementById('settingsOverlay').scrollTop);
  say(Math.abs(after - before) <= 2, 'scroll position of the parent page restored after Back', { before, after });
  await p.context().close();
  // Phone is LITE (incoming plane only); tablet and desktop keep the two-plane hierarchy,
  // which is allowed only while it stays inside the same gate.
  for (const vp of [VIEWPORTS[0], VIEWPORTS[2], VIEWPORTS[3]]) await perfAt(vp, acct);
}

async function perfAt(vp, acct) {
  console.log(`\n── performance ${vp.width}x${vp.height} (4x CPU)`);
  const p = await newPage(vp);
  await QA.signIn(p, acct, { waitMs: 4500 });
  await home(p);
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const run = async (off) => {
    await home(p);
    await p.evaluate((o) => {
      AtweMotion.off = o; window.__lt = [];
      try { if (window.__ltObs) window.__ltObs.disconnect(); } catch (e) {}
      try { window.__ltObs = new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(Math.round(e.duration)))); window.__ltObs.observe({ type: 'longtask', buffered: false }); } catch (e) {}
    }, off);
    const layouts = [];
    for (const f of [() => openSettings(), () => setNav('security'), () => appGoBack(), () => setNav('privacy'), () => appGoBack()]) {
      const n0 = await moCount(p);
      await p.evaluate((src) => (0, eval)('(' + src + ')')(), f.toString());
      // Wait for THIS motion to have started (a Back's popstate arrives a task later).
      if (!off) { for (let k = 0; k < 40 && (await moCount(p)) === n0; k++) await p.waitForTimeout(5); }
      await p.waitForTimeout(60);
      const m0 = (await cdp.send('Performance.getMetrics')).metrics.find((x) => x.name === 'LayoutCount').value;
      await p.waitForTimeout(180);
      const m1 = (await cdp.send('Performance.getMetrics')).metrics.find((x) => x.name === 'LayoutCount').value;
      layouts.push(m1 - m0);
      await settle(p);
    }
    const lt = await p.evaluate(() => window.__lt.slice());
    await p.evaluate(() => { AtweMotion.off = false; });
    return { layouts, longtasks: lt, max: lt.length ? Math.max(...lt) : 0 };
  };
  /* Alternate on/off three times: one run of each is noise at 4x CPU (a single 169ms task
     against a 138ms one moved between runs of the SAME build). Compare the long-task count
     and the median long task, which a real per-transition cost would raise every time. */
  const ons = [], offs = [];
  for (let i = 0; i < 3; i++) { ons.push(await run(false)); offs.push(await run(true)); }
  const all = (rs) => rs.flatMap((r) => r.longtasks);
  const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const onL = all(ons), offL = all(offs);
  console.log('    motion on  layouts', JSON.stringify(ons.map((r) => r.layouts)), 'long tasks', JSON.stringify(onL));
  console.log('    motion off layouts', JSON.stringify(offs.map((r) => r.layouts)), 'long tasks', JSON.stringify(offL));
  const per = (rs) => rs.map((r) => r.longtasks.filter((d) => d > 50).length + '/' + r.longtasks.reduce((a, b) => a + b, 0) + 'ms');
  console.log('    per run (count/total)  on', JSON.stringify(per(ons)), ' off', JSON.stringify(per(offs)));
  say(ons.every((r) => r.layouts.every((d) => d <= 2)), `[${vp.name}] no animation-caused layout churn mid-motion (LayoutCount delta ≤ 2 per step)`, ons.map((r) => r.layouts));
  const nOn = onL.filter((d) => d > 50).length, nOff = offL.filter((d) => d > 50).length;
  say(nOn <= nOff + 3 && med(onL) <= med(offL) + 20,
    `[${vp.name}] no new long task > 50ms in the transition path (4x CPU, 3 alternating runs vs motion off)`, { countOn: nOn, countOff: nOff, medianOn: med(onL), medianOff: med(offL) });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await p.context().close();
}

(async () => {
  const t0 = Date.now();
  const pool = QA.newPool();
  const a = await QA.seedAccount(pool, { business: true, prefix: 'mo' });
  const b = await QA.seedAccount(pool, { business: true, prefix: 'mob' });
  const one = async (sql, args) => (await pool.query(sql, args)).rows[0].id;
  const fx = { b };
  fx.postId = await one("INSERT INTO posts (user_id, body) VALUES ($1, 'navmotion post by B') RETURNING id", [b.id]);
  fx.listingId = await one("INSERT INTO products (business_id, name, price_cents, active) VALUES ($1, 'navmotion listing', 1500, true) RETURNING id", [b.id]);
  await pool.query("INSERT INTO at_messages (sender_id, recipient_id, body) VALUES ($1,$2,'hello from B'), ($2,$1,'hi')", [b.id, a.id]);
  fx.notifId = await one("INSERT INTO notifications (user_id, actor_id, type) VALUES ($1,$2,'follow') RETURNING id", [a.id, b.id]);
  await pool.end();
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  try {
    if (!process.env.PERF_ONLY) {
      for (const vp of VIEWPORTS) await viewportPass(vp, fx, a);
      await edgeCases(fx, a);
    }
    await scrollAndPerf(fx, a);
  } finally { await browser.close(); }
  console.log(`\n${pass} passed, ${fail} FAILED  (${Math.round((Date.now() - t0) / 1000)}s)`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
