/* The browser tab and Google say "Atwe" (build 1878).
 *
 * The founder's locked decisions from the brand/SEO audit of build 1877:
 *   - the browser tab always reads exactly "Atwe": no unread count, no "(3)", no page name;
 *   - Google's site name is "Atwe": WebSite name/url, and NO alternateName (it used to list
 *     atwe.com, which handed Google exactly the label the founder does not want);
 *   - the company is Organization name "Atwe", legalName "Atwe Inc.";
 *   - the home page's canonical stays https://atwe.com/ even after the signed-out sign-in
 *     screen rewrites the visible address to /login;
 *   - admin.atwe.com and the three legal documents are noindex, never through robots.txt;
 *   - the approved description is kept word for word.
 *
 * The first half needs no database and always runs: it reads the shipped files and runs the
 * app's own tab-title and canonical functions in a sandbox against the real route registry.
 * The second half drives a real server (skipped without a database, like the rest of the
 * suite). The browser half lives in scratchpad/brandtitle.js. */
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const H = require('./helpers');
const REG = require('../public/atwe-routes.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const INDEX = read('public/index.html');
const headOf = (html) => html.slice(0, html.indexOf('</head>'));
const HEAD = headOf(INDEX);
const APPROVED = 'The network built for business. Connect, message, hire, sell and grow, all in one place.';
const GOOGLEBOT = 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const PERSON = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const all = (re, s) => [...s.matchAll(re)];
const metas = (html, attr, key) => all(new RegExp(`<meta\\s+${attr}="${key.replace(/[.:]/g, '\\$&')}"\\s+content="([^"]*)"`, 'gi'), html).map((m) => m[1]);
const canonicals = (html) => all(/<link rel="canonical" href="([^"]*)"/gi, html).map((m) => m[1]);
const titles = (html) => all(/<title>([^<]*)<\/title>/gi, html).map((m) => m[1]);
const ld = (html) => all(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi, html).map((m) => JSON.parse(m[1]));

/* A top-level function's source, exactly as shipped: from `function name(` to the first
   closing brace at the start of a line. Every function here is written that way. */
function fnSource(name) {
  const start = INDEX.indexOf('\nfunction ' + name + '(');
  assert.ok(start >= 0, name + ' is defined in public/index.html');
  const end = INDEX.indexOf('\n}\n', start);
  assert.ok(end > start, name + ' has a closing brace');
  return INDEX.slice(start + 1, end + 2);
}

/* ── the home page's head ─────────────────────────────────────────────── */
test('the home page: one title "Atwe", the approved description word for word, one canonical https://atwe.com/', () => {
  assert.deepEqual(titles(HEAD), ['Atwe']);
  assert.deepEqual(metas(HEAD, 'name', 'description'), [APPROVED]);
  assert.deepEqual(canonicals(HEAD), ['https://atwe.com/']);
  assert.deepEqual(metas(HEAD, 'property', 'og:url'), ['https://atwe.com/']);
  assert.deepEqual(metas(HEAD, 'property', 'og:site_name'), ['Atwe']);
  assert.deepEqual(metas(HEAD, 'property', 'og:title'), ['Atwe']);
  assert.deepEqual(metas(HEAD, 'name', 'twitter:title'), ['Atwe']);
  assert.deepEqual(metas(HEAD, 'property', 'og:description'), [APPROVED]);
  assert.deepEqual(metas(HEAD, 'name', 'twitter:description'), [APPROVED]);
  assert.deepEqual(metas(HEAD, 'name', 'robots'), [], 'the home page itself is indexable: no robots meta in its head');
  const man = JSON.parse(read('public/manifest.json'));
  assert.equal(man.name, 'Atwe');
  assert.equal(man.short_name, 'Atwe');
  assert.equal(man.description, APPROVED);
});

test('WebSite schema: name "Atwe", url https://atwe.com/, and no alternateName at all', () => {
  const sites = ld(HEAD).filter((b) => b['@type'] === 'WebSite');
  assert.equal(sites.length, 1, 'exactly one WebSite block');
  const w = sites[0];
  assert.equal(w.name, 'Atwe');
  assert.equal(w.url, 'https://atwe.com/');
  assert.ok(!('alternateName' in w), 'no alternateName: it used to offer Google "atwe.com" as the site name');
  assert.ok(!/"(www\.)?atwe\.com"/i.test(JSON.stringify(w)), 'the domain is never offered as a NAME');
});

test('Organization schema: name "Atwe", legalName "Atwe Inc.", url https://atwe.com/; titles never say "Atwe Inc."', () => {
  const orgs = ld(HEAD).filter((b) => b['@type'] === 'Organization');
  assert.equal(orgs.length, 1, 'exactly one Organization block');
  const o = orgs[0];
  assert.equal(o.name, 'Atwe');
  assert.equal(o.legalName, 'Atwe Inc.');
  assert.equal(o.url, 'https://atwe.com/');
  assert.match(o.logo, /^https:\/\/atwe\.com\//);
  const sites = ld(HEAD).filter((b) => b['@type'] === 'WebSite');
  const product = [...titles(HEAD), ...metas(HEAD, 'property', 'og:title'), ...metas(HEAD, 'property', 'og:site_name'),
    ...metas(HEAD, 'name', 'twitter:title'), sites[0].name, o.name];
  for (const t of product) assert.ok(!/\bInc\b/.test(t), 'a product-facing name never carries "Inc": ' + t);
});

/* ── the browser tab ──────────────────────────────────────────────────── */
test('the app writes document.title in exactly one place, and only ever the literal "Atwe"', () => {
  const writes = all(/document\.title\s*=(?!=)\s*([^;\n]*)/g, INDEX);
  assert.equal(writes.length, 1, 'one write: ' + writes.map((m) => m[0]).join(' | '));
  assert.equal(writes[0][1].trim(), "'Atwe'");
  assert.ok(!INDEX.includes('acRouteTitle'), 'the per-page tab title is gone');
});

test('acSyncTabTitle: "Atwe" with no unread, unread notifications, unread messages, on every route; the icon badge still gets the total', () => {
  const src = fnSource('acSyncTabTitle');
  const cases = [
    { notif: 0, msg: 0, at: '/' }, { notif: 3, msg: 0, at: '/' }, { notif: 0, msg: 2, at: '/beam' },
    { notif: 4, msg: 7, at: '/settings/privacy' }, { notif: 120, msg: 9, at: '/account/wallet' },
    { notif: 1, msg: 0, at: '/notifications' }, { notif: 0, msg: 1, at: '/john' }, { notif: 2, msg: 2, at: '/john/post/9' },
  ];
  for (const c of cases) {
    const calls = [];
    let writes = 0, title = 'Atwe';
    const document = { get title() { return title; }, set title(v) { writes++; title = v; } };
    const ctx = {
      AC: { _notifUnread: c.notif, _tabMsgUnread: c.msg }, document, location: { pathname: c.at },
      navigator: { setAppBadge: (n) => { calls.push(['set', n]); return Promise.resolve(); }, clearAppBadge: () => { calls.push(['clear']); return Promise.resolve(); } },
    };
    vm.runInNewContext(src + '\nacSyncTabTitle();', ctx);
    const total = c.notif + c.msg;
    assert.equal(title, 'Atwe', `tab with ${c.notif} notifications + ${c.msg} messages at ${c.at}`);
    assert.equal(writes, 0, 'a document already titled "Atwe" is never written to');
    assert.deepEqual(calls[calls.length - 1], total > 0 ? ['set', total] : ['clear'], 'the installed-app icon badge is unchanged');
  }
  // A document that arrived with another title (a crawler's per-page card) is reset to "Atwe".
  const ctx = { AC: { _notifUnread: 5, _tabMsgUnread: 0 }, document: { title: 'QA (@qa) · Atwe' }, navigator: {} };
  vm.runInNewContext(src + '\nacSyncTabTitle();', ctx);
  assert.equal(ctx.document.title, 'Atwe');
});

/* ── the canonical ────────────────────────────────────────────────────── */
function canonicalSandbox({ noindex = false, start = 'https://atwe.com/' } = {}) {
  const link = { href: start };
  const og = { content: start, setAttribute(k, v) { if (k === 'content') this.content = v; } };
  const document = {
    querySelector(sel) {
      if (sel.startsWith('meta[name="robots"]')) return noindex ? { content: 'noindex' } : null;
      if (sel === 'link[rel="canonical"]') return link;
      if (sel === 'meta[property="og:url"]') return og;
      return null;
    },
    createElement() { return {}; }, head: { appendChild() {} },
  };
  const ctx = { document, window: { ATWE_ROUTES: REG }, ATWE_ROUTES: REG, CANONICAL_ORIGIN: 'https://atwe.com' };
  vm.runInNewContext(fnSource('acCanonicalIndexable') + '\n' + fnSource('acSetCanonical'), ctx);
  return { set: (p) => vm.runInNewContext('acSetCanonical(' + JSON.stringify(p) + ')', ctx), link, og };
}

test('the signed-out home page keeps https://atwe.com/ when the sign-in screen rewrites the address to /login', () => {
  const s = canonicalSandbox();
  s.set('/login');   // exactly what openLogin() does on a signed-out visit to atwe.com
  assert.equal(s.link.href, 'https://atwe.com/');
  assert.equal(s.og.content, 'https://atwe.com/');
});

test('a public, indexable address still gets its own canonical and og:url, exactly as before', () => {
  for (const p of ['/', '/john', '/john/post/12', '/listing/12-blue-mug', '/job/3-line-cook', '/event/4-spring-fair',
    '/engine/marketplace', '/engine/services', '/circle/bakers', '/group/bakers', '/showcase/8', '/communities/2', '/help']) {
    const s = canonicalSandbox({ start: 'https://atwe.com/elsewhere' });
    s.set(p);
    assert.equal(s.link.href, 'https://atwe.com' + p, p);
    assert.equal(s.og.content, 'https://atwe.com' + p, p + ' og:url');
  }
});

test('a private or noindex address never overwrites a public page\'s canonical', () => {
  for (const p of ['/login', '/signup', '/forgot-password', '/reset-password?token=x', '/verify-email', '/beam', '/beam/u/john',
    '/beam/g/7', '/engine', '/notifications', '/ai', '/cart', '/account', '/account/money', '/account/wallet', '/settings',
    '/settings/privacy', '/settings/security/devices']) {
    const s = canonicalSandbox({ start: 'https://atwe.com/john' });
    s.set(p);
    assert.equal(s.link.href, 'https://atwe.com/john', p + ' must leave the profile\'s canonical alone');
    assert.equal(s.og.content, 'https://atwe.com/john', p + ' og:url');
  }
});

test('every literal live route follows one rule: the canonical moves only for the home page and seo:"index" routes', () => {
  for (const r of REG.liveRoutes()) {
    if (r.pattern.includes(':')) continue;   // the param routes are covered above with real values
    const s = canonicalSandbox({ start: 'https://atwe.com/start' });
    s.set(r.pattern);
    const moves = r.pattern === '/' || r.seo === 'index';
    assert.equal(s.link.href, moves ? 'https://atwe.com' + r.pattern : 'https://atwe.com/start', r.name + ' ' + r.pattern + ' (seo ' + r.seo + ')');
  }
});

test('a document the server sent as noindex never gets a canonical put back, even on a public-shaped address', () => {
  const s = canonicalSandbox({ noindex: true, start: 'https://atwe.com/start' });
  s.set('/john');
  assert.equal(s.link.href, 'https://atwe.com/start');
});

/* ── admin and the legal documents ────────────────────────────────────── */
const LEGAL = [['/privacy.html', 'Privacy Policy'], ['/terms.html', 'Terms of Service'], ['/guidelines.html', 'Community Guidelines']];

test('admin.html and the three legal documents say noindex in their own <head>', () => {
  assert.deepEqual(metas(headOf(read('public/admin.html')), 'name', 'robots'), ['noindex, nofollow']);
  assert.deepEqual(titles(headOf(read('public/admin.html'))), ['Atwe Admin'], 'the admin tab title is unchanged');
  for (const [p, title] of LEGAL) {
    const h = headOf(read('public' + p));
    assert.deepEqual(metas(h, 'name', 'robots'), ['noindex, follow'], p);
    assert.deepEqual(titles(h), [title + ' · Atwe'], p + ' keeps its own title');
  }
});

/* robots.txt, read the way a crawler reads it: Allow/Disallow with * and $. */
function robotsBlocks(txt, p) {
  const rules = txt.split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean)
    .map((l) => /^(allow|disallow):\s*(.*)$/i.exec(l)).filter(Boolean)
    .map(([, k, v]) => ({ allow: k.toLowerCase() === 'allow', v }))
    .filter((r) => r.v)
    .map((r) => ({ ...r, re: new RegExp('^' + r.v.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')) }));
  const hits = rules.filter((r) => r.re.test(p)).sort((a, b) => b.v.length - a.v.length);
  return hits.length > 0 && !hits[0].allow;
}

test('robots.txt is unchanged and lets crawlers fetch the home page, the legal documents and the admin page', () => {
  const txt = read('public/robots.txt');
  const dis = txt.split('\n').filter((l) => /^disallow:/i.test(l.trim())).map((l) => l.split(':').slice(1).join(':').trim());
  assert.deepEqual(dis, ['/api/', '/admin.html', '/*?'], 'the same three Disallow lines as build 1877');
  assert.ok(!/^sitemap:/im.test(txt), 'no sitemap line (not part of this change)');
  for (const p of ['/', ...LEGAL.map((l) => l[0])]) assert.equal(robotsBlocks(txt, p), false, p + ' must stay fetchable, or its noindex is never read');
  assert.equal(robotsBlocks(txt, '/admin.html'), true, 'sanity: the matcher does block /admin.html on the main host');
});

test('the signed-out home page still links the Privacy Policy (Google sign-in verification needs it)', () => {
  const a = INDEX.indexOf('id="authLandingView"');
  const b = INDEX.indexOf('<!-- Step 1: username -->', a);
  assert.ok(a > 0 && b > a, 'the landing markup is where it was');
  assert.match(INDEX.slice(a, b), /<a href="\/privacy\.html">Privacy Policy<\/a>/);
});

test('the server repeats the noindex as a header: every admin.atwe.com response, and exactly the three legal paths', () => {
  const src = read('server.js');
  assert.match(src, /const NOINDEX_DOCS = new Set\(\['\/privacy\.html', '\/terms\.html', '\/guidelines\.html'\]\);/);
  assert.match(src, /if \(req\.hostname === ADMIN_HOST\) \{\n\s+res\.set\('X-Robots-Tag', 'noindex, nofollow'\);/);
});

/* ── live: a real server ──────────────────────────────────────────────── */
const opts = { skip: H.SKIP ? 'no TEST_DATABASE_URL/DATABASE_URL set' : false };
let F = {};
before(async () => {
  if (H.SKIP) return;
  await H.startServer();
  F.user = await H.seedUser({ accountType: 'business' });
});
after(async () => { if (!H.SKIP) await H.stopServer(); });

const base = () => 'http://localhost:' + H.port();
async function get(p, { ua = PERSON, host } = {}) {
  const headers = { Accept: 'text/html', 'User-Agent': ua };
  if (host) headers['X-Forwarded-Host'] = host;
  const res = await fetch(base() + p, { redirect: 'manual', headers });
  return { status: res.status, location: res.headers.get('location') || '', robots: res.headers.get('x-robots-tag'), text: await res.text() };
}

test('live: the home page is served indexable, canonical and og:url https://atwe.com/, to Googlebot and to a person', opts, async () => {
  for (const ua of [GOOGLEBOT, PERSON]) {
    const r = await get('/', { ua });
    assert.equal(r.status, 200);
    assert.equal(r.robots, null, 'no X-Robots-Tag on the home page');
    const h = headOf(r.text);
    assert.deepEqual(canonicals(h), ['https://atwe.com/']);
    assert.deepEqual(metas(h, 'property', 'og:url'), ['https://atwe.com/']);
    assert.deepEqual(titles(h), ['Atwe']);
    assert.deepEqual(metas(h, 'name', 'description'), [APPROVED]);
    assert.deepEqual(metas(h, 'name', 'robots'), []);
  }
});

test('live: the legal documents are 200 and readable, noindex in the header and the page, and robots.txt allows them', opts, async () => {
  const robots = await get('/robots.txt');
  assert.equal(robots.status, 200);
  for (const [p, title] of LEGAL) {
    for (const ua of [GOOGLEBOT, PERSON]) {
      const r = await get(p, { ua });
      assert.equal(r.status, 200, p);
      assert.equal(r.robots, 'noindex, follow', p + ' X-Robots-Tag');
      assert.deepEqual(metas(headOf(r.text), 'name', 'robots'), ['noindex, follow'], p + ' meta');
      assert.ok(r.text.includes('<h1>' + title + '</h1>'), p + ' is still the real document');
      assert.equal(robotsBlocks(robots.text, p), false, p + ' is not blocked by robots.txt');
    }
  }
});

test('live: admin.atwe.com still serves the dashboard, and every response there says noindex', opts, async () => {
  const admin = 'admin.atwe.com';
  const root = await get('/', { host: admin, ua: GOOGLEBOT });
  assert.equal(root.status, 200);
  assert.deepEqual(titles(headOf(root.text)), ['Atwe Admin'], 'the dashboard itself');
  assert.equal(root.robots, 'noindex, nofollow');
  assert.deepEqual(metas(headOf(root.text), 'name', 'robots'), ['noindex, nofollow']);
  const icon = await get('/favicon.png', { host: admin });
  assert.equal(icon.status, 200);
  assert.equal(icon.robots, 'noindex, nofollow', 'an asset on the admin host');
  const res = await fetch(base() + '/api/config', { headers: { 'X-Forwarded-Host': admin } });
  assert.equal(res.status, 200, 'the API the dashboard calls still answers on the admin host');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
  // ...and the main host is untouched: its home page and assets carry no robots header.
  assert.equal((await get('/favicon.png')).robots, null);
  assert.equal((await get('/', { host: 'atwe.com' })).robots, null);
});

test('live: a public profile keeps its own canonical; statuses and redirects are unchanged', opts, async () => {
  const u = F.user.username.toLowerCase();
  const prof = await get('/' + F.user.username, { ua: GOOGLEBOT });
  assert.equal(prof.status, 200);
  assert.equal(prof.robots, null);
  assert.deepEqual(canonicals(headOf(prof.text)), [base() + '/' + u]);
  assert.deepEqual(metas(headOf(prof.text), 'property', 'og:url'), [base() + '/' + u]);
  const moved = await get('/messages');
  assert.equal(moved.status, 301);
  assert.equal(moved.location, '/beam');
  const login = await get('/login', { ua: GOOGLEBOT });
  assert.equal(login.status, 200);
  assert.equal(login.robots, 'noindex');
  assert.deepEqual(canonicals(headOf(login.text)), [], '/login itself still declares no canonical');
  const nobody = await get('/' + H.uniq('nobody').replace(/[^a-z0-9]/gi, ''), { ua: GOOGLEBOT });
  assert.equal(nobody.status, 404);
  assert.equal(nobody.robots, 'noindex');
  assert.equal((await get('/privacy')).status, 404, '/privacy without .html is still a 404, as before');
  assert.equal((await get('/sitemap.xml')).status, 404, 'still no sitemap (not part of this change)');
});
