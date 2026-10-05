/* The server's view of an Atwe address (Route Audit batch 9).
 *
 * Before batch 9 every app path answered 200 with the same shell. These tests hold the
 * HTTP model the audit approved (§36 redirects, §38 statuses, §39 SEO):
 *   301  every legacy rename (DERIVED from the registry's aliases, so it cannot drift),
 *        a post found under its wrong author, a stale or missing entity slug — query kept,
 *        never a loop;
 *   404  an unknown shape, an unknown OR deactivated OR suspended username (identical),
 *        an entity id that was never issued;
 *   410  a public entity that existed and is gone or no longer public — and a post that
 *        is not public answers exactly as a deleted one does;
 *   503  the database could not answer (never a false 404);
 *   200  private routes, with noindex and the generic card — the server never looks
 *        them up, so a conversation that exists, is someone else's, or does not exist all
 *        answer identically.
 * Real server, real database; a second server on a dead database for the 503. */
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const H = require('./helpers');
const REG = require('../public/atwe-routes.js');

const opts = { skip: H.SKIP ? 'no TEST_DATABASE_URL/DATABASE_URL set' : false };
const BOT = 'Mozilla/5.0 (compatible; Twitterbot/1.0)';
let F = {};
before(async () => {
  if (H.SKIP) return;
  await H.startServer();
  const db = H.getPool();
  const owner = await H.seedUser({ accountType: 'business' });
  const peer = await H.seedUser();
  await db.query("UPDATE users SET name = 'Status Owner Biz' WHERE id = $1", [owner.id]);
  const one = async (sql, args) => (await db.query(sql, args)).rows[0].id;
  F.owner = owner; F.peer = peer;
  F.listing = await one("INSERT INTO products (business_id, name, description, price_cents) VALUES ($1, 'Blue Ceramic Mug', 'A mug.', 1200) RETURNING id", [owner.id]);
  F.hidden = await one("INSERT INTO products (business_id, name, price_cents, active) VALUES ($1, 'Withdrawn Lamp', 900, false) RETURNING id", [owner.id]);
  F.gone = await one("INSERT INTO products (business_id, name, price_cents) VALUES ($1, 'Deleted Chair', 900) RETURNING id", [owner.id]);
  await db.query('DELETE FROM products WHERE id = $1', [F.gone]);
  F.service = await one("INSERT INTO services (user_id, title, description) VALUES ($1, 'Piano Lessons', 'Weekly.') RETURNING id", [owner.id]);
  F.job = await one("INSERT INTO jobs (posted_by, title, description) VALUES ($1, 'Line Cook', 'Evenings.') RETURNING id", [owner.id]);
  F.event = await one("INSERT INTO events (host_id, title, starts_at) VALUES ($1, 'Spring Fair', now() + interval '10 days') RETURNING id", [owner.id]);
  F.pastEvent = await one("INSERT INTO events (host_id, title, starts_at) VALUES ($1, 'Last Year Fair', now() - interval '10 days') RETURNING id", [owner.id]);
  F.course = await one("INSERT INTO courses (creator_id, title, published) VALUES ($1, 'Bread Basics', true) RETURNING id", [owner.id]);
  F.draft = await one("INSERT INTO courses (creator_id, title, published) VALUES ($1, 'Secret Draft Course', false) RETURNING id", [owner.id]);
  F.nl = await one("INSERT INTO newsletters (owner_id, title) VALUES ($1, 'Kitchen Notes') RETURNING id", [owner.id]);
  F.paidNl = await one("INSERT INTO newsletters (owner_id, title, description, price_cents) VALUES ($1, 'Paid Letters', 'Members only.', 500) RETURNING id", [owner.id]);
  F.issue = await one("INSERT INTO newsletter_issues (newsletter_id, title, body) VALUES ($1, 'Issue One', 'Free words here.') RETURNING id", [F.nl]);
  F.paidIssue = await one("INSERT INTO newsletter_issues (newsletter_id, title, body) VALUES ($1, 'Paid Issue', 'SECRETPAIDBODY do not leak') RETURNING id", [F.paidNl]);
  F.community = await one("INSERT INTO communities (name, description, created_by) VALUES ('Bakers Guild', 'For bakers.', $1) RETURNING id", [owner.id]);
  F.showcase = await one("INSERT INTO showcases (user_id, title) VALUES ($1, 'My Mural') RETURNING id", [owner.id]);
  F.post = await one("INSERT INTO posts (user_id, body) VALUES ($1, 'Hello public world') RETURNING id", [owner.id]);
  F.circlePost = await one("INSERT INTO posts (user_id, body, to_main) VALUES ($1, 'CIRCLESECRET members only', false) RETURNING id", [owner.id]);
  F.subPost = await one("INSERT INTO posts (user_id, body, subscribers_only) VALUES ($1, 'SUBSECRET', true) RETURNING id", [owner.id]);
  F.deadPost = await one("INSERT INTO posts (user_id, body) VALUES ($1, 'bye') RETURNING id", [owner.id]);
  await db.query('DELETE FROM posts WHERE id = $1', [F.deadPost]);
  F.dm = 'PRIVATEDMSECRET ' + H.uniq('m');
  await db.query('INSERT INTO at_messages (sender_id, recipient_id, body) VALUES ($1,$2,$3)', [owner.id, peer.id, F.dm]);
});
after(async () => { if (!H.SKIP) await H.stopServer(); });

const base = () => 'http://localhost:' + H.port();
async function get(p, ua) {
  const headers = { Accept: 'text/html' };
  if (ua) headers['User-Agent'] = ua;
  const res = await fetch(base() + p, { redirect: 'manual', headers });
  const text = ua ? await res.text() : '';
  return { status: res.status, location: res.headers.get('location') || '', robots: res.headers.get('x-robots-tag') || '', retry: res.headers.get('retry-after') || '', text };
}
const meta = (html, prop) => { const m = new RegExp(`<meta\\s+(?:property|name)="${prop}"\\s+content="([^"]*)"`, 'i').exec(html); return m ? m[1] : null; };
const canonical = (html) => { const m = /<link rel="canonical" href="([^"]*)"/i.exec(html); return m ? m[1] : null; };
const robotsMeta = (html) => /<meta name="robots" content="noindex"/i.test(html);
const head = (html) => html.slice(0, html.indexOf('</head>'));

/* ── 301: the legacy table, derived from the registry ─────────────────── */
test('every literal legacy alias in the registry 301s to its canonical address, query kept, no loop', opts, async () => {
  const aliases = [];
  REG.liveRoutes().forEach((r) => r.aliases.forEach((a) => { if (!a.includes(':') && a !== '/go') aliases.push(a); }));
  assert.ok(aliases.length >= 40, 'the table is not empty: ' + aliases.length);
  for (const a of aliases) {
    const want = REG.legacyRedirect(a);
    assert.ok(want, a + ' has a canonical');
    const r = await get(a + '?tab=2&x=%2F');
    assert.equal(r.status, 301, a);
    assert.equal(r.location, want + '?tab=2&x=%2F', a + ' keeps its query exactly');
    const end = await get(want);
    assert.notEqual(end.status, 301, want + ' is a fixed point (no redirect chain or loop)');
  }
});

test('the approved world-root and named renames, explicitly', opts, async () => {
  const want = { '/messages': '/beam', '/search': '/engine', '/me': '/account', '/profile': '/account',
    '/devices': '/settings/security/devices', '/wallet': '/account/wallet', '/store': '/account/store',
    '/orders': '/account/orders', '/marketplace': '/engine/marketplace', '/jobs': '/engine/jobs', '/home': '/' };
  for (const [from, to] of Object.entries(want)) {
    const r = await get(from);
    assert.equal(r.status, 301, from);
    assert.equal(r.location, to, from);
  }
  assert.notEqual((await get('/engine/search')).status, 301, '/engine/search stays planned: never a redirect target');
  assert.equal((await get('/go')).status, 200, '/go is a server shell path, never redirected');
});

test('the one-shot query actions are untouched at the root', opts, async () => {
  for (const q of ['?u=someone', '?joingroup=abc', '?call=abc', '?paylink=abc', '?ref=ABC', '?verify=t', '?reset=t', '?order=success']) {
    const r = await get('/' + q);
    assert.equal(r.status, 200, q);
  }
});

/* ── Typed entities: slug, status, card ─────────────────────────────────── */
test('a typed entity: missing or stale slug 301s to the current one; the canonical is 200 with its card', opts, async () => {
  const cases = [
    ['listing', F.listing, 'Blue Ceramic Mug', 'product'], ['service', F.service, 'Piano Lessons', 'website'],
    ['job', F.job, 'Line Cook', 'website'], ['event', F.event, 'Spring Fair', 'website'],
    ['course', F.course, 'Bread Basics', 'website'], ['newsletter', F.nl, 'Kitchen Notes', 'website'],
  ];
  for (const [type, id, title, ogType] of cases) {
    const canon = '/' + type + '/' + REG.idSlug(id, title);
    for (const from of ['/' + type + '/' + id, '/' + type + '/' + id + '-old-name', '/' + type + '/0' + id + '-X']) {
      const r = await get(from + '?ref=1');
      assert.equal(r.status, 301, from);
      assert.equal(r.location, canon + '?ref=1', from);
    }
    const ok = await get(canon, BOT);
    assert.equal(ok.status, 200, canon);
    assert.equal(ok.robots, '', canon + ' is indexable');
    assert.ok(canonical(ok.text).endsWith(canon), canon + ' declares itself canonical');
    assert.ok(meta(ok.text, 'og:url').endsWith(canon));
    assert.equal(meta(ok.text, 'og:type'), ogType);
    assert.ok(meta(ok.text, 'og:title').startsWith(title), type + ' title');
    assert.ok(meta(ok.text, 'twitter:title').startsWith(title));
  }
  for (const [p, id] of [['/communities/', F.community], ['/showcase/', F.showcase]]) {
    const ok = await get(p + id, BOT);
    assert.equal(ok.status, 200, p);
    assert.ok(canonical(ok.text).endsWith(p + id));
  }
});

test('gone is 410, never-issued is 404, malformed is 404 — and a draft looks exactly like a deleted one', opts, async () => {
  assert.equal((await get('/listing/' + F.gone)).status, 410, 'deleted');
  assert.equal((await get('/listing/' + F.hidden)).status, 410, 'withdrawn by its seller');
  assert.equal((await get('/course/' + F.draft)).status, 410, 'unpublished: no different from deleted');
  const g = await get('/course/' + F.draft, BOT);
  assert.ok(!g.text.includes('Secret Draft Course'), 'and its title is never in the card');
  assert.ok(robotsMeta(g.text) && g.robots === 'noindex');
  assert.equal((await get('/listing/9999999999')).status, 404, 'an id past every issued one');
  assert.equal((await get('/listing/abc')).status, 404, 'not an id at all');
  assert.equal((await get('/showcase/12-slug')).status, 404, 'showcase takes NO slug (the founder\'s shape)');
});

test('events that are over and paid newsletter issues are 200 but noindex, and a paid body never reaches a card', opts, async () => {
  const past = await get('/event/' + REG.idSlug(F.pastEvent, 'Last Year Fair'));
  assert.equal(past.status, 200);
  assert.equal(past.robots, 'noindex');
  const pi = await get('/newsletter/' + F.paidNl + '/issue/' + F.paidIssue, BOT);
  assert.equal(pi.status, 200);
  assert.equal(pi.robots, 'noindex');
  assert.ok(!pi.text.includes('SECRETPAIDBODY'), 'the paid body is not in the card');
  const fi = await get('/newsletter/' + F.nl + '/issue/' + F.issue, BOT);
  assert.equal(fi.status, 200);
  assert.equal(fi.robots, '');
  assert.equal(meta(fi.text, 'og:type'), 'article');
  const wrongParent = await get('/newsletter/' + F.paidNl + '/issue/' + F.issue);
  assert.equal(wrongParent.status, 301);
  assert.equal(wrongParent.location, '/newsletter/' + F.nl + '/issue/' + F.issue);
});

/* ── Posts ─────────────────────────────────────────────────────────────── */
test('a public post: legacy /post/:id and a wrong author both 301 to /<author>/post/<id>', opts, async () => {
  const canon = '/' + F.owner.username.toLowerCase() + '/post/' + F.post;
  assert.equal((await get('/post/' + F.post)).location, canon);
  assert.equal((await get('/' + F.peer.username + '/post/' + F.post)).location, canon);
  const ok = await get(canon, BOT);
  assert.equal(ok.status, 200);
  assert.equal(meta(ok.text, 'og:type'), 'article');
  assert.ok(meta(ok.text, 'og:description').includes('Hello public world'));
});

test('a post that is not public answers EXACTLY as a deleted one, and leaks neither author nor words', opts, async () => {
  const dead = await get('/post/' + F.deadPost, BOT);
  for (const id of [F.circlePost, F.subPost]) {
    for (const p of ['/post/' + id, '/' + F.owner.username + '/post/' + id, '/' + F.peer.username + '/post/' + id]) {
      const r = await get(p, BOT);
      assert.equal(r.status, 410, p);
      assert.equal(r.location, '', p + ' never redirects (a redirect would name the author)');
      assert.equal(head(r.text), head(dead.text), p + ' is byte-identical to a deleted post');
      assert.ok(!r.text.includes('CIRCLESECRET') && !r.text.includes('SUBSECRET'));
    }
  }
});

/* ── Profiles ──────────────────────────────────────────────────────────── */
test('unknown, deactivated and suspended usernames are one identical 404', opts, async () => {
  const db = H.getPool();
  const d = await H.seedUser(), s = await H.seedUser();
  await db.query("UPDATE users SET deactivated = true, name = 'HIDDENNAME' WHERE id = $1", [d.id]);
  await db.query("UPDATE users SET status = 'suspended', name = 'HIDDENNAME' WHERE id = $1", [s.id]);
  const unknown = await get('/' + H.uniq('nobody'), BOT);
  for (const u of [d.username, s.username]) {
    const r = await get('/' + u, BOT);
    assert.equal(r.status, 404, u);
    assert.equal(r.robots, 'noindex');
    assert.equal(head(r.text), head(unknown.text), u + ' answers byte-identically to an unknown name');
    assert.ok(!r.text.includes('HIDDENNAME'));
  }
  assert.equal(unknown.status, 404);
});

test('a profile: 200 with a profile card; /likes noindex; /company alias declares the profile canonical', opts, async () => {
  const u = F.owner.username.toLowerCase();
  const p = await get('/' + u, BOT);
  assert.equal(p.status, 200);
  assert.equal(meta(p.text, 'og:type'), 'profile');
  assert.ok(canonical(p.text).endsWith('/' + u));
  const likes = await get('/' + u + '/likes');
  assert.equal(likes.status, 200);
  assert.equal(likes.robots, 'noindex');
  const c = await get('/company/' + u, BOT);
  assert.equal(c.status, 200, '/company stays a working alias (the audit keeps it)');
  assert.ok(canonical(c.text).endsWith('/' + u));
});

/* ── Private / auth / search ───────────────────────────────────────────── */
test('private and auth-only routes are 200 + noindex with the generic card — nothing private in it', opts, async () => {
  const generic = await get('/settings', BOT);
  const peerU = F.peer.username;
  for (const p of ['/beam', '/beam/u/' + peerU, '/beam/u/' + H.uniq('nobody'), '/beam/g/1', '/beam/g/999999999',
    '/account', '/account/wallet', '/settings/security/devices', '/notifications', '/ai', '/cart', '/engine', '/login', '/signup']) {
    const r = await get(p, BOT);
    assert.equal(r.status, 200, p);
    assert.equal(r.robots, 'noindex', p);
    assert.ok(robotsMeta(r.text), p);
    assert.equal(canonical(r.text), null, p + ' declares no canonical');
    assert.equal(meta(r.text, 'og:title'), 'Atwe', p + ' uses the generic card');
    assert.equal(head(r.text), head(generic.text), p + ' is the same document as every other private route');
    assert.ok(!r.text.includes(F.dm) && !r.text.includes('Test ' + peerU), p + ' leaks no message or name');
  }
});

test('an unknown route shape is 404 + noindex', opts, async () => {
  for (const p of ['/official', '/settings/nope', '/account/nope/deeper', '/listing', '/beam/x/y', '/.well-known/nothing', '/s/zzzzzz']) {
    const r = await get(p);
    assert.equal(r.status, 404, p);
    assert.equal(r.robots, 'noindex', p);
  }
});

test('the public browse pages are indexable with their own canonical', opts, async () => {
  for (const p of ['/engine/marketplace', '/engine/services', '/engine/events', '/engine/courses', '/engine/showcase']) {
    const r = await get(p, BOT);
    assert.equal(r.status, 200, p);
    assert.equal(r.robots, '', p);
    assert.ok(canonical(r.text).endsWith(p), p);
  }
});

/* ── 503: a database failure is never a "not found" ───────────────────── */
function freePort() {
  return new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
}
test('when the database cannot answer, a lookup route is 503 + Retry-After, never 404', opts, async () => {
  const port = await freePort();
  const child = spawn('node', [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, DATABASE_URL: 'postgres://nobody:x@127.0.0.1:1/none', DB_SSL: 'false', PORT: String(port), JWT_SECRET: 'x' },
    stdio: 'ignore' });
  try {
    for (let i = 0; i < 80; i++) { try { await fetch('http://localhost:' + port + '/api/health'); break; } catch (e) { await new Promise((r) => setTimeout(r, 150)); } }
    const at = async (p) => fetch('http://localhost:' + port + p, { redirect: 'manual', headers: { Accept: 'text/html' } });
    for (const p of ['/' + F.owner.username, '/listing/' + F.listing, '/post/' + F.post, '/listing/' + F.gone]) {
      const r = await at(p);
      assert.equal(r.status, 503, p);
      assert.equal(r.headers.get('retry-after'), '30');
      assert.equal(r.headers.get('x-robots-tag'), 'noindex');
    }
    const legacy = await at('/messages');
    assert.equal(legacy.status, 301, 'a pure rename needs no database and still works');
    assert.equal((await at('/account/wallet')).status, 200, 'a private route needs no database either');
  } finally { child.kill('SIGKILL'); }
});
