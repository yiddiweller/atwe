// Personal / business account type: is the choice real, and is the conversion safe?
//
// Two halves, deliberately. The SOURCE checks hold the invariants that no running
// server can show you (there is no `SET account_type` anywhere but the one route;
// `PUT /api/auth/profile` cannot write it; there is no downgrade; admin cannot edit
// it), and they run with no database at all. The LIVE checks drive the real routes.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { SKIP, api, seedUser, login, startServer, stopServer, getPool } = require('./helpers');

const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const ADMIN = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');

/* ---------------------------------------------------------------- source ---- */

test('S1 exactly one place in the tree sets account_type after signup, and it is the conversion route', () => {
  const sets = SRV.match(/SET account_type/g) || [];
  assert.equal(sets.length, 1, 'server.js should contain exactly one `SET account_type`');
  const i = SRV.indexOf('SET account_type');
  const before = SRV.slice(Math.max(0, i - 2000), i);
  assert.ok(/convert-to-business/.test(before), 'the one write must belong to /api/account/convert-to-business');
  for (const f of ['db.js', 'beta-access.js', 'demo.js', 'seed/beta-account.js']) {
    const s = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.ok(!/SET account_type/.test(s), `${f} must not write account_type`);
  }
});

test('S2 the conversion route names no id, no username and no client-supplied type', () => {
  const i = SRV.indexOf("app.post('/api/account/convert-to-business'");
  assert.ok(i > 0, 'the conversion route should exist');
  const body = SRV.slice(i, SRV.indexOf('\napp.', i + 10));
  assert.ok(/auth\.requireAuth/.test(body), 'it must be requireAuth');
  assert.ok(/blockImpersonation/.test(body), 'it must refuse an impersonating admin');
  assert.ok(/rateLimit\(/.test(body), 'it must be rate limited');
  assert.ok(!/req\.params/.test(body), 'it must take no route parameter');
  assert.ok(!/req\.body\.(userId|username|accountType|account_type|id)\b/.test(body),
    'it must not read an account, a username or a target type from the body');
  assert.ok(/req\.user\.id/.test(body), 'it must act on the caller');
  assert.ok(/accountStatusBlock\(/.test(body), 'it must refuse a suspended or banned account');
  assert.ok(/deactivated/.test(body), 'it must refuse a deactivated account');
  // Claim-first: the guard is in the WHERE, so a repeat writes nothing.
  assert.ok(/account_type <> 'business'/.test(body), 'the UPDATE must be guarded so a repeat is a no-op');
});

test('S3 the conversion writes account_type and nothing else', () => {
  const i = SRV.indexOf("app.post('/api/account/convert-to-business'");
  const body = SRV.slice(i, SRV.indexOf('\napp.', i + 10));
  const update = body.match(/UPDATE users SET (.+?) WHERE/);
  assert.ok(update, 'the route should run one UPDATE users');
  assert.equal(update[1].trim(), "account_type = 'business'", 'exactly one column may be written');
  assert.equal((body.match(/UPDATE users/g) || []).length, 1, 'exactly one UPDATE');
  for (const col of ['onboarded', 'onboard_step', 'onboard_deferred', 'intent', 'categories',
                     'business_verify_status', 'plan', 'username', 'email', 'password_hash']) {
    assert.ok(!new RegExp(col + '\\s*=').test(update[0]), `the conversion must not touch ${col}`);
  }
});

test('S4 there is no business to personal downgrade anywhere', () => {
  assert.ok(!/account_type = 'personal'/.test(SRV.replace(/u\.account_type = 'personal'/g, '')),
    'nothing may set account_type back to personal');
  assert.ok(!/convert-to-personal|downgrade-account|to-personal/.test(SRV), 'no downgrade route');
  assert.ok(!/convert-to-personal|acConvertToPersonal/.test(APP), 'no downgrade in the app');
});

test('S5 PUT /api/auth/profile still cannot write an account type', () => {
  const i = SRV.indexOf("app.put('/api/auth/profile'");
  assert.ok(i > 0);
  const body = SRV.slice(i, SRV.indexOf('\napp.', i + 10));
  const update = body.match(/UPDATE users SET[\s\S]{0,1200}?RETURNING/);
  assert.ok(update, 'the profile route should run an UPDATE');
  assert.ok(!/account_type\s*=/.test(update[0]),
    'account type is a state transition, not a profile field');
});

test('S6 the admin dashboard offers no account-type editor', () => {
  assert.ok(!/SET account_type|convert-to-business/.test(ADMIN), 'admin must not convert an account');
  // It may SHOW the type; it may not change it.
  const writes = ADMIN.match(/account_type\s*[:=][^=]/g) || [];
  for (const w of writes) assert.ok(!/account_type\s*=\s*['"]/.test(w), 'admin must not assign an account type');
});

test('S7 the 18+ gate is still enforced on every signup route', () => {
  // NB /api/auth/signup/start takes only an email (it mails the code); the date of
  // birth is collected at /finish. These four are every route that creates an account.
  const routes = ["'/api/auth/signup'", "'/api/auth/signup/finish'",
                  "'/api/auth/google/complete'", "'/api/auth/apple/complete'"];
  for (const r of routes) {
    const i = SRV.indexOf('app.post(' + r);
    assert.ok(i > 0, r + ' should exist');
    const body = SRV.slice(i, SRV.indexOf('\napp.', i + 10));
    assert.ok(/ageFromDob\(/.test(body), r + ' must read the date of birth');
    assert.ok(/age < 18/.test(body), r + ' must still refuse under 18');
  }
});

test('S8 the birthday step asks a business the honest question, and the age rule is unchanged', () => {
  const i = APP.indexOf('function suDobRender()');
  assert.ok(i > 0);
  const body = APP.slice(i, APP.indexOf('\nfunction ', i + 10));
  assert.ok(/SU\.accountType === 'business'/.test(body), 'the copy must switch on the chosen account type');
  assert.ok(/person setting this account up/.test(body), 'the business question must be about the person, not the company');
  assert.ok(/18 or older/.test(APP), 'the 18+ line must still be shown');
  const cont = APP.slice(APP.indexOf('function suDobContinue()'));
  assert.ok(/age < 18/.test(cont.slice(0, 600)), 'the client must still refuse under 18');
});

test('S9 the OAuth wizard carries the chosen type, and both complete routes honour it', () => {
  const fin = APP.slice(APP.indexOf('async function suFinish('));
  const body = fin.slice(0, fin.indexOf('\n}'));
  assert.equal((body.match(/accountType: SU\.accountType/g) || []).length, 2,
    'both the OAuth and the email branch must send the chosen type');
  for (const r of ["'/api/auth/google/complete'", "'/api/auth/apple/complete'"]) {
    const i = SRV.indexOf('app.post(' + r);
    const rb = SRV.slice(i, SRV.indexOf('\napp.', i + 10));
    assert.ok(/req\.body\.accountType === 'business'/.test(rb), r + ' must read the chosen type');
    assert.ok(/account_type/.test(rb) && /INSERT INTO users/.test(rb), r + ' must store it');
  }
  // A returning OAuth member is signed in, never re-typed.
  for (const r of ["'/api/auth/google'", "'/api/auth/apple'"]) {
    const i = SRV.indexOf('app.post(' + r + ',');
    if (i < 0) continue;
    const rb = SRV.slice(i, SRV.indexOf('\napp.', i + 10));
    assert.ok(!/SET account_type|UPDATE users SET account_type/.test(rb),
      r + ' must never change an existing account type');
  }
});

test('S10 the conversion has exactly one entry point in the app', () => {
  const calls = (APP.match(/acConvertToBusiness\(\)/g) || []).length;
  // one definition + the Account row + the team empty state's way out.
  assert.ok(calls >= 2 && calls <= 4, `expected a small number of call sites, found ${calls}`);
  assert.equal((APP.match(/\/api\/account\/convert-to-business/g) || []).length, 1,
    'exactly one place in the app may call the conversion route');
  assert.ok(/Switch to a business account to invite members/.test(APP) === false,
    'the old dead end that named a switch which did not exist must be gone');
});

test('S11 the conversion never writes a local "you are a business" state', () => {
  const i = APP.indexOf('async function acConvertToBusiness()');
  assert.ok(i > 0);
  const body = APP.slice(i, APP.indexOf('\nfunction ', i + 10));
  assert.ok(!/S\.user\.accountType\s*=/.test(body), 'it must not patch the type locally');
  assert.ok(/\/api\/auth\/me/.test(body), 'it must re-read the account from the server');
  assert.ok(!/localStorage|sessionStorage/.test(body), 'no local fallback');
});

/* ------------------------------------------------------------------ live ---- */

before(async () => { if (!SKIP) await startServer(); });
after(async () => { if (!SKIP) await stopServer(); });

const t = (name, fn) => test(name, { skip: SKIP ? 'no database' : false }, fn);

t('L1 a personal account becomes a business, and keeps everything else', async () => {
  const u = await seedUser({ balanceCents: 4321 });
  const tok = await login(u);
  const pool = getPool();
  const cols = 'id, username, email, password_hash, plan, balance_cents, created_at, onboarded, onboard_step, onboard_deferred, intent, categories, business_verify_status, dob, verified';
  const beforeRow = (await pool.query(`SELECT ${cols}, account_type FROM users WHERE id = $1`, [u.id])).rows[0];
  assert.equal(beforeRow.account_type, 'personal');

  const r = await api('POST', '/api/account/convert-to-business', { token: tok, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.accountType, 'business');

  const afterRow = (await pool.query(`SELECT ${cols}, account_type FROM users WHERE id = $1`, [u.id])).rows[0];
  assert.equal(afterRow.account_type, 'business', 'the type changed');
  for (const k of cols.split(',').map((s) => s.trim())) {
    assert.deepEqual(JSON.stringify(afterRow[k]), JSON.stringify(beforeRow[k]), `${k} must be untouched`);
  }
  // The session still works and the app sees a business.
  const me = await api('GET', '/api/auth/me', { token: tok });
  assert.equal(me.status, 200, 'the same session must still be valid');
  assert.equal(me.body.user.accountType, 'business');
  assert.equal(me.body.user.username, u.username, 'same @username');
});

t('L2 converting twice is safe and resets nothing', async () => {
  const u = await seedUser();
  const tok = await login(u);
  const pool = getPool();
  assert.equal((await api('POST', '/api/account/convert-to-business', { token: tok, body: {} })).status, 200);
  const snap = (await pool.query('SELECT * FROM users WHERE id = $1', [u.id])).rows[0];
  const again = await api('POST', '/api/account/convert-to-business', { token: tok, body: {} });
  assert.equal(again.status, 409, 'a repeat must be refused, not re-run');
  assert.equal(again.body.already, true);
  const after = (await pool.query('SELECT * FROM users WHERE id = $1', [u.id])).rows[0];
  assert.deepEqual(JSON.stringify(after), JSON.stringify(snap), 'a repeat must write nothing at all');
});

t('L3 the caller cannot name a different account or a different target type', async () => {
  const me = await seedUser();
  const victim = await seedUser();
  const tok = await login(me);
  const pool = getPool();
  const r = await api('POST', '/api/account/convert-to-business', {
    token: tok,
    body: { userId: victim.id, id: victim.id, username: victim.username, accountType: 'personal', account_type: 'personal' },
  });
  assert.equal(r.status, 200, 'the extra fields are simply ignored');
  const mine = (await pool.query('SELECT account_type FROM users WHERE id = $1', [me.id])).rows[0];
  const theirs = (await pool.query('SELECT account_type FROM users WHERE id = $1', [victim.id])).rows[0];
  assert.equal(mine.account_type, 'business', 'the caller converted');
  assert.equal(theirs.account_type, 'personal', 'the named account is untouched');
});

t('L4 an unauthenticated caller is refused', async () => {
  const r = await api('POST', '/api/account/convert-to-business', { body: {} });
  assert.equal(r.status, 401);
});

t('L5 a suspended account cannot convert', async () => {
  const u = await seedUser();
  const tok = await login(u);
  await getPool().query("UPDATE users SET status = 'suspended', status_reason = 'test' WHERE id = $1", [u.id]);
  const r = await api('POST', '/api/account/convert-to-business', { token: tok, body: {} });
  assert.equal(r.status, 403, JSON.stringify(r.body));
  const row = (await getPool().query('SELECT account_type FROM users WHERE id = $1', [u.id])).rows[0];
  assert.equal(row.account_type, 'personal', 'nothing was written');
});

t('L6 a deactivated account cannot convert', async () => {
  const u = await seedUser();
  const tok = await login(u);
  await getPool().query('UPDATE users SET deactivated = true WHERE id = $1', [u.id]);
  const r = await api('POST', '/api/account/convert-to-business', { token: tok, body: {} });
  assert.equal(r.status, 403);
  const row = (await getPool().query('SELECT account_type FROM users WHERE id = $1', [u.id])).rows[0];
  assert.equal(row.account_type, 'personal');
});

t('L7 a business-only route refuses before the conversion and serves after it', async () => {
  const u = await seedUser();
  const tok = await login(u);
  const before = await api('GET', '/api/business/team', { token: tok });
  assert.ok(before.status >= 400, `a personal account has no team (got ${before.status})`);
  assert.equal((await api('POST', '/api/account/convert-to-business', { token: tok, body: {} })).status, 200);
  const after = await api('GET', '/api/business/team', { token: tok });
  assert.equal(after.status, 200, 'the same account now has one');
});

t('L8 converting leaves onboarding exactly where it was', async () => {
  const u = await seedUser();
  const tok = await login(u);
  const pool = getPool();
  await pool.query("UPDATE users SET onboarded = false, onboard_step = 'topics', onboard_deferred = true, intent = 'sell' WHERE id = $1", [u.id]);
  assert.equal((await api('POST', '/api/account/convert-to-business', { token: tok, body: {} })).status, 200);
  const me = await api('GET', '/api/auth/me', { token: tok });
  assert.equal(me.body.user.onboarded, false);
  assert.equal(me.body.user.onboardStep, 'topics');
  assert.equal(me.body.user.onboardDeferred, true);
  assert.equal(me.body.user.intent, 'sell');
});

t('L9 a legacy row with the column default behaves as a personal account', async () => {
  const pool = getPool();
  const email = 'legacy' + Date.now() + '@test.local';
  const username = 'legacy' + Date.now();
  const hash = await require('../auth').hashPassword('testpass123');
  // Inserted WITHOUT naming account_type, exactly as a pre-column row ends up.
  const { rows } = await pool.query(
    'INSERT INTO users (name, email, password_hash, username, email_verified) VALUES ($1,$2,$3,$4,true) RETURNING id, account_type',
    ['Legacy', email, hash, username]
  );
  assert.equal(rows[0].account_type, 'personal', 'the column default is personal');
  const tok = await login({ id: rows[0].id, email });
  const me = await api('GET', '/api/auth/me', { token: tok });
  assert.equal(me.body.user.accountType, 'personal');
  assert.equal((await api('POST', '/api/account/convert-to-business', { token: tok, body: {} })).status, 200);
});

t('L10 the profile route cannot be used to change the account type', async () => {
  const u = await seedUser();
  const tok = await login(u);
  const r = await api('PUT', '/api/auth/profile', {
    token: tok,
    body: { name: 'Test', username: u.username, accountType: 'business', account_type: 'business' },
  });
  assert.ok(r.status < 400, JSON.stringify(r.body));
  const row = (await getPool().query('SELECT account_type FROM users WHERE id = $1', [u.id])).rows[0];
  assert.equal(row.account_type, 'personal', 'the profile route must never promote an account');
});

t('L11 a business account created at signup is a business, both types round-trip', async () => {
  for (const want of ['personal', 'business']) {
    const u = await seedUser({ accountType: want });
    const tok = await login(u);
    const me = await api('GET', '/api/auth/me', { token: tok });
    assert.equal(me.body.user.accountType, want);
  }
});
