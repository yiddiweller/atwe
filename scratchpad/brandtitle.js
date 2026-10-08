/* Build 1878: the browser tab and Google say "Atwe".
 *
 * Real app, real browser, real server, real unread data:
 *   1. the tab reads exactly "Atwe" with no unread, with unread notifications and with unread
 *      Beam messages, across Home, Beam, Engine, Notifications, Account, Settings, an Account
 *      tool, a profile and a post, through Back, Forward and reload, and on a direct load of
 *      each; the app never writes the title at all, and the installed-app icon badge still
 *      gets the unread total;
 *   2. the in-app unread badges (the bell, the Beam count) still work;
 *   3. in the app, a public page keeps its own canonical and a private page never overwrites it;
 *   4. as Googlebot (atwe.com mapped to this server): the home page's canonical and og:url stay
 *      https://atwe.com/ after the sign-in screen rewrites the address to /login; the WebSite
 *      and Organization schema; profile, post and browse pages keep their own canonical;
 *   5. over HTTP: the home page is indexable; the three legal documents are 200, readable and
 *      noindex but NOT blocked by robots.txt; every admin.atwe.com response is noindex; the
 *      statuses and redirects are unchanged.
 *
 * Self-tests, both of which must FAIL by name:
 *   node brandtitle.js --break              serves the build-1877 tab title, canonical and schema
 *                                           inside the page (the server half still passes);
 *   BASE=<a build-1877 server> node brandtitle.js   the whole probe against the old server. */
'use strict';
const { chromium } = require('./node_modules/playwright-core');
const QA = require('./qa-fixture');

const BASE = QA.base();
const PORT = new URL(BASE).port || '80';
const BREAK = process.argv.includes('--break');
const APPROVED = 'The network built for business. Connect, message, hire, sell and grow, all in one place.';
const GOOGLEBOT = 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const GOOGLEBOT_DESKTOP = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/130.0.0.0 Safari/537.36';
const PERSON = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

let pass = 0, fail = 0;
const say = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 320) : '')); } };

/* ── --break: the build-1877 behaviour, put back inside the served page ──────────────── */
const OLD_TITLE = [
  'function acRouteTitle() {',
  '  try {',
  '    const m = window.ATWE_ROUTES && ATWE_ROUTES.match(location.pathname);',
  '    const r = m && ATWE_ROUTES.get(m.name);',
  "    return r && r.title ? i18nT(r.title) : '';",
  "  } catch (e) { return ''; }",
  '}',
  'function acSyncTabTitle() {',
  '  const total = (AC._tabMsgUnread || 0) + (AC._notifUnread || 0);',
  '  const rt = acRouteTitle();',
  "  const base = rt ? rt + ' · Atwe' : 'Atwe';",
  "  const t = total > 0 ? `(${total > 99 ? '99+' : total}) ${base}` : base;",
  '  if (document.title !== t) document.title = t;',
  '  try {',
  "    if ('setAppBadge' in navigator) { if (total > 0) navigator.setAppBadge(total).catch(() => {}); else navigator.clearAppBadge().catch(() => {}); }",
  '  } catch (_) {}',
  '}',
  '',
].join('\n');
const NEW_SITE = '{"@context":"https://schema.org","@type":"WebSite","name":"Atwe","url":"https://atwe.com/"}';
const OLD_SITE = '{"@context":"https://schema.org","@type":"WebSite","name":"Atwe","alternateName":["atwe.com","Atwe.com","www.atwe.com"],"url":"https://atwe.com/"}';
const NEW_ORG = '{"@context":"https://schema.org","@type":"Organization","name":"Atwe","legalName":"Atwe Inc.","url":"https://atwe.com/","logo":"https://atwe.com/icon-384.png"}';
const OLD_ORG = '{"@context":"https://schema.org","@type":"Organization","name":"Atwe","url":"https://atwe.com/","logo":"https://atwe.com/icon-384.png"}';
const GATE = '    if (!acCanonicalIndexable(path)) return;\n';
let breakApplied = null;
function breakShell(body) {
  const once = (s, needle) => s.split(needle).length === 2;
  const ok = /function acSyncTabTitle\(\) \{[\s\S]*?\n\}\n/.test(body) && once(body, GATE) && once(body, NEW_SITE) && once(body, NEW_ORG);
  if (breakApplied === null) breakApplied = ok;
  if (!ok) return body;
  return body.replace(/function acSyncTabTitle\(\) \{[\s\S]*?\n\}\n/, () => OLD_TITLE)
    .split(GATE).join('').split(NEW_SITE).join(OLD_SITE).split(NEW_ORG).join(OLD_ORG);
}

/* Every app write to document.title, and every icon-badge call, recorded from the first byte. */
function recorder() {
  const d = Object.getOwnPropertyDescriptor(Document.prototype, 'title');
  window.__titleWrites = [];
  Object.defineProperty(Document.prototype, 'title', { configurable: true, get() { return d.get.call(this); },
    set(v) { window.__titleWrites.push(String(v)); d.set.call(this, v); } });
  window.__badge = [];
  navigator.setAppBadge = (n) => { window.__badge.push(['set', n]); return Promise.resolve(); };
  navigator.clearAppBadge = () => { window.__badge.push(['clear']); return Promise.resolve(); };
}

async function context(br, { ua, viewport = { width: 390, height: 844 }, token, mapped = false } = {}) {
  const c = await br.newContext({ userAgent: ua, viewport, serviceWorkers: 'block',
    extraHTTPHeaders: mapped ? { 'X-Forwarded-Proto': 'https' } : {} });
  await c.addInitScript(recorder);
  if (token) await c.addInitScript((t) => { try { localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_intro_seen', JSON.stringify(['beam', 'circles', 'ai', 'wallet'])); } catch (e) {} }, token);
  const own = mapped ? (h) => h === 'atwe.com' : (h) => h === 'localhost' || h === '127.0.0.1';
  await c.route('**/*', async (route) => {
    const req = route.request();
    if (!own(new URL(req.url()).hostname)) return route.abort();
    if (!BREAK || req.resourceType() !== 'document') return route.continue();
    /* route.fetch() runs in Node, NOT in the browser, so it never sees --host-resolver-rules:
       left alone it would resolve the real atwe.com (and get the network proxy's 403). Send it
       to this server explicitly, as the host the page believes it is on. */
    const u = new URL(req.url());
    const r = mapped
      ? await route.fetch({ url: BASE + u.pathname + u.search, headers: { ...req.headers(), host: 'atwe.com', 'x-forwarded-proto': 'https' } })
      : await route.fetch();
    return route.fulfill({ response: r, body: breakShell(await r.text()) });
  });
  return c;
}

const signedIn = () => { try { return !!(S && S.user && S.user.id); } catch (e) { return false; } };
const snap = (p) => p.evaluate(() => {
  const cls = (id, c) => { const e = document.getElementById(id); return !!(e && e.classList.contains(c)); };
  const txt = (id) => { const e = document.getElementById(id); return e && !e.classList.contains('hidden') ? e.textContent.trim() : null; };
  let notif = null, msg = null; try { notif = AC._notifUnread; msg = AC._tabMsgUnread; } catch (e) {}
  return { path: location.pathname, title: document.title, writes: (window.__titleWrites || []).slice(), badge: (window.__badge || []).slice(),
    notif, msg, bellBlue: cls('bnav-notifs', 'bn-notif'), bellDot: !cls('tbHomeBellDot', 'hidden'), notifRow: txt('notifBadge'),
    beamCount: txt('acBadgeNav'), canonical: [...document.querySelectorAll('link[rel="canonical"]')].map((l) => l.getAttribute('href')),
    ogUrl: (document.querySelector('meta[property="og:url"]') || {}).content || null };
});
const head = (html) => html.slice(0, html.indexOf('</head>'));
const canonOf = (html) => [...head(html).matchAll(/<link rel="canonical" href="([^"]*)"/gi)].map((m) => m[1]);
const metaOf = (html, k) => [...head(html).matchAll(new RegExp(`<meta\\s+(?:name|property)="${k}"\\s+content="([^"]*)"`, 'gi'))].map((m) => m[1]);

(async () => {
  const cfg = await fetch(BASE + '/api/config').then((r) => r.json()).catch(() => ({}));
  console.log(`server ${BASE} reports build ${cfg.build}${BREAK ? '   (--break: build-1877 tab title, canonical and schema served inside the page)' : ''}`);

  /* ── fixtures: a reader with unread notifications and messages, a quiet reader, an author ── */
  const pool = QA.newPool();
  const A = await QA.seedAccount(pool, { prefix: 'brandrd' });
  const C = await QA.seedAccount(pool, { prefix: 'brandqt' });
  const B = await QA.seedAccount(pool, { business: true, prefix: 'brandau' });
  await pool.query("UPDATE users SET name = 'Brand Probe Bakery' WHERE id = $1", [B.id]);
  await QA.assertServerSees(A.token, A.username);
  await QA.assertServerSees(C.token, C.username);
  const postId = (await pool.query("INSERT INTO posts (user_id, body) VALUES ($1, 'A public post for the brand probe') RETURNING id", [B.id])).rows[0].id;
  for (const t of ['follow', 'mention', 'follow']) await pool.query('INSERT INTO notifications (user_id, actor_id, type) VALUES ($1, $2, $3)', [A.id, B.id, t]);
  for (const b of ['first unread', 'second unread']) await pool.query('INSERT INTO at_messages (sender_id, recipient_id, body) VALUES ($1, $2, $3)', [B.id, A.id, b]);
  const b = B.username.toLowerCase();

  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());

  /* ── 1. the tab, signed in ─────────────────────────────────────────────────────────── */
  console.log('\nthe browser tab');
  {
    const c = await context(br, { ua: PERSON, token: C.token });
    const p = await c.newPage();
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await QA.waitUntil(p, signedIn, null, 20000); await p.waitForTimeout(2500);
    const s = await snap(p);
    say(s.notif === 0 && s.msg === 0, '1. the quiet reader really has nothing unread', [s.notif, s.msg]);
    say(s.title === 'Atwe' && s.writes.length === 0, '1. with nothing unread the tab reads exactly "Atwe" (and the app never wrote it)', [s.title, s.writes]);
    await c.close();
  }
  const c = await context(br, { ua: PERSON, token: A.token });
  const p = await c.newPage();
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await QA.waitUntil(p, signedIn, null, 20000);
  await QA.waitUntil(p, () => { try { return AC._notifUnread > 0 && AC._tabMsgUnread > 0; } catch (e) { return false; } }, null, 15000);
  let s = await snap(p);
  say(s.notif > 0, '2. the reader has unread notifications', s.notif);
  say(s.title === 'Atwe', '2. with unread notifications the tab still reads exactly "Atwe"', s.title);
  say(s.msg > 0, '3. the reader has unread Beam messages', s.msg);
  say(s.title === 'Atwe' && s.writes.length === 0, '3. with unread messages the tab still reads exactly "Atwe", never written', [s.title, s.writes]);
  say(s.path === '/' && s.title === 'Atwe', '4. Home (/): the tab reads exactly "Atwe"', [s.path, s.title]);
  say(s.bellBlue && s.bellDot && s.notifRow === String(s.notif), '5. the in-app bell turns blue and the Notifications row shows the count', [s.bellBlue, s.bellDot, s.notifRow, s.notif]);
  say(s.beamCount === String(s.msg), '5. the in-app Beam badge shows the message count', [s.beamCount, s.msg]);
  say(s.badge.some((x) => x[0] === 'set' && x[1] === s.notif + s.msg), '5. the installed-app icon badge still gets the unread total (unchanged)', s.badge.slice(-4));

  const steps = [
    ['Beam', () => appTab('chat'), '/beam'],
    ['Engine', () => appTab('search'), '/engine'],
    ['Notifications', () => acNavNotifs(), '/notifications'],
    ['Account', () => appTab('profile'), '/account'],
    ['Settings', () => openSettings(), '/settings'],
    ['a Settings page', () => setNav('privacy'), '/settings/privacy'],
    ['an Account tool (Wallet)', () => acNavGo('/account/wallet'), '/account/wallet'],
    ['a profile', (u) => acGoProfile(u), '/' + b, B.username],
    ['a post', (id) => acOpenPostView(id), '/' + b + '/post/' + postId, postId],
  ];
  for (const [name, fn, want, arg] of steps) {
    await p.evaluate(fn, arg);
    await QA.waitUntil(p, (w) => location.pathname === w, want, 10000); await p.waitForTimeout(700);
    s = await snap(p);
    say(s.path === want && s.title === 'Atwe' && s.writes.length === 0, `4. ${name} (${want}): the tab reads exactly "Atwe"`, [s.path, s.title, s.writes]);
  }
  for (let i = 1; i <= 3; i++) {
    const before = (await snap(p)).path;
    await p.goBack(); await p.waitForTimeout(1300);
    s = await snap(p);
    say(s.path !== before && s.title === 'Atwe' && s.writes.length === 0, `4. Back ${i} (${before} -> ${s.path}): "Atwe"`, [s.title, s.writes]);
  }
  for (let i = 1; i <= 2; i++) {
    const before = (await snap(p)).path;
    await p.goForward(); await p.waitForTimeout(1300);
    s = await snap(p);
    say(s.path !== before && s.title === 'Atwe' && s.writes.length === 0, `4. Forward ${i} (${before} -> ${s.path}): "Atwe"`, [s.title, s.writes]);
  }
  await p.reload({ waitUntil: 'domcontentloaded' }); await QA.waitUntil(p, signedIn, null, 20000); await p.waitForTimeout(2000);
  s = await snap(p);
  say(s.title === 'Atwe' && s.writes.length === 0, `4. reload on ${s.path}: "Atwe"`, [s.title, s.writes]);
  for (const path of ['/beam', '/engine', '/notifications', '/account', '/settings/privacy', '/account/wallet', '/' + b, '/' + b + '/post/' + postId]) {
    await p.goto(BASE + path, { waitUntil: 'domcontentloaded' }); await QA.waitUntil(p, signedIn, null, 20000); await p.waitForTimeout(1800);
    s = await snap(p);
    say(s.title === 'Atwe' && s.writes.length === 0, `4. direct load of ${path}: "Atwe"`, [s.path, s.title, s.writes]);
  }

  /* ── 5. the in-app badges still move, through the app's own sinks, with real data ─── */
  console.log('\nin-app unread');
  {
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await QA.waitUntil(p, signedIn, null, 20000);
    await QA.waitUntil(p, () => { try { return AC._tabMsgUnread > 0; } catch (e) { return false; } }, null, 15000);
    const s0 = await snap(p);
    await pool.query("INSERT INTO at_messages (sender_id, recipient_id, body) VALUES ($1, $2, 'a third unread')", [B.id, A.id]);
    await pool.query("INSERT INTO notifications (user_id, actor_id, type) VALUES ($1, $2, 'follow'), ($1, $2, 'mention')", [A.id, B.id]);
    await p.evaluate(() => Promise.all([acRefreshUnread(true), refreshNotifCount()]));
    await QA.waitUntil(p, (m) => { try { return AC._tabMsgUnread > m; } catch (e) { return false; } }, s0.msg, 10000);
    const s1 = await snap(p);
    say(s1.msg > s0.msg && s1.beamCount === String(s1.msg), '5. a new message raises the Beam badge', [s0.msg, s1.msg, s1.beamCount]);
    say(s1.notif > s0.notif && s1.notifRow === String(s1.notif) && s1.bellBlue, '5. new notifications raise the bell and the Notifications row', [s0.notif, s1.notif, s1.notifRow]);
    say(s1.title === 'Atwe' && s1.writes.length === 0, '5. ...and the tab still reads exactly "Atwe"', [s1.title, s1.writes]);
  }

  /* ── canonical inside the app: public pages keep theirs, private pages never take over ─ */
  console.log('\ncanonical in the app');
  {
    const canon = async () => (await snap(p)).canonical;
    await p.evaluate((u) => acGoProfile(u), B.username); await QA.waitUntil(p, (w) => location.pathname === w, '/' + b, 10000); await p.waitForTimeout(600);
    say(JSON.stringify(await canon()) === JSON.stringify([BASE + '/' + b]), '14. a public profile carries its own canonical', await canon());
    await p.evaluate(() => appTab('chat')); await QA.waitUntil(p, () => location.pathname === '/beam', null, 10000); await p.waitForTimeout(600);
    say(JSON.stringify(await canon()) === JSON.stringify([BASE + '/' + b]), 'Beam (private) leaves the profile\'s canonical alone', await canon());
    await p.evaluate(() => openSettings()); await QA.waitUntil(p, () => location.pathname === '/settings', null, 10000); await p.waitForTimeout(600);
    say(JSON.stringify(await canon()) === JSON.stringify([BASE + '/' + b]), 'Settings (private) leaves it alone too', await canon());
    await p.evaluate((id) => { closeOverlay('settingsOverlay', true); acOpenPostView(id); }, postId);
    await QA.waitUntil(p, (w) => location.pathname === w, '/' + b + '/post/' + postId, 10000); await p.waitForTimeout(700);
    say(JSON.stringify(await canon()) === JSON.stringify([BASE + '/' + b + '/post/' + postId]), '14. a public post carries its own canonical', await canon());
    await p.evaluate(() => acNavGo('/account/wallet')); await QA.waitUntil(p, () => location.pathname === '/account/wallet', null, 10000); await p.waitForTimeout(600);
    const s2 = await snap(p);
    say(JSON.stringify(s2.canonical) === JSON.stringify([BASE + '/' + b + '/post/' + postId]) && s2.ogUrl === BASE + '/' + b + '/post/' + postId,
      'the Wallet (private) never overwrites the post\'s canonical or og:url', [s2.canonical, s2.ogUrl]);
  }
  await c.close();

  /* ── as Googlebot: atwe.com mapped to this server, so the page runs under its real host ── */
  console.log('\nas Google sees it (atwe.com -> ' + BASE + ')');
  const gb = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-proxy-server', `--host-resolver-rules=MAP atwe.com 127.0.0.1:${PORT}`] })
    .catch(() => chromium.launch({ args: ['--no-proxy-server', `--host-resolver-rules=MAP atwe.com 127.0.0.1:${PORT}`] }));
  const renderAs = async (ua, path, viewport, waitLogin) => {
    const cx = await context(gb, { ua, viewport, mapped: true });
    const pg = await cx.newPage();
    const resp = await pg.goto('http://atwe.com' + path, { waitUntil: 'load', timeout: 60000 });
    const raw = await resp.text();
    if (waitLogin) await QA.waitUntil(pg, () => location.pathname === '/login' && !document.getElementById('loginOverlay').classList.contains('hidden'), null, 20000);
    await pg.waitForTimeout(3500);
    const r = await pg.evaluate(() => ({
      path: location.pathname, title: document.title,
      canonical: [...document.querySelectorAll('link[rel="canonical"]')].map((l) => l.getAttribute('href')),
      ogUrl: (document.querySelector('meta[property="og:url"]') || {}).content || null,
      robots: [...document.querySelectorAll('meta[name="robots"]')].map((m) => m.content),
      description: (document.querySelector('meta[name="description"]') || {}).content || null,
      ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((x) => { try { return JSON.parse(x.textContent); } catch (e) { return null; } }),
    }));
    await cx.close();
    return { status: resp.status(), raw, ...r };
  };
  {
    const h = await renderAs(GOOGLEBOT, '/', { width: 412, height: 915 }, true);
    say(h.status === 200 && JSON.stringify(canonOf(h.raw)) === '["https://atwe.com/"]', '6. home page raw HTML canonical: https://atwe.com/', canonOf(h.raw));
    say(h.path === '/login', 'the sign-in screen still rewrites the visible address to /login (UX unchanged)', h.path);
    say(JSON.stringify(h.canonical) === '["https://atwe.com/"]', '7. home page RENDERED canonical as signed-out Googlebot: https://atwe.com/', h.canonical);
    say(h.ogUrl === 'https://atwe.com/', '8. home page og:url stays https://atwe.com/', h.ogUrl);
    say(h.title === 'Atwe' && h.robots.length === 0, 'the rendered home page is titled "Atwe" and carries no robots tag', [h.title, h.robots]);
    const site = h.ld.filter((x) => x && x['@type'] === 'WebSite'), org = h.ld.filter((x) => x && x['@type'] === 'Organization');
    say(site.length === 1 && site[0].name === 'Atwe' && site[0].url === 'https://atwe.com/' && !('alternateName' in site[0]), '9. WebSite schema: name Atwe, url https://atwe.com/, no alternateName', site);
    say(org.length === 1 && org[0].name === 'Atwe' && org[0].legalName === 'Atwe Inc.' && org[0].url === 'https://atwe.com/', '10. Organization schema: name Atwe, legalName Atwe Inc., url https://atwe.com/', org);
    say(h.description === APPROVED && JSON.stringify(metaOf(h.raw, 'description')) === JSON.stringify([APPROVED]), '11. the approved description, word for word', h.description);
  }
  for (const [label, ua, vp] of [['desktop Googlebot', GOOGLEBOT_DESKTOP, { width: 1280, height: 900 }], ['a signed-out person', PERSON, { width: 390, height: 844 }]]) {
    const h = await renderAs(ua, '/', vp, true);
    say(h.path === '/login' && JSON.stringify(h.canonical) === '["https://atwe.com/"]' && h.ogUrl === 'https://atwe.com/', `7. as ${label}: canonical and og:url stay https://atwe.com/ on /login`, [h.path, h.canonical, h.ogUrl]);
  }
  for (const path of ['/' + b, '/' + b + '/post/' + postId, '/engine/marketplace']) {
    const h = await renderAs(GOOGLEBOT, path, { width: 412, height: 915 }, false);
    const want = 'https://atwe.com' + path;
    say(h.status === 200 && JSON.stringify(canonOf(h.raw)) === JSON.stringify([want]) && JSON.stringify(h.canonical) === JSON.stringify([want]) && h.ogUrl === want,
      `14. ${path}: raw and rendered canonical stay ${want}`, [h.status, canonOf(h.raw), h.canonical, h.ogUrl]);
    if (path === '/' + b) console.log(`  note KNOWN SEO DEBT, unchanged by 1878: the server titles this page "${(head(h.raw).match(/<title>([^<]*)/) || [])[1]}", the rendered title is "${h.title}"`);
  }
  {
    const h = await renderAs(GOOGLEBOT, '/login', { width: 412, height: 915 }, false);
    say(canonOf(h.raw).length === 0 && h.canonical.length === 0 && h.robots.includes('noindex'), '/login (noindex): no canonical sent and none put back by the app', [canonOf(h.raw), h.canonical, h.robots]);
  }
  await gb.close();
  await br.close();

  /* ── over HTTP: indexing, admin, the legal documents, and nothing else moved ───────── */
  console.log('\nover HTTP');
  const get = async (path, { ua = GOOGLEBOT, host } = {}) => {
    const headers = { Accept: 'text/html', 'User-Agent': ua };
    if (host) headers['X-Forwarded-Host'] = host;
    const r = await fetch(BASE + path, { redirect: 'manual', headers });
    return { status: r.status, location: r.headers.get('location') || '', robots: r.headers.get('x-robots-tag'), text: await r.text() };
  };
  {
    const r = await get('/');
    say(r.status === 200 && r.robots === null && metaOf(r.text, 'robots').length === 0, 'the home page is indexable: 200, no X-Robots-Tag, no robots meta', [r.status, r.robots]);
    const robots = await get('/robots.txt');
    const disallow = robots.text.split('\n').filter((l) => /^disallow:/i.test(l.trim())).map((l) => l.split(':').slice(1).join(':').trim());
    say(JSON.stringify(disallow) === '["/api/","/admin.html","/*?"]', '13. robots.txt is unchanged and blocks none of the legal documents', disallow);
    for (const [path, h1] of [['/privacy.html', 'Privacy Policy'], ['/terms.html', 'Terms of Service'], ['/guidelines.html', 'Community Guidelines']]) {
      const d = await get(path);
      say(d.status === 200 && d.text.includes('<h1>' + h1 + '</h1>'), `13. ${path}: still 200 and readable`, d.status);
      say(d.robots === 'noindex, follow' && JSON.stringify(metaOf(d.text, 'robots')) === '["noindex, follow"]', `13. ${path}: noindex in the header and in the page`, [d.robots, metaOf(d.text, 'robots')]);
    }
    const landing = (await get('/', { ua: PERSON })).text;
    const at = landing.indexOf('id="authLandingView"');
    say(at > 0 && /<a href="\/privacy\.html">Privacy Policy<\/a>/.test(landing.slice(at, landing.indexOf('<!-- Step 1: username -->', at))), 'the signed-out sign-in screen still links the Privacy Policy');
    const admin = await get('/', { host: 'admin.atwe.com' });
    say(admin.status === 200 && /<title>Atwe Admin<\/title>/.test(admin.text), '12. admin.atwe.com still serves the dashboard', admin.status);
    say(admin.robots === 'noindex, nofollow' && JSON.stringify(metaOf(admin.text, 'robots')) === '["noindex, nofollow"]', '12. admin.atwe.com is noindex (header and page)', [admin.robots, metaOf(admin.text, 'robots')]);
    const api = await fetch(BASE + '/api/config', { headers: { 'X-Forwarded-Host': 'admin.atwe.com' } });
    say(api.status === 200 && api.headers.get('x-robots-tag') === 'noindex, nofollow', '12. the dashboard\'s API still answers on its host, also noindex', [api.status, api.headers.get('x-robots-tag')]);
    const prof = await get('/' + B.username);
    say(prof.status === 200 && prof.robots === null, '15. a public profile: still 200 and indexable', [prof.status, prof.robots]);
    const moved = await get('/messages');
    say(moved.status === 301 && moved.location === '/beam', '15. /messages still 301s to /beam', [moved.status, moved.location]);
    const login = await get('/login');
    say(login.status === 200 && login.robots === 'noindex', '15. /login still 200 + noindex', [login.status, login.robots]);
    const nobody = await get('/brandnobody' + Date.now().toString(36));
    say(nobody.status === 404 && nobody.robots === 'noindex', '15. an unknown name is still a 404 + noindex', [nobody.status, nobody.robots]);
  }

  if (BREAK) say(breakApplied === true, 'self-test: the build-1877 behaviour was really injected into the page', breakApplied);
  await pool.end().catch(() => {});
  console.log(`\n${pass} passed, ${fail} FAILED`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
