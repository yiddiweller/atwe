/* Route batch 8 — Beam conversation URLs + canonical world roots.
 *
 *   WORLD ROOTS     Beam /beam, Engine /engine, Account /account. The old /messages, /search,
 *                   /me (and /profile) are aliases, canonicalised by REPLACE, no entry added.
 *   BEAM            /beam/u/{username}, /beam/u/{username}/{threadId}, /beam/g/{id},
 *                   /beam/g/{id}/info. An in-app open is ONE push; refresh rebuilds from the
 *                   URL; a direct entry's App Back falls to the registry parent by REPLACE.
 *                   /beam/u/{username}/contact stays planned (no Beam contact page exists).
 *   PUBLIC GROUP    /group/{slug} stays exactly what it was, and is never rewritten.
 *   SHOWCASE        /showcase/{id}, no slug; parent /engine/showcase.
 *   PRIVACY         a conversation this member may not read shows the SAME not-found state
 *                   as one that does not exist, with nothing of it on screen or in memory.
 *
 * Owns its fixture. Full matrix at 390x844 and 1440x900, smoke at 820x1180.
 *
 *   node route8.js                    the checks
 *   node route8.js --break=messages   /messages stays canonical          (must FAIL)
 *   node route8.js --break=me         /me stays canonical                (must FAIL)
 *   node route8.js --break=dmreplace  a DM opener replaces, not pushes   (must FAIL)
 *   node route8.js --break=groupinfo  direct group-info Back goes to /beam (must FAIL)
 *   node route8.js --break=leak       a server leaks a foreign thread    (must FAIL)
 *   node route8.js --break=slug       a slugged Showcase address          (must FAIL)
 * Every mutation is applied to the RESPONSE in flight (never to a file on disk), so nothing
 * needs restoring and a stale mutation throws by name.
 */
'use strict';
const path = require('path');
const QA = require(path.join(__dirname, 'qa-fixture.js'));
const R = require(path.join(__dirname, '..', 'public', 'atwe-routes.js'));
const { chromium } = require(process.env.PW_SCRATCH
  ? path.join(process.env.PW_SCRATCH, 'node_modules/playwright-core')
  : path.join(__dirname, 'node_modules/playwright-core'));

const BREAK = process.argv.find((a) => a.startsWith('--break'));
const BREAK_KIND = BREAK ? (BREAK.split('=')[1] || 'messages') : null;
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7) || null;
const BASE = QA.base();
let pass = 0, fail = 0;
const say = (ok, what, extra) => { ok ? pass++ : fail++; console.log((ok ? '  ok   ' : '  FAIL ') + what + (extra !== undefined && !ok ? '   ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); };

const MUT = {
  messages: { html: [[`chat: '/beam', search: '/engine'`, `chat: '/messages', search: '/engine'`]] },
  me: { html: [[`ai: '/ai', profile: '/account' }`, `ai: '/ai', profile: '/me' }`]] },
  dmreplace: { html: [[`  const _bTok = acBeamOwn(acBeamDmPath(acBeamKnownUsername(id), threadId), true);`,
                       `  const _bTok = acBeamOwn(acBeamDmPath(acBeamKnownUsername(id), threadId), false);`]] },
  groupinfo: { js: [[`params: { id: 'int' }, parent: 'beam-group' })`, `params: { id: 'int' }, parent: 'messages' })`]] },
  slug: { html: [[`acRoutePath('showcase-detail', { id }, '/showcase/' + id)`, `('/showcase/' + id + '-' + 'item')`]] },
  leak: {},   // served by a route handler below: the probe's own detector is what is tested
};

let LEAK = null;   // { url: RegExp, body: string } — the foreign thread, as a leaking server would send it
async function newTab(browser, token, viewport, first, noToken) {
  const ctx = await browser.newContext(BREAK ? { viewport, serviceWorkers: 'block' } : { viewport });
  if (BREAK && BREAK_KIND !== 'leak') {
    const m = MUT[BREAK_KIND];
    await ctx.route(/localhost:\d+\/([^.]*|atwe-routes\.js.*)$/, async (route) => {
      const req = route.request();
      if (/\/api\//.test(req.url())) return route.continue();
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
  if (BREAK_KIND === 'leak') {
    await ctx.route(/\/api\/atchat\/with\/\d+/, async (route) => {
      if (LEAK && LEAK.url.test(route.request().url()) && route.request().method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: LEAK.body });
      }
      return route.continue();
    });
  }
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const api = [];
  p.on('response', (r) => { if (/\/api\/atchat\/(with|groups|peer)\//.test(r.url())) api.push({ url: r.url().replace(/^https?:\/\/[^/]+/, ''), status: r.status() }); });
  await p.addInitScript(([t, nt]) => {
    try { if (!nt) localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_intro_seen', JSON.stringify(['beam', 'circles', 'ai', 'wallet'])); } catch (e) {}
    window.__nav = [];
    window.addEventListener('atwe:navigate', (e) => { window.__nav.push({ kind: e.detail.kind, direction: e.detail.direction, path: e.detail.to && e.detail.to.path }); });
  }, [token, !!noToken]);
  if (noToken) { await p.goto(BASE + first, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500); }
  else await go(p, first || '/');
  return { ctx, p, errs, api };
}
const booted = async (p) => {
  await QA.waitUntil(p, () => typeof S !== 'undefined' && !!(S.user && S.user.id), null, 25000);
  await QA.waitUntil(p, () => window.AtweHistory && !AtweHistory.booting, null, 15000);
  await p.waitForTimeout(800);
};
const go = async (p, url) => { await p.goto(BASE + url, { waitUntil: 'domcontentloaded' }); await booted(p); };
const settle = (p, ms) => p.waitForTimeout(ms || 1200);
const back = async (p) => { await p.goBack({ timeout: 6000 }).catch(() => {}); await settle(p, 1400); };
const fwd = async (p) => { await p.goForward({ timeout: 6000 }).catch(() => {}); await settle(p, 1400); };
const reload = async (p) => { await p.reload({ waitUntil: 'domcontentloaded' }); await booted(p); await settle(p, 1200); };
const appBack = async (p) => { const r = await p.evaluate(() => { try { return appGoBack(); } catch (e) { return 'threw:' + e.message; } }); await settle(p, 1400); return r; };
const closeAll = (p) => p.evaluate(() => { document.querySelectorAll('.overlay:not(.hidden)').forEach((o) => { try { closeOverlay(o.id, true); } catch (e) {} }); });
const evSince = (p, n) => p.evaluate((k) => window.__nav.slice(k), n);
const navEv = (evs) => evs.filter((e) => ['push', 'replace', 'root-change', 'traverse'].includes(e.kind));
const pushes = (evs) => evs.filter((e) => e.kind === 'push' || e.kind === 'root-change');

/* One coherent state: the world, the screen, the top layer, the URL and the lit nav agree. */
const snap = (p) => p.evaluate(() => {
  const vis = (e) => !!e && !e.classList.contains('hidden') && !e.classList.contains('closing');
  const open = [...document.querySelectorAll('.overlay:not(.hidden):not(.closing)')].map((o) => o.id);
  const screen = AC_SCREENS.find((id) => vis(document.getElementById(id))) || null;
  const why = [];
  const r = parseDeepLink();
  const WORLD = { acHomeScreen: 'home', acListScreen: 'chat', acSearchScreen: 'search', acMeScreen: 'profile', acThreadScreen: 'chat', acGroupInfoScreen: 'chat' };
  if (WORLD[screen] && WORLD[screen] !== _appTab && !open.length) why.push(screen + ' under world ' + _appTab);
  const BEAM = ['beamdm', 'beamgroup', 'beam', 'group'];
  if (r && BEAM.includes(r.type) && !open.length && !['acThreadScreen', 'acGroupInfoScreen', 'acListScreen'].includes(screen)) why.push('a Beam address over ' + screen);
  if ((screen === 'acThreadScreen' || screen === 'acGroupInfoScreen') && !open.length && !(r && BEAM.includes(r.type))) why.push(screen + ' at ' + location.pathname);
  const lit = [...document.querySelectorAll('#bottomNav .bn-tab.active, .sb-navbtn.active')].map((e) => e.id.replace(/^[bs]nav-/, ''));
  const wantLit = document.body.classList.contains('notif-tab') ? 'notifs' : (NAV_ALIAS[_appTab] || _appTab);
  if (lit.length && lit.some((x) => x !== wantLit)) why.push('nav lit ' + lit.join('/') + ' want ' + wantLit);
  const cur = AtweHistory.current || {};
  const st = history.state || {};
  const thread = document.getElementById('acThread');
  return { path: location.pathname, idx: cur.idx, key: cur.key, prev: cur.prev, tab: _appTab, screen, open,
    top: open[open.length - 1] || null, events: window.__nav.length, coherent: why.length === 0, why,
    mode: AC.mode, peer: AC.peer ? AC.peer.username : null, groupId: AC.groupId, threadId: AC.threadId,
    text: thread ? thread.innerText : '', name: (document.getElementById('acPeerName') || {}).textContent || '',
    mem: JSON.stringify((AC.messages || []).map((m) => m.body)),
    stClean: st.atwe === 2 && st.path === location.pathname && !['peer', 'thread', 'group', 'from', 'parent', 'beam'].some((k) => k in st) };
});
const waitThread = (p, ms) => QA.waitUntil(p, () => { const t = document.getElementById('acThreadScreen'); return !!t && !t.classList.contains('hidden') && !!(AC.peer || AC.group); }, null, ms || 12000).catch(() => {});

/* ── A. world roots ── */
async function roots(p, errs, tag) {
  console.log(`\n${tag} A. world roots`);
  const W = [['chat', '/beam', 'acListScreen'], ['search', '/engine', 'acSearchScreen'], ['profile', '/account', 'acMeScreen']];
  for (const [tab, want, scr] of W) {
    await closeAll(p); await p.evaluate(() => appTab('home')); await settle(p);
    const s0 = await snap(p);
    await p.evaluate((t) => appTab(t), tab); await settle(p);
    const s = await snap(p);
    const ev = navEv(await evSince(p, s0.events));
    say(s.path === want && s.screen === scr && s.prev === s0.idx && pushes(ev).length === 1 && ev.length === 1 && s.coherent && s.stClean,
      `${tag} ${want}: switching world is ONE push to the canonical root`, { path: s.path, ev, screen: s.screen, why: s.why });
    await reload(p);
    const r = await snap(p);
    say(r.path === want && r.screen === scr && r.idx === s.idx && r.coherent, `${tag} ${want}: refresh stays on the root, same entry`, { path: r.path, screen: r.screen, why: r.why });
    await back(p);
    const b = await snap(p);
    say(b.path === '/' && b.screen === 'acHomeScreen' && b.idx === s0.idx && b.coherent, `${tag} ${want}: browser Back returns Home`, { path: b.path, screen: b.screen, why: b.why });
    await fwd(p);
    const f = await snap(p);
    say(f.path === want && f.screen === scr && f.idx === s.idx && f.coherent, `${tag} ${want}: browser Forward restores the world`, { path: f.path, screen: f.screen });
  }
  say(errs.length === 0, `${tag} A. no JS errors`, errs.slice(0, 2));
}

/* ── B. legacy roots and direct loads ── */
async function legacyRoots(browser, token, vp, tag) {
  console.log(`\n${tag} B. legacy roots canonicalise by REPLACE`);
  const { ctx, p, errs } = await newTab(browser, token, vp, '/');
  const CASES = [['/messages', '/beam', 'acListScreen'], ['/MESSAGES', '/beam', 'acListScreen'], ['/beam', '/beam', 'acListScreen'],
    ['/search', '/engine', 'acSearchScreen'], ['/engine', '/engine', 'acSearchScreen'],
    ['/me', '/account', 'acMeScreen'], ['/profile', '/account', 'acMeScreen'], ['/account', '/account', 'acMeScreen']];
  for (const [url, want, scr] of CASES) {
    // boot restores the last world used: land somewhere else first so the alias does real work
    await p.evaluate(() => appTab('home')); await settle(p, 500);
    await go(p, url); await settle(p, 900);
    const s = await snap(p);
    const ev = await p.evaluate(() => window.__nav.slice());
    say(s.path === want && s.screen === scr && s.prev === null && pushes(ev).length === 0 && s.coherent && s.stClean,
      `${tag} ${url}: lands on ${want} by REPLACE, no entry added`, { path: s.path, screen: s.screen, ev: ev.map((e) => e.kind + ':' + e.path), why: s.why });
  }
  // a refresh after canonicalising stays canonical
  await go(p, '/messages'); await reload(p);
  say((await snap(p)).path === '/beam', `${tag} refresh after /messages stays /beam`, (await snap(p)).path);
  // Back from a canonicalised alias does not land on the alias
  await go(p, '/me'); await settle(p);
  await p.evaluate(() => acOpenAccountSection('money')); await settle(p);
  await back(p);
  const b = await snap(p);
  say(b.path === '/account', `${tag} Back onto a canonicalised alias entry shows /account, never /me`, b.path);
  say(errs.length === 0, `${tag} B. no JS errors`, errs.slice(0, 2));
  await ctx.close();
}

/* ── C/D. a DM and an extra thread, in-app ── */
async function dms(p, errs, tag, fx) {
  console.log(`\n${tag} C. main DM, D. extra thread`);
  const dm = '/beam/u/' + fx.b.username, th = dm + '/' + fx.thread;
  for (const [name, open, want, marker] of [
    ['main DM from the inbox row', (p2) => p2.evaluate((id) => acDmRowTap(id, null), fx.b.id), dm, fx.mainMark],
    ['extra thread from the inbox row', (p2) => p2.evaluate(([id, t]) => acDmRowTap(id, t), [fx.b.id, fx.thread]), th, fx.threadMark],
  ]) {
    await closeAll(p); await p.evaluate(() => appTab('chat')); await settle(p, 1400);
    const s0 = await snap(p);
    await open(p); await waitThread(p); await settle(p, 1200);
    const s = await snap(p);
    const ev = navEv(await evSince(p, s0.events));
    say(s.path === want && s.screen === 'acThreadScreen' && s.prev === s0.idx && ev.length === 1 && pushes(ev).length === 1 && s.coherent && s.stClean,
      `${tag} ${name}: ONE push to ${want}`, { path: s.path, ev, screen: s.screen, why: s.why });
    say(s.text.includes(marker), `${tag} ${name}: shows ITS messages`, s.text.slice(0, 120));
    await reload(p); await waitThread(p); await settle(p, 1000);
    const r = await snap(p);
    say(r.path === want && r.screen === 'acThreadScreen' && r.text.includes(marker) && r.idx === s.idx && r.coherent,
      `${tag} ${name}: refresh rebuilds it from the URL`, { path: r.path, screen: r.screen, why: r.why, has: r.text.includes(marker) });
    await back(p);
    const b = await snap(p);
    say(b.path === '/beam' && b.screen === 'acListScreen' && b.idx === s0.idx && b.coherent, `${tag} ${name}: browser Back returns to /beam`, { path: b.path, screen: b.screen, why: b.why });
    await fwd(p); await waitThread(p); await settle(p, 800);
    const f = await snap(p);
    say(f.path === want && f.screen === 'acThreadScreen' && f.text.includes(marker) && f.idx === s.idx && f.coherent, `${tag} ${name}: browser Forward restores it`, { path: f.path, screen: f.screen });
    const n = f.events;
    await p.evaluate(() => acBackToList()); await settle(p, 1500);
    const a = await snap(p);
    const aev = navEv(await evSince(p, n));
    say(a.path === '/beam' && a.screen === 'acListScreen' && aev.length === 1 && aev[0].kind === 'traverse' && a.coherent,
      `${tag} ${name}: the conversation's own Back walks the REAL history to /beam`, { path: a.path, ev: aev });
  }
  // switching from one thread to the other with the same person never shows the wrong one
  await closeAll(p); await p.evaluate(() => appTab('chat')); await settle(p, 1200);
  await p.evaluate((id) => acDmRowTap(id, null), fx.b.id); await waitThread(p); await settle(p, 900);
  await p.evaluate(([id, t]) => acDmRowTap(id, t), [fx.b.id, fx.thread]); await waitThread(p); await settle(p, 1200);
  await back(p); await waitThread(p); await settle(p, 900);
  let s = await snap(p);
  say(s.path === dm && s.text.includes(fx.mainMark) && !s.text.includes(fx.threadMark), `${tag} Back from the extra thread to the main chat shows the MAIN chat's messages`, { path: s.path, t: s.text.slice(0, 80) });
  await fwd(p); await waitThread(p); await settle(p, 900);
  s = await snap(p);
  say(s.path === th && s.text.includes(fx.threadMark) && !s.text.includes(fx.mainMark), `${tag} Forward to the extra thread shows the THREAD's messages`, { path: s.path, t: s.text.slice(0, 80) });
  say(errs.length === 0, `${tag} C/D. no JS errors`, errs.slice(0, 2));
}

/* ── C/D/E/F direct entries ── */
async function directBeam(browser, token, vp, tag, fx) {
  console.log(`\n${tag} C-F. Beam addresses entered directly`);
  const { ctx, p, errs } = await newTab(browser, token, vp, '/');
  const dm = '/beam/u/' + fx.b.username;
  const CASES = [
    [dm, dm, fx.mainMark, 'dm'], ['/beam/u/@' + fx.b.username.toUpperCase(), dm, fx.mainMark, 'dm'],
    [dm + '/' + fx.thread, dm + '/' + fx.thread, fx.threadMark, 'dm'],
    ['/beam/g/' + fx.group, '/beam/g/' + fx.group, fx.groupMark, 'group'],
  ];
  for (const [url, want, marker, kind] of CASES) {
    await go(p, url); await waitThread(p); await settle(p, 1200);
    const s = await snap(p);
    const ev = await p.evaluate(() => window.__nav.slice());
    say(s.path === want && s.screen === 'acThreadScreen' && s.text.includes(marker) && s.prev === null && pushes(ev).length === 0 && s.coherent && s.tab === 'chat',
      `${tag} ${url}: rebuilds the ${kind} at ${want} with no entry added`, { path: s.path, screen: s.screen, tab: s.tab, ev: ev.map((e) => e.kind + ':' + e.path), why: s.why });
    const n = s.events;
    await appBack(p);
    const a = await snap(p);
    const aev = navEv(await evSince(p, n));
    say(a.path === '/beam' && a.screen === 'acListScreen' && aev.length === 1 && aev[0].kind === 'replace' && a.idx === s.idx && a.coherent,
      `${tag} ${url} (direct): App Back REPLACES to /beam, fabricating no history`, { path: a.path, ev: aev, idx: [s.idx, a.idx] });
  }
  // F. group info: in-app open pushes; direct entry climbs info -> group -> inbox by replace
  await go(p, '/beam/g/' + fx.group); await waitThread(p); await settle(p, 1200);
  const g0 = await snap(p);
  await p.evaluate(() => acOpenGroupInfo()); await settle(p, 1200);
  const gi = await snap(p);
  const gev = navEv(await evSince(p, g0.events));
  say(gi.path === '/beam/g/' + fx.group + '/info' && gi.screen === 'acGroupInfoScreen' && gev.length === 1 && pushes(gev).length === 1 && gi.prev === g0.idx && gi.coherent,
    `${tag} group info from the group is ONE push to /beam/g/<id>/info`, { path: gi.path, ev: gev, why: gi.why });
  await p.evaluate(() => { const b = document.querySelector('#acGroupInfoTop .msg-back'); if (b) b.click(); }); await settle(p, 1400);
  const gb = await snap(p);
  say(gb.path === '/beam/g/' + fx.group && gb.screen === 'acThreadScreen' && gb.idx === g0.idx && gb.coherent, `${tag} group info's arrow walks real history back to the group`, { path: gb.path, screen: gb.screen });
  await go(p, '/beam/g/' + fx.group + '/info'); await settle(p, 2500);
  let s = await snap(p);
  say(s.path === '/beam/g/' + fx.group + '/info' && s.screen === 'acGroupInfoScreen' && s.prev === null && s.coherent, `${tag} /beam/g/<id>/info direct: the info page`, { path: s.path, screen: s.screen, why: s.why });
  await reload(p); await settle(p, 1500);
  s = await snap(p);
  say(s.path === '/beam/g/' + fx.group + '/info' && s.screen === 'acGroupInfoScreen', `${tag} …refresh rebuilds the info page`, { path: s.path, screen: s.screen });
  await appBack(p); await waitThread(p); await settle(p, 900);
  s = await snap(p);
  say(s.path === '/beam/g/' + fx.group && s.screen === 'acThreadScreen' && s.text.includes(fx.groupMark), `${tag} …App Back REPLACES to the group (its registry parent), not the inbox`, { path: s.path, screen: s.screen });
  await appBack(p);
  s = await snap(p);
  say(s.path === '/beam' && s.screen === 'acListScreen', `${tag} …App Back again REPLACES to /beam`, { path: s.path, screen: s.screen });
  // G. the contact card stays planned: its address names nothing, and never becomes a profile
  for (const url of [dm + '/contact', '/beam/x', '/beam/g/' + fx.group + '/members']) {
    await go(p, url); await settle(p, 1200);
    s = await snap(p);
    say(s.path === '/beam' && s.screen === 'acListScreen' && s.coherent, `${tag} ${url}: names nothing — the inbox, never a profile or another page`, { path: s.path, screen: s.screen });
  }
  // H. the public group address stays what it was
  await go(p, '/group/' + fx.groupSlug); await waitThread(p); await settle(p, 1400);
  s = await snap(p);
  say(s.path === '/group/' + fx.groupSlug && s.screen === 'acThreadScreen' && s.text.includes(fx.groupMark) && s.coherent,
    `${tag} /group/<slug> as a member: the conversation, at the PUBLIC address, unchanged`, { path: s.path, screen: s.screen, why: s.why });
  await reload(p); await waitThread(p); await settle(p, 1000);
  s = await snap(p);
  say(s.path === '/group/' + fx.groupSlug && s.screen === 'acThreadScreen', `${tag} …refresh keeps /group/<slug>`, s.path);
  say(errs.length === 0, `${tag} direct Beam: no JS errors`, errs.slice(0, 2));
  await ctx.close();
}

/* ── privacy: wrong member == nonexistent, nothing leaked ── */
async function privacy(browser, token, vp, tag, fx) {
  console.log(`\n${tag} P. a conversation that is not yours is indistinguishable from one that does not exist`);
  const dm = '/beam/u/' + fx.b.username;
  const pairs = [
    ['someone else\'s thread', dm + '/' + fx.foreignThread, 'a thread that does not exist', dm + '/99999999'],
    ['a group you are not in', '/beam/g/' + fx.foreignGroup, 'a group that does not exist', '/beam/g/99999999'],
    ['a deactivated account you never talked to', '/beam/u/' + fx.gone.username, 'a handle nobody has', '/beam/u/nobody' + fx.tag],
  ];
  for (const [wName, wrong, nName, none] of pairs) {
    const seen = [];
    for (const url of [wrong, none]) {
      const { ctx, p, errs, api } = await newTab(browser, token, vp, '/');
      await p.evaluate(() => appTab('home')); await settle(p, 400);
      await go(p, url); await settle(p, 2600);
      const s = await snap(p);
      const notes = await p.evaluate(() => [...document.querySelectorAll('.notif, .toast, [role=status]')].map((e) => e.textContent.trim()).filter(Boolean));
      const statuses = api.filter((x) => !/\/read/.test(x.url)).map((x) => x.status);
      seen.push({ url, path: s.path, screen: s.screen, peer: s.peer, group: s.groupId && s.mode === 'group' ? s.groupId : null, text: s.text, mem: s.mem, name: s.name, notes: notes.join('|'), statuses, errs: errs.length });
      await ctx.close();
    }
    const [w, n] = seen;
    const leaked = [fx.foreignMark, fx.foreignGroupMark, fx.goneMark].some((m) => (w.text + w.mem + w.name).includes(m));
    say(!leaked, `${tag} ${wName}: NOTHING of it reaches the screen or memory`, { text: w.text.slice(0, 120), mem: w.mem.slice(0, 120) });
    say(w.path === '/beam' && n.path === '/beam' && w.screen === 'acListScreen' && n.screen === 'acListScreen' && w.notes === n.notes,
      `${tag} ${wName} and ${nName}: the SAME not-found state`, { wrong: [w.path, w.screen, w.notes], none: [n.path, n.screen, n.notes] });
    say(w.statuses.includes(404) && n.statuses.includes(404), `${tag} ${wName}: the loader answered 404, like ${nName}`, { wrong: w.statuses, none: n.statuses });
    say(w.errs === 0 && n.errs === 0, `${tag} ${wName}: no JS errors`);
  }
  // a deactivated account the member DOES share history with: that history is theirs, and the
  // URL opens it exactly as the inbox row does
  const { ctx, p, errs } = await newTab(browser, token, vp, '/');
  await go(p, '/beam/u/' + fx.goneHist.username); await waitThread(p); await settle(p, 1500);
  const h = await snap(p);
  say(h.path === '/beam/u/' + fx.goneHist.username && h.screen === 'acThreadScreen' && h.text.includes(fx.goneHistMark),
    `${tag} a deactivated account you share history with: your own conversation, by URL as from the inbox`, { path: h.path, screen: h.screen });
  say(errs.length === 0, `${tag} P. no JS errors`, errs.slice(0, 2));
  await ctx.close();
}

/* ── logged out: the existing gate, then resume ── */
async function loggedOut(browser, token, vp, tag, fx) {
  console.log(`\n${tag} L. signed out`);
  const dm = '/beam/u/' + fx.b.username;
  const { ctx, p, errs } = await newTab(browser, token, vp, dm, true);
  const s = await p.evaluate(() => ({ login: !document.getElementById('loginOverlay').classList.contains('hidden'), path: location.pathname,
    text: (document.getElementById('acThread') || {}).innerText || '' }));
  say(s.login && !s.text.includes(fx.mainMark), `${tag} ${dm} signed out: the sign-in gate, nothing of the conversation`, s);
  const me = await (await fetch(BASE + '/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })).json();
  await p.evaluate(([t, u]) => onAuthSuccess(t, u), [token, me.user]);
  await waitThread(p); await settle(p, 1800);
  const r = await snap(p);
  say(r.path === dm && r.screen === 'acThreadScreen' && r.text.includes(fx.mainMark) && r.tab === 'chat', `${tag} …signing in resumes at the conversation`, { path: r.path, screen: r.screen, tab: r.tab });
  say(errs.length === 0, `${tag} signed out: no JS errors`, errs.slice(0, 2));
  await ctx.close();
}

/* ── I. transient UI never moves the address ── */
async function transients(p, errs, tag, fx) {
  console.log(`\n${tag} I. transient UI`);
  await closeAll(p); await p.evaluate(() => appTab('chat')); await settle(p, 1000);
  await p.evaluate((id) => acDmRowTap(id, null), fx.b.id); await waitThread(p); await settle(p, 1200);
  const s0 = await snap(p);
  await p.evaluate(() => { try { acHeadMenu(); } catch (e) {} }); await settle(p, 700);
  await p.evaluate(() => { try { acThreadSearchOpen(); } catch (e) {} }); await settle(p, 500);
  let s = await snap(p);
  say(s.path === s0.path && s.idx === s0.idx && navEv(await evSince(p, s0.events)).length === 0, `${tag} the ⋯ menu and in-chat search change neither the address nor history`, { path: s.path });
  await p.evaluate(() => { try { acThreadSearchClose(); } catch (e) {} });
  await p.evaluate(() => { try { acToggleAttach && acToggleAttach(); } catch (e) {} }); await settle(p, 500);
  const before = await snap(p);
  const st0 = await p.evaluate(() => ({ idx: AtweHistory.current.idx, key: AtweHistory.current.key }));
  // a menu that is open: browser Back cancels THAT, the conversation and its entry stay
  await p.evaluate(() => { const m = document.querySelector('.attach-menu, .chat-menu'); if (m) m.classList.remove('hidden'); });
  await back(p);
  s = await snap(p);
  const st1 = await p.evaluate(() => ({ idx: AtweHistory.current.idx, key: AtweHistory.current.key }));
  say(s.path === before.path && s.screen === 'acThreadScreen' && st1.idx === st0.idx && st1.key === st0.key,
    `${tag} browser Back with a menu open cancels the menu; same idx, key and URL`, { path: s.path, st0, st1 });
  say(errs.length === 0, `${tag} I. no JS errors`, errs.slice(0, 2));
}

/* ── J. handoffs into a conversation ── */
async function handoffs(p, errs, tag, fx) {
  console.log(`\n${tag} J. handoffs into a conversation`);
  const dm = '/beam/u/' + fx.b.username;
  const click = (sel, within) => p.evaluate(([s1, w]) => { const root = w ? document.querySelector(w) : document; const el = root && root.querySelector(s1); if (!el) return false; el.click(); return true; }, [sel, within || null]);
  const CASES = [
    ['Connections -> Message', '/account/network', async () => { await p.evaluate(() => acOpenConnections()); await QA.waitUntil(p, () => /ac-conn-item/.test((document.getElementById('connListBody') || {}).innerHTML || ''), null, 20000); },
      () => click('.ac-conn-item .ac-pill-btn', '#connListBody')],
    ['Profile -> Message', '/' + fx.b.username, async () => { await p.evaluate((u) => { appTab('home'); acGoProfile(u); }, fx.b.username); await settle(p, 2000); },
      () => p.evaluate(() => { acProfileMessage(); return true; })],
    ['Order -> Message', '/account/orders', async () => {
      await p.evaluate(() => acOpenOrders('buyer')); await settle(p, 1500);
      await p.evaluate((id) => acOpenOrder(id), fx.order);
      await QA.waitUntil(p, () => { const v = document.getElementById('orderView'); return !!v && !v.classList.contains('hidden') && /Message/.test(v.innerHTML); }, null, 20000);
    }, () => click('[onclick*="acOpenChat"]', '#orderView')],
    ['Service -> Message', '/engine/services', async () => { await p.evaluate(() => acOpenServices()); await settle(p, 1800); },
      () => p.evaluate((id) => { acMessageProvider(id); return true; }, fx.b.id)],
    ['Notifications -> DM', '/notifications', async () => { await p.evaluate(() => acNavNotifs()); await QA.waitUntil(p, () => !!(AC._notifs && AC._notifs.length), null, 20000); },
      () => p.evaluate((id) => { const n = (AC._notifs || []).find((x) => x.type === 'message' && x.actor && x.actor.id === id); if (!n) return false; acNotifGo(n.id); return true; }, fx.b.id)],
  ];
  for (const [name, src, open, act] of CASES) {
    await closeAll(p); await p.evaluate(() => appTab('home')); await settle(p, 900);
    await open(); await settle(p, 800);
    const s0 = await snap(p);
    say(s0.path === src, `${tag} ${name}: the source is open at ${src}`, s0.path);
    if (s0.path !== src) continue;
    const ok = await act();
    if (ok === false) { say(false, `${tag} ${name}: could not drive its real control`); continue; }
    await waitThread(p); await settle(p, 2200);
    const s = await snap(p);
    const ev = navEv(await evSince(p, s0.events));
    say(s.path === dm && s.screen === 'acThreadScreen' && s.tab === 'chat' && pushes(ev).length === 1 && s.prev === s0.idx && s.coherent,
      `${tag} ${name}: ONE push to ${dm}, in the Beam world`, { path: s.path, screen: s.screen, tab: s.tab, ev, why: s.why });
    await p.evaluate(() => acBackToList()); await settle(p, 2200);
    const b = await snap(p);
    say(b.path === src && b.idx === s0.idx && b.tab === s0.tab && b.coherent, `${tag} ${name}: Back returns to ${src} (real history), its world restored`, { path: b.path, tab: [s0.tab, b.tab], why: b.why });
    await fwd(p); await waitThread(p); await settle(p, 900);
    const f = await snap(p);
    say(f.path === dm && f.screen === 'acThreadScreen' && f.coherent, `${tag} ${name}: Forward returns to the conversation`, { path: f.path, screen: f.screen });
  }
  say(errs.length === 0, `${tag} J. no JS errors`, errs.slice(0, 2));
}

/* ── K/L/M/N. Account root, Engine root, search, Showcase ── */
async function others(p, errs, tag, fx) {
  console.log(`\n${tag} K-N. Account root, Engine root, search, Showcase`);
  // K. a Settings handoff to an Account tool: real history back
  await closeAll(p); await p.evaluate(() => appTab('profile')); await settle(p);
  await p.evaluate(() => openSettings('premium')); await settle(p, 1200);
  const sp = await snap(p);
  await p.evaluate(() => { const r = [...document.querySelectorAll('#settingsOverlay [onclick*="acOpenWallet"]')].find((e) => e.offsetParent); if (r) r.click(); else acOpenWallet(); }); await settle(p, 1600);
  const w = await snap(p);
  say(sp.path === '/settings/premium' && w.path === '/account/wallet' && w.prev === sp.idx, `${tag} Settings -> Wallet is ONE push to /account/wallet`, [sp.path, w.path]);
  await back(p);
  let s = await snap(p);
  say(s.path === '/settings/premium', `${tag} …Back returns to /settings/premium (real history)`, s.path);
  // Account parents end at /account
  await go(p, '/account/wallet'); await settle(p, 1500);
  await appBack(p); s = await snap(p);
  say(s.path === '/account/money', `${tag} /account/wallet direct: App Back -> /account/money`, s.path);
  await appBack(p); s = await snap(p);
  say(s.path === '/account' && s.screen === 'acMeScreen', `${tag} …then -> /account (the Account root)`, { path: s.path, screen: s.screen });
  // L. Engine children end at /engine
  await go(p, '/engine/marketplace'); await settle(p, 1500);
  await appBack(p); s = await snap(p);
  say(s.path === '/engine' && s.screen === 'acSearchScreen' && s.top === null, `${tag} /engine/marketplace direct: App Back -> /engine`, { path: s.path, top: s.top });
  // M. search stays the Engine root: no query, no scope, no committed-results URL
  const m0 = await snap(p);
  await p.evaluate(async () => { const i = document.getElementById('tbSearchInput'); for (const q of ['b', 'be', 'bea', 'beam']) { if (i) i.value = q; acDoSearch(q); await new Promise((r) => setTimeout(r, 120)); } });
  await settle(p, 1200);
  s = await snap(p);
  say(s.path === '/engine' && navEv(await evSince(p, m0.events)).length === 0 && !(await p.evaluate(() => location.search)), `${tag} typing a search keeps /engine, no query in the URL, no entries`, s.path);
  await go(p, '/engine/search'); await settle(p, 1000);
  s = await snap(p);
  say(s.path === '/engine' && s.screen === 'acSearchScreen', `${tag} /engine/search is still planned: the Engine root`, { path: s.path, screen: s.screen });
  // N. Showcase detail
  await closeAll(p); await p.evaluate(() => appTab('search')); await settle(p);
  await p.evaluate(() => acOpenShowcaseDiscover()); await settle(p, 1500);
  const n0 = await snap(p);
  await p.evaluate((id) => acOpenShowcase(id), fx.showcase); await settle(p, 1500);
  const n1 = await snap(p);
  const nev = navEv(await evSince(p, n0.events));
  const sc = '/showcase/' + fx.showcase;
  say(n0.path === '/engine/showcase' && n1.path === sc && n1.top === 'showcaseView' && nev.length === 1 && pushes(nev).length === 1 && n1.prev === n0.idx && n1.coherent,
    `${tag} Showcase -> an item is ONE push to ${sc} (no slug)`, { path: n1.path, ev: nev, top: n1.top });
  await reload(p);
  s = await snap(p);
  say(s.path === sc && s.top === 'showcaseView', `${tag} …refresh rebuilds the item from its id`, { path: s.path, top: s.top });
  await back(p); s = await snap(p);
  say(s.path === '/engine/showcase' && s.top === 'showcaseDiscover', `${tag} …browser Back returns to /engine/showcase`, { path: s.path, top: s.top });
  await go(p, sc); await settle(p, 1500);
  const d = await snap(p);
  await appBack(p); s = await snap(p);
  say(d.path === sc && d.top === 'showcaseView' && d.prev === null && s.path === '/engine/showcase' && s.top === 'showcaseDiscover' && s.idx === d.idx,
    `${tag} ${sc} direct: App Back REPLACES to /engine/showcase`, { d: [d.path, d.top], s: [s.path, s.top] });
  await go(p, sc + '-sunset'); await settle(p, 1000);
  s = await snap(p);
  say(s.screen !== 'acProfileScreen' && !s.open.includes('showcaseView'), `${tag} a slugged /showcase/<id>-<slug> is not an address (and not a profile)`, { screen: s.screen, open: s.open });
  say(errs.length === 0, `${tag} K-N. no JS errors`, errs.slice(0, 2));
}

/* ── the boot race: a deep link must not be overtaken by boot's own world ── */
async function bootRace(browser, token, vp, tag, fx) {
  console.log(`\n${tag} R. boot race (60 cold boots)`);
  const dm = '/beam/u/' + fx.b.username;
  const urls = ['/messages', '/me', '/search', dm, '/beam/g/' + fx.group, '/account/wallet', '/engine/marketplace', '/showcase/' + fx.showcase];
  const want = { '/messages': '/beam', '/me': '/account', '/search': '/engine' };
  let bad = [];
  const { ctx, p } = await newTab(browser, token, vp, '/');
  for (let i = 0; i < 60; i++) {
    const url = urls[i % urls.length];
    // a DIFFERENT last world each time, so boot's own landing has to be overruled
    await p.evaluate((t) => { try { localStorage.setItem('atwe_last_tab', t); } catch (e) {} }, ['home', 'search', 'profile', 'chat'][i % 4]);
    await p.goto(BASE + url, { waitUntil: 'domcontentloaded' }); await booted(p); await settle(p, 900);
    const s = await snap(p);
    const exp = want[url] || url;
    if (s.path !== exp || !s.coherent || pushes(await p.evaluate(() => window.__nav.slice())).length) bad.push({ url, path: s.path, why: s.why });
  }
  say(bad.length === 0, `${tag} 60 cold boots onto deep links land where the URL says, coherent, no entry`, bad.slice(0, 4));
  await ctx.close();
  return bad;
}

(async () => {
  const pool = QA.newPool();
  const one = async (q, v) => (await pool.query(q, v)).rows[0];
  const tag8 = Math.random().toString(36).slice(2, 8);
  const fx = { tag: tag8 };
  fx.a = await QA.seedAccount(pool, { business: true, prefix: 'r8a', balanceCents: 50000 });
  fx.b = await QA.seedAccount(pool, { business: true, prefix: 'r8b' });
  fx.c = await QA.seedAccount(pool, { prefix: 'r8c' });
  fx.d = await QA.seedAccount(pool, { prefix: 'r8d' });
  fx.gone = await QA.seedAccount(pool, { prefix: 'r8g' });
  fx.mainMark = 'main-' + tag8; fx.threadMark = 'thread-' + tag8; fx.groupMark = 'group-' + tag8;
  fx.foreignMark = 'SECRET-cd-' + tag8; fx.foreignGroupMark = 'SECRET-grp-' + tag8; fx.goneMark = 'SECRET-gone-' + tag8;
  const [lo, hi] = fx.a.id < fx.b.id ? [fx.a.id, fx.b.id] : [fx.b.id, fx.a.id];
  fx.thread = (await one('INSERT INTO dm_threads (a, b, title, created_by) VALUES ($1,$2,$3,$4) RETURNING id', [lo, hi, 'Project ' + tag8, fx.a.id])).id;
  await pool.query('INSERT INTO at_messages (sender_id, recipient_id, body) VALUES ($1,$2,$3)', [fx.b.id, fx.a.id, fx.mainMark]);
  await pool.query('INSERT INTO at_messages (sender_id, recipient_id, body, thread_id) VALUES ($1,$2,$3,$4)', [fx.b.id, fx.a.id, fx.threadMark, fx.thread]);
  const [clo, chi] = fx.c.id < fx.d.id ? [fx.c.id, fx.d.id] : [fx.d.id, fx.c.id];
  fx.foreignThread = (await one('INSERT INTO dm_threads (a, b, title, created_by) VALUES ($1,$2,$3,$4) RETURNING id', [clo, chi, 'Private ' + tag8, fx.c.id])).id;
  await pool.query('INSERT INTO at_messages (sender_id, recipient_id, body, thread_id) VALUES ($1,$2,$3,$4)', [fx.c.id, fx.d.id, fx.foreignMark, fx.foreignThread]);
  // a deactivated account WITH history (the member's own) and one without: only the second is "nobody"
  fx.goneHist = await QA.seedAccount(pool, { prefix: 'r8h' });
  fx.goneHistMark = 'own-history-' + tag8;
  await pool.query('INSERT INTO at_messages (sender_id, recipient_id, body) VALUES ($1,$2,$3)', [fx.goneHist.id, fx.a.id, fx.goneHistMark]);
  await pool.query('INSERT INTO at_messages (sender_id, recipient_id, body) VALUES ($1,$2,$3)', [fx.gone.id, fx.d.id, fx.goneMark]);
  await pool.query('UPDATE users SET deactivated = true WHERE id = ANY($1)', [[fx.gone.id, fx.goneHist.id]]);
  fx.groupSlug = 'r8grp' + tag8;
  fx.group = (await one('INSERT INTO at_groups (name, created_by, username) VALUES ($1,$2,$3) RETURNING id', ['Route8 Group ' + tag8, fx.b.id, fx.groupSlug])).id;
  for (const u of [fx.a.id, fx.b.id]) await pool.query("INSERT INTO at_group_members (group_id, user_id, role) VALUES ($1,$2,$3)", [fx.group, u, u === fx.b.id ? 'admin' : 'member']);
  await pool.query('INSERT INTO at_group_messages (group_id, sender_id, body) VALUES ($1,$2,$3)', [fx.group, fx.b.id, fx.groupMark]);
  fx.foreignGroup = (await one('INSERT INTO at_groups (name, created_by) VALUES ($1,$2) RETURNING id', ['Closed ' + tag8, fx.c.id])).id;
  await pool.query('INSERT INTO at_group_members (group_id, user_id, role) VALUES ($1,$2,$3)', [fx.foreignGroup, fx.c.id, 'admin']);
  await pool.query('INSERT INTO at_group_messages (group_id, sender_id, body) VALUES ($1,$2,$3)', [fx.foreignGroup, fx.c.id, fx.foreignGroupMark]);
  await pool.query("INSERT INTO connections (requester_id, addressee_id, status) VALUES ($1,$2,'accepted')", [fx.a.id, fx.b.id]);
  fx.order = (await one("INSERT INTO orders (buyer_id, seller_id, status, total_cents) VALUES ($1,$2,'paid',800) RETURNING id", [fx.a.id, fx.b.id])).id;
  fx.service = (await one("INSERT INTO services (user_id, title, category) VALUES ($1,'Route8 tuning','Home') RETURNING id", [fx.b.id])).id;
  fx.showcase = (await one("INSERT INTO showcases (user_id, title) VALUES ($1,'Route8 showcase') RETURNING id", [fx.b.id])).id;
  await pool.query("INSERT INTO notifications (user_id, actor_id, type) VALUES ($1,$2,'message')", [fx.a.id, fx.b.id]);
  if (BREAK_KIND === 'leak') {
    // a server that ANSWERED the foreign thread: the real C-D conversation, fetched as C
    const r = await fetch(BASE + '/api/atchat/with/' + fx.d.id + '?thread=' + fx.foreignThread, { headers: { Authorization: 'Bearer ' + fx.c.token } });
    const body = await r.json(); body.peer = Object.assign({}, body.peer, { id: fx.b.id, username: fx.b.username });
    LEAK = { url: new RegExp('/api/atchat/with/' + fx.b.id + '\\?thread=' + fx.foreignThread + '$'), body: JSON.stringify(body) };
  }
  const seen = await QA.serverSees(fx.a.token);
  if (!seen.ok) { console.log('  FAIL fixture: the server does not see the seeded account (HTTP ' + seen.status + ')'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const t0 = Date.now();
  const run = (k) => !ONLY || ONLY.split(',').includes(k);
  try {
    for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      const tag = vp.width >= 1000 ? '[desktop]' : '[phone]';
      const { ctx, p, errs } = await newTab(browser, fx.a.token, vp, '/');
      if (run('A')) await roots(p, errs, tag);
      if (run('C')) await dms(p, errs, tag, fx);
      if (run('I')) await transients(p, errs, tag, fx);
      if (run('J')) await handoffs(p, errs, tag, fx);
      if (run('K')) await others(p, errs, tag, fx);
      say(errs.length === 0, `${tag} no JS errors over the whole run`, errs.slice(0, 3));
      await ctx.close();
      if (run('B')) await legacyRoots(browser, fx.a.token, vp, tag);
      if (run('D')) await directBeam(browser, fx.a.token, vp, tag, fx);
      if (run('P')) await privacy(browser, fx.a.token, vp, tag, fx);
      if (run('L') && vp.width < 1000) await loggedOut(browser, fx.a.token, vp, tag, fx);
      if (run('R') && vp.width < 1000) await bootRace(browser, fx.a.token, vp, tag, fx);
    }
    if (run('T')) {
      const tag = '[tablet]';
      const { ctx, p, errs } = await newTab(browser, fx.a.token, { width: 820, height: 1180 }, '/messages');
      let s = await snap(p);
      say(s.path === '/beam' && s.screen === 'acListScreen', `${tag} /messages lands on /beam`, s.path);
      await p.evaluate((id) => acDmRowTap(id, null), fx.b.id); await waitThread(p); await settle(p, 1200);
      s = await snap(p);
      say(s.path === '/beam/u/' + fx.b.username && s.screen === 'acThreadScreen' && s.coherent, `${tag} a conversation at /beam/u/<username>`, s.path);
      await back(p); s = await snap(p);
      say(s.path === '/beam', `${tag} Back returns to /beam`, s.path);
      await go(p, '/showcase/' + fx.showcase); await settle(p, 1400);
      s = await snap(p);
      say(s.path === '/showcase/' + fx.showcase && s.top === 'showcaseView', `${tag} /showcase/<id> direct`, s.path);
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
