/* Route batch 5 — Account sections and Account-owned tools are canonical URLs.
 *
 *   /me                          the Account ROOT (unchanged; /account is its batch-8 future)
 *   /account/<section>           eleven sections, rendered inside the Account page
 *   /account/<tool…>             the Account tools, each a routed overlay
 *   /wallet, /store, /orders …   the flat addresses issued before batch 5: permanent ALIASES,
 *                                canonicalised to /account/… by replace
 *
 * THE URL IS THE DESTINATION. The same address rebuilds the same destination from any
 * starting point, whatever `_meSection` remembers; a tap is ONE push and ONE NavEvent;
 * Back/Forward walk real entries; a direct entry's own Account Back walks the logical
 * parent (tool -> section -> /me) by REPLACE, never fabricating history behind a link.
 *
 * Owns its fixture (one business account, so every business-only row exists). Runs the
 * full matrix at 390x844 and 1440x900, and a smoke pass at 820x1180. Data-driven: a direct
 * load is also the direct-entry Back test, and a reload is also the refresh test, so each
 * destination costs one navigation and one reload per width.
 *
 *   node route5.js               the checks
 *   node route5.js --break       serves the page with the Account section taken back out of
 *                                the path sync (a section leaves /me in the address bar, the
 *                                pre-batch-5 defect); must FAIL by name
 *   node route5.js --break=flat  serves the page with Account tools on their FLAT addresses
 *                                again (/wallet never canonicalises); must FAIL by name
 */
'use strict';
const path = require('path');
const QA = require(path.join(__dirname, 'qa-fixture.js'));
const R = require(path.join(__dirname, '..', 'public', 'atwe-routes.js'));
const { chromium } = require(process.env.PW_SCRATCH
  ? path.join(process.env.PW_SCRATCH, 'node_modules/playwright-core')
  : path.join(__dirname, 'node_modules/playwright-core'));

const BREAK = process.argv.find((a) => a.startsWith('--break'));
const BREAK_KIND = BREAK ? (BREAK.split('=')[1] || 'section') : null;
const BASE = QA.base();
let pass = 0, fail = 0;
const say = (ok, what, extra) => { ok ? pass++ : fail++; console.log((ok ? '  ok   ' : '  FAIL ') + what + (extra !== undefined ? '   ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); };

/* --break: two pre-batch-5 defects, each by its exact current source. */
const OLD = {
  section: [[`      if (_appTab === 'profile') { const sec = acMeShownSection(); if (sec) { acSetPath(acAccountSectionPath(sec) || WORLD_PATH.profile, _push); return; } }\n`, '']],
  flat: [[`  return acRoutePath(key, null, def.acct ? '/account/' + def.acct : '/' + key);`, `  return '/' + key;`]],
};

/* The page's own section id for each URL key (two differ on purpose). */
const SEC_ID = { profile: 'profile', money: 'money', selling: 'selling', customers: 'customers', marketing: 'growth',
  jobs: 'jobs', library: 'library', planning: 'planning', creating: 'creating', ai: 'ai', help: 'app' };
/* How a person reaches each section from the Account hub: the row's visible label. */
const SECTIONS = R.ACCOUNT_SECTIONS.map(([key, title]) => ({ key, title, id: SEC_ID[key],
  row: key === 'help' ? '^Help & feedback$' : '^' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$' }));

/* How a person reaches each tool in-app: a row in its owning section, or (store-orders,
   coupons, bundles) a row inside Manage store. [name, label regex, via] */
const REACH = {
  wallet: ['^Wallet$'], 'money-requests': ['^Money requests$'], invoices: ['^Invoices$'], quotes: ['^Quotes$'],
  'payment-links': ['^Payment links$'], 'gift-cards': ['^Gift cards$'], rewards: ['^Rewards$'], referrals: ['^Invite friends$'],
  card: ['^Atwe Card$'], store: ['^Manage store$'], listings: ['^My listings$'],
  'store-orders': ['^Orders', 'store'], coupons: ['^Coupons', 'store'], bundles: ['^Bundles', 'store'],
  analytics: ['^Sales & analytics$'], ads: ['^Ads Manager$'], dashboard: ['^Business dashboard$'], team: ['^Team$'],
  till: ['^The till$'], delivery: ['^Local delivery$'], phone: ['^Business phone number$'],
  verification: ['^Verify your identity$'], pro: ['^(Upgrade to Pro|Manage plan)$'], affiliate: ['^Affiliate program$'],
  orders: ['^Orders$'], saved: ['^Saved items$'], subscriptions: ['^Subscriptions$'], addresses: ['^Addresses$'],
  bookings: ['^Bookings$'], calendar: ['^Calendar$'], appointments: ['^Appointments$'], resumes: ['^Resumes$'],
  'job-alerts': ['^Job alerts$'], network: ['^My network$'],
};
const TOOLS = R.ACCOUNT_TOOLS.map(([name, sub, view, section, title, alias]) => ({
  name, path: '/account/' + sub, view, section, secId: SEC_ID[section], title, alias,
  label: REACH[name][0], via: REACH[name][1] || null }));
const secPath = (key) => '/account/' + key;

async function freshPage(browser, token, viewport, first) {
  /* --break MUST block the service worker. After the first load the worker serves every
     navigation itself, and a request a service worker makes is NOT seen by context.route —
     so the broken page reached only each context's first document and the phone and desktop
     passes quietly ran against the real one (the first self-test "failed" 2 checks of 754). */
  const ctx = await browser.newContext(BREAK ? { viewport, serviceWorkers: 'block' } : { viewport });
  if (BREAK) {
    await ctx.route(/localhost:\d+\/[^.]*$/, async (route) => {
      if (route.request().resourceType() !== 'document') return route.continue();
      const res = await route.fetch();
      let html = await res.text();
      for (const [now, was] of OLD[BREAK_KIND]) {
        if (!html.includes(now)) throw new Error('--break: current code not found, the probe is stale');
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
  }, token);
  await go(p, first || '/me');
  return { ctx, p, errs };
}
const booted = async (p) => {
  /* `S` is a top-level let, NOT a window property: `window.S` is always undefined and a wait
     on it burns its whole timeout on every load. Ask for the binding itself. */
  await QA.waitUntil(p, () => typeof S !== 'undefined' && !!(S.user && S.user.id), null, 25000);
  await QA.waitUntil(p, () => window.AtweHistory && !AtweHistory.booting, null, 15000);
  await p.waitForTimeout(700);
};
const go = async (p, url) => { await p.goto(BASE + url, { waitUntil: 'domcontentloaded' }); await booted(p); };
const reload = async (p) => { await p.reload({ waitUntil: 'domcontentloaded' }); await booted(p); };
const settle = (p, ms) => p.waitForTimeout(ms || 900);
const back = async (p) => { await p.goBack({ timeout: 6000 }).catch(() => {}); await settle(p, 1100); };
const fwd = async (p) => { await p.goForward({ timeout: 6000 }).catch(() => {}); await settle(p, 1100); };

const snap = (p) => p.evaluate(() => {
  const vis = (o) => !o.classList.contains('hidden') && !o.classList.contains('closing');
  const open = [...document.querySelectorAll('.overlay:not(.hidden):not(.closing)')].map((o) => o.id);
  const nav = ['bnav-profile', 'snav-profile'].map((id) => document.getElementById(id)).filter((e) => e && e.getBoundingClientRect().width > 0);
  const me = document.getElementById('acMeScreen');
  return { path: location.pathname, len: history.length, idx: (history.state || {}).idx, st: history.state,
    sec: acMeShownSection(), meVisible: !!me && vis(me), tab: _appTab, open, top: open[open.length - 1] || null,
    title: document.title, events: AtweHistory.log.length, hasPrev: AtweHistory.hasPrev(),
    navLit: nav.length > 0 && nav.every((e) => e.classList.contains('active')),
    // AC is a top-level binding, not window.AC
    ordScope: typeof AC !== 'undefined' ? AC._ordScope : undefined, secTitle: (document.querySelector('#acMeBody .me-sectitle') || {}).textContent || null,
    stale: [...document.querySelectorAll('.overlay:not(.hidden):not(.closing)')].filter((o) => o._ownPath && o._ownPath !== location.pathname).map((o) => o.id) };
});
const evSince = (p, n) => p.evaluate((k) => AtweHistory.log.slice(k), n);
const navEvents = (evs) => evs.filter((e) => ['push', 'replace', 'root-change', 'traverse'].includes(e.kind));
const titled = (s, t) => new RegExp('(^|\\) )' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' · Atwe$').test(s.title);
/* No stale state behind the URL: nothing of another route is open, and history.state carries
   only bookkeeping (no section name, no setPage/via). */
const cleanState = (s) => !!s.st && s.st.atwe === 2 && Number.isInteger(s.st.idx) && s.st.path === s.path
  && !['section', 'meSection', '_meSection', 'setPage', 'via'].some((k) => k in s.st);

/* Tap a visible Account row by its label, inside the Account page or the Manage store sheet. */
const tapRow = (p, scope, re) => p.evaluate(([scope, re]) => {
  const rx = new RegExp(re);
  const root = document.querySelector(scope);
  if (!root) return false;
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const el = [...root.querySelectorAll('.me-row, button, [onclick]')].filter(vis)
    .find((x) => rx.test(((x.querySelector('.me-lbl, .sm-title, .sm-lbl') || x).textContent || '').trim().replace(/\s+/g, ' ')));
  if (!el) return false; el.click(); return true;
}, [scope, re]);

async function rootChecks(p, errs, tag) {
  console.log(`\n${tag} A. the Account root`);
  await go(p, '/me');
  let s = await snap(p);
  say(s.path === '/account' && s.meVisible && s.sec === null && s.tab === 'profile' && s.navLit, `${tag} A1. /me (the old root, an alias since batch 8) direct: lands on /account, the Account hub, Account lit`, s.path);
  await reload(p); s = await snap(p);
  say(s.path === '/account' && s.meVisible && s.sec === null, `${tag} A2. refresh keeps /account`, s.path);
  /* Boot restores the LAST world used, which is Account here, so land on Home in-app first:
     the question is what entering Account from another world does. */
  await go(p, '/');
  await p.evaluate(() => appTab('home')); await settle(p);
  const n0 = (await snap(p)).events;
  await p.evaluate(() => appTab('profile')); await settle(p);
  s = await snap(p);
  const ev = navEvents(await evSince(p, n0));
  say(s.path === '/account' && s.meVisible && ev.length === 1, `${tag} A3. Account from another world is /account, one NavEvent`, { path: s.path, ev: ev.map((e) => e.kind) });
  await back(p); s = await snap(p);
  say(s.path === '/' && !s.meVisible, `${tag} A4. Back leaves /account for the world it came from`, s.path);
  await fwd(p); s = await snap(p);
  say(s.path === '/account' && s.meVisible && s.sec === null, `${tag} A5. Forward returns into /account`, s.path);
  say(R.get('me').pattern === '/account' && R.get('me').aliases.includes('/me'), `${tag} A6. /account is the Account root (route batch 8); /me is its alias`);
  say(errs.length === 0, `${tag} A7. no JS errors`, errs.slice(0, 2));
}

async function sectionChecks(p, errs, tag) {
  console.log(`\n${tag} B. the eleven sections`);
  for (const S of SECTIONS) {
    const want = secPath(S.key);
    const e0 = errs.length;
    // Direct load: the section, in the Account world, and nothing else.
    await go(p, want);
    let s = await snap(p);
    say(s.path === want && s.meVisible && s.sec === S.id && s.tab === 'profile' && s.navLit && s.open.length === 0 && titled(s, S.title),
      `${tag} ${S.key}: direct load renders the section`, { path: s.path, sec: s.sec, open: s.open, title: s.title });
    // Account Back on a direct entry: the root, by REPLACE (no history behind a link).
    let idx = s.idx, n = s.events;
    await p.evaluate(() => appGoBack()); await settle(p);
    s = await snap(p);
    let ev = navEvents(await evSince(p, n));
    say(s.path === '/account' && s.sec === null && s.idx === idx && ev.length === 1 && ev[0].kind === 'replace',
      `${tag} ${S.key}: Account Back on a direct entry -> /me by replace`, { path: s.path, idx: [idx, s.idx], ev: ev.map((e) => e.kind) });
    // In-app: /me -> section is one push, one NavEvent.
    idx = s.idx; n = s.events;
    const tapped = await tapRow(p, '#acMeBody', S.row);
    await settle(p);
    s = await snap(p);
    ev = navEvents(await evSince(p, n));
    /* history.length is CAPPED AT 50 by the browser, so after a few dozen steps it stops
       counting: the entry's own idx and the NavEvent log are the exact measure. */
    say(tapped && s.path === want && s.sec === S.id && s.idx === idx + 1 && ev.length === 1 && ev[0].kind === 'push' && cleanState(s),
      `${tag} ${S.key}: Account -> section is ONE push to ${want}`, { tapped, path: s.path, idx: [idx, s.idx], ev: ev.map((e) => e.kind) });
    await reload(p); s = await snap(p);
    say(s.path === want && s.sec === S.id && s.meVisible, `${tag} ${S.key}: refresh keeps the section`, s.path);
    n = s.events;
    await back(p); s = await snap(p);
    ev = navEvents(await evSince(p, n));
    say(s.path === '/account' && s.sec === null && ev.length === 1 && ev[0].direction === 'back', `${tag} ${S.key}: browser Back -> /me`, { path: s.path, ev: ev.map((e) => e.kind + ':' + e.direction) });
    n = s.events;
    await fwd(p); s = await snap(p);
    ev = navEvents(await evSince(p, n));
    say(s.path === want && s.sec === S.id && ev.length === 1 && ev[0].direction === 'forward', `${tag} ${S.key}: browser Forward -> the section`, { path: s.path, ev: ev.map((e) => e.kind + ':' + e.direction) });
    say(errs.length === e0, `${tag} ${S.key}: no JS errors`, errs.slice(e0, e0 + 2));
  }
}

async function openTool(p, T) {
  if (T.via === 'store') {
    if (!(await tapRow(p, '#acMeBody', '^Manage store$'))) return false;
    await settle(p, 1200);
    return tapRow(p, '#storeManageView', T.label);
  }
  return tapRow(p, '#acMeBody', T.label);
}

async function toolChecks(p, errs, tag, list) {
  console.log(`\n${tag} C. the Account tools (${list.length})`);
  for (const T of list) {
    const e0 = errs.length;
    const secWant = secPath(T.section);
    // Direct load: Account world, the tool on top, its own section underneath.
    await go(p, T.path);
    let s = await snap(p);
    const seller = T.name !== 'store-orders' || s.ordScope === 'seller';
    say(s.path === T.path && s.top === T.view && s.sec === T.secId && s.tab === 'profile' && s.stale.length === 0 && seller && titled(s, T.title),
      `${tag} ${T.name}: direct load -> ${T.path} over the ${T.section} section`, { path: s.path, top: s.top, sec: s.sec, title: s.title, ordScope: s.ordScope });
    // Account Back on a direct entry: tool -> section -> /me, each by replace.
    let idx = s.idx, n = s.events;
    await p.evaluate(() => appGoBack()); await settle(p);
    s = await snap(p);
    let ev = navEvents(await evSince(p, n));
    say(s.path === secWant && !s.open.includes(T.view) && s.sec === T.secId && s.idx === idx && ev.length === 1 && ev[0].kind === 'replace',
      `${tag} ${T.name}: Account Back (direct) -> ${secWant} by replace`, { path: s.path, open: s.open, idx: [idx, s.idx], ev: ev.map((e) => e.kind) });
    // In-app from the section: one push to the canonical path.
    idx = s.idx; n = s.events;
    const tapped = await openTool(p, T);
    await settle(p, 1200);
    s = await snap(p);
    ev = navEvents(await evSince(p, n));
    const viaStore = T.via === 'store';
    say(tapped && s.path === T.path && s.top === T.view && s.stale.length === 0 && s.idx === idx + (viaStore ? 2 : 1)
        && ev.filter((e) => e.kind === 'push').length === (viaStore ? 2 : 1) && cleanState(s),
      `${tag} ${T.name}: ${viaStore ? 'store -> ' : 'section -> '}tool is one push to ${T.path}`, { tapped, path: s.path, top: s.top, idx: [idx, s.idx], ev: ev.map((e) => e.kind) });
    await reload(p); s = await snap(p);
    say(s.path === T.path && s.top === T.view && s.stale.length === 0, `${tag} ${T.name}: refresh keeps ${T.path}`, { path: s.path, top: s.top });
    n = s.events;
    await back(p); s = await snap(p);
    say(s.path === (viaStore ? '/account/store' : secWant) && !s.open.includes(T.view) && navEvents(await evSince(p, n)).length === 1,
      `${tag} ${T.name}: browser Back -> ${viaStore ? '/account/store' : secWant}`, { path: s.path, open: s.open });
    n = s.events;
    await fwd(p); s = await snap(p);
    say(s.path === T.path && s.top === T.view && navEvents(await evSince(p, n)).length === 1, `${tag} ${T.name}: browser Forward -> ${T.path}`, { path: s.path, top: s.top });
    say(errs.length === e0, `${tag} ${T.name}: no JS errors`, errs.slice(e0, e0 + 2));
  }
}

async function aliasChecks(p, errs, tag) {
  const aliases = TOOLS.filter((t) => t.alias);
  console.log(`\n${tag} D. legacy flat aliases (${aliases.length})`);
  for (const T of aliases) {
    await go(p, T.alias);
    const s = await snap(p);
    const m = R.match(T.alias);
    /* A fresh document's NavEvent log starts empty: canonicalising must be a REPLACE of the
       arrival entry (initial -> replace), never a push that would leave a second entry. */
    const kinds = (await evSince(p, 0)).map((e) => e.kind);
    say(s.path === T.path && s.top === T.view && m && m.alias && m.name === T.name && cleanState(s) && !kinds.includes('push') && kinds.includes('replace'),
      `${tag} ${T.alias} -> ${T.path} (replace, no extra entry, the tool on top)`, { path: s.path, top: s.top, kinds });
  }
  await go(p, '/me');
  const s0 = await snap(p);
  await go(p, '/wallet');
  let s = await snap(p);
  say(s.idx === s0.idx + 1 && s.path === '/account/wallet', `${tag} a flat alias adds exactly the one entry the browser made`, [s0.idx, s.idx]);
  await reload(p); s = await snap(p);
  say(s.path === '/account/wallet', `${tag} refresh after canonicalising stays canonical`, s.path);
  await back(p); s = await snap(p);
  say(s.path === '/account', `${tag} Back from the canonicalised alias returns to the entry before it`, s.path);
  say(aliases.every((t) => R.match(t.alias).name !== 'profile'), `${tag} no flat alias is ever read as a username`);
  say(errs.length === 0, `${tag} aliases: no JS errors`, errs.slice(0, 2));
}

async function settingsHandoffs(p, errs, tag) {
  console.log(`\n${tag} E. Settings -> Account handoffs`);
  await go(p, '/settings/premium');
  let s = await snap(p);
  const n0 = s.events;
  const ok1 = await p.evaluate(() => { const b = [...document.querySelectorAll('#settingsOverlay .iset-body[data-page="premium"] .iset-row')].find((x) => /Wallet/.test(x.textContent)); if (b) b.click(); return !!b; });
  await settle(p, 1100); s = await snap(p);
  say(ok1 && s.path === '/account/wallet' && s.top === 'walletView' && navEvents(await evSince(p, n0)).filter((e) => e.kind === 'push').length === 1,
    `${tag} E1. Settings Premium -> Wallet lands on /account/wallet`, { path: s.path, top: s.top });
  await back(p); s = await snap(p);
  say(s.path === '/settings/premium' && s.open.includes('settingsOverlay') && !s.open.includes('walletView'), `${tag} E2. Back returns to /settings/premium`, { path: s.path, open: s.open });
  await go(p, '/settings');
  const ok2 = await p.evaluate(() => { const b = document.querySelector('#hubStoreGroup .iset-row'); if (b) b.click(); return !!b; });
  await settle(p, 1200); s = await snap(p);
  say(ok2 && s.path === '/account/store' && s.top === 'storeManageView', `${tag} E3. Settings -> Manage store lands on /account/store`, { path: s.path, top: s.top });
  await back(p); s = await snap(p);
  say(s.path === '/settings' && s.open.includes('settingsOverlay') && !s.open.includes('storeManageView'), `${tag} E4. Back returns to /settings`, { path: s.path, open: s.open });
  say(!R.ROUTES.some((x) => x.world === 'settings' && /wallet|store/.test(x.pattern)), `${tag} E5. neither tool is nested under /settings`);
}

async function staleMemory(p, errs, tag) {
  console.log(`\n${tag} F. the URL wins over stale _meSection`);
  for (const [key, wrong] of [['money', 'jobs'], ['selling', 'creating'], ['library', 'ai']]) {
    // (a) a direct load after the page's memory says something else
    await go(p, '/me');
    await p.evaluate((w) => { _meSection = w; }, wrong);
    await go(p, '/account/' + key);
    let s = await snap(p);
    say(s.path === '/account/' + key && s.sec === SEC_ID[key], `${tag} F. /account/${key} direct with _meSection="${wrong}"`, { sec: s.sec });
    // (b) a history traverse onto the URL while the page's memory is wrong
    await go(p, '/account/' + wrong);
    await p.evaluate((w) => { _meSection = w; }, 'creating');
    await p.evaluate((k) => { history.pushState(null, '', '/account/' + k); window.dispatchEvent(new PopStateEvent('popstate', { state: null })); }, key);
    await settle(p, 900);
    s = await snap(p);
    say(s.path === '/account/' + key && s.sec === SEC_ID[key] && s.secTitle && s.secTitle.length > 0,
      `${tag} F. a traverse onto /account/${key} renders ${key}, not the stale memory`, { sec: s.sec, title: s.secTitle });
  }
}

async function transients(p, errs, tag) {
  console.log(`\n${tag} G. transient flows keep the owning URL`);
  const cases = [
    ['/account/wallet', 'acOpenSendMoneyByUsername()', 'Send money'],
    ['/account/wallet', 'acOpenRequestMoney()', 'Request money'],
    ['/account/wallet', 'acOpenAddMoney()', 'Add money'],
    ['/account/store/listings', 'acProductFormOpen()', 'Create listing'],
    ['/account/store/coupons', 'acCouponFormOpen()', 'Create coupon'],
    ['/account/store/bundles', 'acBundleFormOpen()', 'Create bundle'],
    ['/account/profile', 'openProfileEdit()', 'Edit profile'],
    ['/account/money', 'acOpenSendMoneyByUsername()', 'Send money from Money'],
  ];
  for (const [at, open, name] of cases) {
    await go(p, at);
    const s0 = await snap(p);
    await p.evaluate((code) => { try { (0, eval)(code); } catch (e) { window.__openErr = String(e); } }, open);
    await settle(p, 1100);
    const s = await snap(p);
    say(s.path === at && s.top && s.top !== s0.top && s.idx === s0.idx, `${tag} G. ${name} opens over ${at} and the URL stays ${at}`, { path: s.path, top: s.top });
  }
}

async function unsafeDetails(tag) {
  console.log(`\n${tag} H. no private detail made addressable`);
  for (const n of ['order-detail', 'store-order-detail', 'wallet-tx']) say(R.get(n) && R.get(n).status === 'planned', `${tag} H. ${n} stays planned`);
  const live = R.liveRoutes().filter((x) => x.world === 'account');
  say(live.every((x) => !/:/.test(x.pattern)), `${tag} H. no live Account route takes an id`, live.filter((x) => /:/.test(x.pattern)).map((x) => x.name));
  say(['/account/orders/5', '/account/store/orders/5', '/account/wallet/tx/5'].every((u) => R.match(u) === null), `${tag} H. detail URLs match nothing`);
}

(async () => {
  const pool = QA.newPool();
  let acct;
  try { acct = await QA.seedAccount(pool, { business: true, prefix: 'r5' }); } finally { await pool.end(); }
  const seen = await QA.serverSees(acct.token);
  if (!seen.ok) { console.log('  FAIL fixture: the server does not see the seeded account (HTTP ' + seen.status + ')'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const t0 = Date.now();
  try {
    for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      const tag = vp.width >= 1000 ? '[desktop]' : '[phone]';
      const { ctx, p, errs } = await freshPage(browser, acct.token, vp);
      await rootChecks(p, errs, tag);
      await sectionChecks(p, errs, tag);
      await toolChecks(p, errs, tag, TOOLS);
      await aliasChecks(p, errs, tag);
      await settingsHandoffs(p, errs, tag);
      await staleMemory(p, errs, tag);
      await transients(p, errs, tag);
      say(errs.length === 0, `${tag} no JS errors over the whole run`, errs.slice(0, 3));
      await ctx.close();
    }
    // Responsive smoke at a tablet width.
    {
      const tag = '[tablet]';
      const { ctx, p, errs } = await freshPage(browser, acct.token, { width: 820, height: 1180 }, '/account/money');
      console.log(`\n${tag} responsive smoke`);
      let s = await snap(p);
      say(s.path === '/account/money' && s.sec === 'money', `${tag} /account/money direct`, s.path);
      await tapRow(p, '#acMeBody', '^Wallet$'); await settle(p, 1100); s = await snap(p);
      say(s.path === '/account/wallet' && s.top === 'walletView', `${tag} Money -> Wallet`, s.path);
      await back(p); s = await snap(p);
      say(s.path === '/account/money' && !s.open.includes('walletView'), `${tag} Back -> Money`, s.path);
      await go(p, '/account/store/listings'); s = await snap(p);
      say(s.path === '/account/store/listings' && s.top === 'sellView' && s.sec === 'selling', `${tag} /account/store/listings direct`, s.path);
      say(errs.length === 0, `${tag} no JS errors`, errs.slice(0, 2));
      await ctx.close();
    }
    await unsafeDetails('[registry]');
  } finally { await browser.close(); }
  console.log(`\n${pass} passed, ${fail} FAILED${BREAK ? '   (--break=' + BREAK_KIND + ': failures expected)' : ''}   (${Math.round((Date.now() - t0) / 1000)}s)`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
