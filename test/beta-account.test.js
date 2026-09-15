/* ADDING ONE BETA ACCOUNT — the refusals, and what the created row may carry.
 *
 * No database and no network. The identity rules are pure functions; the
 * "already exists" and "creates correctly" paths run against a tiny fake db
 * that records the SQL it was handed, which is exactly what the interesting
 * assertions are about (was a password hashed with the app's own function, was
 * seedDemo called, was an UPDATE ever issued).
 *
 * SELF-TESTED, and the fifth attempt is why that is written down. Five real
 * breaks were made and re-run: dropping the username clash (caught), dropping
 * the reserved-name guard (caught), calling seedDemo from add-account (caught),
 * making commerce the default (caught), hashing with a local bcrypt (caught).
 * The reserved-name break FIRST reported a pass, and the break itself was the
 * bug: it sliced to `indexOf('  const r = await db.query(')` with no offset,
 * which matched findByUsername far EARLIER in the file, so the slice was empty
 * and the file was rewritten unchanged. A self-test that removes nothing proves
 * nothing -- always assert the break actually changed something before reading
 * the result.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const jstext = require('../tools/jstext');
const account = require('../seed/beta-account');
const auth = require('../auth');
const guard = require('../tools/seed-guard');

const ROOT = path.join(__dirname, '..');
const CLI = fs.readFileSync(path.join(ROOT, 'tools', 'seed-beta.js'), 'utf8');
const MOD = fs.readFileSync(path.join(ROOT, 'seed', 'beta-account.js'), 'utf8');

/* COMMENTS MUST BE STRIPPED BEFORE ANY STRUCTURAL SCAN. Both these files
   DOCUMENT what they refuse to do ("it never calls seedDemo", "No DROP, no
   TRUNCATE"), so a raw grep reports the prose as if it were code -- the exact
   trap deadends.js records. jstext.scan is the repo's own tokeniser: it blanks
   comments while preserving every offset, so line numbers still line up. */
const CLI_CODE = jstext.scan(CLI).code;
const MOD_CODE = jstext.scan(MOD).code;

const GOOD = {
  email: 'beta+atwe@atwe.test', username: 'atwe', name: 'Atwe',
  headline: 'Atwe', bio: 'Official Atwe beta account.',
  accountType: 'business', role: 'member',
};

/* A db that answers "nothing exists" and remembers every statement. */
function fakeDb(rowsFor = () => ({ rows: [], rowCount: 0 })) {
  const sql = [];
  return {
    sql,
    async query(text, params) { sql.push({ text: String(text), params }); return rowsFor(text, params); },
  };
}
const joined = (db) => db.sql.map((q) => q.text).join('\n');

/* ---- 1-2. the environment guards are the SAME ones, not a second copy --- */

test('1. outside beta is refused — add-account runs the same guard as seed', () => {
  const bad = guard.checkEnvironment({ ATWE_ENV: 'production', APP_URL: 'https://atwe.com', DATABASE_URL: 'postgres://u:p@h/d' });
  assert.equal(bad.ok, false);
  /* main() refuses before any command reaches a database, so add-account is
     covered by the very same gate. */
  assert.match(CLI_CODE, /if \(!report\.ok\) \{\s*console\.error\('\\nREFUSED\. Nothing was read/);
  assert.match(CLI_CODE, /'check', 'status', 'seed', 'reset', 'add-account'/);
});

test('2. dangerous integrations are refused, by the existing unchanged rules', () => {
  for (const v of ['STRIPE_SECRET_KEY', 'SMTP_HOST', 'VAPID_PUBLIC_KEY', 'TWILIO_ACCOUNT_SID', 'SHIPPO_API_KEY', 'S3_BUCKET', 'TAX_API_KEY']) {
    const r = guard.checkIntegrations({ [v]: 'x' });
    assert.equal(r.ok, false, `${v} must block seeding`);
  }
  assert.equal(guard.checkIntegrations({}).ok, true);
});

/* ---- 3. the identity file may not carry a credential ------------------- */

test('3. every forbidden auth/secret field is refused by name', () => {
  const forbidden = ['password', 'passwordHash', 'password_hash', 'secret', 'token', 'apiKey',
                     'sessionToken', 'totpSecret', 'stripeCustomerId', 'stripeConnectId',
                     'oauthProvider', 'isAdmin', 'adminPerms', 'pushToken'];
  for (const f of forbidden) {
    const problem = account.identityProblem({ ...GOOD, [f]: 'x' });
    assert.ok(problem, `${f} must be refused`);
    assert.match(problem, new RegExp(f, 'i'), `the refusal must name ${f}`);
  }
  assert.equal(account.identityProblem(GOOD), null, 'a clean file passes');
  assert.ok(account.identityProblem({ ...GOOD, surprise: 1 }), 'an unknown field is refused too');
});

test('3b. a hash cannot be smuggled in as the password argument', async () => {
  const db = fakeDb();
  await assert.rejects(
    () => account.createBetaAccount(db, { identity: GOOD, passwordHash: 'plaintext' }),
    /bcrypt hash from auth\.hashPassword/);
  assert.equal(db.sql.length, 0, 'nothing was queried');
});

/* ---- 4-5. an existing username is refused and never touched ------------ */

test('4. an existing username is refused', async () => {
  const db = fakeDb((t) => /lower\(username\)/.test(t)
    ? { rows: [{ id: 7, username: 'atwe', seed_tag: null }], rowCount: 1 } : { rows: [], rowCount: 0 });
  await assert.rejects(
    () => account.createBetaAccount(db, { identity: GOOD, passwordHash: '$2a$10$x' }),
    /already exists/);
});

test('4b. an existing EMAIL is refused too, rather than hitting a raw constraint', async () => {
  const db = fakeDb((t) => /lower\(email\)/.test(t)
    ? { rows: [{ id: 9, username: 'someone', email: GOOD.email }], rowCount: 1 } : { rows: [], rowCount: 0 });
  await assert.rejects(
    () => account.createBetaAccount(db, { identity: { ...GOOD, username: 'brandnew' }, passwordHash: '$2a$10$x' }),
    /already belongs to/);
});

test('5. a refusal never writes: no UPDATE, no DELETE, no INSERT', async () => {
  const db = fakeDb((t) => /lower\(username\)/.test(t)
    ? { rows: [{ id: 7, username: 'atwe', seed_tag: 'beta' }], rowCount: 1 } : { rows: [], rowCount: 0 });
  await assert.rejects(() => account.createBetaAccount(db, { identity: GOOD, passwordHash: '$2a$10$x' }));
  const all = joined(db);
  assert.doesNotMatch(all, /UPDATE/i);
  assert.doesNotMatch(all, /DELETE/i);
  assert.doesNotMatch(all, /INSERT/i);
});

/* ---- 6-7, 9-11. what the created row carries -------------------------- */

test('6. the account is created with seed_tag beta, in the INSERT itself', async () => {
  const db = fakeDb((t) => /INSERT INTO users/.test(t) ? { rows: [{ id: 42 }], rowCount: 1 } : { rows: [], rowCount: 0 });
  const made = await account.createBetaAccount(db, { identity: GOOD, passwordHash: '$2a$10$x', claimReserved: true });
  assert.equal(made.id, 42);
  const ins = db.sql.find((q) => /INSERT INTO users/.test(q.text));
  assert.ok(ins, 'it inserted');
  assert.match(ins.text, /seed_tag/, 'seed_tag is written by the INSERT, not a later pass');
  assert.ok(ins.params.includes('beta'), 'the tag value is beta');
});

test('7. the password is hashed by the app\'s own auth.hashPassword', async () => {
  const hash = await auth.hashPassword('a-beta-only-password');
  assert.match(hash, /^\$2[aby]\$/, 'a real bcrypt hash');
  assert.equal(await auth.verifyPassword('a-beta-only-password', hash), true);
  assert.equal(await auth.verifyPassword('wrong', hash), false);
  /* and the CLI uses that function rather than a local bcrypt call */
  assert.match(CLI_CODE, /auth\.hashPassword\(pw\)/);
  assert.doesNotMatch(CLI_CODE, /bcrypt/, 'no second hashing path in the tool');
});

test('9. role member is the default and stays member', async () => {
  const db = fakeDb((t) => /INSERT INTO users/.test(t) ? { rows: [{ id: 1 }], rowCount: 1 } : { rows: [], rowCount: 0 });
  const made = await account.createBetaAccount(db, {
    identity: { email: 'x@beta.test', username: 'plainuser', name: 'X' }, passwordHash: '$2a$10$x' });
  assert.equal(made.role, 'member', 'member when the file says nothing');
  const ins = db.sql.find((q) => /INSERT INTO users/.test(q.text));
  assert.ok(ins.params.includes(false), 'is_admin false is passed');
});

test('10. no staff access is created — is_admin false, no admin_perms/admin_role', async () => {
  const db = fakeDb((t) => /INSERT INTO users/.test(t) ? { rows: [{ id: 1 }], rowCount: 1 } : { rows: [], rowCount: 0 });
  await account.createBetaAccount(db, { identity: GOOD, passwordHash: '$2a$10$x', claimReserved: true });
  const ins = db.sql.find((q) => /INSERT INTO users/.test(q.text));
  assert.doesNotMatch(ins.text, /admin_perms/);
  assert.doesNotMatch(ins.text, /admin_role/);
  assert.match(ins.text, /is_admin/);
  const i = ins.text.split(',').findIndex((c) => /is_admin/.test(c));
  assert.ok(i >= 0);
});

test('11. no production auth / payment / external column is ever written', async () => {
  const db = fakeDb((t) => /INSERT INTO users/.test(t) ? { rows: [{ id: 1 }], rowCount: 1 } : { rows: [], rowCount: 0 });
  await account.createBetaAccount(db, { identity: GOOD, passwordHash: '$2a$10$x', claimReserved: true });
  const ins = db.sql.find((q) => /INSERT INTO users/.test(q.text));
  for (const col of ['stripe_customer_id', 'stripe_connect_id', 'stripe_pro_subscription_id',
                     'oauth_provider', 'oauth_id', 'totp_secret', 'totp_recovery', 'totp_enabled',
                     'connect_payouts_enabled', 'referral_code', 'admin_perms', 'admin_role']) {
    assert.doesNotMatch(ins.text, new RegExp(col), `${col} must keep its schema default`);
  }
  /* and nothing anywhere reads another account's row to copy from */
  assert.doesNotMatch(MOD_CODE, /SELECT \*/);
});

/* ---- 8. nothing prints a password or a hash --------------------------- */

test('8. no password or hash can reach the console', () => {
  /* the module never logs at all, and never receives a plaintext password */
  assert.doesNotMatch(MOD_CODE, /console\./, 'the reusable module prints nothing');
  /* the CLI nulls the plaintext immediately after hashing, and never prints either */
  assert.match(CLI_CODE, /pw = null;/);
  for (const line of CLI_CODE.split('\n')) {
    if (!/console\.(log|error)/.test(line)) continue;
    assert.doesNotMatch(line, /\$\{\s*(pw|hash|passwordHash)\s*\}/, `a console line interpolates a credential: ${line.trim()}`);
  }
});

/* ---- 12-14. add-account does NOT rebuild the world -------------------- */

function addAccountBody() {
  const from = CLI_CODE.indexOf('async function doAddAccount');
  const to = CLI_CODE.indexOf('async function doReset', from);
  assert.ok(from > 0 && to > from, 'found the add-account implementation');
  return CLI_CODE.slice(from, to);
}

test('12. add-account never calls seedDemo or any global seeding', () => {
  const body = addAccountBody();
  assert.doesNotMatch(body, /seedDemo/, 'the demo population is never rebuilt');
  assert.doesNotMatch(body, /refreshDemoStories/);
  assert.doesNotMatch(body, /teardownDemo/);
  assert.doesNotMatch(MOD_CODE, /seedDemo\s*\(/, 'nor a call from the reusable module');
});

test('13. add-account never recreates shops or listings', () => {
  const body = addAccountBody();
  assert.doesNotMatch(body, /INSERT INTO products/i);
  assert.doesNotMatch(body, /CATALOG/);
  assert.doesNotMatch(MOD_CODE, /INSERT INTO products/i);
  /* the two SELLERS shops belong to doSeed alone */
  const seedFrom = CLI_CODE.indexOf('async function doSeed');
  assert.ok(CLI_CODE.slice(seedFrom, CLI_CODE.indexOf('async function doAddAccount')).includes('SELLERS'));
  assert.doesNotMatch(body, /SELLERS/);
});

test('14. commerce is OPTIONAL, off unless --commerce is passed', () => {
  const body = addAccountBody();
  assert.match(body, /if \(opts\.commerce\)/, 'commerce sits behind the flag');
  assert.match(CLI_CODE, /commerce: argv\.includes\('--commerce'\)/, 'and the flag is opt-in');
  /* seedCommerce is only reachable inside that branch */
  const idx = body.indexOf('seedCommerce');
  assert.ok(idx > body.indexOf('if (opts.commerce)'), 'seedCommerce is inside the flag branch');
});

/* ---- 15. immersion only attaches THIS account ------------------------- */

test('15. immersion is additive and scoped to the new account', () => {
  const demo = jstext.scan(fs.readFileSync(path.join(ROOT, 'demo.js'), 'utf8')).code;
  const from = demo.indexOf('async function immerseInDemo');
  const to = demo.indexOf('async function teardownDemo', from);
  const body = demo.slice(from, to);
  /* every write is an INSERT; there is no UPDATE and no DELETE at all */
  assert.doesNotMatch(body, /\bUPDATE\b/i, 'immersion never updates an existing row');
  assert.doesNotMatch(body, /\bDELETE\b/i, 'immersion never deletes');
  assert.doesNotMatch(body, /seedDemo/, 'immersion never re-seeds');
  for (const t of ['follows', 'at_messages', 'notifications', 'at_group_members']) {
    assert.match(body, new RegExp(`INSERT INTO ${t}`), `it inserts into ${t}`);
  }
  /* four insert targets and no others */
  const targets = [...body.matchAll(/INSERT INTO (\w+)/g)].map((m) => m[1]).sort();
  assert.deepEqual([...new Set(targets)].sort(),
    ['at_group_members', 'at_messages', 'follows', 'notifications'],
    'immersion writes to exactly these four tables');
});

/* ---- the reserved-name guard ----------------------------------------- */

test('16. a RESERVED username is refused unless claimed deliberately', async () => {
  const routes = require('../routes');
  assert.ok(routes.SYSTEM_ROUTES.includes('atwe'), '"atwe" really is reserved by the app');

  const db = fakeDb((t) => {
    if (/reserved_usernames/.test(t)) return { rows: [{ username: 'atwe' }], rowCount: 1 };
    if (/INSERT INTO users/.test(t)) return { rows: [{ id: 5 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  await assert.rejects(
    () => account.createBetaAccount(db, { identity: GOOD, passwordHash: '$2a$10$x' }),
    /RESERVED username/);
  assert.doesNotMatch(joined(db), /INSERT/i, 'and it wrote nothing');

  const db2 = fakeDb((t) => {
    if (/reserved_usernames/.test(t)) return { rows: [{ username: 'atwe' }], rowCount: 1 };
    if (/INSERT INTO users/.test(t)) return { rows: [{ id: 5 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const made = await account.createBetaAccount(db2, { identity: GOOD, passwordHash: '$2a$10$x', claimReserved: true });
  assert.equal(made.id, 5, 'claimed deliberately, it is created');
  assert.doesNotMatch(joined(db2), /DELETE FROM reserved_usernames/i,
    'and the reservation is LEFT in place, so the name stays locked to everyone else');
});

test('17. the business account type is the app\'s real one', () => {
  assert.deepEqual(account.ACCOUNT_TYPES, ['personal', 'business']);
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(server, /account_type === 'business' \? 'business' : 'personal'/,
    'the app itself recognises exactly these two');
  assert.equal(account.normalizeIdentity(GOOD).accountType, 'business');
});

test('18. reset safety is untouched — still seed_tag only, no is_demo, no DROP', () => {
  const dels = [...CLI_CODE.matchAll(/DELETE FROM[^\n;]*/g)].map((m) => m[0]);
  assert.ok(dels.length, 'there is a delete path');
  for (const d of dels) {
    assert.match(d, /WHERE seed_tag = \$1/, `a DELETE not scoped to seed_tag: ${d}`);
    assert.doesNotMatch(d, /is_demo/, `a DELETE reasoning about is_demo: ${d}`);
  }
  assert.doesNotMatch(CLI_CODE, /\bDROP\b|\bTRUNCATE\b/i);
  assert.doesNotMatch(MOD_CODE, /\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i, 'the account module deletes nothing at all');
});
