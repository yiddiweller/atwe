// Automated tests for the security-critical money + auth flows. Run with:
//   TEST_DATABASE_URL=postgres://user:pass@host/db npm test
// (skips cleanly when no database is configured — see helpers.js).
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const opts = { skip: H.SKIP ? 'no TEST_DATABASE_URL/DATABASE_URL set' : false };

before(async () => { if (!H.SKIP) await H.startServer(); });
after(async () => { await H.stopServer(); });

/* ───────────────────────── AUTH ───────────────────────── */

test('login with correct credentials returns a token + user', opts, async () => {
  const u = await H.seedUser();
  const r = await H.api('POST', '/api/auth/login', { body: { email: u.email, password: u.password } });
  assert.equal(r.status, 200);
  assert.ok(r.body.token, 'token present');
  assert.equal(r.body.user.id, u.id);
});

test('login with a wrong password is rejected (401)', opts, async () => {
  const u = await H.seedUser();
  const r = await H.api('POST', '/api/auth/login', { body: { email: u.email, password: 'wrongwrong' } });
  assert.equal(r.status, 401);
  assert.ok(!r.body.token);
});

test('a protected route requires a valid token', opts, async () => {
  const anon = await H.api('GET', '/api/auth/me');
  assert.equal(anon.status, 401);
  const bad = await H.api('GET', '/api/auth/me', { token: 'not.a.jwt' });
  assert.equal(bad.status, 401);
  const u = await H.seedUser();
  const token = await H.login(u);
  const ok = await H.api('GET', '/api/auth/me', { token });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.id, u.id);
});

/* ───────────────────────── WALLET ───────────────────────── */

test('demo top-up credits the wallet balance', opts, async () => {
  const u = await H.seedUser();
  const token = await H.login(u);
  const r = await H.api('POST', '/api/wallet/topup', { token, body: { amount: 10, clientId: H.uniq('cid') } });
  assert.equal(r.status, 200);
  assert.equal(r.body.balanceCents, 1000);
});

test('sending money debits sender, credits recipient, and is zero-sum', opts, async () => {
  const a = await H.seedUser({ balanceCents: 1000 });
  const b = await H.seedUser();
  const ta = await H.login(a);
  const r = await H.api('POST', '/api/wallet/send', { token: ta, body: { to: b.username, amount: 4, clientId: H.uniq('cid') } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.balanceCents, 600, 'sender left with $6');
  const pool = H.getPool();
  const bal = await pool.query('SELECT balance_cents FROM users WHERE id = ANY($1)', [[a.id, b.id]]);
  const sum = bal.rows.reduce((s, x) => s + x.balance_cents, 0);
  assert.equal(sum, 1000, 'total balance conserved (zero-sum transfer)');
  const rb = await pool.query('SELECT balance_cents FROM users WHERE id = $1', [b.id]);
  assert.equal(rb.rows[0].balance_cents, 400, 'recipient credited $4');
});

test('you cannot send money to yourself', opts, async () => {
  const u = await H.seedUser({ balanceCents: 1000 });
  const token = await H.login(u);
  const r = await H.api('POST', '/api/wallet/send', { token, body: { to: u.username, amount: 2, clientId: H.uniq('cid') } });
  assert.equal(r.status, 400);
});

test('sending to an unknown username 404s', opts, async () => {
  const u = await H.seedUser({ balanceCents: 1000 });
  const token = await H.login(u);
  const r = await H.api('POST', '/api/wallet/send', { token, body: { to: H.uniq('nope'), amount: 2, clientId: H.uniq('cid') } });
  assert.equal(r.status, 404);
});

/* ─────────────────── IDEMPOTENCY (double-tap safe) ─────────────────── */

test('two top-ups with the same clientId credit only once', opts, async () => {
  const u = await H.seedUser();
  const token = await H.login(u);
  const cid = H.uniq('cid');
  await H.api('POST', '/api/wallet/topup', { token, body: { amount: 10, clientId: cid } });
  await H.api('POST', '/api/wallet/topup', { token, body: { amount: 10, clientId: cid } });
  const me = await H.api('GET', '/api/auth/me', { token });
  assert.equal(me.body.user.balanceCents, 1000, 'credited once, not twice');
});

test('concurrent sends with the same clientId credit the recipient only once', opts, async () => {
  const a = await H.seedUser({ balanceCents: 2000 });
  const b = await H.seedUser();
  const ta = await H.login(a);
  const cid = H.uniq('cid');
  const send = () => H.api('POST', '/api/wallet/send', { token: ta, body: { to: b.username, amount: 5, clientId: cid } });
  await Promise.all([send(), send()]);
  const pool = H.getPool();
  const rb = await pool.query('SELECT balance_cents FROM users WHERE id = $1', [b.id]);
  assert.equal(rb.rows[0].balance_cents, 500, 'recipient credited exactly once');
  const ra = await pool.query('SELECT balance_cents FROM users WHERE id = $1', [a.id]);
  assert.equal(ra.rows[0].balance_cents, 1500, 'sender debited exactly once');
});

/* ─────────────────── VELOCITY CAP (anti-fraud) ─────────────────── */

test('outgoing sends past the daily cap are rejected (429)', opts, async () => {
  // Boot env sets WALLET_DAILY_CAP_CENTS=500 ($5). A $6 send must be capped.
  const a = await H.seedUser({ balanceCents: 5000 });
  const b = await H.seedUser();
  const ta = await H.login(a);
  const r = await H.api('POST', '/api/wallet/send', { token: ta, body: { to: b.username, amount: 6, clientId: H.uniq('cid') } });
  assert.equal(r.status, 429);
  assert.ok(r.body.velocityLimited, 'velocity flag set');
});

/* ─────────────────── PPV UNLOCK (claim-before-charge race) ─────────────────── */

test('concurrent PPV unlocks charge the buyer only once', opts, async () => {
  const author = await H.seedUser();
  const buyer = await H.seedUser({ balanceCents: 1000 });
  const pool = H.getPool();
  const { rows } = await pool.query(
    'INSERT INTO posts (user_id, body, ppv_cents) VALUES ($1,$2,$3) RETURNING id',
    [author.id, 'locked content', 300]
  );
  const postId = rows[0].id;
  const tb = await H.login(buyer);
  const unlock = () => H.api('POST', `/api/social/posts/${postId}/unlock`, { token: tb, body: {} });
  await Promise.all([unlock(), unlock()]);
  const bal = await pool.query('SELECT balance_cents FROM users WHERE id = $1', [buyer.id]);
  assert.equal(bal.rows[0].balance_cents, 700, 'buyer charged exactly one $3 unlock');
  const unlocks = await pool.query('SELECT count(*)::int AS n FROM post_unlocks WHERE post_id = $1 AND user_id = $2', [postId, buyer.id]);
  assert.equal(unlocks.rows[0].n, 1, 'exactly one unlock row');
  const ra = await pool.query('SELECT balance_cents FROM users WHERE id = $1', [author.id]);
  assert.equal(ra.rows[0].balance_cents, 300, 'author credited exactly once');
});

/* ─────────────────── DB BACKSTOP (balance never negative) ─────────────────── */

test('the database rejects a negative wallet balance', opts, async () => {
  const u = await H.seedUser({ balanceCents: 100 });
  const pool = H.getPool();
  await assert.rejects(
    () => pool.query('UPDATE users SET balance_cents = -1 WHERE id = $1', [u.id]),
    (e) => e.code === '23514', // check_violation
    'users_balance_nonneg CHECK fires'
  );
});
