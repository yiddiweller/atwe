/* Route batch 4 — Settings is a real URL hierarchy.
 *
 *   /settings                      the hub
 *   /settings/<page>               nine pages (account, privacy, security, notifications,
 *                                  premium, display, assistant, data, about)
 *   /settings/<page>/<leaf>        sixteen approved leaves, each its own sheet
 *   /devices                       the old Devices address, now an alias
 *
 * THE URL IS THE DESTINATION: the same address always rebuilds the same node, from any
 * starting point, and history.state carries bookkeeping only (no setPage / via). In-app
 * navigation is one PUSH per meaningful step; Back/Forward walk real entries; a direct
 * link's own Settings Back walks the logical parent without fabricating history behind it.
 *
 * Owns its fixture (one business account). Runs at 390x844 and 1440x900.
 *
 *   node setroutes.js          the checks
 *   node setroutes.js --break  serves the page with the Settings address taken back out of
 *                              the path sync (every node collapses to /settings, as before
 *                              batch 4) and the leaves' own addresses removed; must FAIL.
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

/* --break: the pre-batch-4 shape — Settings owns only /settings, and a leaf owns nothing. */
const OLD = [
  [`        if (open[i].id === 'settingsOverlay') { acSetPath(acSettingsPath(_setPage), { push }); return; }\n`, ''],
  [`  if (_leaf) { el._ownPath = _leaf.path; el._setLeaf = _leaf; }`, `  /* leaf addresses removed by --break */`],
];

const PAGES = [['account', 'Your account'], ['privacy', 'Privacy & safety'], ['security', 'Security & access'],
  ['notifications', 'Notifications'], ['premium', 'Premium'], ['display', 'Display & accessibility'],
  ['assistant', 'Atwe Assistant'], ['data', 'Your data & storage'], ['about', 'About']];
/* [page, leaf, sheet, the row's visible label (on the page), title] */
const LEAVES = [
  ['account', 'delete', 'deleteAccountOverlay', 'Delete account', 'Delete account'],
  ['privacy', 'contact', 'privacyOverlay', 'Who can contact you', 'Who can contact you'],
  ['privacy', 'blocked', 'blockedOverlay', 'Blocked accounts', 'Blocked accounts'],
  ['privacy', 'muted', 'mutedOverlay', 'Muted accounts', 'Muted accounts'],
  ['privacy', 'muted-words', 'mutedWordsOverlay', 'Muted words', 'Muted words'],
  ['privacy', 'last-seen', 'lastSeenHiddenOverlay', 'Hidden from', 'Hidden from'],
  ['security', 'devices', 'devicesOverlay', 'Devices & sessions', 'Devices & sessions'],
  ['security', '2fa', 'twoFaView', 'Two-factor authentication', 'Two-factor authentication'],
  ['security', 'passkeys', 'passkeysView', 'Passkeys', 'Passkeys'],
  ['security', 'locks', 'lockedSectionsOverlay', 'Locked sections', 'Locked sections'],
  ['notifications', 'phone', 'phoneOverlay', 'Your number', 'Your number'],
  ['premium', 'creator', 'creatorSubView', 'Creator subscriptions', 'Creator subscriptions'],
  ['display', 'language', 'langView', 'Language', 'Language'],
  ['display', 'currency', 'currencyView', 'Currency', 'Currency'],
  ['data', 'history', 'historyView', 'Posts you', 'Posts you’ve read'],
  ['about', 'whats-new', 'changelogView', null, 'What’s new'],   // its row lives on the hub
];
const LEAF_VIEWS = LEAVES.map((x) => x[2]);

async function freshPage(browser, token, viewport, first) {
  const ctx = await browser.newContext({ viewport });
  if (BREAK) {
    await ctx.route(/localhost:\d+\/[^.]*$/, async (route) => {
      if (route.request().resourceType() !== 'document') return route.continue();
      const res = await route.fetch();
      let html = await res.text();
      for (const [now, was] of OLD) {
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
  await p.goto(BASE + (first || '/'), { waitUntil: 'domcontentloaded' });
  await QA.waitUntil(p, () => !!(window.S && S.user && S.user.id), null, 25000);
  await QA.waitUntil(p, () => window.AtweHistory && !AtweHistory.booting, null, 15000);
  await p.waitForTimeout(900);
  return { ctx, p, errs };
}

const snap = (p) => p.evaluate((LEAF_VIEWS) => {
  if (!window.AtweHistory) return { path: location.href, offApp: true, len: history.length, st: history.state, events: 0 };
  const visible = (o) => !o.classList.contains('hidden') && !o.classList.contains('closing');
  const so = document.getElementById('settingsOverlay');
  const setOpen = !!so && visible(so);
  const bodies = [...document.querySelectorAll('#settingsOverlay .iset-body[data-page]')].filter((b) => !b.classList.contains('hidden')).map((b) => b.dataset.page);
  const leaves = LEAF_VIEWS.filter((id) => { const o = document.getElementById(id); return o && visible(o); });
  const open = [...document.querySelectorAll('.overlay:not(.hidden):not(.closing)')].map((o) => o.id);
  const stale = [...document.querySelectorAll('.overlay:not(.hidden):not(.closing)')].filter((o) => o._ownPath && o._ownPath !== location.pathname).map((o) => o.id);
  return { path: location.pathname, len: history.length, st: history.state, setOpen, bodies, page: _setPage, leaves, open, stale,
    top: open[open.length - 1] || null, title: document.title, events: AtweHistory.log.length, hasPrev: AtweHistory.hasPrev() };
}, LEAF_VIEWS);
const evSince = (p, n) => p.evaluate((k) => (window.AtweHistory ? AtweHistory.log.slice(k) : []), n);
const settle = (p, ms) => p.waitForTimeout(ms || 1100);
const back = async (p) => { await p.goBack({ timeout: 6000 }).catch(() => {}); await settle(p, 1300); };
const fwd = async (p) => { await p.goForward({ timeout: 6000 }).catch(() => {}); await settle(p, 1300); };
const reload = async (p) => {
  await p.reload({ waitUntil: 'domcontentloaded' });
  await QA.waitUntil(p, () => !!(window.S && S.user && S.user.id), null, 25000);
  await QA.waitUntil(p, () => window.AtweHistory && !AtweHistory.booting, null, 15000);
  await settle(p, 1400);
};
const navEvents = (evs) => evs.filter((e) => ['push', 'replace', 'root-change', 'traverse'].includes(e.kind));
const noLegacy = (st) => !!st && !('setPage' in st) && !('via' in st);
const want = (page, leaf) => (!page || page === 'hub') ? '/settings' : '/settings/' + page + (leaf ? '/' + leaf : '');

/* The node the URL names is the node on screen — and nothing else is. */
function nodeIs(s, page, leaf) {
  const leafView = leaf ? LEAVES.find((x) => x[0] === page && x[1] === leaf)[2] : null;
  return s.path === want(page, leaf) && s.setOpen && s.page === (page || 'hub')
    && s.bodies.length === 1 && s.bodies[0] === (page || 'hub')
    && (leaf ? s.leaves.length === 1 && s.leaves[0] === leafView : s.leaves.length === 0)
    && s.stale.length === 0;
}
function stateOk(s, route) {
  return !!s.st && s.st.atwe === 2 && Number.isInteger(s.st.idx) && s.st.idx > 0 && typeof s.st.key === 'string'
    && (s.st.path === undefined || s.st.path === s.path) && s.st.route === route && noLegacy(s.st);
}
const routeName = (page, leaf) => (!page || page === 'hub') ? 'settings' : 'settings-' + page + (leaf ? '-' + leaf : '');

/* tap a visible row inside the Settings page body (or a sheet) by its text */
const tapRow = (p, scope, re) => p.evaluate(([scope, re]) => {
  const rx = new RegExp(re);
  const root = document.querySelector(scope);
  if (!root) return false;
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const el = [...root.querySelectorAll('.iset-row, button, [onclick]')].filter(vis)
    .find((x) => rx.test((x.textContent || '').trim().replace(/\s+/g, ' ')));
  if (!el) return false; el.click(); return true;
}, [scope, re]);
const bodySel = (page) => `#settingsOverlay .iset-body[data-page="${page}"]`;
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* the app's own back control on the top sheet */
const sheetBack = (p) => p.evaluate(() => {
  const open = [...document.querySelectorAll('.overlay:not(.hidden):not(.closing)')];
  const top = open[open.length - 1];
  if (!top) return 'none';
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const b = [...top.querySelectorAll('.iset-back, .sheet-close, .msg-back, [aria-label^="Back"], [aria-label^="Close"]')].find(vis);
  if (!b) return 'no-control:' + top.id;
  b.click(); return 'clicked:' + top.id;
});

/* ── 1-3, 5-12, 15-24, 40, 42: every node, reached by its real row, from Home ─────── */
async function inAppTree(browser, F, vp, tag) {
  const { ctx, p, errs } = await freshPage(browser, F.acct.token, vp);
  const home = await snap(p);
  await p.evaluate(() => openSettings()); await settle(p);
  const s1 = await snap(p);
  let ev = navEvents(await evSince(p, home.events));
  say(nodeIs(s1, 'hub') && s1.len === home.len + 1, tag + ' 1. Home → /settings: the hub, one new entry', [s1.path, home.len, s1.len]);
  say(ev.length === 1 && ev[0].kind === 'push' && ev[0].to.path === '/settings' && stateOk(s1, 'settings') && s1.st.idx === home.st.idx + 1,
    tag + ' 1b. one push NavEvent, a new idx, route settings, path = URL', ev.map((e) => [e.kind, e.to && e.to.path]));
  say(/^Settings · Atwe$|\) Settings · Atwe$/.test(s1.title), tag + ' 1c. the title comes from the route', s1.title);

  for (const [page, label] of PAGES) {
    const a = await snap(p);
    const tapped = await tapRow(p, bodySel('hub'), '^' + esc(label));
    await settle(p);
    const b = await snap(p);
    ev = navEvents(await evSince(p, a.events));
    say(tapped && nodeIs(b, page) && b.len <= a.len + 1, tag + ' ' + page + ': the hub row opens /settings/' + page + ' as ONE entry (a push; it drops any forward entries, as every push does)', [tapped, b.path, b.bodies, a.len, b.len]);
    say(ev.length === 1 && ev[0].kind === 'push' && ev[0].direction === 'forward' && stateOk(b, routeName(page)) && b.st.idx > a.st.idx && b.st.prev === a.st.idx,
      tag + ' ' + page + ': one forward push, a new idx, route ' + routeName(page) + ', prev = the hub', [ev.map((e) => e.kind), b.st]);
    say(b.title.endsWith(label + ' · Atwe'), tag + ' ' + page + ': the title is the page', b.title);

    for (const [lp, leaf, view, row] of LEAVES.filter((x) => x[0] === page && x[3])) {
      const c = await snap(p);
      const t = await tapRow(p, bodySel(page), '^' + esc(row));
      await settle(p, 1300);
      const d = await snap(p);
      ev = navEvents(await evSince(p, c.events));
      say(t && nodeIs(d, page, leaf) && d.len <= c.len + 1, tag + ' ' + page + '/' + leaf + ': its row opens /settings/' + page + '/' + leaf + ' over the page, ONE entry', [t, d.path, d.leaves, d.bodies, c.len, d.len]);
      say(ev.length === 1 && ev[0].kind === 'push' && stateOk(d, routeName(page, leaf)) && d.st.idx > c.st.idx && d.st.prev === c.st.idx,
        tag + ' ' + page + '/' + leaf + ': one push, route ' + routeName(page, leaf) + ', path = URL, no setPage/via', [ev.map((e) => [e.kind, e.to && e.to.path]), d.st]);
      const how = await sheetBack(p);
      await settle(p, 1300);
      const e2 = await snap(p);
      ev = navEvents(await evSince(p, d.events));
      say(nodeIs(e2, page) && e2.len === d.len && e2.st.idx === c.st.idx, tag + ' ' + page + '/' + leaf + ': its own back returns to the page (a real walk back)', [how, e2.path, e2.leaves, e2.st && e2.st.idx, c.st.idx]);
      say(ev.length === 1 && ev[0].kind === 'traverse' && ev[0].direction === 'back', tag + ' ' + page + '/' + leaf + ': one back traverse NavEvent', ev.map((x) => [x.kind, x.direction]));
    }
    // 3. the page's own Settings Back → the hub, through real history
    const f = await snap(p);
    await p.evaluate(() => setBack()); await settle(p);
    const g = await snap(p);
    ev = navEvents(await evSince(p, f.events));
    say(nodeIs(g, 'hub') && g.st.idx === s1.st.idx, tag + ' ' + page + ': Settings Back returns to the hub entry', [g.path, g.st && g.st.idx, s1.st.idx]);
    say(ev.length === 1 && ev[0].kind === 'traverse' && ev[0].direction === 'back', tag + ' ' + page + ': one back traverse NavEvent', ev.map((x) => [x.kind, x.direction]));
  }
  // 23. What's new: its row is on the hub, its address is under About
  {
    const a = await snap(p);
    const t = await tapRow(p, bodySel('hub'), '^What’s new');
    await settle(p, 1300);
    const b = await snap(p);
    say(t && b.path === '/settings/about/whats-new' && b.leaves.length === 1 && b.leaves[0] === 'changelogView' && b.len - a.len <= 1 && b.st.prev === a.st.idx && stateOk(b, 'settings-about-whats-new'),
      tag + ' about/whats-new: the hub row opens /settings/about/whats-new, one entry', [t, b.path, b.leaves]);
    await sheetBack(p); await settle(p, 1300);
    const c = await snap(p);
    say(nodeIs(c, 'hub'), tag + ' about/whats-new: closing it returns to the hub it was opened from', [c.path, c.bodies]);
  }
  // Settings Back on the hub → closes Settings, back to Home
  {
    const a = await snap(p);
    await p.evaluate(() => setBack()); await settle(p);
    const b = await snap(p);
    say(!b.setOpen && b.path === '/' && b.st.idx === home.st.idx, tag + ' Settings Back on the hub closes Settings, back on Home\'s entry', [b.path, b.setOpen, b.st && b.st.idx, home.st.idx]);
  }
  say(errs.length === 0, tag + ' in-app tree: no JS errors', errs.slice(0, 3));
  await ctx.close();
}

/* ── 25-28: transient flows and local controls never get an address ─────────────── */
async function transient(browser, F, vp, tag) {
  const { ctx, p, errs } = await freshPage(browser, F.acct.token, vp, '/settings/account');
  const cases = [
    ['account', 'Display name', 'profileOverlay'], ['account', 'Username', 'profileOverlay'],
    ['account', 'Email', null], ['account', 'Pause my account', null], ['account', 'Deactivate account', null],
    ['security', 'Link a device', 'qrLoginView'], ['about', 'Report a problem', 'feedbackView'],
  ];
  for (const [page, label] of cases) {
    await p.evaluate((pg) => { [...document.querySelectorAll('.overlay:not(.hidden)')].filter((o) => o.id !== 'settingsOverlay').forEach((o) => { try { closeOverlay(o.id, true); } catch (e) {} }); openSettings(pg); }, page);
    await settle(p);
    const a = await snap(p);
    const t = await tapRow(p, bodySel(page), '^' + esc(label));
    await settle(p, 1300);
    const b = await snap(p);
    const ev = navEvents(await evSince(p, a.events));
    say(t && b.path === '/settings/' + page && b.len === a.len && ev.length === 0 && noLegacy(b.st),
      tag + ' transient "' + label + '" writes no address, no entry, no NavEvent', [t, b.path, a.len, b.len, ev.map((e) => e.kind), b.top]);
    await p.evaluate(() => { const o = document.getElementById('confirmOverlay'); if (o && !o.classList.contains('hidden')) document.getElementById('cfCancel')?.click(); });
  }
  // 28. theme cards and ordinary switches are local controls
  await p.evaluate(() => { [...document.querySelectorAll('.overlay:not(.hidden)')].filter((o) => o.id !== 'settingsOverlay').forEach((o) => { try { closeOverlay(o.id, true); } catch (e) {} }); openSettings('display'); });
  await settle(p);
  const a = await snap(p);
  await p.evaluate(() => {
    const card = [...document.querySelectorAll('#themePicker .theme-card')][1]; if (card) card.click();
    const sw = document.getElementById('bigTextToggle'); if (sw) sw.click();
    const sw2 = document.getElementById('bigTextToggle'); if (sw2) sw2.click();
    const back = [...document.querySelectorAll('#themePicker .theme-card')][0]; if (back) back.click();
  });
  await settle(p);
  const b = await snap(p);
  const ev = navEvents(await evSince(p, a.events));
  say(b.path === '/settings/display' && b.len === a.len && ev.length === 0, tag + ' 28. theme and switches change no URL and write no entry', [b.path, a.len, b.len, ev.length]);
  say(errs.length === 0, tag + ' transient: no JS errors', errs.slice(0, 3));
  await ctx.close();
}

/* ── 29-30: Back and Forward across three levels, from Home ─────────────────────── */
async function backForward(browser, F, vp, tag) {
  const { ctx, p, errs } = await freshPage(browser, F.acct.token, vp);
  const home = await snap(p);
  await p.evaluate(() => openSettings()); await settle(p);
  await tapRow(p, bodySel('hub'), '^Security & access'); await settle(p);
  await tapRow(p, bodySel('security'), '^Devices & sessions'); await settle(p, 1400);
  const top = await snap(p);
  say(nodeIs(top, 'security', 'devices') && top.len === home.len + 3, tag + ' 29. Home → /settings → /security → /devices: three entries', [top.path, home.len, top.len]);
  const steps = [['security', null], ['hub', null]];
  let last = top;
  for (const [pg] of steps) {
    await back(p);
    const s = await snap(p);
    const ev = navEvents(await evSince(p, last.events));
    say(nodeIs(s, pg) && s.st.idx === last.st.idx - 1 && s.len === top.len, tag + ' 29. browser Back → ' + want(pg), [s.path, s.bodies, s.leaves, s.st && s.st.idx]);
    say(ev.length === 1 && ev[0].kind === 'traverse' && ev[0].direction === 'back' && ev[0].to.path === want(pg), tag + ' 29. ...one back traverse to ' + want(pg), ev.map((e) => [e.kind, e.direction, e.to && e.to.path]));
    last = s;
  }
  await back(p);
  const h = await snap(p);
  say(h.path === '/' && !h.setOpen && h.st.idx === home.st.idx, tag + ' 29. browser Back → Home, Settings closed', [h.path, h.setOpen]);
  last = h;
  for (const [pg, lf] of [['hub'], ['security'], ['security', 'devices']]) {
    await fwd(p);
    const s = await snap(p);
    const ev = navEvents(await evSince(p, last.events));
    say(nodeIs(s, pg, lf) && s.st.idx === last.st.idx + 1, tag + ' 30. browser Forward → ' + want(pg, lf), [s.path, s.bodies, s.leaves]);
    say(ev.length === 1 && ev[0].kind === 'traverse' && ev[0].direction === 'forward', tag + ' 30. ...one forward traverse', ev.map((e) => [e.kind, e.direction]));
    last = s;
  }
  say(last.len === top.len, tag + ' 30. Back/Forward minted no entries', [top.len, last.len]);
  // 33. refresh on a leaf: same node, no new entry
  await reload(p);
  const r = await snap(p);
  say(nodeIs(r, 'security', 'devices') && r.len === top.len && stateOk(r, 'settings-security-devices'), tag + ' 33. refresh on a leaf keeps it, adds no entry', [r.path, r.leaves, top.len, r.len]);
  await reload(p);
  const r2 = await snap(p);
  say(r2.len === top.len, tag + ' 33. a second refresh adds none either', [top.len, r2.len]);
  say(errs.length === 0, tag + ' back/forward: no JS errors', errs.slice(0, 3));
  await ctx.close();
}

/* ── 4, 13, 14, 31, 32, 34-39: direct entry of every node ────────────────────────── */
async function direct(browser, F, vp, tag) {
  const nodes = [['hub']].concat(PAGES.map(([pg]) => [pg]), LEAVES.map(([pg, lf]) => [pg, lf]));
  for (const [pg, lf] of nodes) {
    const u = want(pg, lf);
    const { ctx, p, errs } = await freshPage(browser, F.acct.token, vp, u);
    const s = await snap(p);
    const bootEv = navEvents(await evSince(p, 0)).filter((e) => e.kind !== 'traverse');
    say(nodeIs(s, pg, lf) && stateOk(s, routeName(pg, lf)) && s.st.prev === null && !s.hasPrev,
      tag + ' 34. direct ' + u + ' rebuilds exactly that node (one Settings body, ' + (lf ? 'its sheet' : 'no sheet') + '), no fabricated prev', [s.path, s.bodies, s.leaves, s.stale, s.st]);
    /* NB boot opens the default world before the deep link (pre-existing, batch 2: every
       deep link does it), so a replace to the world's address may come first. What matters
       here: boot never PUSHES, and the address it settles on is this node.
       NB a boot may write NOTHING (Batch 12B, proved by holding frames): acSyncPath coalesces
       per frame, so when the first frame lands after the deep link has opened, the world write
       and the node's write merge into ONE, which is a no-op because the URL already is the
       node. Requiring a replace failed on that correct outcome; the address itself is the
       proof of where it settled. */
    say(bootEv.every((e) => e.kind === 'replace' || e.kind === 'initial') && s.path === u && (!bootEv.length || bootEv[bootEv.length - 1].to.path === u) && s.len === 2,
      tag + ' 34. ...booting it never pushes, settles on ' + u + ', one Atwe entry', [bootEv.map((e) => [e.kind, e.to && e.to.path]), s.len]);
    if (['hub', 'privacy'].includes(pg) && !lf || ['devices', 'currency', 'whats-new', 'muted-words'].includes(lf)) {
      await reload(p);
      const r = await snap(p);
      say(nodeIs(r, pg, lf) && r.len === s.len, tag + ' 4/33. refresh ' + u + ' stays on it, no new entry', [r.path, s.len, r.len]);
    }
    say(errs.length === 0, tag + ' direct ' + u + ': no JS errors', errs.slice(0, 3));
    await ctx.close();
  }

  // 31/32. a direct leaf: Settings Back walks the logical parent; browser Back leaves Atwe
  {
    const { ctx, p } = await freshPage(browser, F.acct.token, vp, '/settings/security/devices');
    const a = await snap(p);
    await sheetBack(p); await settle(p, 1300);
    const b = await snap(p);
    let ev = navEvents(await evSince(p, a.events));
    say(nodeIs(b, 'security') && b.len === a.len && ev.length === 1 && ev[0].kind === 'replace', tag + ' 32. direct leaf → its own back → /settings/security (replace, no history made)', [b.path, a.len, b.len, ev.map((e) => e.kind)]);
    await p.evaluate(() => setBack()); await settle(p);
    const c = await snap(p);
    ev = navEvents(await evSince(p, b.events));
    say(nodeIs(c, 'hub') && c.len === a.len && ev.length === 1 && ev[0].kind === 'replace', tag + ' 32. → Settings Back → /settings (replace)', [c.path, c.len, ev.map((e) => e.kind)]);
    await p.evaluate(() => setBack()); await settle(p);
    const d = await snap(p);
    say(!d.setOpen && d.len === a.len && d.path === '/', tag + ' 32. → Settings Back on the hub closes Settings, still no history made', [d.path, d.setOpen, d.len]);
    await ctx.close();
  }
  {
    const { ctx, p } = await freshPage(browser, F.acct.token, vp, '/settings/security/devices');
    await back(p);
    const s = await snap(p);
    say(!!s.offApp || !/\/settings/.test(s.path), tag + ' 31. direct leaf → browser Back leaves Atwe', s.path);
    await ctx.close();
  }
  // 14. /devices → canonical, in place
  {
    const { ctx, p, errs } = await freshPage(browser, F.acct.token, vp, '/devices');
    const s = await snap(p);
    say(nodeIs(s, 'security', 'devices') && stateOk(s, 'settings-security-devices'), tag + ' 14. /devices opens Devices and the address becomes /settings/security/devices', [s.path, s.leaves]);
    await back(p);
    const b = await snap(p);
    say(!!b.offApp || !/devices|settings/.test(b.path), tag + ' 14. ...in place: no /devices entry left behind', b.path);
    say(errs.length === 0, tag + ' 14. no JS errors', errs.slice(0, 3));
    await ctx.close();
  }
  // unknown nodes never silently render some other page under their own address
  for (const [u, pg] of [['/settings/nope', 'hub'], ['/settings/security/nope', 'security']]) {
    const { ctx, p } = await freshPage(browser, F.acct.token, vp, u);
    const s = await snap(p);
    say(nodeIs(s, pg) && s.path === want(pg), tag + ' unknown ' + u + ' lands on ' + want(pg) + ' with the address corrected, never kept', [s.path, s.bodies]);
    await ctx.close();
  }
}

/* ── handoffs, and Settings opened from other places ───────────────────────────── */
async function handoffs(browser, F, vp, tag) {
  const { ctx, p, errs } = await freshPage(browser, F.acct.token, vp);
  // Premium → Wallet → Back
  await p.evaluate(() => openSettings()); await settle(p);
  await tapRow(p, bodySel('hub'), '^Premium'); await settle(p);
  const a = await snap(p);
  await tapRow(p, bodySel('premium'), '^Wallet'); await settle(p, 1600);
  const w = await snap(p);
  say(w.path === '/account/wallet' && w.open.includes('walletView') && w.len === a.len + 1, tag + ' Premium → Wallet pushes /account/wallet (an Account tool since batch 5, not a Settings child)', [w.path, a.len, w.len]);
  await back(p);
  const b = await snap(p);
  say(nodeIs(b, 'premium') && !b.open.includes('walletView'), tag + ' ...browser Back returns to /settings/premium', [b.path, b.bodies, b.open]);
  await fwd(p);
  const f = await snap(p);
  say(f.path === '/account/wallet' && f.open.includes('walletView'), tag + ' ...and Forward reopens the Wallet', [f.path]);
  await back(p);
  // hub → Manage store → Back
  await p.evaluate(() => setBack()); await settle(p);
  const h = await snap(p);
  const t = await tapRow(p, bodySel('hub'), '^Manage store'); await settle(p, 1600);
  const m = await snap(p);
  say(t && m.path === '/account/store' && m.len <= h.len + 1 && m.st.prev === h.st.idx, tag + ' hub → Manage store pushes /account/store', [t, m.path, h.len, m.len]);
  await back(p);
  const mb = await snap(p);
  say(nodeIs(mb, 'hub'), tag + ' ...browser Back returns to /settings', [mb.path, mb.bodies]);
  await p.evaluate(() => setBack()); await settle(p);

  // Opened from Account, from Notifications' own menu, and from the profile menu
  await p.evaluate(() => appTab('profile')); await settle(p);
  const me = await snap(p);
  await p.evaluate(() => openSettings()); await settle(p);
  const s = await snap(p);
  say(nodeIs(s, 'hub') && s.len === me.len + 1 && s.st.prev === me.st.idx, tag + ' from Account: a real /settings entry on top of /account', [s.path, me.path, s.len]);
  await back(p);
  const sb = await snap(p);
  say(sb.path === '/account' && !sb.setOpen, tag + ' ...Back returns to the Account page', [sb.path, sb.setOpen]);

  await p.evaluate(() => acNavNotifs()); await settle(p, 1400);
  const n = await snap(p);
  await p.evaluate(() => acNotifMenuPick('settings')); await settle(p, 1400);
  const ns = await snap(p);
  say(nodeIs(ns, 'notifications') && ns.len === n.len + 1 && ns.st.prev === n.st.idx, tag + ' from Notifications\' menu: ONE entry, straight onto /settings/notifications', [ns.path, n.path, n.len, ns.len]);
  await p.evaluate(() => setBack()); await settle(p, 1400);
  const nb = await snap(p);
  say(nb.path === '/notifications' && !nb.setOpen, tag + ' ...its Settings Back walks the REAL previous entry (Notifications), not the hub', [nb.path, nb.setOpen]);

  await p.evaluate(() => appTab('home')); await settle(p);
  const hm = await snap(p);
  await p.evaluate(() => { try { toggleProfileMenu({ currentTarget: document.getElementById('tbBrandProf'), stopPropagation() {}, preventDefault() {} }); } catch (e) {} });
  await settle(p, 500);
  const hasRow = await tapRow(p, '#profileMenu', 'Settings');
  if (hasRow) {
    await settle(p);
    const pm = await snap(p);
    say(nodeIs(pm, 'hub') && pm.len === hm.len + 1, tag + ' from the profile menu: a real /settings entry', [pm.path, hm.len, pm.len]);
  } else {
    await p.evaluate(() => { const m = document.getElementById('profileMenu'); if (m) m.classList.add('hidden'); });
    await p.evaluate(() => acNavSettings()); await settle(p);
    const pm = await snap(p);
    say(nodeIs(pm, 'hub') && pm.len === hm.len + 1, tag + ' from the drawer (the profile menu has no Settings row): a real /settings entry', [pm.path, hm.len, pm.len]);
  }
  say(errs.length === 0, tag + ' handoffs: no JS errors', errs.slice(0, 3));
  await ctx.close();
}

/* ── 41, 43: old tabs' entries ─────────────────────────────────────────────────── */
async function legacy(browser, F, vp, tag) {
  const { ctx, p, errs } = await freshPage(browser, F.acct.token, vp);
  // 41a. an 1874 entry on the bare /settings, reached by Back
  await p.evaluate(() => {
    history.pushState({ atwe: 1, path: '/settings', setPage: 'privacy', via: 'push' }, '', '/settings');
    history.pushState({}, '', '/');
  });
  await settle(p, 400);
  await back(p);
  const a = await snap(p);
  say(nodeIs(a, 'privacy') && noLegacy(a.st), tag + ' 41. an old {setPage:"privacy"} entry at /settings opens Privacy and becomes /settings/privacy', [a.path, a.bodies, a.st]);
  const ev = (await evSince(p, 0)).slice(-3);
  say(ev.filter((e) => e.kind === 'traverse').length >= 1 && ev[ev.length - 1].to.path === '/settings/privacy', tag + ' 41. ...the traverse reports the canonical address', ev.map((e) => [e.kind, e.to && e.to.path]));
  // 41b. the same entry reloaded
  await p.evaluate(() => history.replaceState({ atwe: 2, idx: 999, key: 'legacykey', route: 'settings', path: '/settings', setPage: 'security', via: 'land' }, '', '/settings'));
  await reload(p);
  const b = await snap(p);
  say(nodeIs(b, 'security') && noLegacy(b.st) && b.st.idx === 999, tag + ' 41. an old v2 entry with setPage survives a reload: Security, same position, setPage gone', [b.path, b.bodies, b.st]);
  // 43. v1 and unknown entries are tolerated
  await p.evaluate(() => {
    history.pushState({ atwe: 1, path: '/settings' }, '', '/settings');
    history.pushState({ foo: 'bar' }, '', '/settings/about');
    history.pushState({}, '', '/');
  });
  await settle(p, 400);
  await back(p);
  const c = await snap(p);
  const cev = (await evSince(p, 0)).filter((e) => e.kind === 'traverse').pop();
  say(nodeIs(c, 'about') && cev && cev.direction === 'unknown', tag + ' 43. a foreign-state entry renders from its URL, direction "unknown"', [c.path, cev && cev.direction]);
  await back(p);
  const d = await snap(p);
  say(nodeIs(d, 'hub') && noLegacy(d.st), tag + ' 43. a v1 entry renders from its URL', [d.path, d.bodies]);
  say(errs.length === 0, tag + ' 44. legacy: no JS errors', errs.slice(0, 3));
  await ctx.close();
}

(async () => {
  const pool = QA.newPool();
  const acct = await QA.seedAccount(pool, { business: true, prefix: 'sr' });
  await pool.end();
  await QA.assertServerSees(acct.token);
  const F = { acct };
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  /* The two widths run side by side (separate contexts, separate accounts' state is not
     shared: every section opens its own fresh context), which halves the wall time. */
  const widths = [[{ width: 390, height: 844 }, '[390]'], [{ width: 1440, height: 900 }, '[1440]']];
  try {
    await Promise.all(widths.map(async ([vp, tag]) => {
      await inAppTree(browser, F, vp, tag);
      await transient(browser, F, vp, tag);
      await backForward(browser, F, vp, tag);
      await direct(browser, F, vp, tag);
      await handoffs(browser, F, vp, tag);
      await legacy(browser, F, vp, tag);
    }));
  } finally { await browser.close(); }
  console.log('\n' + pass + ' passed, ' + fail + ' FAILED');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
