/* Route batch 6 — ONE App Back, and it is real history first.
 *
 *   App Back (appGoBack, and every "go back" arrow that delegates to it):
 *     1. dismiss a transient layer first (menu, confirm, drawer, an unrouted sheet);
 *     2. a real previous Atwe entry exists (History v2 prev)  -> history.back();
 *     3. none (a direct/deep entry)                            -> REPLACE to the route
 *        registry's logical parent, never fabricating history behind the link;
 *     4. a root with nothing behind                            -> nothing.
 *   Browser Back is always a real traversal. Notifications resolve every row through ONE
 *   registry-backed resolver, routeFor(), and a routed destination is ONE push.
 *
 * Owns its fixture: a business viewer, a second person with a post and a listing, a post
 * of theirs in an official circle, and notifications pointing at all of it. Runs the full
 * matrix at 390x844 and 1440x900 and a smoke pass at 820x1180.
 *
 *   node route6.js              the checks
 *   node route6.js --break      profile Back consults the old private _profFrom memory
 *                               before real history (the pre-batch-6 defect); must FAIL
 *   node route6.js --break=notif one notification row bypasses routeFor with the old inline
 *                               mapping; the routeFor check must FAIL
 */
'use strict';
const path = require('path');
const QA = require(path.join(__dirname, 'qa-fixture.js'));
const { chromium } = require(process.env.PW_SCRATCH
  ? path.join(process.env.PW_SCRATCH, 'node_modules/playwright-core')
  : path.join(__dirname, 'node_modules/playwright-core'));

const BREAK = process.argv.find((a) => a.startsWith('--break'));
const BREAK_KIND = BREAK ? (BREAK.split('=')[1] || 'prof') : null;
const BASE = QA.base();
let pass = 0, fail = 0;
const say = (ok, what, extra) => { ok ? pass++ : fail++; console.log((ok ? '  ok   ' : '  FAIL ') + what + (extra !== undefined && !ok ? '   ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); };

/* --break: two old defects, each written against the exact current source. */
const OLD = {
  prof: [
    [`function acProfileBack() { appGoBack(); }`,
     `function acProfileBack() { const from = AC._profFrom; if (from === 'acSearchScreen') { appTab('search'); return; } if (from) { acGoHome(); return; } appGoBack(); }`],
    [`  acStopMic();\n  acShow('acProfileScreen', mine ? 'profile' : null);`,
     `  { const cur = AC_SCREENS.find(id => !document.getElementById(id).classList.contains('hidden')); if (cur && cur !== 'acProfileScreen') AC._profFrom = cur; }\n  acStopMic();\n  acShow('acProfileScreen', mine ? 'profile' : null);`],
  ],
  notif: [
    [`onclick="acNotifGo(\${Number(n.id)})">\n    <div class="notif-ava-wrap">`,
     `onclick="\${n.type === 'follow' ? \`closeOverlay('notifOverlay', true);appTab('home');acGoProfile('\${a.username}')\` : \`acNotifGo(\${Number(n.id)})\`}">\n    <div class="notif-ava-wrap">`],
  ],
};

async function newTab(browser, token, viewport, first) {
  /* --break MUST block the service worker: a worker-served navigation is not seen by
     context.route, so a broken page would only ever reach each context's first document. */
  const ctx = await browser.newContext(BREAK ? { viewport, serviceWorkers: 'block' } : { viewport });
  if (BREAK) {
    await ctx.route(/localhost:\d+\/[^.]*$/, async (route) => {
      if (route.request().resourceType() !== 'document') return route.continue();
      const res = await route.fetch();
      let html = await res.text();
      for (const [now, was] of OLD[BREAK_KIND]) {
        if (!html.includes(now)) throw new Error('--break: current code not found, the probe is stale: ' + now.slice(0, 60));
        html = html.split(now).join(was);
      }
      await route.fulfill({ response: res, body: html, headers: { ...res.headers(), 'content-length': undefined } });
    });
  }
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript((t) => {
    try { localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_intro_seen', JSON.stringify(['beam', 'circles', 'ai', 'wallet'])); } catch (e) {}
    /* AtweHistory.log is a RING of 60, so its length stops counting after a while: keep an
       unbounded copy of every NavEvent for the probe. */
    window.__nav = [];
    window.addEventListener('atwe:navigate', (e) => { window.__nav.push({ kind: e.detail.kind, direction: e.detail.direction }); });
  }, token);
  await go(p, first || '/');
  return { ctx, p, errs };
}
const booted = async (p) => {
  // S is a top-level let, not a window property: ask for the binding itself.
  await QA.waitUntil(p, () => typeof S !== 'undefined' && !!(S.user && S.user.id), null, 25000);
  await QA.waitUntil(p, () => window.AtweHistory && !AtweHistory.booting, null, 15000);
  await p.waitForTimeout(700);
};
const go = async (p, url) => { await p.goto(BASE + url, { waitUntil: 'domcontentloaded' }); await booted(p); };
const settle = (p, ms) => p.waitForTimeout(ms || 1000);
const back = async (p) => { await p.goBack({ timeout: 6000 }).catch(() => {}); await settle(p, 1200); };
const fwd = async (p) => { await p.goForward({ timeout: 6000 }).catch(() => {}); await settle(p, 1200); };
const appBack = async (p) => { const r = await p.evaluate(() => { try { return appGoBack(); } catch (e) { return 'threw:' + e.message; } }); await settle(p, 1200); return r; };

/* The whole state, and whether it is COHERENT: chrome, screen, overlay, URL and the lit nav
   item must all describe the same destination (the mixed-state class of bug). */
const snap = (p) => p.evaluate(() => {
  const vis = (e) => !!e && !e.classList.contains('hidden') && !e.classList.contains('closing');
  const open = [...document.querySelectorAll('.overlay:not(.hidden):not(.closing)')].map((o) => o.id);
  const screen = AC_SCREENS.find((id) => vis(document.getElementById(id))) || null;
  const owner = _navBackOwner();
  const r = parseDeepLink();
  const ownPathOf = (id) => { const o = document.getElementById(id); return o._ownPath || (id === 'settingsOverlay' ? acSettingsPath(_setPage) : (acViewRouteKey(id) ? acRouteKeyPath(acViewRouteKey(id)) : null)); };
  const routedOpen = open.filter((id) => { const o = document.getElementById(id); return o._ownPath || id === 'settingsOverlay' || acViewRouteKey(id); });
  /* Only the TOP routed layer must own the address: a lower one (Settings under Wallet,
     Marketplace under a listing) is the stack real Back walks down. A routed layer ABOVE the
     owner cannot exist by construction (the owner is the top one). */
  const stale = [];
  void routedOpen;
  let why = [];
  if (owner.overlay) { if (ownPathOf(owner.overlay) !== location.pathname) why.push('top layer ' + owner.overlay + ' owns ' + ownPathOf(owner.overlay)); }
  else if (owner.screen === 'acProfileScreen' && !(r && r.type === 'profile')) why.push('profile screen, URL is not a profile');
  else if (owner.screen === 'acPostViewScreen' && !(r && r.type === 'post')) why.push('post screen, URL is not a post');
  else if (owner.screen === 'acCircleScreen' && !(r && r.type === 'circle')) why.push('circle screen, URL is not a circle');
  else if (['acHomeScreen', 'acListScreen', 'acSearchScreen', 'acMeScreen'].includes(owner.screen)) {
    const want = { acHomeScreen: 'home', acListScreen: 'chat', acSearchScreen: 'search', acMeScreen: 'profile' }[owner.screen];
    if (_appTab !== want) why.push('screen ' + owner.screen + ' under world ' + _appTab);
  }
  if (stale.length) why.push('stale routed layers ' + stale.join(','));
  const lit = [...document.querySelectorAll('#bottomNav .bn-tab.active, .sb-navbtn.active')].map((e) => e.id.replace(/^[bs]nav-/, ''));
  const wantLit = document.body.classList.contains('notif-tab') ? 'notifs' : (NAV_ALIAS[_appTab] || _appTab);
  if (lit.length && lit.some((x) => x !== wantLit)) why.push('nav lit ' + lit.join('/') + ' want ' + wantLit);
  return { path: location.pathname, len: history.length, idx: (AtweHistory.current || {}).idx, key: (AtweHistory.current || {}).key,
    prev: (AtweHistory.current || {}).prev, tab: _appTab, screen, open, top: open[open.length - 1] || null,
    events: window.__nav.length, coherent: why.length === 0, why, st: history.state, ownLeg: !!owner.legacy };
});
const evSince = (p, n) => p.evaluate((k) => window.__nav.slice(k), n);
const navEvents = (evs) => evs.filter((e) => ['push', 'replace', 'root-change', 'traverse'].includes(e.kind));
const cleanState = (s) => !!s.st && s.st.atwe === 2 && Number.isInteger(s.st.idx) && s.st.path === s.path
  && !['section', 'setPage', 'via', 'from', 'parent', 'profFrom', 'postNav'].some((k) => k in s.st);

/* Walk a chain in-app, then App Back all the way and Forward all the way. Each step is
   { name, act(p), want: path, check(s) }. */
async function chain(p, tag, label, start, steps) {
  await p.evaluate(start); await settle(p, 1400);
  const base = await snap(p);
  const seen = [base];
  for (const st of steps) {
    const s0 = await snap(p);
    await p.evaluate(st.act, st.arg); await settle(p, 1400);
    const s = await snap(p);
    const ev = navEvents(await evSince(p, s0.events));
    /* idx is ONE monotonic sequence per tab, so after a Back the next push is not idx+1:
       what proves a push FROM here is that the new entry's prev is the entry we left. */
    say(s.path === st.want && s.idx !== s0.idx && s.prev === s0.idx && ev.length === 1 && ev[0].kind !== 'replace' && cleanState(s) && s.coherent && (!st.check || st.check(s)),
      `${tag} ${label}: ${st.name} is ONE push to ${st.want}`, { path: s.path, idx: [s0.idx, s.idx], prev: s.prev, ev, why: s.why, top: s.top, screen: s.screen });
    seen.push(s);
  }
  // App Back all the way to the start: the REAL previous entry every time.
  for (let i = seen.length - 1; i > 0; i--) {
    const n0 = (await snap(p)).events;
    await appBack(p);
    const s = await snap(p);
    const ev = navEvents(await evSince(p, n0));
    const want = seen[i - 1];
    say(s.path === want.path && s.idx === want.idx && ev.length === 1 && ev[0].kind === 'traverse' && ev[0].direction === 'back' && s.coherent
      && (!steps[i - 1].backCheck || steps[i - 1].backCheck(s)),
      `${tag} ${label}: App Back from ${seen[i].path} walks REAL history to ${want.path}`, { path: s.path, idx: [want.idx, s.idx], ev, why: s.why, screen: s.screen, top: s.top, tab: s.tab });
  }
  // Forward all the way: symmetric.
  for (let i = 1; i < seen.length; i++) {
    await fwd(p);
    const s = await snap(p);
    say(s.path === seen[i].path && s.idx === seen[i].idx && s.coherent, `${tag} ${label}: Forward restores ${seen[i].path}`, { path: s.path, why: s.why, top: s.top, screen: s.screen });
  }
  // and home again for the next chain, with nothing left open
  for (let i = seen.length - 1; i > 0; i--) await back(p);
  await p.evaluate(() => { document.querySelectorAll('.overlay:not(.hidden)').forEach((o) => { try { closeOverlay(o.id, true); } catch (e) {} }); appTab('home'); });
  await settle(p);
}

async function realHistory(p, errs, tag, fx) {
  console.log(`\n${tag} 1. real-history App Back`);
  const B = fx.b.username, PID = fx.postId, LID = fx.listingId;
  await chain(p, tag, 'Home -> profile -> post', () => appTab('home'), [
    { name: 'profile', act: (u) => acGoProfile(u), arg: B, want: '/' + B, check: (s) => s.screen === 'acProfileScreen' },
    { name: 'post', act: (id) => acOpenPostView(id), arg: PID, want: '/' + B + '/post/' + PID, check: (s) => s.screen === 'acPostViewScreen',
      backCheck: (s) => s.screen === 'acProfileScreen' },
  ].map((x, i, a) => (i === 0 ? { ...x, backCheck: (s) => s.screen === 'acHomeScreen' && s.tab === 'home' } : x)));
  await chain(p, tag, 'Home -> Settings -> page -> leaf', () => appTab('home'), [
    { name: 'Settings', act: () => openSettings(), want: '/settings', backCheck: (s) => s.screen === 'acHomeScreen' && s.top === null },
    { name: 'Privacy', act: () => setNav('privacy'), want: '/settings/privacy', backCheck: (s) => s.top === 'settingsOverlay' },
    { name: 'Muted words', act: () => acOpenMutedWords(), want: '/settings/privacy/muted-words', backCheck: (s) => s.top === 'settingsOverlay' },
  ]);
  await chain(p, tag, '/me -> section -> tool', () => appTab('profile'), [
    { name: 'Money', act: () => acOpenAccountSection('money'), want: '/account/money', backCheck: (s) => s.screen === 'acMeScreen' },
    { name: 'Wallet', act: () => acOpenWallet(), want: '/account/wallet', check: (s) => s.top === 'walletView', backCheck: (s) => s.top === null },
  ]);
  await chain(p, tag, 'Settings Premium -> Wallet', () => { appTab('home'); openSettings('premium'); }, [
    { name: 'Wallet', act: () => acOpenWallet(), want: '/account/wallet', check: (s) => s.top === 'walletView' },
  ]);
  await chain(p, tag, 'Settings -> Manage store', () => { appTab('home'); openSettings(); }, [
    { name: 'Manage store', act: () => { closeSettings(true); acOpenStoreManage(); }, want: '/account/store', check: (s) => s.top === 'storeManageView' },
  ]);
  await chain(p, tag, 'Engine -> Marketplace -> listing', () => appTab('search'), [
    { name: 'Marketplace', act: () => acOpenMarketplace(), want: '/marketplace', backCheck: (s) => s.screen === 'acSearchScreen' && s.top === null },
    { name: 'listing', act: (id) => acOpenListing(id), arg: LID, want: '/listing/' + LID, check: (s) => s.top === 'listingView', backCheck: (s) => s.top === 'marketplaceView' },
  ]);
  await chain(p, tag, 'circle -> post', () => appTab('home'), [
    { name: 'circle', act: (u) => acOpenCircleByUsername(u), arg: fx.circle, want: '/circle/' + fx.circle, check: (s) => s.screen === 'acCircleScreen', backCheck: (s) => s.screen === 'acHomeScreen' },
    { name: 'post', act: (id) => acOpenPostView(id), arg: PID, want: '/' + B + '/post/' + PID, backCheck: (s) => s.screen === 'acCircleScreen' },
  ]);
  // The arrows themselves delegate: the profile and post arrows go where App Back goes.
  await p.evaluate(() => appTab('home')); await settle(p);
  await p.evaluate((u) => acGoProfile(u), B); await settle(p, 1400);
  await p.evaluate((id) => acOpenPostView(id), PID); await settle(p, 1400);
  await p.evaluate(() => acPostViewBack()); await settle(p, 1400);
  let s = await snap(p);
  say(s.path === '/' + B && s.screen === 'acProfileScreen' && s.coherent, `${tag} 1b. the post's own arrow walks real history to the profile`, s);
  await p.evaluate(() => acProfileBack()); await settle(p, 1400);
  s = await snap(p);
  say(s.path === '/' && s.screen === 'acHomeScreen' && s.coherent, `${tag} 1b. the profile's own arrow walks real history Home`, s);
  say(errs.length === 0, `${tag} 1. no JS errors`, errs.slice(0, 2));
}

async function notifications(p, errs, tag, fx) {
  console.log(`\n${tag} 6. Notifications`);
  const open = async () => { await p.evaluate(() => { appTab('home'); }); await settle(p); await p.evaluate(() => acNavNotifs()); await settle(p, 2200); };
  const cases = [
    ['follow', '/' + fx.b.username, (s) => s.screen === 'acProfileScreen'],
    ['like', '/' + fx.a.username + '/post/' + fx.ownPostId, (s) => s.screen === 'acPostViewScreen'],
    ['payment', '/account/wallet', (s) => s.top === 'walletView'],
    ['price_drop', '/listing/' + fx.listingId, (s) => s.top === 'listingView'],
  ];
  for (const [type, want, check] of cases) {
    await open();
    let s0 = await snap(p);
    // routeFor is the ONE source: spy it and read what it says this row resolves to.
    const r = await p.evaluate((ty) => {
      const n = (AC._notifs || []).find((x) => x.type === ty);
      if (!n) return { none: true };
      window.__rf = 0; const orig = window.routeFor;
      window.routeFor = function () { window.__rf++; return orig.apply(this, arguments); };
      const d = orig(n);
      const row = [...document.querySelectorAll('#notifList .notif-row')].find((x) => x.dataset.type === ty);
      if (row) row.click();
      return { d, path: acNotifPath(d), clicked: !!row };
    }, type);
    await settle(p, 1600);
    const s = await snap(p);
    const ev = navEvents(await evSince(p, s0.events));
    const spy = await p.evaluate(() => { const c = window.__rf; delete window.__rf; return c; });
    say(!r.none && r.clicked && r.path === want && spy >= 1, `${tag} ${type}: routeFor resolves the row to ${want}, and the tap used it`, { r, spy });
    say(s.path === want && s.prev === s0.idx && ev.length === 1 && ev[0].kind !== 'replace' && check(s) && s.coherent && !s.open.includes('notifOverlay'),
      `${tag} ${type}: /notifications -> ONE push to ${want}`, { path: s.path, idx: [s0.idx, s.idx], prev: s.prev, ev, why: s.why, top: s.top });
    await appBack(p);
    let b = await snap(p);
    say(b.path === '/notifications' && b.top === 'notifOverlay' && b.idx === s0.idx && b.coherent, `${tag} ${type}: App Back -> /notifications`, { path: b.path, top: b.top, why: b.why });
    await fwd(p);
    b = await snap(p);
    say(b.path === want && check(b) && b.coherent, `${tag} ${type}: Forward -> ${want} again`, { path: b.path, top: b.top, why: b.why });
    await back(p);
  }
  // A system alert opens its detail INSIDE /notifications, and its action routes to Devices.
  await open();
  const s0 = await snap(p);
  await p.evaluate(() => { const row = [...document.querySelectorAll('#notifList .notif-row')].find((x) => /New sign-in/.test(x.textContent)); if (row) row.click(); });
  await settle(p, 900);
  let s = await snap(p);
  const det = await p.evaluate(() => document.getElementById('notifCard').classList.contains('detail-open'));
  say(det && s.path === '/notifications' && s.idx === s0.idx, `${tag} New sign-in opens its detail inside /notifications (no URL of its own)`, { det, path: s.path });
  await p.evaluate(() => document.querySelector('#notifDetailBody .nd-action').click());
  await settle(p, 1600);
  s = await snap(p);
  say(s.path === '/settings/security/devices' && s.top === 'devicesOverlay' && s.prev === s0.idx && s.coherent, `${tag} its action routes to /settings/security/devices`, { path: s.path, top: s.top, why: s.why });
  await appBack(p);
  s = await snap(p);
  say(s.path === '/notifications' && s.top === 'notifOverlay', `${tag} and App Back returns to /notifications`, { path: s.path, top: s.top });
  await p.evaluate(() => closeOverlay('notifOverlay', true)); await settle(p);
  say(errs.length === 0, `${tag} 6. no JS errors`, errs.slice(0, 2));
}

async function contextual(p, errs, tag, fx) {
  console.log(`\n${tag} 5. the same destination from two origins`);
  const B = fx.b.username;
  for (const [origin, start, want, check] of [
    ['Engine', () => appTab('search'), '/search', (s) => s.screen === 'acSearchScreen' && s.tab === 'search'],
    ['Home', () => appTab('home'), '/', (s) => s.screen === 'acHomeScreen' && s.tab === 'home'],
    ['Account', () => appTab('profile'), '/me', (s) => s.screen === 'acMeScreen' && s.tab === 'profile'],
  ]) {
    await p.evaluate(start); await settle(p, 1300);
    await p.evaluate((u) => acGoProfile(u), B); await settle(p, 1400);
    await p.evaluate(() => acProfileBack()); await settle(p, 1400);
    const s = await snap(p);
    say(s.path === want && check(s) && s.coherent, `${tag} ${origin} -> profile -> Back returns to ${origin}`, { path: s.path, tab: s.tab, screen: s.screen, why: s.why });
  }
  for (const [origin, start, want, check] of [
    ['Marketplace', () => { appTab('search'); acOpenMarketplace(); }, '/marketplace', (s) => s.top === 'marketplaceView'],
    ['Settings', () => { appTab('home'); openSettings('premium'); }, '/settings/premium', (s) => s.top === 'settingsOverlay'],
  ]) {
    await p.evaluate(start); await settle(p, 1400);
    await p.evaluate(() => acOpenWallet()); await settle(p, 1400);
    await appBack(p);
    const s = await snap(p);
    say(s.path === want && check(s) && s.coherent, `${tag} ${origin} -> Wallet -> Back returns to ${origin}, not the registry parent`, { path: s.path, top: s.top, why: s.why });
    await p.evaluate(() => document.querySelectorAll('.overlay:not(.hidden)').forEach((o) => closeOverlay(o.id, true))); await settle(p);
  }
  say(errs.length === 0, `${tag} 5. no JS errors`, errs.slice(0, 2));
}

async function modals(p, errs, tag, fx) {
  console.log(`\n${tag} 3. transient layers close first`);
  await p.evaluate(() => appTab('home')); await settle(p);
  await p.evaluate((u) => acGoProfile(u), fx.b.username); await settle(p, 1400);
  const layers = [
    ['a menu', () => document.getElementById('profileMenu').classList.remove('hidden'), () => !document.getElementById('profileMenu').classList.contains('hidden')],
    ['a confirm', () => { appConfirm({ title: 'route6' }); }, () => !document.getElementById('confirmOverlay').classList.contains('hidden')],
    ['an unrouted sheet', () => showOverlay('tipSheet'), () => !document.getElementById('tipSheet').classList.contains('hidden') && !document.getElementById('tipSheet').classList.contains('closing')],
  ];
  for (const [name, openIt, isOpen] of layers) {
    for (const how of ['App Back', 'browser Back']) {
      const s0 = await snap(p);
      await p.evaluate(openIt); await settle(p, 500);
      const opened = await p.evaluate(isOpen);
      if (how === 'App Back') await appBack(p); else await back(p);
      const s = await snap(p);
      const still = await p.evaluate(isOpen);
      say(opened && !still && s.path === s0.path && s.idx === s0.idx && s.key === s0.key && s.screen === 'acProfileScreen',
        `${tag} ${how} closes ${name} first; the profile, its URL and its entry (idx+key) stay`, { opened, still, path: s.path, idx: [s0.idx, s.idx], key: [s0.key, s.key] });
    }
  }
  if (tag === '[phone]') {
    const s0 = await snap(p);
    await p.evaluate(() => toggleSidebar()); await settle(p, 500);
    await appBack(p);
    const s = await snap(p);
    const drawer = await p.evaluate(() => document.getElementById('sidebar').classList.contains('open'));
    say(!drawer && s.path === s0.path && s.idx === s0.idx, `${tag} App Back closes the drawer first`, { drawer, path: s.path });
  }
  await p.evaluate(() => appTab('home')); await settle(p);
  say(errs.length === 0, `${tag} 3. no JS errors`, errs.slice(0, 2));
}

async function gates(p, errs, tag) {
  console.log(`\n${tag} 4. gates are not dismissible`);
  for (const id of ['onboardingFlow', 'appLockView']) {
    const ok = await p.evaluate((i) => { const el = document.getElementById(i); if (!el) return false; el.classList.remove('hidden'); return true; }, id);
    await appBack(p);
    const a = await p.evaluate((i) => !document.getElementById(i).classList.contains('hidden'), id);
    await back(p);
    const b = await p.evaluate((i) => !document.getElementById(i).classList.contains('hidden'), id);
    say(ok && a && b, `${tag} ${id} survives App Back and browser Back`, { ok, a, b });
    await p.evaluate((i) => document.getElementById(i).classList.add('hidden'), id);
    await fwd(p);
  }
  await p.evaluate(() => appTab('home')); await settle(p);
}

async function poison(p, errs, tag, fx) {
  console.log(`\n${tag} 7. stale private memory cannot move Back`);
  const B = fx.b.username;
  const poisonIt = () => {
    AC._profFrom = 'acSearchScreen'; AC._postNav = [{ type: 'screen', id: 'acListScreen' }];
    window._aiFrom = 'chat'; window._profFrom = 'acListScreen';
    try { _meSection = 'money'; } catch (e) {}
    _handoffPanel = { idx: 987654, sheets: ['tipSheet'] };
    _navStack.push({ idx: 987654, screen: 'acSearchScreen', appTab: 'search', path: '/', scrolls: [] });
    _navStack.push({ idx: (AtweHistory.current || {}).idx, screen: 'acListScreen', appTab: 'chat', path: '/not-here', scrolls: [] });
  };
  // Notifications -> profile, poisoned: Back is still /notifications.
  await p.evaluate(() => appTab('home')); await settle(p);
  await p.evaluate(() => acNavNotifs()); await settle(p, 2200);
  await p.evaluate(() => { const row = [...document.querySelectorAll('#notifList .notif-row')].find((x) => x.dataset.type === 'follow'); if (row) row.click(); });
  await settle(p, 1500);
  await p.evaluate(poisonIt);
  await p.evaluate(() => acProfileBack()); await settle(p, 1500);
  let s = await snap(p);
  say(s.path === '/notifications' && s.top === 'notifOverlay' && s.coherent, `${tag} poisoned _profFrom/_navStack: profile Back still returns to /notifications`, { path: s.path, top: s.top, why: s.why });
  await p.evaluate(() => closeOverlay('notifOverlay', true)); await settle(p);
  // Home -> profile -> post, poisoned: post Back is the profile, profile Back is Home.
  await p.evaluate(() => appTab('home')); await settle(p);
  await p.evaluate((u) => acGoProfile(u), B); await settle(p, 1400);
  await p.evaluate((id) => acOpenPostView(id), fx.postId); await settle(p, 1400);
  await p.evaluate(poisonIt);
  await p.evaluate(() => acPostViewBack()); await settle(p, 1400);
  s = await snap(p);
  say(s.path === '/' + B && s.screen === 'acProfileScreen', `${tag} poisoned _postNav: post Back still returns to the profile`, { path: s.path, screen: s.screen });
  await p.evaluate(poisonIt);
  await p.evaluate(() => acProfileBack()); await settle(p, 1400);
  s = await snap(p);
  say(s.path === '/' && s.screen === 'acHomeScreen' && s.tab === 'home' && s.coherent, `${tag} poisoned _profFrom: profile Back still returns Home`, { path: s.path, screen: s.screen, tab: s.tab, why: s.why });
  // Settings Premium -> Wallet, poisoned _meSection: Back is Settings, not /account/money.
  await p.evaluate(() => openSettings('premium')); await settle(p, 1200);
  await p.evaluate(() => acOpenWallet()); await settle(p, 1400);
  await p.evaluate(poisonIt);
  await appBack(p);
  s = await snap(p);
  say(s.path === '/settings/premium' && s.top === 'settingsOverlay', `${tag} poisoned _meSection: Wallet Back still returns to Settings Premium`, { path: s.path, top: s.top });
  await p.evaluate(() => closeSettings(true)); await settle(p);
  // AI, poisoned _aiFrom: Back is the world it really came from.
  await p.evaluate(() => appTab('search')); await settle(p, 1200);
  await p.evaluate(() => appTab('ai')); await settle(p, 1200);
  await p.evaluate(poisonIt);
  await p.evaluate(() => acAiBack()); await settle(p, 1400);
  s = await snap(p);
  say(s.path === '/search' && s.tab === 'search', `${tag} poisoned _aiFrom: AI Back returns to the world it really came from`, { path: s.path, tab: s.tab });
  const leftover = await p.evaluate(() => !document.getElementById('tipSheet').classList.contains('hidden'));
  say(!leftover, `${tag} a stale handoff mark reopens nothing`, leftover);
  await p.evaluate(() => { _navStack.length = 0; _handoffPanel = null; delete AC._profFrom; delete AC._postNav; delete window._aiFrom; delete window._profFrom; });
  await p.evaluate(() => appTab('home')); await settle(p);
  say(errs.length === 0, `${tag} 7. no JS errors`, errs.slice(0, 2));
}

async function mixedState(p, errs, tag, fx) {
  console.log(`\n${tag} 8. mixed state (world + screen + overlay + URL + nav agree)`);
  // The build-1871 shape: Marketplace -> seller (handoff) -> Back; and Orders -> chat -> Back.
  await p.evaluate(() => appTab('search')); await settle(p, 1200);
  await p.evaluate(() => acOpenMarketplace()); await settle(p, 1500);
  await p.evaluate((u) => { acHandoffFrom('marketplaceView'); acGoProfile(u); }, fx.b.username); await settle(p, 1500);
  let s = await snap(p);
  say(s.path === '/' + fx.b.username && s.coherent, `${tag} Marketplace -> seller is the seller's profile`, s.why);
  await p.evaluate(() => acProfileBack()); await settle(p, 1500);
  s = await snap(p);
  say(s.path === '/marketplace' && s.top === 'marketplaceView' && s.tab === 'search' && s.screen === 'acSearchScreen' && s.coherent,
    `${tag} Back: Marketplace over Engine, Engine lit (no Engine chrome over Home)`, { path: s.path, top: s.top, tab: s.tab, screen: s.screen, why: s.why });
  await fwd(p);
  s = await snap(p);
  say(s.path === '/' + fx.b.username && s.screen === 'acProfileScreen' && !s.open.includes('marketplaceView') && s.coherent, `${tag} Forward: the profile, no Marketplace lingering underneath`, { open: s.open, why: s.why });
  await back(p);
  await p.evaluate(() => closeOverlay('marketplaceView', true)); await settle(p);
  // An Account tool reached from the Account world, left for a conversation, and back.
  await p.evaluate(() => appTab('profile')); await settle(p, 1200);
  await p.evaluate(() => acOpenOrders('buyer')); await settle(p, 1400);
  const ordIdx = (await snap(p)).idx;
  await p.evaluate((id) => { acHandoffFrom('ordersView'); appTab('chat'); acOpenChat(id); }, fx.b.id); await settle(p, 2000);
  s = await snap(p);
  say(s.screen === 'acThreadScreen' && s.ownLeg && s.prev === ordIdx, `${tag} Orders -> conversation (a conversation owns no URL: legacy-unrouted)`, { screen: s.screen, prev: s.prev, ordIdx });
  await p.evaluate(() => acBackToList()); await settle(p, 1800);
  s = await snap(p);
  say(s.path === '/account/orders' && s.top === 'ordersView' && s.tab === 'profile' && s.screen === 'acMeScreen' && s.coherent,
    `${tag} its Back walks REAL history to Orders over the Account world (no Beam chrome + stale tool)`, { path: s.path, top: s.top, tab: s.tab, screen: s.screen, why: s.why });
  await p.evaluate(() => closeOverlay('ordersView', true)); await settle(p);
  await p.evaluate(() => appTab('home')); await settle(p);
  say(errs.length === 0, `${tag} 8. no JS errors`, errs.slice(0, 2));
}

/* 2. Direct entries: each is a fresh tab with NOTHING of ours behind it. */
async function directEntries(browser, token, vp, tag, fx) {
  console.log(`\n${tag} 2. direct entry`);
  const B = fx.b.username;
  const cases = [
    ['profile', '/' + B, ['/']],
    ['post', '/' + B + '/post/' + fx.postId, ['/']],
    ['circle', '/circle/' + fx.circle, ['/']],
    ['Settings page', '/settings/privacy', ['/settings']],
    ['Settings leaf', '/settings/security/devices', ['/settings/security', '/settings']],
    ['Account section', '/account/money', ['/me']],
    ['Account tool', '/account/wallet', ['/account/money', '/me']],
    ['Marketplace', '/marketplace', ['/search']],
    ['listing', '/listing/' + fx.listingId, [null]],
    ['job', '/job/' + fx.jobId, [null]],
    ['event', '/event/' + fx.eventId, [null]],
    ['/ai', '/ai', ['/']],
  ];
  for (const [name, url, wants] of cases) {
    const { ctx, p, errs } = await newTab(browser, token, vp, url);
    await settle(p, 1400);
    let s = await snap(p);
    const len0 = s.len, idx0 = s.idx;
    say(s.path === url && s.prev === null && s.coherent, `${tag} ${name}: ${url} direct has no fake previous entry`, { path: s.path, prev: s.prev, why: s.why });
    for (const want of wants) {
      const n0 = s.events;
      const r = await appBack(p);
      s = await snap(p);
      const ev = navEvents(await evSince(p, n0));
      const okPath = want === null ? (['/', '/messages', '/search', '/me'].includes(s.path) && !s.open.length) : s.path === want;
      const okEv = want === null ? ev.every((e) => e.kind === 'replace') : (ev.length === 1 && ev[0].kind === 'replace');
      say(r === 'x' && okPath && s.idx === idx0 && s.len === len0 && okEv && s.coherent,
        `${tag} ${name}: App Back -> ${want === null ? 'the world it was shown over (layer close)' : want} by REPLACE, history does not grow`,
        { r, path: s.path, idx: [idx0, s.idx], len: [len0, s.len], ev, open: s.open, why: s.why });
    }
    await p.goBack({ timeout: 4000 }).catch(() => {});
    await settle(p, 800);
    const left = p.url();
    say(!left.startsWith(BASE) || left === 'about:blank', `${tag} ${name}: browser Back from the direct entry leaves Atwe`, left);
    say(errs.length === 0, `${tag} ${name}: no JS errors`, errs.slice(0, 2));
    await ctx.close();
  }
}

async function roots(p, errs, tag) {
  console.log(`\n${tag} root`);
  const { ctx } = { ctx: null };
  void ctx;
  const s0 = await snap(p);
  if (s0.prev === null) {
    const r = await appBack(p);
    const s = await snap(p);
    say(r === 'exit' && s.path === s0.path && s.idx === s0.idx, `${tag} a root with nothing behind: App Back does nothing ('exit')`, { r, path: s.path });
  }
}

(async () => {
  const pool = QA.newPool();
  const crypto = require('crypto');
  const fx = {};
  try {
    fx.a = await QA.seedAccount(pool, { business: true, prefix: 'r6a' });
    fx.b = await QA.seedAccount(pool, { business: true, prefix: 'r6b' });
    const one = async (q, v) => (await pool.query(q, v)).rows[0];
    fx.postId = (await one("INSERT INTO posts (user_id, body) VALUES ($1, 'route6 post by B') RETURNING id", [fx.b.id])).id;
    fx.ownPostId = (await one("INSERT INTO posts (user_id, body) VALUES ($1, 'route6 post by A') RETURNING id", [fx.a.id])).id;
    const circ = await one("SELECT id, username FROM circles WHERE username IS NOT NULL AND official ORDER BY id LIMIT 1");
    fx.circle = circ.username;
    await pool.query('INSERT INTO post_circles (post_id, circle_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [fx.postId, circ.id]);
    fx.listingId = (await one("INSERT INTO products (business_id, name, price_cents, active) VALUES ($1, 'route6 listing', 1500, true) RETURNING id", [fx.b.id])).id;
    fx.jobId = (await one("INSERT INTO jobs (posted_by, title, description) VALUES ($1, 'route6 job', 'x') RETURNING id", [fx.b.id])).id;
    fx.eventId = (await one("INSERT INTO events (host_id, title, starts_at) VALUES ($1, 'route6 event', now() + interval '3 days') RETURNING id", [fx.b.id])).id;
    for (const [t, extra] of [['follow', {}], ['like', { post_id: fx.ownPostId }], ['payment', {}], ['price_drop', { product_id: fx.listingId }], ['login', {}]]) {
      await pool.query('INSERT INTO notifications (user_id, actor_id, type, post_id, product_id) VALUES ($1,$2,$3,$4,$5)',
        [fx.a.id, t === 'login' ? fx.a.id : fx.b.id, t, extra.post_id || null, extra.product_id || null]);
    }
    void crypto;
  } finally { await pool.end(); }
  const seen = await QA.serverSees(fx.a.token);
  if (!seen.ok) { console.log('  FAIL fixture: the server does not see the seeded account (HTTP ' + seen.status + ')'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const t0 = Date.now();
  try {
    for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      const tag = vp.width >= 1000 ? '[desktop]' : '[phone]';
      const { ctx, p, errs } = await newTab(browser, fx.a.token, vp, '/');
      await roots(p, errs, tag);
      await realHistory(p, errs, tag, fx);
      await notifications(p, errs, tag, fx);
      await contextual(p, errs, tag, fx);
      await modals(p, errs, tag, fx);
      await gates(p, errs, tag);
      await poison(p, errs, tag, fx);
      await mixedState(p, errs, tag, fx);
      say(errs.length === 0, `${tag} no JS errors over the whole run`, errs.slice(0, 3));
      await ctx.close();
      await directEntries(browser, fx.a.token, vp, tag, fx);
    }
    {
      const tag = '[tablet]';
      const { ctx, p, errs } = await newTab(browser, fx.a.token, { width: 820, height: 1180 }, '/');
      await chain(p, tag, 'Home -> profile -> post', () => appTab('home'), [
        { name: 'profile', act: (u) => acGoProfile(u), arg: fx.b.username, want: '/' + fx.b.username },
        { name: 'post', act: (id) => acOpenPostView(id), arg: fx.postId, want: '/' + fx.b.username + '/post/' + fx.postId },
      ]);
      await notifications(p, errs, tag, fx);
      await ctx.close();
      await directEntries(browser, fx.a.token, { width: 820, height: 1180 }, tag, fx);
    }
  } catch (e) {
    fail++; console.log('  FAIL the probe threw: ' + (e && e.stack || e).toString().slice(0, 600));
  } finally {
    await browser.close();
  }
  console.log(`\n${pass} passed, ${fail} FAILED  (${Math.round((Date.now() - t0) / 1000)}s)`);
  process.exit(fail ? 1 : 0);
})();
