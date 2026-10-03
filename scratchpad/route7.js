/* Route batch 7 — Engine browse under /engine, typed public entity permalinks.
 *
 *   ENGINE BROWSE   /engine/{marketplace|services|jobs|events|businesses|courses|
 *                   newsletters|communities|showcase}; each flat /<key> it used to live at
 *                   is a permanent alias, canonicalised by REPLACE. The Engine ROOT is still
 *                   /search until batch 8; /engine since.
 *   ENTITIES        /listing /service /job /event /course /newsletter : `{id}-{slug}`, the id
 *                   authoritative, the slug from the ONE registry rule; an issue is
 *                   /newsletter/<id>/issue/<n>; a community /communities/<id>.
 *   ONE NAVIGATION  an in-app open is ONE push of the canonical address (the sheet waits for
 *                   the title); a slug or alias correction is a REPLACE; Back is the real
 *                   history, a direct entry's App Back falls to the browse parent.
 *
 * Owns its fixture (two business accounts and one of every entity, titles chosen to stress
 * the slug rule). Full matrix at 390x844 and 1440x900, smoke at 820x1180.
 *
 *   node route7.js               the checks
 *   node route7.js --break=flat  a flat browse URL no longer canonicalises     (must FAIL)
 *   node route7.js --break=slug  a slug correction PUSHES instead of replacing  (must FAIL)
 *   node route7.js --break=parent a listing's direct-entry parent is Services   (must FAIL)
 */
'use strict';
const path = require('path');
const QA = require(path.join(__dirname, 'qa-fixture.js'));
const R = require(path.join(__dirname, '..', 'public', 'atwe-routes.js'));
const { chromium } = require(process.env.PW_SCRATCH
  ? path.join(process.env.PW_SCRATCH, 'node_modules/playwright-core')
  : path.join(__dirname, 'node_modules/playwright-core'));

const BREAK = process.argv.find((a) => a.startsWith('--break'));
const BREAK_KIND = BREAK ? (BREAK.split('=')[1] || 'flat') : null;
const BASE = QA.base();
let pass = 0, fail = 0;
const say = (ok, what, extra) => { ok ? pass++ : fail++; console.log((ok ? '  ok   ' : '  FAIL ') + what + (extra !== undefined && !ok ? '   ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); };

/* --break: each mutation is written against the exact current source; a stale probe throws. */
const MUT = {
  flat: { html: [[`  return acRoutePath(key, null, def.acct ? '/account/' + def.acct : def.engine ? '/engine/' + key : '/' + key);`,
                  `  if (def.engine) return '/' + key;\n  return acRoutePath(key, null, def.acct ? '/account/' + def.acct : '/' + key);`]] },
  /* the correction itself is written as a PUSH (straight through acSetPath, as the pre-registry
     openers did), so a stale link leaves the stale address behind it in history */
  slug: { html: [[`  acSyncPath(wait && wait.push ? { push: true } : undefined);`, `  if (wait && wait.push) acSyncPath({ push: true }); else acSetPath(path, { push: true });`]] },
  parent: { js: [[`parent: 'marketplace', privacy: 'public', seo: 'index', native: '/listing/:id'`, `parent: 'services', privacy: 'public', seo: 'index', native: '/listing/:id'`]] },
};

async function newTab(browser, token, viewport, first) {
  const ctx = await browser.newContext(BREAK ? { viewport, serviceWorkers: 'block' } : { viewport });
  if (BREAK) {
    const m = MUT[BREAK_KIND];
    await ctx.route(/localhost:\d+\/([^.]*|atwe-routes\.js.*)$/, async (route) => {
      const req = route.request();
      const isDoc = req.resourceType() === 'document', isReg = /atwe-routes\.js/.test(req.url());
      const pairs = isDoc ? m.html : isReg ? m.js : null;
      if (!pairs) return route.continue();
      const res = await route.fetch();
      let body = await res.text();
      for (const [now, was] of pairs) {
        if (!body.includes(now)) throw new Error('--break: current code not found, the probe is stale: ' + now.slice(0, 70));
        body = body.split(now).join(was);
      }
      await route.fulfill({ response: res, body, headers: { ...res.headers(), 'content-length': undefined } });
    });
  }
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript((t) => {
    try { localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_intro_seen', JSON.stringify(['beam', 'circles', 'ai', 'wallet'])); } catch (e) {}
    window.__nav = [];
    window.addEventListener('atwe:navigate', (e) => { window.__nav.push({ kind: e.detail.kind, direction: e.detail.direction, path: e.detail.to && e.detail.to.path }); });
  }, token);
  await go(p, first || '/');
  return { ctx, p, errs };
}
const booted = async (p) => {
  // S is a top-level let, not a window property: ask for the binding itself.
  await QA.waitUntil(p, () => typeof S !== 'undefined' && !!(S.user && S.user.id), null, 25000);
  await QA.waitUntil(p, () => window.AtweHistory && !AtweHistory.booting, null, 15000);
  await p.waitForTimeout(800);
};
const go = async (p, url) => { await p.goto(BASE + url, { waitUntil: 'domcontentloaded' }); await booted(p); };
const settle = (p, ms) => p.waitForTimeout(ms || 1200);
const back = async (p) => { await p.goBack({ timeout: 6000 }).catch(() => {}); await settle(p, 1300); };
const fwd = async (p) => { await p.goForward({ timeout: 6000 }).catch(() => {}); await settle(p, 1300); };
const reload = async (p) => { await p.reload({ waitUntil: 'domcontentloaded' }); await booted(p); await settle(p, 900); };
const appBack = async (p) => { const r = await p.evaluate(() => { try { return appGoBack(); } catch (e) { return 'threw:' + e.message; } }); await settle(p, 1300); return r; };
const closeAll = (p) => p.evaluate(() => { document.querySelectorAll('.overlay:not(.hidden)').forEach((o) => { try { closeOverlay(o.id, true); } catch (e) {} }); });

const snap = (p) => p.evaluate(() => {
  const vis = (e) => !!e && !e.classList.contains('hidden') && !e.classList.contains('closing');
  const open = [...document.querySelectorAll('.overlay:not(.hidden):not(.closing)')].map((o) => o.id);
  const screen = AC_SCREENS.find((id) => vis(document.getElementById(id))) || null;
  const owner = _navBackOwner();
  const why = [];
  const ownPathOf = (id) => { const o = document.getElementById(id); return o._ownPath || (id === 'settingsOverlay' ? acSettingsPath(_setPage) : (acViewRouteKey(id) ? acRouteKeyPath(acViewRouteKey(id)) : null)); };
  if (owner.overlay && ownPathOf(owner.overlay) !== location.pathname) why.push('top layer ' + owner.overlay + ' owns ' + ownPathOf(owner.overlay));
  if (screen === 'acSearchScreen' && _appTab !== 'search') why.push('Engine screen under world ' + _appTab);
  if (screen === 'acHomeScreen' && _appTab !== 'home') why.push('Home screen under world ' + _appTab);
  const lit = [...document.querySelectorAll('#bottomNav .bn-tab.active, .sb-navbtn.active')].map((e) => e.id.replace(/^[bs]nav-/, ''));
  const wantLit = document.body.classList.contains('notif-tab') ? 'notifs' : (NAV_ALIAS[_appTab] || _appTab);
  if (lit.length && lit.some((x) => x !== wantLit)) why.push('nav lit ' + lit.join('/') + ' want ' + wantLit);
  const cur = AtweHistory.current || {};
  const st = history.state || {};
  return { path: location.pathname, search: location.search, idx: cur.idx, key: cur.key, prev: cur.prev, tab: _appTab, screen, open,
    top: open[open.length - 1] || null, scope: typeof _searchScope !== 'undefined' ? _searchScope : null,
    events: window.__nav.length, coherent: why.length === 0, why,
    stClean: st.atwe === 2 && st.path === location.pathname && !['slug', 'entity', 'from', 'parent', 'engine'].some((k) => k in st) };
});
const evSince = (p, n) => p.evaluate((k) => window.__nav.slice(k), n);
const navEv = (evs) => evs.filter((e) => ['push', 'replace', 'root-change', 'traverse'].includes(e.kind));
const pushes = (evs) => evs.filter((e) => e.kind === 'push' || e.kind === 'root-change');

/* ── fixture ── */
const T = {
  listing: 'Oak   Chair, (2026) — Café & Co!',
  service: "Bob's Plumbing & Heating",
  job: 'Senior   Barista / Shift Lead',
  event: 'Spring Market: Day One',
  course: 'Intro to Bookkeeping (Part 1)',
  newsletter: 'The Weekly Ledger',
};
const BROWSE = [
  // key, opener, a check that the destination is really on screen
  ['marketplace', 'acOpenMarketplace()', (s) => s.top === 'marketplaceView'],
  ['services', 'acOpenServices()', (s) => s.top === 'servicesView'],
  ['jobs', 'acOpenJobsView()', (s) => s.top === null && s.screen === 'acSearchScreen' && s.scope === 'jobs'],
  ['events', 'acOpenEvents()', (s) => s.top === 'eventsList'],
  ['businesses', 'acOpenDirectory()', (s) => s.top === 'bizDirectory'],
  ['courses', 'acOpenCourses()', (s) => s.top === 'coursesView'],
  ['newsletters', 'acOpenNewsletters()', (s) => s.top === 'nlList'],
  ['communities', 'acOpenCommunities()', (s) => s.top === 'commList'],
  ['showcase', 'acOpenShowcaseDiscover()', (s) => s.top === 'showcaseDiscover'],
];
const SHEET = { listing: 'listingView', service: 'serviceView', job: 'jobView', event: 'eventView', course: 'courseView',
  newsletter: 'nlView', nlissue: 'nlIssueView', community: 'commView' };
const OPENER = { listing: 'acOpenListing', service: 'acOpenService', job: 'acOpenJob', event: 'acOpenEvent', course: 'acOpenCourse',
  newsletter: 'acOpenNewsletter', community: 'acOpenCommunity' };
const PARENT = { listing: 'marketplace', service: 'services', job: 'jobs', event: 'events', course: 'courses', newsletter: 'newsletters', community: 'communities' };
const canon = (fx, type) => type === 'community' ? '/communities/' + fx.community
  : type === 'listing2' ? '/listing/' + R.idSlug(fx.listing2, T.listing2) : '/' + type + '/' + R.idSlug(fx[type], T[type]);

/* A. browse destinations */
async function browse(p, errs, tag) {
  console.log(`\n${tag} A. Engine browse destinations`);
  for (const [key, open, onScreen] of BROWSE) {
    await closeAll(p); await p.evaluate(() => appTab('search')); await settle(p);
    const s0 = await snap(p);
    await p.evaluate(open); await settle(p, 1500);
    const s = await snap(p);
    const ev = navEv(await evSince(p, s0.events));
    say(s.path === '/engine/' + key && s.prev === s0.idx && pushes(ev).length === 1 && ev.length === 1 && onScreen(s) && s.coherent && s.stClean,
      `${tag} ${key}: opened from Engine is ONE push to /engine/${key}`, { path: s.path, ev, top: s.top, why: s.why });
    await reload(p);
    const r = await snap(p);
    say(r.path === '/engine/' + key && onScreen(r) && r.idx === s.idx && r.coherent, `${tag} ${key}: refresh stays canonical, same entry, same surface`, { path: r.path, top: r.top, scope: r.scope, why: r.why });
    await back(p);
    const b = await snap(p);
    say(b.path === '/engine' && b.screen === 'acSearchScreen' && b.top === null && b.idx === s0.idx && b.coherent, `${tag} ${key}: browser Back returns to the Engine root`, { path: b.path, top: b.top, why: b.why });
    await fwd(p);
    const f = await snap(p);
    say(f.path === '/engine/' + key && onScreen(f) && f.idx === s.idx && f.coherent, `${tag} ${key}: browser Forward restores it`, { path: f.path, top: f.top, why: f.why });
    const n = f.events;
    await appBack(p);
    const a = await snap(p);
    const aev = navEv(await evSince(p, n));
    say(a.path === '/engine' && a.top === null && a.idx === s0.idx && aev.length === 1 && aev[0].kind === 'traverse' && a.coherent,
      `${tag} ${key}: App Back walks the REAL history to /search`, { path: a.path, ev: aev, top: a.top });
  }
  say(errs.length === 0, `${tag} A. no JS errors`, errs.slice(0, 2));
}

/* B. flat legacy aliases, and A's direct load */
async function aliases(browser, token, vp, tag) {
  console.log(`\n${tag} B. flat aliases and direct loads`);
  const { ctx, p, errs } = await newTab(browser, token, vp, '/engine/marketplace');
  for (const [key, , onScreen] of BROWSE) {
    for (const url of ['/' + key, '/' + key.toUpperCase(), '/engine/' + key]) {
      await go(p, url); await settle(p, 900);
      const s = await snap(p);
      const ev = await p.evaluate(() => window.__nav.slice());
      say(s.path === '/engine/' + key && s.prev === null && pushes(ev).length === 0 && onScreen(s) && s.coherent && s.stClean,
        `${tag} ${url}: direct load lands on /engine/${key} by REPLACE, no entry added`, { path: s.path, prev: s.prev, ev: ev.map((e) => e.kind + ':' + e.path), top: s.top, why: s.why });
      if (url === '/' + key) {
        await reload(p);
        const r = await snap(p);
        say(r.path === '/engine/' + key && onScreen(r), `${tag} /${key}: refresh after canonicalising stays /engine/${key}`, { path: r.path });
        const n = r.events;
        await appBack(p);
        const a = await snap(p);
        const aev = navEv(await evSince(p, n));
        say(a.path === '/engine' && a.top === null && aev.length === 1 && aev[0].kind === 'replace' && a.idx === r.idx && a.coherent,
          `${tag} /engine/${key} (direct): App Back REPLACES to the Engine root, fabricating no history`, { path: a.path, ev: aev, idx: [r.idx, a.idx] });
      }
    }
  }
  // An address under /engine that names nothing never becomes a username.
  for (const url of ['/engine/nope', '/engine/search', '/engine/workers']) {
    await go(p, url); await settle(p, 900);
    const s = await snap(p);
    say(s.screen === 'acSearchScreen' && s.tab === 'search' && s.path === '/engine' && s.top === null, `${tag} ${url}: lands on the Engine root, never a profile`, { path: s.path, screen: s.screen, top: s.top });
  }
  say(errs.length === 0, `${tag} B. no JS errors`, errs.slice(0, 2));
  await ctx.close();
}

/* C + D. typed entities: in-app, refresh, Back/Forward, App Back, slugs */
async function entities(p, errs, tag, fx) {
  console.log(`\n${tag} C. typed entities opened in-app`);
  for (const type of ['listing', 'service', 'job', 'event', 'course', 'newsletter', 'community']) {
    await closeAll(p); await p.evaluate(() => appTab('search')); await settle(p);
    const parentOpen = BROWSE.find((b) => b[0] === PARENT[type]);
    await p.evaluate(parentOpen[1]); await settle(p, 1500);
    const s0 = await snap(p);
    await p.evaluate(([fn, id]) => window[fn](id), [OPENER[type], fx[type]]); await settle(p, 1600);
    const s = await snap(p);
    const ev = navEv(await evSince(p, s0.events));
    const want = canon(fx, type);
    say(s.path === want && s.top === SHEET[type] && s.prev === s0.idx && ev.length === 1 && pushes(ev).length === 1 && s.coherent && s.stClean,
      `${tag} ${type}: in-app open is ONE push straight to ${want}`, { path: s.path, ev, top: s.top, why: s.why });
    await reload(p);
    const r = await snap(p);
    say(r.path === want && r.top === SHEET[type] && r.coherent, `${tag} ${type}: refresh rebuilds it at its canonical address`, { path: r.path, top: r.top, why: r.why });
    await back(p);
    const b = await snap(p);
    say(b.path === '/engine/' + PARENT[type] && b.idx === s0.idx && !b.open.includes(SHEET[type]) && b.coherent,
      `${tag} ${type}: browser Back returns to /engine/${PARENT[type]}`, { path: b.path, open: b.open, why: b.why });
    await fwd(p);
    const f = await snap(p);
    say(f.path === want && f.top === SHEET[type] && f.idx === s.idx && f.coherent, `${tag} ${type}: browser Forward restores it`, { path: f.path, top: f.top });
    const n = f.events;
    await appBack(p);
    const a = await snap(p);
    const aev = navEv(await evSince(p, n));
    say(a.path === '/engine/' + PARENT[type] && aev.length === 1 && aev[0].kind === 'traverse' && !a.open.includes(SHEET[type]) && a.coherent,
      `${tag} ${type}: App Back walks the REAL history to its browse surface`, { path: a.path, ev: aev, open: a.open });
  }
  // the issue: from the newsletter it belongs to
  await closeAll(p); await p.evaluate(() => appTab('search')); await settle(p);
  await p.evaluate((id) => acOpenNewsletter(id), fx.newsletter); await settle(p, 1500);
  const n0 = await snap(p);
  await p.evaluate((id) => acOpenIssue(id), fx.issue); await settle(p, 1500);
  const ni = await snap(p);
  const iev = navEv(await evSince(p, n0.events));
  const issuePath = '/newsletter/' + fx.newsletter + '/issue/' + fx.issue;
  say(ni.path === issuePath && ni.top === 'nlIssueView' && iev.length === 1 && pushes(iev).length === 1 && ni.prev === n0.idx,
    `${tag} issue: opened from its newsletter is ONE push to ${issuePath}`, { path: ni.path, ev: iev });
  await appBack(p);
  const nb = await snap(p);
  say(nb.path === canon(fx, 'newsletter') && nb.top === 'nlView', `${tag} issue: App Back returns to the newsletter (real history)`, { path: nb.path, top: nb.top });

  console.log(`\n${tag} D. slugs`);
  // A non-Latin title has no slug: the canonical address is the bare id.
  await closeAll(p); await p.evaluate(() => appTab('search')); await settle(p);
  await p.evaluate((id) => acOpenListing(id), fx.listingHe); await settle(p, 1500);
  say((await snap(p)).path === '/listing/' + fx.listingHe, `${tag} a Hebrew title has no slug: /listing/${fx.listingHe}`, (await snap(p)).path);
  // A rename keeps the id and changes the canonical slug.
  await closeAll(p); await settle(p, 600);
  await fx.pool.query('UPDATE products SET name = $1 WHERE id = $2', ['Walnut Desk', fx.listing]);
  await p.evaluate((id) => acOpenListing(id), fx.listing); await settle(p, 1500);
  const rn = await snap(p);
  say(rn.path === '/listing/' + fx.listing + '-walnut-desk', `${tag} a renamed listing opens at its NEW slug, same id`, rn.path);
  await fx.pool.query('UPDATE products SET name = $1 WHERE id = $2', [T.listing, fx.listing]);
  await closeAll(p); await settle(p, 600);
  say(errs.length === 0, `${tag} C/D. no JS errors`, errs.slice(0, 2));
}

/* C + D for direct entries: every form lands canonical by REPLACE; App Back falls to the
   browse parent; the slug in the link never matters, the id does. */
async function directEntities(browser, token, vp, tag, fx) {
  console.log(`\n${tag} C/D. typed entities entered directly`);
  const { ctx, p, errs } = await newTab(browser, token, vp, '/');
  const forms = (type) => type === 'community'
    ? [canon(fx, type), '/communities/0' + fx.community]
    : [canon(fx, type), '/' + type + '/' + fx[type], '/' + type + '/' + fx[type] + '-a-stale-old-title', '/' + type.toUpperCase() + '/' + fx[type] + '-Oak'];
  for (const type of ['listing', 'service', 'job', 'event', 'course', 'newsletter', 'community']) {
    for (const url of forms(type)) {
      await go(p, url); await settle(p, 1400);
      const s = await snap(p);
      const ev = await p.evaluate(() => window.__nav.slice());
      say(s.path === canon(fx, type) && s.top === SHEET[type] && s.prev === null && pushes(ev).length === 0 && s.coherent,
        `${tag} ${url}: lands on ${canon(fx, type)} by REPLACE (id authoritative, no entry added)`, { path: s.path, top: s.top, ev: ev.map((e) => e.kind + ':' + e.path), why: s.why });
    }
    // after a correction, the address is stable through a refresh
    await reload(p);
    const r = await snap(p);
    say(r.path === canon(fx, type) && r.top === SHEET[type], `${tag} ${type}: refresh after a correction stays canonical`, r.path);
    const n = r.events;
    await appBack(p);
    const a = await snap(p);
    const aev = navEv(await evSince(p, n));
    say(a.path === '/engine/' + PARENT[type] && aev.length === 1 && aev[0].kind === 'replace' && a.idx === r.idx && !a.open.includes(SHEET[type]) && a.coherent,
      `${tag} ${type} (direct): App Back REPLACES to /engine/${PARENT[type]}`, { path: a.path, ev: aev, open: a.open, why: a.why });
  }
  // an issue entered directly: App Back climbs issue -> newsletter -> newsletters
  const issuePath = '/newsletter/' + fx.newsletter + '/issue/' + fx.issue;
  await go(p, issuePath); await settle(p, 1400);
  let s = await snap(p);
  say(s.path === issuePath && s.top === 'nlIssueView' && s.prev === null, `${tag} ${issuePath}: direct load`, { path: s.path, top: s.top });
  await appBack(p); s = await snap(p);
  say(s.path === canon(fx, 'newsletter') && s.top === 'nlView', `${tag} issue (direct): App Back -> its newsletter (by replace)`, { path: s.path, top: s.top });
  await appBack(p); s = await snap(p);
  say(s.path === '/engine/newsletters' && s.top === 'nlList', `${tag} …then -> /engine/newsletters`, { path: s.path, top: s.top });
  // an issue link naming the WRONG newsletter is corrected to the issue's own
  await go(p, '/newsletter/' + fx.newsletter2 + '/issue/' + fx.issue); await settle(p, 1400);
  s = await snap(p);
  say(s.path === issuePath && s.prev === null, `${tag} an issue under the wrong newsletter id is corrected by replace`, s.path);
  // Showcase detail is routed since batch 8 (/showcase/<id>, no slug): never a profile
  await go(p, '/showcase/' + fx.showcase); await settle(p, 900);
  s = await snap(p);
  say(s.screen !== 'acProfileScreen' && s.open.includes('showcaseView') && s.path === '/showcase/' + fx.showcase, `${tag} /showcase/<id> opens the item at its own address (batch 8)`, { screen: s.screen, open: s.open });
  // malformed typed paths never become a profile
  for (const url of ['/service/abc', '/course/12/x', '/newsletter/x/issue/2', '/communities/x', '/listing/abc-12']) {
    await go(p, url); await settle(p, 800);
    s = await snap(p);
    say(s.screen !== 'acProfileScreen' && !s.open.some((o) => Object.values(SHEET).includes(o)), `${tag} ${url}: not a profile, not an entity`, { screen: s.screen, open: s.open });
  }
  say(errs.length === 0, `${tag} direct entities: no JS errors`, errs.slice(0, 2));
  await ctx.close();
}

/* E. search and filters */
async function search(p, errs, tag) {
  console.log(`\n${tag} E. search and filters`);
  await closeAll(p); await p.evaluate(() => appTab('search')); await settle(p);
  const s0 = await snap(p);
  await p.evaluate(async () => { const i = document.getElementById('tbSearchInput'); for (const q of ['o', 'oa', 'oak', 'oak c']) { i.value = q; acDoSearch(q); await new Promise((r) => setTimeout(r, 120)); } });
  await settle(p, 1200);
  let s = await snap(p);
  let ev = navEv(await evSince(p, s0.events));
  say(s.path === '/engine' && s.idx === s0.idx && ev.length === 0, `${tag} typing a query keeps the Engine root /search, no entries (search URLs are batch-7 planned)`, { path: s.path, ev });
  for (const sc of ['people', 'shop', 'posts']) { await p.evaluate((x) => acSetSearchScope(x), sc); await settle(p, 500); }
  s = await snap(p); ev = navEv(await evSince(p, s0.events));
  say(s.path === '/engine' && pushes(ev).length === 0, `${tag} scope chips never push`, { path: s.path, ev });
  await p.evaluate(() => { const i = document.getElementById('tbSearchInput'); i.value = ''; acSetSearchScope('all'); });
  await settle(p);
  // Marketplace filters are local: no entry per chip, one Back leaves the surface
  await p.evaluate(() => acOpenMarketplace()); await settle(p, 1400);
  const m0 = await snap(p);
  await p.evaluate(async () => {
    const tabs = [...document.querySelectorAll('#mktKindTabs .ac-jv')];
    for (const t of tabs.slice(0, 3)) { t.click(); await new Promise((r) => setTimeout(r, 150)); }
    const q = document.getElementById('mktSearch'); if (q) { q.value = 'oak'; q.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await settle(p, 1200);
  const m1 = await snap(p);
  const mev = navEv(await evSince(p, m0.events));
  say(m1.path === '/engine/marketplace' && m1.idx === m0.idx && mev.length === 0, `${tag} Marketplace filter chips + query replace nothing and push nothing`, { path: m1.path, ev: mev });
  await back(p);
  const mb = await snap(p);
  say(mb.path === '/engine' && mb.top === null, `${tag} one Back leaves the Marketplace (not each filter)`, { path: mb.path, top: mb.top });
  // unknown query params never survive canonicalisation
  await go(p, '/marketplace?utm_x=1&junk=2'); await settle(p, 900);
  s = await snap(p);
  say(s.path === '/engine/marketplace' && s.search === '', `${tag} /marketplace?junk: canonicalised with unknown params stripped`, { path: s.path, search: s.search });
  say(errs.length === 0, `${tag} E. no JS errors`, errs.slice(0, 2));
}

/* F + G. contextual parents: the REAL origin wins, every time */
async function contextual(p, errs, tag, fx) {
  console.log(`\n${tag} F. contextual Back`);
  const fromNotif = async (type, label) => {
    await closeAll(p); await p.evaluate(() => appTab('home')); await settle(p);
    await p.evaluate(() => acNavNotifs()); await settle(p, 1500);
    const s0 = await snap(p);
    const ok = await p.evaluate((t) => { const n = (AC._notifs || []).find((x) => x.type === t); if (!n) return false; acNotifGo(n.id); return true; }, type);
    await settle(p, 1600);
    const s = await snap(p);
    const ev = navEv(await evSince(p, s0.events));
    say(ok && s.path === canon(fx, label) && s.top === SHEET[label] && pushes(ev).length === 1 && ev.every((e) => e.kind !== 'push' || e.path === s.path || /^\/(listing|job|event)\/\d+$/.test(e.path)),
      `${tag} Notifications (${type}) -> ${label}: lands on ${canon(fx, label)} with ONE push`, { ok, path: s.path, ev, top: s.top });
    await appBack(p);
    const b = await snap(p);
    say(b.path === '/notifications' && b.open.includes('notifOverlay') && !b.open.includes(SHEET[label]) && b.coherent,
      `${tag} Notifications -> ${label} -> App Back returns to /notifications`, { path: b.path, open: b.open, why: b.why });
    await fwd(p);
    const f = await snap(p);
    say(f.path === canon(fx, label) && f.top === SHEET[label], `${tag} …and Forward returns to the ${label}`, { path: f.path, top: f.top });
  };
  await fromNotif('price_drop', 'listing');
  await fromNotif('job_match', 'job');
  await fromNotif('event_rsvp', 'event');
  /* A link with a stale or missing slug, followed IN the app after boot (boot turns every
     push into a replace, so only this proves a correction is never a push): exactly ONE
     push for the move, then the correction as a REPLACE; Back returns to the origin. */
  for (const [type, url] of [['listing', '/listing/' + fx.listing + '-a-stale-old-title'], ['job', '/job/' + fx.job], ['course', '/course/' + fx.course + '-x']]) {
    await closeAll(p); await p.evaluate(() => appTab('search')); await settle(p);
    await p.evaluate(() => acOpenMarketplace()); await settle(p, 1400);
    const s0 = await snap(p);
    await p.evaluate((u) => acNavGo(u), url); await settle(p, 1600);
    const s = await snap(p);
    const ev = navEv(await evSince(p, s0.events));
    say(s.path === canon(fx, type) && pushes(ev).length === 1 && ev.filter((e) => e.kind === 'replace').length === 1 && s.prev === s0.idx,
      `${tag} ${url} followed in-app: ONE push, the slug corrected by REPLACE`, { path: s.path, ev });
    await appBack(p);
    const b = await snap(p);
    say(b.path === '/engine/marketplace' && b.idx === s0.idx && b.top === 'marketplaceView', `${tag} …and Back returns to the origin, not to the stale address`, { path: b.path, top: b.top });
  }
  // another routed origin: a profile, then the Engine root
  for (const [label, start, want] of [
    ['a profile', (u) => { appTab('home'); acGoProfile(u); }, (fx2) => '/' + fx2.b.username],
    ['the Engine root', () => appTab('search'), () => '/engine'],
  ]) {
    await closeAll(p); await p.evaluate(start, fx.b.username); await settle(p, 1500);
    const s0 = await snap(p);
    await p.evaluate((id) => acOpenService(id), fx.service); await settle(p, 1500);
    const s = await snap(p);
    await appBack(p);
    const b = await snap(p);
    say(s.path === canon(fx, 'service') && s.prev === s0.idx && b.path === want(fx) && b.idx === s0.idx && !b.open.includes('serviceView') && b.coherent,
      `${tag} ${label} -> service -> App Back returns to ${want(fx)}, not /engine/services`, { open: s.path, back: b.path, why: b.why });
  }
  // a listing opened from a listing ("More from this seller") is a real step too
  await closeAll(p); await p.evaluate(() => appTab('search')); await settle(p);
  await p.evaluate((id) => acOpenListing(id), fx.listing); await settle(p, 1500);
  const l0 = await snap(p);
  await p.evaluate((id) => acOpenListing(id), fx.listing2); await settle(p, 1500);
  const l1 = await snap(p);
  await appBack(p);
  const lb = await snap(p);
  say(l1.path === canon(fx, 'listing2') && l1.prev === l0.idx && lb.path === canon(fx, 'listing') && lb.top === 'listingView',
    `${tag} listing -> another listing -> App Back returns to the first listing`, { l1: l1.path, back: lb.path, top: lb.top });

  console.log(`\n${tag} G. business directory -> profile`);
  await closeAll(p); await p.evaluate(() => appTab('search')); await settle(p);
  await p.evaluate(() => acOpenDirectory()); await settle(p, 1500);
  const d0 = await snap(p);
  await p.evaluate((u) => { acHandoffFrom('bizDirectory'); appTab('home'); acGoProfile(u); }, fx.b.username); await settle(p, 1600);
  const d1 = await snap(p);
  say(d1.path === '/' + fx.b.username && d1.screen === 'acProfileScreen' && d1.prev === d0.idx, `${tag} directory -> business is its own /${'{username}'} (one push)`, { path: d1.path, prev: d1.prev });
  await appBack(p);
  const d2 = await snap(p);
  say(d2.path === '/engine/businesses' && d2.top === 'bizDirectory' && d2.coherent, `${tag} business profile -> App Back returns to /engine/businesses`, { path: d2.path, top: d2.top, why: d2.why });

  console.log(`\n${tag} H. transient commerce`);
  await closeAll(p); await p.evaluate(() => appTab('search')); await settle(p);
  await p.evaluate(() => acOpenMarketplace()); await settle(p, 1300);
  await p.evaluate((id) => acOpenListing(id), fx.listing); await settle(p, 1500);
  const c0 = await snap(p);
  await p.evaluate((id) => acBuyNow(id), fx.listing); await settle(p, 1800);
  const c1 = await snap(p);
  const cev = navEv(await evSince(p, c0.events));
  say(c1.open.includes('checkoutView') && c1.path === canon(fx, 'listing') && pushes(cev).length === 0 && !/checkout/.test(c1.path),
    `${tag} Buy now opens checkout with NO address of its own and no entry`, { open: c1.open, path: c1.path, ev: cev });
  await appBack(p);
  const c2 = await snap(p);
  say(!c2.open.includes('checkoutView') && c2.path === canon(fx, 'listing') && c2.idx === c0.idx, `${tag} App Back dismisses checkout first; the listing and its entry stay`, { open: c2.open, path: c2.path });
  await closeAll(p);
  await p.evaluate(async (id) => { try { await acAddToCart(id); } catch (e) {} }, fx.listing2); await settle(p, 800);
  await p.evaluate(() => acOpenCart()); await settle(p, 1500);
  const k = await snap(p);
  say(k.path === '/cart' && k.top === 'cartView', `${tag} the cart keeps its private /cart`, { path: k.path, top: k.top });
  await closeAll(p);
  say(errs.length === 0, `${tag} F/G/H. no JS errors`, errs.slice(0, 2));
}

(async () => {
  const pool = QA.newPool();
  const fx = { pool };
  const one = async (q, v) => (await pool.query(q, v)).rows[0];
  fx.a = await QA.seedAccount(pool, { business: true, prefix: 'r7a', balanceCents: 100000 });
  fx.b = await QA.seedAccount(pool, { business: true, prefix: 'r7b' });
  fx.listing = (await one("INSERT INTO products (business_id, name, price_cents, active) VALUES ($1, $2, 1500, true) RETURNING id", [fx.b.id, T.listing])).id;
  fx.listing2 = (await one("INSERT INTO products (business_id, name, price_cents, active) VALUES ($1, 'Second Shelf', 900, true) RETURNING id", [fx.b.id])).id;
  fx.listingHe = (await one("INSERT INTO products (business_id, name, price_cents, active) VALUES ($1, 'שלום עולם', 700, true) RETURNING id", [fx.b.id])).id;
  T.listing2 = 'Second Shelf';
  fx.service = (await one("INSERT INTO services (user_id, title, category) VALUES ($1, $2, 'Home') RETURNING id", [fx.b.id, T.service])).id;
  fx.job = (await one("INSERT INTO jobs (posted_by, title, description) VALUES ($1, $2, 'x') RETURNING id", [fx.b.id, T.job])).id;
  fx.event = (await one("INSERT INTO events (host_id, title, starts_at) VALUES ($1, $2, now() + interval '3 days') RETURNING id", [fx.b.id, T.event])).id;
  fx.course = (await one("INSERT INTO courses (creator_id, title, published) VALUES ($1, $2, true) RETURNING id", [fx.b.id, T.course])).id;
  fx.newsletter = (await one("INSERT INTO newsletters (owner_id, title) VALUES ($1, $2) RETURNING id", [fx.b.id, T.newsletter])).id;
  fx.newsletter2 = (await one("INSERT INTO newsletters (owner_id, title) VALUES ($1, 'Another Letter') RETURNING id", [fx.b.id])).id;
  fx.issue = (await one("INSERT INTO newsletter_issues (newsletter_id, title, body) VALUES ($1, 'Issue One', 'hello') RETURNING id", [fx.newsletter])).id;
  fx.community = (await one("INSERT INTO communities (name, created_by) VALUES ('route7 community', $1) RETURNING id", [fx.b.id])).id;
  await pool.query("INSERT INTO community_members (community_id, user_id, role) VALUES ($1, $2, 'admin') ON CONFLICT DO NOTHING", [fx.community, fx.b.id]);
  fx.showcase = (await one("INSERT INTO showcases (user_id, title) VALUES ($1, 'route7 showcase') RETURNING id", [fx.b.id])).id;
  for (const [t, col, v] of [['price_drop', 'product_id', fx.listing], ['job_match', 'job_id', fx.job], ['event_rsvp', 'event_id', fx.event]]) {
    await pool.query(`INSERT INTO notifications (user_id, actor_id, type, ${col}) VALUES ($1,$2,$3,$4)`, [fx.a.id, fx.b.id, t, v]);
  }
  const seen = await QA.serverSees(fx.a.token);
  if (!seen.ok) { console.log('  FAIL fixture: the server does not see the seeded account (HTTP ' + seen.status + ')'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const t0 = Date.now();
  try {
    for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      const tag = vp.width >= 1000 ? '[desktop]' : '[phone]';
      const { ctx, p, errs } = await newTab(browser, fx.a.token, vp, '/search');
      await browse(p, errs, tag);
      await entities(p, errs, tag, fx);
      await search(p, errs, tag);
      await contextual(p, errs, tag, fx);
      say(errs.length === 0, `${tag} no JS errors over the whole run`, errs.slice(0, 3));
      await ctx.close();
      await aliases(browser, fx.a.token, vp, tag);
      await directEntities(browser, fx.a.token, vp, tag, fx);
    }
    {
      const tag = '[tablet]';
      const vp = { width: 820, height: 1180 };
      const { ctx, p, errs } = await newTab(browser, fx.a.token, vp, '/search');
      await p.evaluate(() => acOpenMarketplace()); await settle(p, 1400);
      const s0 = await snap(p);
      await p.evaluate((id) => acOpenListing(id), fx.listing); await settle(p, 1500);
      const s = await snap(p);
      say(s0.path === '/engine/marketplace' && s.path === canon(fx, 'listing') && s.prev === s0.idx, `${tag} Marketplace -> listing at their canonical addresses`, [s0.path, s.path]);
      await appBack(p);
      say((await snap(p)).path === '/engine/marketplace', `${tag} App Back returns to the Marketplace`, (await snap(p)).path);
      await p.goto(BASE + '/service/' + fx.service, { waitUntil: 'domcontentloaded' }); await booted(p); await settle(p, 1200);
      const d = await snap(p);
      say(d.path === canon(fx, 'service') && d.top === 'serviceView', `${tag} a direct /service/<id> lands canonical`, d.path);
      say(errs.length === 0, `${tag} no JS errors`, errs.slice(0, 2));
      await ctx.close();
    }
  } catch (e) {
    fail++; console.log('  FAIL the probe threw: ' + (e && e.stack || e).toString().slice(0, 600));
  } finally {
    await browser.close();
    await pool.end();
  }
  console.log(`\n${pass} passed, ${fail} FAILED  (${Math.round((Date.now() - t0) / 1000)}s)`);
  process.exit(fail ? 1 : 0);
})();
