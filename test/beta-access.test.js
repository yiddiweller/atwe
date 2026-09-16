/* ADMIN -> BETA ACCESS. What it refuses, and what it never returns.
 *
 * NO DATABASE AND NO NETWORK. That is a deliberate choice, not a shortcut: the
 * whole suite skips cleanly where there is no Postgres, and a guard that only
 * runs on a machine with a database is a guard nobody can trust on the day it
 * matters. So the rules are proved three ways, and every one of them runs
 * anywhere `npm test` does:
 *
 *   PURE          the environment gate and the shape that leaves the module are
 *                 plain functions over plain objects.
 *   FAKE DB       a tiny recorder stands in for pg, so the interesting questions
 *                 ("was an UPDATE ever issued", "did the WHERE re-assert the
 *                 tag", "did anything call seedDemo") are asked of the real SQL.
 *   SOURCE        the things no unit test can reach -- that every route carries
 *                 requireAdmin AND betaOnly, that no route hands back a hash --
 *                 are read out of server.js itself. A route test can only cover
 *                 routes whose preconditions it can arrange; reading the source
 *                 covers the seventh route somebody adds next year.
 *
 * COMMENTS ARE STRIPPED BEFORE ANY STRUCTURAL SCAN. These files DOCUMENT what
 * they refuse to do ("there is no delete", "no DROP, no TRUNCATE"), so a raw
 * grep reports the prose as if it were code. jstext.scan is the repo's own
 * tokeniser and blanks comments while keeping every offset.
 *
 * SELF-TESTED. Six deliberate breaks were made and re-run: dropping betaOnly
 * from one route, letting the list include untagged accounts, allowing @atwe
 * through the ordinary password reset, letting createAccount pass a role
 * through, removing the staff refusal, and returning the account row raw
 * instead of through safeAccount. All six were caught. The `role` break is
 * worth naming: the first attempt at it edited a COMMENT rather than the code,
 * the tests stayed green, and the break itself was the bug. Always assert the
 * break changed something before believing the result.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const jstext = require('../tools/jstext');
const betaAccess = require('../beta-access');
const account = require('../seed/beta-account');
const guard = require('../tools/seed-guard');
const auth = require('../auth');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const SERVER_CODE = jstext.scan(SERVER).code;
const SVC = fs.readFileSync(path.join(ROOT, 'beta-access.js'), 'utf8');
const SVC_CODE = jstext.scan(SVC).code;
const MOD_CODE = jstext.scan(fs.readFileSync(path.join(ROOT, 'seed', 'beta-account.js'), 'utf8')).code;
const ADMIN = fs.readFileSync(path.join(ROOT, 'public', 'admin.html'), 'utf8');

/* Every Beta Access route, as it is written in server.js. */
const BETA_ROUTES = [...SERVER_CODE.matchAll(
  /app\.(get|post|patch|delete|put)\(\s*'(\/api\/admin\/beta[^']*)'([^\n]*)/g)]
  .map((m) => ({ verb: m[1], path: m[2], rest: m[3] }));

/* A db that answers "nothing is there" and remembers every statement. */
function fakeDb(rowsFor = () => ({ rows: [], rowCount: 0 })) {
  const sql = [];
  return { sql, async query(text, params) { sql.push({ text: String(text), params }); return rowsFor(text, params); } };
}
const joined = (db) => db.sql.map((q) => q.text).join('\n');

const BETA_ENV = { ATWE_ENV: 'beta', APP_URL: 'https://beta.atwe.com', DATABASE_URL: 'postgres://u:p@db.internal/beta' };

/* Rows shaped the way the SELECT in beta-access.js returns them. */
const ordinaryRow = (o = {}) => Object.assign({
  id: 2, name: 'Yiddi Weller', email: 'y@example.com', username: 'yiddiweller',
  account_type: 'personal', headline: null, bio: null, is_admin: false, admin_perms: [],
  admin_role: null, is_demo: false, verified: false, email_verified: true, status: 'active',
  status_reason: null, suspended_until: null, deactivated: false, totp_enabled: false,
  seed_tag: 'beta', created_at: '2026-09-15T09:00:00.000Z', demo_follows: 40,
}, o);

const officialRow = (o = {}) => Object.assign({
  id: 1, name: 'Atwe', email: 'no-reply+atwe@atwe.internal', username: 'atwe',
  account_type: 'business', headline: 'Product news and tips from Atwe', bio: null,
  is_admin: false, admin_perms: [], admin_role: null, is_demo: false, verified: true,
  email_verified: true, status: 'active', status_reason: null, suspended_until: null,
  deactivated: false, totp_enabled: false, seed_tag: 'beta-keep',
  created_at: '2026-09-14T10:00:00.000Z', demo_follows: 0,
}, o);

/* ═══ 1. THE ENVIRONMENT IS THE FIRST GATE ═══════════════════════════════ */

test('1. outside beta the service refuses, and for the same reasons the seeder does', () => {
  const prod = betaAccess.envState({ ATWE_ENV: 'production', APP_URL: 'https://atwe.com', DATABASE_URL: 'postgres://u:p@h/d' });
  assert.equal(prod.ok, false);
  assert.ok(prod.failures.some((f) => /ATWE_ENV must be exactly "beta"/.test(f)));
  assert.ok(prod.failures.some((f) => /production host/.test(f)));
  assert.equal(betaAccess.isBeta({ ATWE_ENV: '', APP_URL: 'https://atwe.com' }), false);
  assert.equal(betaAccess.isBeta(BETA_ENV), true);
  /* The SAME function, not a second copy that could drift. */
  assert.deepEqual(betaAccess.envState(BETA_ENV).info, guard.checkEnvironment(BETA_ENV).info);
});

test('1b. an unset ATWE_ENV is refused, not treated as beta', () => {
  for (const v of [undefined, '', 'Beta ', 'betaX', 'prod', 'production']) {
    const r = betaAccess.envState({ ATWE_ENV: v, APP_URL: 'https://beta.atwe.com', DATABASE_URL: 'postgres://u:p@h/d' });
    if (String(v || '').trim().toLowerCase() === 'beta') continue;
    assert.equal(r.ok, false, `ATWE_ENV=${JSON.stringify(v)} must refuse`);
  }
});

test('1c. EVERY beta route carries requireAdmin AND betaOnly, in that order', () => {
  assert.ok(BETA_ROUTES.length >= 6, `expected the beta routes, found ${BETA_ROUTES.length}`);
  for (const r of BETA_ROUTES) {
    assert.match(r.rest, /auth\.requireAdmin\s*,\s*betaOnly/,
      `${r.verb.toUpperCase()} ${r.path} must be auth.requireAdmin then betaOnly`);
  }
  /* Including the READ routes. A list of who can get into beta is not something
     production should answer at all. */
  const reads = BETA_ROUTES.filter((r) => r.verb === 'get');
  assert.ok(reads.length >= 2, 'the list and the detail route must both exist');
  for (const r of reads) assert.match(r.rest, /betaOnly/, `${r.path} must be gated too`);
});

test('1d. betaOnly runs the real guard and answers 403, it does not trust a flag', () => {
  const fn = SERVER_CODE.slice(SERVER_CODE.indexOf('function betaOnly'));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  assert.match(body, /betaAccess\.envState\(process\.env\)/);
  assert.match(body, /res\.status\(403\)/);
  assert.doesNotMatch(body, /req\.(body|query|headers)/, 'the gate must not read anything the client sent');
});

test('1e. /api/config only HINTS at beta, and says so', () => {
  assert.match(SERVER_CODE, /betaEnv:\s*betaAccess\.isBeta\(process\.env\)/);
  /* The dashboard may hide the tab, and must never be the thing enforcing it. */
  assert.match(ADMIN, /if \(tab === 'betaaccess' && !BETA_ENV\) return false;/);
  assert.match(ADMIN, /BETA_ENV = cfg\.betaEnv === true;/);
  assert.match(ADMIN, /let BETA_ENV = false;/, 'it must start closed, not open');
});

/* ═══ 2. WHO MAY BE LISTED AT ALL ════════════════════════════════════════ */

test('2. the list is beta-owned accounts only, by explicit criteria', async () => {
  const db = fakeDb(() => ({ rows: [], rowCount: 0 }));
  await betaAccess.listAccounts(db);
  const q = db.sql[0];
  assert.match(q.text, /seed_tag = \$1/);
  assert.match(q.text, /seed_tag = \$2 AND lower\(u\.username\) = \$3/);
  assert.deepEqual(q.params, ['beta', 'beta-keep', 'atwe']);
  /* Never a bare "everyone". `is_demo` DOES appear in the query, and correctly:
     it is how the follows sub-select counts demo accounts. What must never use
     it is the WHERE that decides who is listed, so the outer WHERE is sliced out
     and checked on its own. A regex over the whole statement would have failed
     on working code, which is what the first version of this did. */
  assert.doesNotMatch(q.text, /FROM users u\s*ORDER/i);
  const outerWhere = q.text.slice(q.text.indexOf('WHERE ${OWNED') >= 0 ? 0 : q.text.lastIndexOf('WHERE'));
  assert.doesNotMatch(outerWhere, /is_demo/, 'the ownership test must not infer from is_demo');
  assert.match(outerWhere, /seed_tag/);
});

test('2b. an untagged account is not reachable, even by id', async () => {
  const db = fakeDb(() => ({ rows: [], rowCount: 0 }));   // the WHERE excludes it, so nothing comes back
  assert.equal(await betaAccess.getAccount(db, 77), null);
  assert.match(db.sql[0].text, /u\.id = \$4 AND \(u\.seed_tag = \$1/);
  await assert.rejects(() => betaAccess.assertManageable(db, 77, 'any'),
    /not managed by beta tooling/);
});

test('2c. the SELECT never asks for a credential column', () => {
  const forbidden = ['password_hash', 'totp_secret', 'totp_recovery', 'stripe_customer_id',
    'stripe_connect_id', 'oauth_provider', 'oauth_id', 'referral_code', 'chat_lock_pin', 'e2ee_public_key'];
  const cols = SVC_CODE.slice(SVC_CODE.indexOf('const ACCOUNT_COLS'), SVC_CODE.indexOf('const OWNED_BY_BETA'));
  for (const c of forbidden) assert.ok(!cols.includes(c), `ACCOUNT_COLS must not read ${c}`);
  assert.ok(!/SELECT\s+\*/i.test(SVC_CODE), 'no SELECT * in the service layer');
});

/* ═══ 3. NOTHING SECRET LEAVES ═══════════════════════════════════════════ */

test('3. safeAccount drops every secret it is handed', () => {
  const out = betaAccess.safeAccount(ordinaryRow({
    password_hash: '$2b$10$aaaaaaaaaaaaaaaaaaaaaa', totp_secret: 'JBSWY3DPEHPK3PXP',
    totp_recovery: ['abc'], stripe_customer_id: 'cus_123', oauth_provider: 'google',
  }));
  const json = JSON.stringify(out);
  for (const secret of ['$2b$', 'JBSWY3DPEHPK3PXP', 'cus_123', 'google', 'totp_secret', 'password']) {
    assert.ok(!json.includes(secret), `safeAccount leaked ${secret}`);
  }
  assert.equal(out.username, 'yiddiweller');
  assert.equal(out.twoFactor, false);      // the FACT is reported, never the secret
});

test('3b. no route hands back a password or a hash', () => {
  const start = SERVER_CODE.indexOf("app.get('/api/admin/beta/accounts'");
  const end = SERVER_CODE.indexOf("app.get('/api/admin/storage'");
  assert.ok(start > 0 && end > start, 'could not slice the beta routes');
  const block = SERVER_CODE.slice(start, end);
  assert.doesNotMatch(block, /res\.json\([^)]*passwordHash/);
  assert.doesNotMatch(block, /res\.json\([^)]*password\b/);
  assert.doesNotMatch(block, /console\.log\([^)]*password/i);
  /* The audit row records WHAT happened, never the value. */
  /* The audit rows record WHAT happened, never the value. The action NAME is
     `beta_password_reset`, so the word itself is there by design -- what is
     checked is the meta object, which is the only part carrying data. */
  const audits = [...block.matchAll(/adminAudit\([^;]*\)/g)].map((m) => m[0]);
  /* FOUR calls, FIVE action names: revoke and restore are one call with a
     ternary, because they are one route. Counting names and expecting calls is
     how the first version of this failed on correct code. */
  assert.ok(audits.length >= 4, `every write must audit-log (found ${audits.length})`);
  for (const a of audits) {
    const meta = a.slice(a.indexOf('{'));
    assert.doesNotMatch(meta, /\bpassword|passwordHash|\bhash\b|\bpw\b/i,
      `an audit row must not carry a credential: ${a.slice(0, 60)}`);
  }
});

test('3c. the shape leaving the module is safeAccount, everywhere', () => {
  /* Every read path funnels through it, so a new field cannot be returned raw.
     Matched loosely around the call because safeAccount now takes a second
     argument (the beta-only allowAdmin flag); what must hold is that no read
     path returns a database row without passing it through. */
  assert.match(SVC_CODE, /rows\.map\(.{0,40}?safeAccount\(/);
  assert.match(SVC_CODE, /rows\[0\] \? safeAccount\(rows\[0\]/);
});

/* ═══ 4. ADDING AN ACCOUNT ═══════════════════════════════════════════════ */

test('4. one account, tagged beta in the INSERT itself, member only', async () => {
  const db = fakeDb((text) => (/INSERT INTO users/.test(text) ? { rows: [{ id: 51 }], rowCount: 1 }
    : /SELECT \$\{|FROM users u/.test(text) ? { rows: [ordinaryRow({ id: 51, username: 'newtester' })], rowCount: 1 }
    : { rows: [], rowCount: 0 }));
  const hash = await auth.hashPassword('Quiet-Harbour-41');
  await betaAccess.createAccount(db, {
    identity: { email: 'new@example.com', username: 'newtester', name: 'New Tester', accountType: 'personal' },
    passwordHash: hash,
  });
  const inserts = db.sql.filter((q) => /INSERT INTO/i.test(q.text));
  assert.equal(inserts.length, 1, 'exactly one INSERT');
  assert.match(inserts[0].text, /INSERT INTO users/);
  assert.match(inserts[0].text, /seed_tag\)/);
  assert.ok(inserts[0].params.includes('beta'), 'the tag is written in the INSERT');
  assert.ok(inserts[0].params.includes(hash), 'the hash the caller supplied, not a re-hash');
  /* is_admin is the 9th placeholder and comes from role === 'admin'. */
  assert.ok(inserts[0].params.includes(false), 'is_admin false');
  assert.ok(!joined(db).match(/UPDATE|DELETE/i), 'creating touches nothing that exists');
});

test('4b. a role sent by the caller is thrown away, not honoured', async () => {
  const db = fakeDb((text) => (/INSERT INTO users/.test(text) ? { rows: [{ id: 52 }], rowCount: 1 }
    : /FROM users u/.test(text) ? { rows: [ordinaryRow({ id: 52 })], rowCount: 1 } : { rows: [], rowCount: 0 }));
  await betaAccess.createAccount(db, {
    identity: { email: 'x@example.com', username: 'sneaky', name: 'S', role: 'admin' },
    passwordHash: await auth.hashPassword('Quiet-Harbour-41'),
  });
  const ins = db.sql.find((q) => /INSERT INTO users/.test(q.text));
  assert.ok(!ins.params.includes(true), 'is_admin must be false whatever the caller asked for');
  /* And the service pins it rather than relying on the route to strip it. */
  assert.match(SVC_CODE, /delete id\.role;/);
  assert.match(SVC_CODE, /role: 'member'/);
});

test('4c. the route never reads a role field at all', () => {
  const start = SERVER_CODE.indexOf("app.post('/api/admin/beta/accounts'");
  const block = SERVER_CODE.slice(start, SERVER_CODE.indexOf("app.post('/api/admin/beta/accounts/:id/password'"));
  assert.doesNotMatch(block, /\brole\b/, 'the create route must not accept a role');
  assert.doesNotMatch(block, /is_admin|isAdmin|adminPerms|admin_perms/);
  assert.match(block, /claimReserved: false/.test(SVC_CODE) ? /identityProblemFor/ : /identityProblemFor/);
});

test('4d. a duplicate username or email refuses, and writes nothing', async () => {
  for (const which of ['username', 'email']) {
    const db = fakeDb((text) => (
      /lower\(username\) = lower\(\$1\)/.test(text) && which === 'username'
        ? { rows: [{ id: 9, username: 'taken', seed_tag: null }], rowCount: 1 }
      : /lower\(email\) = lower\(\$1\)/.test(text) && which === 'email'
        ? { rows: [{ id: 9, username: 'taken' }], rowCount: 1 }
      : { rows: [], rowCount: 0 }));
    await assert.rejects(() => betaAccess.createAccount(db, {
      identity: { email: 'taken@example.com', username: 'taken', name: 'T' },
      passwordHash: '$2b$10$aaaaaaaaaaaaaaaaaaaaaa',
    }), /already exists|already belongs/);
    assert.ok(!/INSERT INTO/i.test(joined(db)), `a duplicate ${which} must not insert`);
  }
});

test('4e. @atwe cannot be created here: it is a reserved handle and this never claims one', async () => {
  const db = fakeDb((text) => (/reserved_usernames/.test(text) ? { rows: [{ username: 'atwe' }], rowCount: 1 }
    : { rows: [], rowCount: 0 }));
  await assert.rejects(() => betaAccess.createAccount(db, {
    identity: { email: 'x@example.com', username: 'atwe', name: 'Atwe' },
    passwordHash: '$2b$10$aaaaaaaaaaaaaaaaaaaaaa',
  }), /RESERVED username/);
  assert.ok(!/INSERT INTO/i.test(joined(db)));
  /* And the escape hatch the CLI has is not wired to this door. */
  assert.match(SVC_CODE, /claimReserved: false/);
});

test('4f. the password rules are the seeder\'s own, and both fields are required', () => {
  assert.equal(betaAccess.passwordProblem('short'), guard.passwordProblem('short'));
  assert.ok(betaAccess.passwordProblem('nine char'));
  assert.ok(betaAccess.passwordProblem('betaisfine123'), 'an obvious opening is refused');
  assert.equal(betaAccess.passwordProblem('Quiet-Harbour-41'), null);
  const fn = SERVER_CODE.slice(SERVER_CODE.indexOf('function betaPasswordFrom'));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  assert.match(body, /pw !== confirm/, 'the confirmation field is enforced server-side too');
  assert.match(body, /betaAccess\.passwordProblem\(pw\)/);
});

test('4g. hashing is the app\'s own auth.hashPassword, never a local bcrypt', () => {
  const start = SERVER_CODE.indexOf("app.post('/api/admin/beta/accounts'");
  const block = SERVER_CODE.slice(start, SERVER_CODE.indexOf("app.get('/api/admin/storage'"));
  const hashes = [...block.matchAll(/passwordHash:\s*([^,\n]+)/g)].map((m) => m[1].trim());
  assert.ok(hashes.length >= 2, 'both create and reset must hash');
  for (const h of hashes) assert.match(h, /await auth\.hashPassword\(/);
  assert.doesNotMatch(block, /require\(['"]bcrypt/);
  assert.doesNotMatch(block, /\.hash\(/);
});

/* ═══ 5. THE PROTECTED OFFICIAL ACCOUNT ══════════════════════════════════ */

test('5. @atwe is recognised, labelled protected, and keeps beta-keep', () => {
  const out = betaAccess.safeAccount(officialRow());
  assert.equal(out.official, true);
  assert.equal(out.betaStatus, 'protected');
  assert.equal(out.betaLabel, 'Protected beta account');
  assert.equal(out.officialVerified, true);
  assert.equal(betaAccess.KEEP_TAG, 'beta-keep');
  assert.notEqual(betaAccess.KEEP_TAG, betaAccess.TAG);
});

test('5b. a row that no longer matches the canonical identity refuses every action', async () => {
  const wrong = officialRow({ email: 'someone@gmail.com' });
  const out = betaAccess.safeAccount(wrong);
  assert.equal(out.official, true, 'still shown, because the tag is a fact');
  assert.equal(out.officialVerified, false);
  assert.match(out.officialProblem, /email/);
  const db = fakeDb(() => ({ rows: [wrong], rowCount: 1 }));
  await assert.rejects(() => betaAccess.assertManageable(db, 1, 'any'), /no longer matches/);
  await assert.rejects(() => betaAccess.assertManageable(db, 1, 'official'), /no longer matches/);
});

test('5c. every canonical check is the app\'s own, reused rather than re-implemented', () => {
  assert.match(SVC_CODE, /account\.officialMismatch\(/);
  /* The thirteen refusals live in beta-account.js and are exercised there; here
     it is enough to prove this screen asks the same question. */
  for (const probe of [
    { email: 'x@y.com' }, { name: 'Not Atwe' }, { account_type: 'personal' },
    { is_demo: true }, { is_admin: true }, { admin_perms: ['users'] },
    { totp_enabled: true }, { status: 'suspended' }, { deactivated: true },
    { stripe_customer_id: 'cus_1' }, { stripe_connect_id: 'acct_1' },
    { oauth_provider: 'google' }, { seed_tag: 'beta' },
  ]) {
    const row = officialRow(probe);
    /* seed_tag 'beta' stops it being the official row at all, which is its own
       correct refusal: it then reads as an ordinary account. */
    const problem = account.officialMismatch(row, 'atwe');
    assert.ok(problem, `officialMismatch must refuse ${JSON.stringify(probe)}`);
  }
});

test('5d. @atwe cannot be revoked, cannot join the test world, cannot be deleted', async () => {
  const db = fakeDb(() => ({ rows: [officialRow()], rowCount: 1 }));
  await assert.rejects(() => betaAccess.assertManageable(db, 1, 'ordinary'),
    /official Atwe account. It is protected/);
  await assert.rejects(() => betaAccess.joinTestWorld(db, 1), /protected/);
  /* There is no delete anywhere in the feature. */
  assert.ok(!/DELETE FROM users/i.test(SVC_CODE), 'the service deletes no account');
  const start = SERVER_CODE.indexOf("app.get('/api/admin/beta/accounts'");
  const block = SERVER_CODE.slice(start, SERVER_CODE.indexOf("app.get('/api/admin/storage'"));
  assert.ok(!/DELETE FROM users/i.test(block), 'no route deletes an account');
  assert.ok(!/\bDROP\b|\bTRUNCATE\b/i.test(block), 'no DROP, no TRUNCATE');
  assert.ok(!/app\.delete\(\s*'\/api\/admin\/beta/.test(SERVER_CODE), 'there is no DELETE route');
});

test('5e. the official reset goes through activateOfficial and re-writes beta-keep', async () => {
  const db = fakeDb((text) => (
    /UPDATE\s+users/i.test(text) ? { rows: [{ id: 1, username: 'atwe' }], rowCount: 1 }
      : { rows: [officialRow()], rowCount: 1 }));
  const out = await betaAccess.resetPassword(db, { id: 1, passwordHash: '$2b$10$aaaaaaaaaaaaaaaaaaaaaa' });
  assert.equal(out.official, true);
  assert.equal(out.seedTag, 'beta-keep');
  const upd = db.sql.find((q) => /UPDATE\s+users/i.test(q.text));
  assert.ok(upd.params.includes('beta-keep'), 'the tag stays beta-keep');
  assert.ok(!upd.params.includes('beta'), 'it is never moved onto the tag reset deletes');
  /* Three columns, and the identity re-asserted in the WHERE. */
  assert.match(upd.text, /SET password_hash = \$1, email_verified = true, seed_tag = \$2/);
  assert.match(upd.text, /AND lower\(username\) = \$4/);
  /* Normalised, not raw. `lower(email)` or `lower(trim(email))` both satisfy
     this: what matters is that the WHERE normalises the same way the official
     email classifier does. Written as a shape because that normalisation has
     already changed once (a tab-padded row slipped through `lower(trim(...))`,
     since Postgres trims spaces only), and a literal goes stale next time. */
  assert.match(upd.text, /AND lower\((?:trim\()?email/);
  /* The admin state is RE-ASSERTED against what was inspected rather than
     pinned to one value, because on beta the protected @atwe is allowed to be
     a superadmin. That is strictly stronger: a row promoted or demoted between
     the check and this write matches nothing and reports it. And the SET clause
     still writes no admin column, so this can neither promote nor demote. */
  assert.match(upd.text, /AND is_admin IS NOT DISTINCT FROM \$\d+/);
  const setClause = upd.text.split('WHERE')[0];
  assert.doesNotMatch(setClause, /is_admin|admin_perms|admin_role/);
});

/* ═══ 6. RESETTING AN ORDINARY PASSWORD ══════════════════════════════════ */

test('6. an ordinary reset writes ONE column and re-asserts the tag in the WHERE', async () => {
  const db = fakeDb((text) => (
    /UPDATE\s+users/i.test(text) ? { rows: [{ id: 2, username: 'yiddiweller' }], rowCount: 1 }
      : { rows: [ordinaryRow()], rowCount: 1 }));
  const hash = await auth.hashPassword('Quiet-Harbour-41');
  const out = await betaAccess.resetPassword(db, { id: 2, passwordHash: hash });
  assert.equal(out.official, false);
  const upd = db.sql.find((q) => /UPDATE\s+users/i.test(q.text));
  /* ONE column is written. `seed_tag` and `is_admin` do appear further down --
     in the WHERE, which is the ownership re-assertion and the point of the
     statement -- so the SET clause is sliced out and checked on its own. */
  const setClause = upd.text.slice(upd.text.indexOf('SET '), upd.text.indexOf('WHERE'));
  assert.match(setClause, /^SET password_hash = \$1\s*$/m, 'exactly one column is written');
  assert.doesNotMatch(setClause, /username|email|seed_tag|is_admin|verified|,/);
  assert.match(upd.text, /AND seed_tag\s*= \$3/);
  assert.match(upd.text, /AND is_admin IS NOT TRUE/);
  assert.match(upd.text, /jsonb_array_length\(COALESCE\(admin_perms/);
  assert.deepEqual(upd.params, [hash, 2, 'beta']);
});

test('6b. it refuses an account beta tooling did not create, and the official one', async () => {
  const untagged = fakeDb(() => ({ rows: [Object.assign(ordinaryRow(), { seed_tag: null })], rowCount: 1 }));
  await assert.rejects(() => account.resetBetaPassword(untagged, { userId: 2, passwordHash: '$2b$10$a' }),
    /not created by beta tooling/);
  assert.ok(!/UPDATE/i.test(joined(untagged)), 'a refusal writes nothing');

  const keep = fakeDb(() => ({ rows: [Object.assign(ordinaryRow(), { seed_tag: 'beta-keep' })], rowCount: 1 }));
  await assert.rejects(() => account.resetBetaPassword(keep, { userId: 1, passwordHash: '$2b$10$a' }),
    /built-in account/);
  assert.ok(!/UPDATE/i.test(joined(keep)));
});

test('6c. a staff account is refused by both doors', async () => {
  const db = fakeDb(() => ({ rows: [ordinaryRow({ is_admin: true })], rowCount: 1 }));
  await assert.rejects(() => betaAccess.assertManageable(db, 2, 'any'), /staff access/);
  const scoped = fakeDb(() => ({ rows: [ordinaryRow({ admin_perms: ['users'] })], rowCount: 1 }));
  await assert.rejects(() => betaAccess.assertManageable(scoped, 2, 'any'), /staff access/);
  const direct = fakeDb(() => ({ rows: [ordinaryRow({ is_admin: true })], rowCount: 1 }));
  await assert.rejects(() => account.resetBetaPassword(direct, { userId: 2, passwordHash: '$2b$10$a' }),
    /admin rights/);
});

test('6d. a reset needs a real bcrypt hash, so a plaintext cannot be stored by mistake', async () => {
  const db = fakeDb(() => ({ rows: [ordinaryRow()], rowCount: 1 }));
  for (const bad of ['', null, 'Quiet-Harbour-41', 'md5:abc']) {
    await assert.rejects(() => account.resetBetaPassword(db, { userId: 2, passwordHash: bad }),
      /bcrypt hash/);
  }
  assert.ok(!/UPDATE/i.test(joined(db)));
});

test('6e. resetting one account cannot reach another', async () => {
  const db = fakeDb((text) => (
    /UPDATE\s+users/i.test(text) ? { rows: [{ id: 2, username: 'yiddiweller' }], rowCount: 1 }
      : { rows: [ordinaryRow()], rowCount: 1 }));
  await betaAccess.resetPassword(db, { id: 2, passwordHash: await auth.hashPassword('Quiet-Harbour-41') });
  const upd = db.sql.find((q) => /UPDATE\s+users/i.test(q.text));
  assert.match(upd.text, /WHERE id = \$2/, 'scoped to one id');
  assert.ok(!/WHERE\s+seed_tag\s*=\s*\$\d+\s*$/im.test(upd.text), 'never a tag-wide update');
});

/* ═══ 7. THE TEST WORLD ══════════════════════════════════════════════════ */

test('7. immersion never seeds the world, only attaches one account to it', () => {
  assert.ok(!/seedDemo/.test(SVC_CODE), 'the service never calls seedDemo');
  assert.ok(!/seedDemo/.test(MOD_CODE.slice(MOD_CODE.indexOf('async function immerseAccount'))),
    'immerseAccount never calls seedDemo');
  const start = SERVER_CODE.indexOf("app.post('/api/admin/beta/accounts/:id/immerse'");
  const block = SERVER_CODE.slice(start, SERVER_CODE.indexOf("app.post('/api/admin/beta/accounts/:id/access'"));
  for (const forbidden of ['seedDemo', 'products', 'shops', 'ad_campaigns', 'gift_cards', 'orders']) {
    assert.ok(!block.includes(forbidden), `the immerse route must not touch ${forbidden}`);
  }
  assert.match(SVC_CODE, /account\.immerseAccount\(db, acct\.id\)/);
});

test('7b. the badge and the button agree, because both read one number', () => {
  assert.equal(betaAccess.safeAccount(ordinaryRow({ demo_follows: 40 })).inTestWorld, true);
  assert.equal(betaAccess.safeAccount(ordinaryRow({ demo_follows: 0 })).inTestWorld, false);
  assert.equal(betaAccess.safeAccount(ordinaryRow({ demo_follows: 19 })).inTestWorld, false);
  assert.equal(betaAccess.safeAccount(ordinaryRow({ demo_follows: 20 })).inTestWorld, true);
  /* 20 is demo.js's own threshold for "already immersed, write nothing". */
  const demo = fs.readFileSync(path.join(ROOT, 'demo.js'), 'utf8');
  assert.match(demo, /n\) >= 20\)\s*return 0;/, 'demo.js still returns 0 at 20 follows');
  assert.equal(betaAccess.IMMERSED_MIN, 20);
});

/* ═══ 8. REVOKING ACCESS ═════════════════════════════════════════════════ */

test('8. revoke is the app\'s own reversible status model, never a delete', () => {
  const start = SERVER_CODE.indexOf("app.post('/api/admin/beta/accounts/:id/access'");
  const block = SERVER_CODE.slice(start, SERVER_CODE.indexOf("app.get('/api/admin/storage'"));
  assert.match(block, /applyAccountStatus\(req, acct\.id, enabled \? 'active' : 'suspended'/);
  assert.match(block, /assertManageable\(db, req\.params\.id, 'ordinary'\)/, 'ordinary accounts only');
  assert.ok(!/DELETE/i.test(block), 'revoke deletes nothing');
  assert.match(block, /cannot revoke your own access/);
  /* Reversible: the same route puts it back. */
  assert.match(block, /enabled \? 'beta_access_restored' : 'beta_access_revoked'/);
});

test('8b. suspension really is what blocks the login, and it is undone by active', () => {
  /* The status model is the app's, so this asserts the two ends meet rather
     than re-implementing either. */
  assert.match(SERVER_CODE, /function accountStatusBlock\(/);
  const fn = SERVER_CODE.slice(SERVER_CODE.indexOf('async function applyAccountStatus'));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  assert.match(body, /status === 'suspended' \|\| status === 'banned'/);
  assert.match(body, /DELETE FROM auth_sessions WHERE user_id = \$1/, 'sessions go');
  assert.match(body, /rtKickUser\(id\)/);
});

/* ═══ 9. THE AUDIT TRAIL ═════════════════════════════════════════════════ */

test('9. every write is audit-logged, through the dashboard\'s own system', () => {
  const start = SERVER_CODE.indexOf("app.get('/api/admin/beta/accounts'");
  const block = SERVER_CODE.slice(start, SERVER_CODE.indexOf("app.get('/api/admin/storage'"));
  for (const action of ['beta_account_created', 'beta_password_reset', 'beta_world_joined',
                        'beta_access_revoked', 'beta_access_restored']) {
    assert.ok(block.includes(action), `${action} must be recorded`);
  }
  /* adminAudit already carries the actor, the target and the time, and mirrors
     into the activity feed. No parallel system was invented. */
  assert.ok(!/INSERT INTO .*audit/i.test(block), 'no second audit table');
  assert.match(block, /adminAudit\(req, 'beta_account_created', 'user', acct\.id/);
});

/* ═══ 10. THE SCREEN ═════════════════════════════════════════════════════ */

test('10. the dashboard never asks for anything it must not, and clears the field', () => {
  const start = ADMIN.indexOf('async function renderBetaAccessView');
  const block = ADMIN.slice(start, ADMIN.indexOf('async function renderStorageView'));
  assert.ok(block.length > 2000, 'the Beta Access view must be there');
  /* Both password fields are hidden inputs asking the browser for a NEW password. */
  const pwFields = [...block.matchAll(/<input[^>]*type="password"[^>]*>/g)].map((m) => m[0]);
  assert.equal(pwFields.length, 4, 'two on the add form, two on the reset panel');
  for (const f of pwFields) assert.match(f, /autocomplete="new-password"/);
  /* It is cleared after use and never stashed anywhere. */
  assert.match(block, /baClear\(\['baName','baUser','baEmail','baHead','baBio','baPw','baPw2'\]\)/);
  assert.match(block, /baClear\(\['baNewPw','baNewPw2'\]\)/);
  assert.ok(!/localStorage[^\n]*[Pp]assword/.test(block), 'a password is never stored on the device');
  assert.ok(!/notify\([^)]*\bpw\b/.test(block), 'a password never reaches a toast');
});

test('10b. the screen speaks English, not schema', () => {
  const start = ADMIN.indexOf('async function renderBetaAccessView');
  const block = ADMIN.slice(start, ADMIN.indexOf('async function renderStorageView'));
  /* The words on screen, taken from the visible strings only. */
  const visible = block.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const jargon of ['seed_tag', 'beta-keep', 'SQL', 'bcrypt', 'hash', 'UPDATE ', 'DELETE ']) {
    assert.ok(!visible.includes(jargon), `"${jargon}" must not appear on the screen`);
  }
  assert.ok(visible.includes('Protected beta account'));
  assert.ok(visible.includes('Beta account'));
  assert.ok(visible.includes('In the test world'));
});

test('10c. every action on the screen asks first, and says what will happen', () => {
  const start = ADMIN.indexOf('async function renderBetaAccessView');
  const block = ADMIN.slice(start, ADMIN.indexOf('async function renderStorageView'));
  /* One of them passes a variable rather than a literal, because the wording
     depends on which direction the toggle is going. Reading the call alone
     reported "q" and failed on correct code, so a bare identifier is resolved
     back to what it was assigned. */
  const confirms = [...block.matchAll(/confirm\(([^;]+?)\)\)/g)].map((m) => m[1].trim()).map((arg) => {
    if (!/^[a-zA-Z_$][\w$]*$/.test(arg)) return arg;
    const decl = new RegExp('const\\s+' + arg + '\\s*=([\\s\\S]*?);', 'm').exec(block);
    return decl ? decl[1] : arg;
  });
  assert.ok(confirms.length >= 3, `password reset, join world and access change all confirm (found ${confirms.length})`);
  /* A confirmation that does not say what happens is not a confirmation. */
  for (const c of confirms) assert.ok(c.length > 60, `a confirm must explain itself: ${c.slice(0, 50)}`);
  assert.ok(confirms.some((c) => /signed out/.test(c)), 'the password reset says they are signed out');
  assert.ok(confirms.some((c) => /not deleted|give access back/.test(c)), 'revoke says nothing is deleted');
});

/* ═══ 11. NOTHING REACHES PRODUCTION ═════════════════════════════════════ */

test('11. no second database, no production credential, anywhere in this feature', () => {
  for (const [name, code] of [['beta-access.js', SVC_CODE], ['seed/beta-account.js', MOD_CODE]]) {
    assert.ok(!/new Pool\(|new Client\(|pg\.connect/.test(code), `${name} opens no connection of its own`);
    assert.ok(!/PROD_DATABASE_URL(?!_FINGERPRINT)/.test(code), `${name} reads no production URL`);
    assert.ok(!/https?:\/\/(www\.)?atwe\.(com|ai|app|co)/.test(code), `${name} contacts no production host`);
  }
  const start = SERVER_CODE.indexOf("app.get('/api/admin/beta/accounts'");
  const block = SERVER_CODE.slice(start, SERVER_CODE.indexOf("app.get('/api/admin/storage'"));
  assert.ok(!/new Pool\(|fetch\(/.test(block), 'no route opens a connection or calls out');
  /* Every query goes through the one `db` the app already has. */
  assert.ok(!/require\(['"]pg['"]\)/.test(block));
});

test('11b. the service reads process.env for the gate only, never for a credential', () => {
  const envUses = [...SVC_CODE.matchAll(/process\.env(\.\w+)?/g)].map((m) => m[0]);
  for (const u of envUses) assert.equal(u, 'process.env', `unexpected env read: ${u}`);
});
