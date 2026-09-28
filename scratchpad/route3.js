/* Route batch 3 — live history ownership.
 *
 *   B1     a profile or a post opened in-app is a REAL history entry (it used to replace
 *          the page underneath, so browser Back from a profile left Atwe).
 *   B2/B3  a listing / job / event sheet OWNS its address: /listing/<id> stays in the bar
 *          while it is open (it used to be overwritten by the browse surface's queued
 *          sync — Marketplace -> listing showed /marketplace — and a direct /listing/15
 *          collapsed to /).
 *   B9     /go is the shell route, never the profile @go.
 *
 * Owns its fixtures: a seller with a post, an active listing, a job and an event.
 *
 *   node route3.js          the checks, at 390x844 and 1440x900
 *   node route3.js --break  serves the page with B1 and B2 put back; must FAIL by name
 */
'use strict';
const path = require('path');
const QA = require(path.join(__dirname, 'qa-fixture.js'));
const { chromium } = require(process.env.PW_SCRATCH
  ? path.join(process.env.PW_SCRATCH, 'node_modules/playwright-core')
  : path.join(__dirname, 'node_modules/playwright-core'));

/* --break restores every shipped bug; --break=b1,b2,apply restores only the named ones. */
const BREAK_ARG = (process.argv.find((a) => a.startsWith('--break')) || '');
const BREAK = !!BREAK_ARG;
const BREAK_ONLY = BREAK_ARG.includes('=') ? BREAK_ARG.split('=')[1].split(',') : ['b1', 'b2', 'apply'];
const BASE = QA.base();
let pass = 0, fail = 0;
const say = (ok, what, extra) => { ok ? pass++ : fail++; console.log((ok ? '  ok   ' : '  FAIL ') + what + (extra !== undefined ? '   ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); };

/* --break: the shipped bugs, restored byte-for-byte from build 1874. */
const OLD = [
  ['b2', `  document.getElementById('listingView')._ownPath = acRoutePath('listing', { id }, '/listing/' + id);
  showOverlay('listingView');`, `  showOverlay('listingView');
  acSetPath('/listing/' + id); // shareable + reload-safe listing URL`],
  ['b1', `if (handle) acSetPath(acRoutePath('profile', { username: handle }, '/' + handle), { push: !_histRestoring });`,
   `if (handle) acSetPath('/' + handle);`],
  // the batch-3 restore fix: Back onto a panel's address used to leave the profile underneath
  ['apply', `    if (SELF_ROUTED_SCREENS.includes(_scr)) { try { appTab(_appTab && _appTab !== 'ai' ? _appTab : 'home'); } catch (e) {} }`,
   `    /* restore fix removed by --break */`],
];

async function api(token, method, p, body) {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(method + ' ' + p + ' → ' + r.status + ' ' + JSON.stringify(j));
  return j;
}

async function fixtures() {
  const pool = QA.newPool();
  const seller = await QA.seedAccount(pool, { business: true, prefix: 'r3s' });
  const viewer = await QA.seedAccount(pool, { prefix: 'r3v' });
  await pool.end();
  const post = await api(seller.token, 'POST', '/api/social/posts', { body: 'Route batch 3 fixture post ' + Date.now() });
  const prod = await api(seller.token, 'POST', '/api/products', { name: 'R3 chair', priceCents: 2500, kind: 'physical', shipFree: true, stock: 5 });
  const job = await api(seller.token, 'POST', '/api/jobs', { title: 'R3 designer', description: 'A fixture job for route batch 3.', location: 'Remote', remote: true });
  const start = new Date(Date.now() + 5 * 864e5).toISOString();
  const ev = await api(seller.token, 'POST', '/api/events', { title: 'R3 meetup', description: 'A fixture event.', startsAt: start, online: true, location: 'https://example.com' });
  const pick = (o, ...ks) => { for (const k of ks) { const v = k.split('.').reduce((a, b) => (a || {})[b], o); if (v) return v; } return null; };
  return {
    seller, viewer,
    postId: pick(post, 'post.id', 'id'), productId: pick(prod, 'product.id', 'id'),
    jobId: pick(job, 'job.id', 'id'), eventId: pick(ev, 'event.id', 'id'),
  };
}

async function freshPage(browser, token, viewport, first) {
  const ctx = await browser.newContext({ viewport });
  if (BREAK) {
    await ctx.route(/localhost:\d+\/[^.]*$/, async (route) => {
      if (route.request().resourceType() !== 'document') return route.continue();
      const res = await route.fetch();
      let html = await res.text();
      for (const [id, now, was] of OLD) {
        if (!BREAK_ONLY.includes(id)) continue;
        if (!html.includes(now)) throw new Error('--break: current code not found, the probe is stale');
        html = html.split(now).join(was);
      }
      await route.fulfill({ response: res, body: html, headers: { ...res.headers(), 'content-length': undefined } });
    });
  }
  const p = await ctx.newPage();
  const errs = [], profileHits = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('request', (r) => { if (/\/api\/(social|public)\/profile\/go(\b|$|\?)/i.test(r.url())) profileHits.push(r.url()); });
  await p.addInitScript((t) => {
    try { localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_intro_seen', JSON.stringify(['beam', 'circles', 'ai', 'wallet'])); } catch (e) {}
  }, token);
  await p.goto(BASE + (first || '/'), { waitUntil: 'domcontentloaded' });
  await QA.waitUntil(p, () => !!(window.S && S.user && S.user.id), null, 25000);
  await QA.waitUntil(p, () => window.AtweHistory && !AtweHistory.booting, null, 15000);
  await p.waitForTimeout(700);
  return { ctx, p, errs, profileHits };
}
const snap = (p) => p.evaluate(() => {
  // Off Atwe altogether (Back walked out of the app): say so as data, never crash.
  if (!window.AtweHistory) return { path: location.href, len: history.length, st: history.state, scr: null, offApp: true, events: 0 };
  const vis = (id) => { const e = document.getElementById(id); return !!e && !e.classList.contains('hidden') && !e.classList.contains('closing'); };
  const scr = ['acHomeScreen', 'acSearchScreen', 'acListScreen', 'acProfileScreen', 'acMeScreen', 'acPostViewScreen']
    .find((id) => { const e = document.getElementById(id); return e && !e.classList.contains('hidden'); }) || null;
  return { path: location.pathname, len: history.length, st: history.state, scr,
    listing: vis('listingView'), job: vis('jobView'), event: vis('eventView'), mkt: vis('marketplaceView'), evs: vis('eventsList'),
    events: AtweHistory.log.length };
});
const evSince = (p, n) => p.evaluate((k) => (window.AtweHistory ? AtweHistory.log.slice(k) : []), n);
const settle = (p, ms) => p.waitForTimeout(ms || 1100);
const owned = (s) => !!(s && s.atwe === 2 && Number.isInteger(s.idx));
const pathOk = (s) => !!s.st && s.st.path === s.path;
const back = async (p) => { await p.goBack({ timeout: 6000 }).catch(() => {}); await settle(p, 1300); };
const fwd = async (p) => { await p.goForward({ timeout: 6000 }).catch(() => {}); await settle(p, 1300); };
const reload = async (p) => {
  await p.reload({ waitUntil: 'domcontentloaded' });
  await QA.waitUntil(p, () => !!(window.S && S.user && S.user.id), null, 25000);
  await QA.waitUntil(p, () => window.AtweHistory && !AtweHistory.booting, null, 15000);
  await settle(p, 1400);
};

/* One in-app open of an entity sheet from its browse surface, then refresh/Back/Forward. */
async function entityJourney(browser, F, vp, tag, spec) {
  const { ctx, p, errs } = await freshPage(browser, F.viewer.token, vp);
  await p.evaluate(spec.openBrowse); await settle(p);
  const a = await snap(p);
  say(a.path === spec.browsePath, tag + ' ' + spec.label + ': the browse surface is on its own address first', a.path);
  await p.evaluate(spec.openEntity, spec.id); await settle(p);
  await p.waitForTimeout(1600);   // long enough for any queued parent sync to have landed
  const b = await snap(p);
  const evs = await evSince(p, a.events);
  const want = '/' + spec.kind + '/' + spec.id;
  say(b.path === want && b[spec.flag], tag + ' ' + spec.label + ': opening it shows ' + want + ' and it stays there', [b.path, b[spec.flag]]);
  say(b.len === a.len + 1, tag + ' ' + spec.label + ': the open adds exactly ONE history entry', [a.len, b.len]);
  const nav = evs.filter((e) => e.kind === 'push' || e.kind === 'root-change' || e.kind === 'replace');
  say(nav.length === 1 && nav[0].kind === 'push' && nav[0].to.path === want && nav[0].direction === 'forward',
    tag + ' ' + spec.label + ': exactly one NavEvent, a forward push to ' + want, nav.map((e) => [e.kind, e.to && e.to.path]));
  say(owned(b.st) && b.st.idx === a.st.idx + 1 && pathOk(b) && b.st.route === spec.kind,
    tag + ' ' + spec.label + ': a new idx, path = URL, route = ' + spec.kind, b.st);
  await reload(p);
  const c = await snap(p);
  say(c.path === want && c[spec.flag] && c.len === b.len, tag + ' ' + spec.label + ': refresh restores it with no new entry', [c.path, c[spec.flag], b.len, c.len]);
  await back(p);
  const d = await snap(p);
  const ev = (await evSince(p, 0)).reverse().find((e) => e.kind === 'traverse');
  say(d.path === spec.browsePath && !d[spec.flag], tag + ' ' + spec.label + ': browser Back returns to ' + spec.browsePath + ' and closes it', [d.path, d[spec.flag]]);
  say(ev && ev.direction === 'back', tag + ' ' + spec.label + ': ...reported as back', ev && ev.direction);
  await fwd(p);
  const e2 = await snap(p);
  const ev2 = (await evSince(p, 0)).reverse().find((e) => e.kind === 'traverse');
  say(e2.path === want && e2[spec.flag], tag + ' ' + spec.label + ': browser Forward reopens it', [e2.path, e2[spec.flag]]);
  say(ev2 && ev2.direction === 'forward', tag + ' ' + spec.label + ': ...reported as forward', ev2 && ev2.direction);
  say(errs.length === 0, tag + ' ' + spec.label + ': no JS errors', errs.slice(0, 2));
  await ctx.close();
}

async function directEntity(browser, F, vp, tag, kind, id, flag) {
  const want = '/' + kind + '/' + id;
  const { ctx, p, errs } = await freshPage(browser, F.viewer.token, vp, want);
  await p.waitForTimeout(1600);
  const a = await snap(p);
  say(a.path === want && a[flag] && a.len === 2, tag + ' direct ' + want + ' opens it, keeps the address, ONE entry', [a.path, a[flag], a.len]);
  await reload(p);
  const b = await snap(p);
  say(b.path === want && b[flag] && b.len === 2, tag + ' direct ' + want + ' survives a refresh', [b.path, b[flag], b.len]);
  await p.goBack({ timeout: 6000 }).catch(() => {});
  await p.waitForTimeout(800);
  say(!/localhost/.test(p.url()), tag + ' direct ' + want + ': browser Back leaves Atwe (no fabricated entry behind a link)', p.url());
  say(errs.length === 0, tag + ' direct ' + want + ': no JS errors', errs.slice(0, 2));
  await ctx.close();
}

async function run(browser, F, vp) {
  const tag = vp.width >= 1000 ? '[desktop]' : '[phone]';
  const U = F.seller.username;

  /* 1/2. Home -> profile -> Back -> Forward */
  {
    const { ctx, p, errs } = await freshPage(browser, F.viewer.token, vp);
    const a = await snap(p);
    await p.evaluate((u) => acGoProfile(u), U); await settle(p);
    const b = await snap(p);
    const evs = await evSince(p, a.events);
    say(b.path === '/' + U && b.scr === 'acProfileScreen', tag + ' 1. opening a profile shows /' + U, [b.path, b.scr]);
    say(b.len === a.len + 1 && owned(b.st) && b.st.idx === a.st.idx + 1 && pathOk(b) && b.st.route === 'profile',
      tag + ' 1b. ...as ONE new entry: new idx, path = URL, route = profile', [a.len, b.len, b.st]);
    const nav = evs.filter((e) => ['push', 'replace', 'root-change'].includes(e.kind));
    say(nav.length === 1 && nav[0].kind === 'push', tag + ' 1c. exactly one NavEvent for the open (a push)', nav.map((e) => e.kind));
    await back(p);
    const c = await snap(p);
    const ev = (await evSince(p, 0)).reverse().find((e) => e.kind === 'traverse');
    say(c.path === '/' && c.scr === 'acHomeScreen', tag + ' 1d. browser Back returns to Home, inside Atwe', [c.path, c.scr]);
    say(ev && ev.direction === 'back' && ev.delta === -1, tag + ' 1e. ...reported as back, delta -1', ev && [ev.direction, ev.delta]);
    await fwd(p);
    const d = await snap(p);
    const ev2 = (await evSince(p, 0)).reverse().find((e) => e.kind === 'traverse');
    say(d.path === '/' + U && d.scr === 'acProfileScreen', tag + ' 2. browser Forward returns to the profile', [d.path, d.scr]);
    say(ev2 && ev2.direction === 'forward', tag + ' 2b. ...reported as forward', ev2 && ev2.direction);

    /* 4/3. profile -> post -> author profile -> Back -> Back */
    const e0 = await snap(p);
    await p.evaluate((id) => acOpenPostView(id), F.postId); await settle(p, 1500);
    const e1 = await snap(p);
    const evp = (await evSince(p, e0.events)).filter((e) => ['push', 'replace', 'root-change'].includes(e.kind));
    const postPath = '/' + U + '/post/' + F.postId;
    say(e1.path === postPath && e1.scr === 'acPostViewScreen', tag + ' 4. opening a post from the profile shows ' + postPath, [e1.path, e1.scr]);
    say(e1.len === e0.len + 1 && e1.st.idx === e0.st.idx + 1 && e1.st.route === 'post' && pathOk(e1), tag + ' 4b. ...as ONE new entry, route = post', [e0.len, e1.len, e1.st]);
    say(evp.length === 1 && evp[0].kind === 'push', tag + ' 4c. exactly one NavEvent for the post open (its author was already known)', evp.map((e) => e.kind));
    await p.evaluate((u) => acGoProfile(u), U); await settle(p);
    const e2 = await snap(p);
    say(e2.path === '/' + U && e2.len === e1.len + 1, tag + ' 3. post -> author profile is its own entry', [e2.path, e1.len, e2.len]);
    await back(p);
    const e3 = await snap(p);
    say(e3.path === postPath && e3.scr === 'acPostViewScreen', tag + ' 3b. Back from the author returns to the post', [e3.path, e3.scr]);
    await back(p);
    const e4 = await snap(p);
    say(e4.path === '/' + U && e4.scr === 'acProfileScreen', tag + ' 4d. Back from the post returns to the profile', [e4.path, e4.scr]);
    say(errs.length === 0, tag + ' 1-4. no JS errors', errs.slice(0, 2));
    await ctx.close();
  }

  /* 5. direct profile + refresh, and Back leaves */
  {
    const { ctx, p, errs } = await freshPage(browser, F.viewer.token, vp, '/' + U);
    const a = await snap(p);
    say(a.path === '/' + U && a.scr === 'acProfileScreen' && a.len === 2, tag + ' 5. direct /' + U + ' opens the profile in ONE entry', [a.path, a.scr, a.len]);
    await reload(p);
    const b = await snap(p);
    say(b.path === '/' + U && b.scr === 'acProfileScreen' && b.len === 2, tag + ' 5b. ...and a refresh rebuilds it from the URL', [b.path, b.scr, b.len]);
    await p.goBack({ timeout: 6000 }).catch(() => {}); await p.waitForTimeout(800);
    say(!/localhost/.test(p.url()), tag + ' 5c. direct profile: browser Back leaves Atwe', p.url());
    say(errs.length === 0, tag + ' 5. no JS errors', errs.slice(0, 2));
    await ctx.close();
  }
  /* 6. direct post + refresh */
  {
    const postPath = '/' + U + '/post/' + F.postId;
    const { ctx, p, errs } = await freshPage(browser, F.viewer.token, vp, postPath);
    await p.waitForTimeout(1200);
    const a = await snap(p);
    say(a.path === postPath && a.scr === 'acPostViewScreen' && a.len === 2, tag + ' 6. direct ' + postPath + ' opens the post in ONE entry', [a.path, a.scr, a.len]);
    await reload(p);
    const b = await snap(p);
    say(b.path === postPath && b.scr === 'acPostViewScreen' && b.len === 2, tag + ' 6b. ...and a refresh rebuilds it', [b.path, b.scr, b.len]);
    say(errs.length === 0, tag + ' 6. no JS errors', errs.slice(0, 2));
    await ctx.close();
  }

  /* 7b. panel -> (real control) seller profile -> browser Back: the panel comes back and the
     profile screen does NOT stay underneath it. B1 made the profile a real entry, so Back now
     lands on the panel's own address; the screen under it must be the world's, not the profile. */
  {
    const { ctx, p, errs } = await freshPage(browser, F.viewer.token, vp);
    await p.evaluate(() => acOpenMarketplace());
    await QA.waitUntil(p, () => { const b = document.getElementById('marketplaceBody'); return !!b && /mkt-head|ac-listing/.test(b.innerHTML); }, null, 20000);
    await settle(p, 600);
    await p.evaluate(() => { const h = document.querySelector('#marketplaceView .mkt-head'); if (h) h.click(); });
    await settle(p, 1600);
    const a = await snap(p);
    say(a.scr === 'acProfileScreen' && !a.mkt, tag + ' 7b. Marketplace -> seller profile (the real control)', [a.scr, a.path]);
    await back(p);
    const b = await snap(p);
    say(b.path === '/marketplace' && b.mkt, tag + ' 7c. browser Back reopens the Marketplace on /marketplace', [b.path, b.mkt]);
    say(b.scr !== 'acProfileScreen', tag + ' 7d. ...with the world\'s screen underneath, not the profile', b.scr);
    say(errs.length === 0, tag + ' 7e. no JS errors', errs.slice(0, 2));
    await ctx.close();
  }

  /* 7-16. listing, job, event from their browse surfaces */
  await entityJourney(browser, F, vp, tag, { label: 'listing', kind: 'listing', id: F.productId, flag: 'listing', browsePath: '/marketplace',
    openBrowse: () => acOpenMarketplace(), openEntity: (id) => acOpenListing(id) });
  await entityJourney(browser, F, vp, tag, { label: 'job', kind: 'job', id: F.jobId, flag: 'job', browsePath: '/jobs',
    openBrowse: () => acOpenJobsView(), openEntity: (id) => acOpenJob(id) });
  await entityJourney(browser, F, vp, tag, { label: 'event', kind: 'event', id: F.eventId, flag: 'event', browsePath: '/events',
    openBrowse: () => acOpenEvents(), openEntity: (id) => acOpenEvent(id) });
  await directEntity(browser, F, vp, tag, 'listing', F.productId, 'listing');
  await directEntity(browser, F, vp, tag, 'job', F.jobId, 'job');
  await directEntity(browser, F, vp, tag, 'event', F.eventId, 'event');

  /* 17/18. /go is the shell, a real username still resolves, an unknown one still says so */
  for (const g of ['/go', '/GO', '/go?check=1']) {
    const { ctx, p, errs, profileHits } = await freshPage(browser, F.viewer.token, vp, g);
    await p.waitForTimeout(1200);
    const a = await snap(p);
    say(a.scr !== 'acProfileScreen' && a.scr === 'acHomeScreen' && profileHits.length === 0,
      tag + ' 17. ' + g + ' opens Home and never loads a profile named "go"', [a.scr, a.path, profileHits]);
    say(a.path === '/', tag + ' 17b. ' + g + ' settles on the canonical /', a.path);
    say(errs.length === 0, tag + ' 17c. ' + g + ': no JS errors', errs.slice(0, 2));
    await ctx.close();
  }
  {
    const { ctx, p, errs } = await freshPage(browser, F.viewer.token, vp, '/' + U);
    const a = await snap(p);
    say(a.scr === 'acProfileScreen' && a.path === '/' + U, tag + ' 18. an ordinary username still resolves to its profile', [a.scr, a.path]);
    await ctx.close();
    const n = await freshPage(browser, F.viewer.token, vp, '/nosuchuser' + Date.now().toString(36));
    const b = await snap(n.p);
    say(b.scr === 'acProfileScreen' && n.errs.length === 0, tag + ' 18b. an unknown username still lands on the profile screen\'s own not-found state', [b.scr, n.errs.slice(0, 1)]);
    await n.ctx.close();
  }

  /* 19. a v1 (build 1861) entry behind a new one: Back is "unknown", and the right page shows */
  {
    const { ctx, p, errs } = await freshPage(browser, F.viewer.token, vp);
    await p.evaluate(() => history.replaceState({ atwe: 1, path: location.pathname }, ''));
    await p.evaluate((u) => acGoProfile(u), U); await settle(p);
    await back(p);
    const a = await snap(p);
    const ev = (await evSince(p, 0)).reverse().find((e) => e.kind === 'traverse');
    say(ev && ev.direction === 'unknown' && a.path === '/' && a.scr === 'acHomeScreen', tag + ' 19. Back onto a v1 entry: direction unknown, Home still shows', [ev && ev.direction, a.path, a.scr]);
    say(errs.length === 0, tag + ' 19b. no JS errors', errs.slice(0, 2));
    await ctx.close();
  }
}

(async () => {
  const F = await fixtures();
  if (!F.postId || !F.productId || !F.jobId || !F.eventId) throw new Error('fixtures incomplete: ' + JSON.stringify(F));
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  try {
    for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) await run(browser, F, vp);
  } finally { await browser.close(); }
  console.log(`\n${pass} passed, ${fail} FAILED${BREAK ? '   (--break: failures expected)' : ''}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
