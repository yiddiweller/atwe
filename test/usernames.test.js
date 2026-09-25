// The new-username gate (Route Audit batch 1). Run with:
//   TEST_DATABASE_URL=postgres://user:pass@host/db npm test
// The rule-level tests need nothing; the route tests skip cleanly with no database.
//
// A person's public address is atwe.com/<username>, so every handle is a claim on the
// root of the site. These tests hold the promise from both sides:
//   · NEW names can never take a word Atwe uses (or will use) as an address, a
//     server-owned root, or a file-shaped name — through ANY door, including staff's;
//   · NOBODY who already holds a name is renamed or blocked from saving their profile.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./helpers');
const auth = require('../auth');   // after helpers, which pins JWT_SECRET first
const { SYSTEM_ROUTES, ALLOCATION_RESERVED, REGISTRY: REG } = require('../routes');

const ROOT = path.join(__dirname, '..');
const NEW_SET = new Set(ALLOCATION_RESERVED);
/* The rule, restated from its two published halves (the server adds the /public
   listing on top; the test below proves the shape rule already covers every file). */
const refused = (n) => !!REG.usernameShapeError(n) || NEW_SET.has(String(n).toLowerCase());

/* ── Rules (no database) ─────────────────────────────────────────────── */

test('every route root the registry knows is reserved for new usernames', () => {
  for (const r of REG.routeRoots()) assert.ok(NEW_SET.has(r), r + ' is a route root but a new member could take it');
  for (const r of REG.parseReserved()) assert.ok(NEW_SET.has(r), r + ' is router-reserved but not refused for new names');
});

test('the server-owned roots are refused', () => {
  for (const n of ['go', 's', 'catalog', '_diag', '__shell', '.well-known', 'api', 'admin']) {
    assert.ok(refused(n), n + ' must be refused');
  }
});

test('every file actually in /public is refused as a new username', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'public'))) assert.ok(refused(f), f + ' would be shadowed by the static file');
});

test('reserved checking is case-insensitive', () => {
  for (const n of ['Wallet', 'GO', 'Settings', 'BEAM', 'Engine', 'Account', 'Catalog']) assert.ok(refused(n), n);
});

test('ordinary usernames still pass', () => {
  for (const n of ['john', 'john.doe', 'jane_99', 'a', 'A1', 'x-y', 'Yiddi.Weller', 'shop4', 'atwe_fan']) {
    assert.strictEqual(REG.usernameShapeError(n), null, n + ' should be a valid shape');
    assert.ok(!refused(n), n + ' should be allowed');
  }
});

test('leading, trailing and doubled punctuation is refused', () => {
  for (const n of ['.john', '_john', '-john', 'john.', 'john_', 'john-', 'jo..hn', '.', '..', '...', '-']) {
    assert.ok(REG.usernameShapeError(n), n + ' should be refused');
  }
});

test('names that end like a file are refused', () => {
  for (const n of ['john.png', 'john.JS', 'index.html', 'privacy.html', 'status.htm', 'a.json', 'x.webmanifest', 'jsqr.js', 'verified.svg']) {
    assert.ok(REG.usernameShapeError(n), n + ' should be refused');
  }
  // …but a dot that is not a file extension is fine.
  for (const n of ['john.doe', 'a.io', 'mr.smith']) assert.strictEqual(REG.usernameShapeError(n), null, n);
});

test('non-ASCII and over-long names are refused', () => {
  for (const n of ['jöhn', 'jоhn' /* Cyrillic o */, 'a'.repeat(41), 'john doe', 'john@x']) assert.ok(REG.usernameShapeError(n), n);
});

test('the database seed is UNCHANGED: SYSTEM_ROUTES is still exactly the router set', () => {
  // lockSystemRoutes seeds SYSTEM_ROUTES into reserved_usernames on every boot. It must
  // not grow: the wider new-username set is enforced in code, so a deploy writes no new
  // rows and nobody holding a newly-protected word is affected.
  assert.deepStrictEqual([...SYSTEM_ROUTES], REG.parseReserved());
  for (const w of SYSTEM_ROUTES) assert.ok(NEW_SET.has(w), w);
  assert.ok(ALLOCATION_RESERVED.length > SYSTEM_ROUTES.length, 'the new-username set should be the wider one');
});

test('every username write path in server.js goes through the gate', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const sliceRoute = (sig) => {
    const i = src.indexOf(sig);
    assert.ok(i > -1, 'route not found: ' + sig);
    const j = src.indexOf('\napp.', i + sig.length);
    return src.slice(i, j > -1 ? j : i + 6000);
  };
  const doors = [
    "app.post('/api/auth/signup',", "app.post('/api/auth/signup/verify'", "app.post('/api/auth/signup/finish'",
    "app.post('/api/auth/google/complete'", "app.post('/api/auth/apple/complete'", "app.put('/api/auth/profile'",
    "app.post('/api/bots'", "app.post('/api/admin/system-accounts'", "app.post('/api/admin/username-locks/:username/assign'",
    "app.post('/api/handles/claim'", "app.get('/api/handles/:username'", "app.post('/api/auth/exists'",
  ];
  for (const d of doors) assert.match(sliceRoute(d), /newUsernameError\(/, d + ' does not call newUsernameError');
  const gen = src.slice(src.indexOf('async function generateUsername('), src.indexOf('async function generateUsername(') + 600);
  assert.match(gen, /newUsernameError\(/, 'generated usernames must pass the gate too');
});

test('the beta seeding tool asks the same questions as the app', () => {
  const B = require('../seed/beta-account.js');
  const ok = { email: 'a@example.com', username: 'newtester', name: 'N' };
  assert.doesNotThrow(() => B.normalizeIdentity(ok));
  for (const bad of ['_lead', 'trail_']) {
    assert.throws(() => B.normalizeIdentity(Object.assign({}, ok, { username: bad })), /start and end/);
  }
});

/* ── Routes (real server, real database) ─────────────────────────────── */

const opts = { skip: H.SKIP ? 'no TEST_DATABASE_URL/DATABASE_URL set' : false };
let admin, adminToken;
before(async () => {
  if (H.SKIP) return;
  await H.startServer();
  admin = await H.seedUser();
  await H.getPool().query('UPDATE users SET is_admin = true WHERE id = $1', [admin.id]);
  adminToken = auth.signToken({ id: admin.id, email: admin.email, is_admin: true });
  await H.getPool().query('INSERT INTO auth_sessions (user_id, token_hash, user_agent, ip) VALUES ($1,$2,$3,$4)',
    [admin.id, auth.hashToken(adminToken), 'usernames-test', '127.0.0.1']);
});
after(async () => { if (!H.SKIP) await H.stopServer(); });

const profile = (token, username) => H.api('PUT', '/api/auth/profile', { token, body: { name: 'Test', username } });

test('a member cannot switch to a system word, a server root or a file name', opts, async () => {
  const u = await H.seedUser();
  const t = await H.login(u);
  for (const bad of ['wallet', 'Settings', 'go', 'catalog', 'beam', 'engine', 'account', 'privacy.html', 'x.png', '.lead', 'a..b']) {
    const r = await profile(t, bad);
    assert.equal(r.status, 400, bad + ' → ' + r.status + ' ' + JSON.stringify(r.body));
  }
  const still = (await H.getPool().query('SELECT username FROM users WHERE id = $1', [u.id])).rows[0].username;
  assert.equal(still, u.username, 'a refused change must leave the name exactly as it was');
});

test('an ordinary new username still works', opts, async () => {
  const u = await H.seedUser();
  const t = await H.login(u);
  const want = H.uniq('okname').replace('_', '.');
  const r = await profile(t, want);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const got = (await H.getPool().query('SELECT username FROM users WHERE id = $1', [u.id])).rows[0].username;
  assert.equal(got.toLowerCase(), want.toLowerCase());
});

test('GRANDFATHERED: a member holding a now-refused name keeps it and can still save', opts, async () => {
  const u = await H.seedUser();
  const legacy = '_old' + Date.now().toString(36) + '.';   // leading and trailing punctuation
  await H.getPool().query('UPDATE users SET username = $1 WHERE id = $2', [legacy, u.id]);
  const t = await H.login(u);
  const r = await profile(t, legacy);
  assert.equal(r.status, 200, 'saving a profile must never fail because an old handle predates today\'s rules: ' + JSON.stringify(r.body));
  const got = (await H.getPool().query('SELECT username FROM users WHERE id = $1', [u.id])).rows[0].username;
  assert.equal(got, legacy, 'nobody is renamed');
  // …but moving to ANOTHER refused name is still refused.
  assert.equal((await profile(t, '.other')).status, 400);
});

test('signup refuses a system word before anything else happens', opts, async () => {
  const r = await H.api('POST', '/api/auth/signup/finish', { body: {
    email: H.uniq('s') + '@test.local', code: '000000', name: 'New', password: 'Correct-Horse-9-battery',
    dob: '1990-01-01', username: 'catalog' } });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.match(r.body.error, /isn’t available/);
});

test('the username check tells the signup screen a system word is taken', opts, async () => {
  const r = await H.api('POST', '/api/auth/exists', { body: { identifier: 'catalog' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.exists, false);
  assert.equal(r.body.reserved, true);
  const ok = await H.api('POST', '/api/auth/exists', { body: { identifier: H.uniq('free') } });
  assert.equal(ok.body.reserved, false);
});

test('an existing member signing in with a grandfathered handle is not told it is "reserved"', opts, async () => {
  const u = await H.seedUser();
  const legacy = 'old' + Date.now().toString(36) + '.';
  await H.getPool().query('UPDATE users SET username = $1 WHERE id = $2', [legacy, u.id]);
  const r = await H.api('POST', '/api/auth/exists', { body: { identifier: legacy } });
  assert.equal(r.body.exists, true);
  assert.equal(r.body.reserved, false);
});

test('staff cannot assign a system word to an account', opts, async () => {
  const target = await H.seedUser();
  for (const n of ['go', 'wallet', 'catalog']) {
    const r = await H.api('POST', '/api/admin/username-locks/' + n + '/assign', { token: adminToken, body: { toId: target.id } });
    assert.equal(r.status, 409, n + ' → ' + r.status + ' ' + JSON.stringify(r.body));
  }
  const still = (await H.getPool().query('SELECT username FROM users WHERE id = $1', [target.id])).rows[0].username;
  assert.equal(still, target.username);
});

test('staff can still assign an ordinary admin-locked premium name', opts, async () => {
  const target = await H.seedUser();
  const prem = ('prem' + Date.now().toString(36)).toLowerCase();
  await H.getPool().query('INSERT INTO reserved_usernames (username, note) VALUES ($1, $2)', [prem, 'test lock']);
  const r = await H.api('POST', '/api/admin/username-locks/' + prem + '/assign', { token: adminToken, body: { toId: target.id } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const got = (await H.getPool().query('SELECT username FROM users WHERE id = $1', [target.id])).rows[0].username;
  assert.equal(got, prem);
});

test('staff system accounts go through the same gate', opts, async () => {
  const r = await H.api('POST', '/api/admin/system-accounts', { token: adminToken,
    body: { username: 'catalog', name: 'Catalog', password: 'Correct-Horse-9-battery' } });
  assert.equal(r.status, 400, JSON.stringify(r.body));
});

test('a system word is never sold, even if its lock row carries a price', opts, async () => {
  const u = await H.seedUser({ balanceCents: 100000 });
  const t = await H.login(u);
  const pool = H.getPool();
  await pool.query("INSERT INTO reserved_usernames (username, note) VALUES ('wallet', 'System route') ON CONFLICT (username) DO NOTHING");
  const before = (await pool.query("SELECT price_cents FROM reserved_usernames WHERE username = 'wallet'")).rows[0].price_cents;
  await pool.query("UPDATE reserved_usernames SET price_cents = 500 WHERE username = 'wallet'");
  try {
    const look = await H.api('GET', '/api/handles/wallet', { token: t });
    assert.equal(look.body.claimable, false);
    const buy = await H.api('POST', '/api/handles/claim', { token: t, body: { username: 'wallet', clientId: H.uniq('c') } });
    assert.equal(buy.status, 400, JSON.stringify(buy.body));
    const row = (await pool.query('SELECT username, balance_cents FROM users WHERE id = $1', [u.id])).rows[0];
    assert.equal(row.username, u.username, 'the name did not move');
    assert.equal(Number(row.balance_cents), 100000, 'no money moved');
  } finally {
    await pool.query("UPDATE reserved_usernames SET price_cents = $1 WHERE username = 'wallet'", [before]);
  }
});
