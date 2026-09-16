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

/* ======================================================================
   ACTIVATING THE APP'S OWN @atwe ACCOUNT.

   Different in kind from everything above: @atwe is not created here and
   never was -- server.js makes it on boot. So the tests are about REFUSING
   anything that is not provably that account, writing as little as possible,
   and never letting a beta reset delete it.
   ====================================================================== */

/* The built-in row exactly as server.js's ensureOfficialAccount writes it,
   plus the columns the checks read. Every mismatch test below is this object
   with ONE field changed, so a refusal can only be caused by that field. */
const BUILTIN = {
  id: 1, name: 'Atwe', email: 'no-reply+atwe@atwe.internal', username: 'atwe',
  account_type: 'business', is_demo: false, is_admin: false, admin_perms: [],
  admin_role: null, verified: true, email_verified: true,
  headline: 'Product news and tips from Atwe', status: 'active', deactivated: false,
  totp_enabled: false, stripe_customer_id: null, stripe_connect_id: null,
  oauth_provider: null, seed_tag: null,
};
const HASH = '$2a$10$' + 'x'.repeat(53);
const officialDb = (row, count) => fakeDb((t) => {
  if (/FROM users WHERE lower\(username\)/.test(t)) {
    return row ? { rows: [row], rowCount: count == null ? 1 : count } : { rows: [], rowCount: 0 };
  }
  if (/UPDATE users/.test(t)) return { rows: [{ id: row.id, username: row.username }], rowCount: 1 };
  return { rows: [], rowCount: 0 };
});

test('19. the expected identity is READ from the app, not invented here', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const want = account.officialIdentity();
  /* Each of these is the literal server.js writes in ensureOfficialAccount. If
     the app changes any of them this test fails rather than the tool silently
     refusing the real account for ever. */
  assert.match(server, /const ATWE_OFFICIAL_USERNAME = \(process\.env\.ATWE_OFFICIAL_USERNAME \|\| 'atwe'\)/);
  assert.match(server, /no-reply\+\$\{ATWE_OFFICIAL_USERNAME\}@atwe\.internal/,
    'the email shape the tool requires is the app\'s own');
  assert.match(server, /VALUES \('Atwe', \$1, \$2, \$3, 'business', true, true, 'Product news and tips from Atwe'\)/,
    'name, account type, verified, email_verified and headline are the app\'s own');
  assert.equal(want.username, 'atwe');
  assert.equal(want.email, 'no-reply+atwe@atwe.internal');
  assert.equal(want.accountType, 'business');
});

test('20. the real built-in row is accepted, and only three columns are written', async () => {
  const db = officialDb(BUILTIN);
  assert.equal(account.officialMismatch(BUILTIN), null, 'the genuine row passes every check');
  const done = await account.activateOfficial(db, { passwordHash: HASH });
  assert.equal(done.id, 1);

  const writes = db.sql.filter((q) => /^\s*(INSERT|UPDATE|DELETE)/i.test(q.text));
  assert.equal(writes.length, 1, 'exactly one write');
  const up = writes[0].text;
  assert.match(up, /^\s*UPDATE users/);
  for (const col of ['password_hash', 'email_verified', 'seed_tag']) {
    assert.ok(new RegExp(col).test(up.split('WHERE')[0]), `${col} is set`);
  }
  /* Nothing that could rename it, re-address it or promote it. */
  const setClause = up.split('WHERE')[0];
  /* Anchored to a column START (line begin, comma or space), because a bare
     "verified =" also matches inside "email_verified = true", which this
     UPDATE legitimately sets -- the first version of this check failed on
     correct code for exactly that reason. */
  for (const col of ['username', 'name', 'email', 'account_type', 'is_admin', 'admin_perms',
                     'admin_role', 'verified', 'headline', 'stripe_customer_id', 'oauth_provider',
                     'totp_secret', 'totp_enabled']) {
    assert.doesNotMatch(setClause, new RegExp(`(^|[\\s,(])${col}\\s*=`, 'm'),
      `the UPDATE must not set ${col}`);
  }
  /* The identity is re-asserted in the WHERE, so a row that changed underneath
     is missed rather than written to. */
  const where = up.split('WHERE')[1];
  assert.match(where, /lower\(username\)/);
  assert.match(where, /lower\(email\)/);
  assert.match(where, /account_type\s*=\s*'business'/);
  /* The row's OWN admin state is re-asserted (see beta-access 5e): on beta the
     protected @atwe may be a superadmin, so demanding one fixed value would be
     wrong, while re-asserting what was inspected is stricter than the literal
     `IS NOT TRUE` this replaced. */
  assert.match(where, /is_admin\s+IS NOT DISTINCT FROM \$\d+/);
});

test('21. the keep-tag is NOT the tag reset deletes', () => {
  assert.notEqual(account.KEEP_TAG, account.TAG, 'the whole point: reset tests equality with "beta"');
  assert.equal(account.KEEP_TAG, 'beta-keep');
  assert.equal(account.TAG, 'beta');
});

test('22. a beta reset can never delete the app\'s own account', () => {
  /* Two independent protections, because one of them is a value in a column
     that a human could overwrite by hand. */
  const reset = CLI_CODE.slice(CLI_CODE.indexOf('async function doReset'),
                               CLI_CODE.indexOf('async function main'));
  assert.ok(reset.length > 500, 'found the reset body');
  assert.match(reset, /DELETE FROM \$\{t\} WHERE seed_tag = \$1\$\{guard\}/,
    'the delete still carries the guard');
  assert.match(reset, /lower\(username\) IS DISTINCT FROM \$2/,
    'and the guard excludes the official account by name');
  assert.match(reset, /account\.OFFICIAL_USERNAME/,
    'from the shared constant, never a hardcoded "atwe"');
  /* The guard must apply to users and ONLY to users: the other four tables
     have no username column and the query would simply throw. */
  assert.match(reset, /t === 'users' \? ' AND lower\(username\)/);
  assert.match(reset, /t === 'users' \? \[TAG, account\.OFFICIAL_USERNAME\] : \[TAG\]/);
});

test('23. it refuses any account that is not provably the built-in one', () => {
  const cases = [
    ['a different username', { username: 'someoneelse' }, /username/],
    ['a real person\'s email', { email: 'me@gmail.com' }, /was not made by the app itself/],
    ['a renamed account', { name: 'Atwe Inc' }, /name/],
    ['a personal account', { account_type: 'personal' }, /account type/],
    ['seeded sample data', { is_demo: true }, /is_demo/],
    ['an ADMIN account', { is_admin: true }, /superadmin is not permitted for the official account/],
    ['a scoped staffer', { admin_perms: ['users', 'revenue'] }, /staff scopes/],
    ['two-factor enabled', { totp_enabled: true }, /two-factor/],
    ['a suspended account', { status: 'suspended' }, /status/],
    ['a deactivated account', { deactivated: true }, /deactivated/],
    ['a Stripe customer', { stripe_customer_id: 'cus_1' }, /Stripe customer/],
    ['a linked provider', { oauth_provider: 'google' }, /sign-in provider/],
    ['a seeded row', { seed_tag: 'beta' }, /seed_tag/],
  ];
  for (const [what, patch, expect] of cases) {
    const why = account.officialMismatch({ ...BUILTIN, ...patch });
    assert.ok(why, `it must refuse ${what}`);
    assert.match(why, expect, `and say why, for ${what}`);
  }
  assert.match(account.officialMismatch(null), /no @atwe account exists/);
});

test('24. a refusal writes nothing at all', async () => {
  for (const patch of [{ is_admin: true }, { email: 'me@gmail.com' }, { account_type: 'personal' }]) {
    const db = officialDb({ ...BUILTIN, ...patch });
    await assert.rejects(() => account.activateOfficial(db, { passwordHash: HASH }));
    const writes = db.sql.filter((q) => /^\s*(INSERT|UPDATE|DELETE)/i.test(q.text));
    assert.equal(writes.length, 0, `a refusal must not write: ${JSON.stringify(patch)}`);
  }
});

test('25. it never creates a second @atwe, and never creates anything', async () => {
  const db = officialDb(BUILTIN);
  await account.activateOfficial(db, { passwordHash: HASH });
  assert.doesNotMatch(joined(db), /INSERT INTO users/i, 'no account is ever created here');

  /* Two rows holding the handle means the unique index is gone; touch neither. */
  const two = officialDb(BUILTIN, 2);
  await assert.rejects(() => account.activateOfficial(two, { passwordHash: HASH }), /2 accounts hold/);
  assert.equal(two.sql.filter((q) => /^\s*UPDATE/i.test(q.text)).length, 0);

  /* And the command itself is not a generic overwrite: it takes no username. */
  const body = CLI_CODE.slice(CLI_CODE.indexOf('async function doActivateOfficial'),
                              CLI_CODE.indexOf('async function doReset'));
  assert.ok(body.length > 500, 'found the command body');
  assert.match(body, /account\.OFFICIAL_USERNAME/, 'the target is the constant');
  assert.doesNotMatch(body, /opts\.username|argv/, 'no way to point it at another account');
});

test('26. the password is beta-only, hashed by the app, and never printed', async () => {
  const body = CLI_CODE.slice(CLI_CODE.indexOf('async function doActivateOfficial'),
                              CLI_CODE.indexOf('async function doReset'));
  assert.match(body, /readPassword\(\)/, 'the one shared password path');
  assert.match(body, /auth\.hashPassword\(pw\)/, 'the app\'s own hasher');
  assert.match(body, /pw = null/, 'the plaintext is dropped');
  /* NOT a bare /bcrypt/: the module's own refusal message says the words
     "bcrypt hash", and jstext strips comments but never strings. What must be
     absent is a hashing library and any hashing call. */
  assert.doesNotMatch(MOD_CODE, /require\(['"]bcrypt/, 'the module requires no hashing library');
  assert.doesNotMatch(MOD_CODE, /\.hash\s*\(|hashPassword\s*\(/, 'and hashes nothing itself');

  /* A plaintext password can only come from the env or the hidden prompt. */
  assert.match(CLI_CODE, /process\.env\.BETA_SEED_PASSWORD/);
  assert.match(CLI_CODE, /promptHidden\(/);

  /* Nothing printed anywhere in either file carries a password or a hash
     VALUE. Naming the column in a preview ("password_hash  set to the beta
     password you are about to type") is a label, not a secret, and the first
     version of this check failed on exactly that line -- what must never
     appear is the variable, interpolated or passed. */
  const SECRET = /\$\{\s*(pw|hash|passwordHash|password)\b[^}]*\}|[,(]\s*(pw|hash|passwordHash)\s*[,)]/;
  for (const [name, code] of [['seed-beta.js', CLI_CODE], ['beta-account.js', MOD_CODE]]) {
    for (const line of code.split('\n')) {
      if (!/console\.(log|error|warn)/.test(line)) continue;
      assert.doesNotMatch(line, SECRET, `${name}: a console line prints a secret: ${line.trim()}`);
    }
  }
  /* Self-test the detector: it must catch the thing it exists to catch. */
  assert.match("console.log(`pw ${pw}`)", SECRET, 'the secret detector actually detects');
  assert.match("console.log('x', hash)", SECRET, 'including a passed argument');
  /* And a hash that is not one is refused rather than written. */
  await assert.rejects(() => account.activateOfficial(officialDb(BUILTIN), { passwordHash: 'plaintext' }),
    /bcrypt hash/);
});

test('27. activating grants no staff access and copies nothing from production', async () => {
  const db = officialDb(BUILTIN);
  await account.activateOfficial(db, { passwordHash: HASH });
  /* WRITES only. The SELECT deliberately reads admin_perms, is_admin and the
     external-credential columns -- that is how it refuses an account carrying
     them -- so asserting over every statement failed on correct code. */
  const writes = db.sql.filter((q) => /^\s*(INSERT|UPDATE|DELETE)/i.test(q.text))
                       .map((q) => q.text).join('\n');
  assert.ok(writes.length, 'there was a write to inspect');
  for (const bad of ['is_admin', 'admin_perms', 'admin_role', 'plan', 'stripe', 'oauth', 'totp_secret']) {
    assert.doesNotMatch(writes.split('WHERE')[0], new RegExp(bad, 'i'),
      `no write may set ${bad}`);
  }
  /* The module as a whole knows nothing about reading another database. It now
     names a "production" ACCESS LANE (section 5a), so the bare word is no
     longer the signal -- what must stay absent is any way to reach a second
     database: a connection string, a client, a pool, a second db handle. */
  assert.doesNotMatch(MOD_CODE, /PROD_DATABASE_URL|DATABASE_URL|pg\.Client|new Pool|require\(['"]pg['"]\)/i);
  /* And the only thing it may say about production is the policy: no lane may
     be on, and the switch must be the reviewed constant rather than a bare
     environment read that a deploy could flip on its own. */
  const lane = MOD_CODE.slice(MOD_CODE.indexOf('const OFFICIAL_ACCESS'), MOD_CODE.indexOf('PROD_ACTIVATION_PHRASE'));
  assert.match(lane, /production:\s*\{\s*allowLogin:\s*false,\s*allowAdmin:\s*false\s*\}/,
    'the production lane ships switched off');
});

test('28. activating reruns no global seed and adds no commerce', () => {
  const body = CLI_CODE.slice(CLI_CODE.indexOf('async function doActivateOfficial'),
                              CLI_CODE.indexOf('async function doReset'));
  for (const bad of ['seedDemo', 'refreshDemoStories', 'teardownDemo', 'seedCommerce', 'beta-commerce']) {
    assert.doesNotMatch(body, new RegExp(bad), `activate-official must not mention ${bad}`);
  }
  for (const bad of ['products', 'CATALOG', 'SELLERS', 'opts.commerce']) {
    assert.doesNotMatch(body, new RegExp(`\\b${bad}\\b`), `and must not touch ${bad}`);
  }
  assert.match(body, /opts\.immerse/, 'immersion is still offered');
  assert.match(body, /account\.immerseAccount/, 'through the same audited helper add-account uses');
});

test('29. there is no broad UPDATE or DELETE anywhere in the new path', () => {
  /* THIS USED TO COUNT THE UPDATES AND EXPECT ONE, and it went red the moment
     Beta Access added resetBetaPassword -- a second, deliberate, equally narrow
     statement. A count is not the invariant; being pinned to a single id is.
     So every UPDATE in the module is checked, and a third one added later is
     held to the same rule rather than simply failing the tally. */
  const ups = [...MOD_CODE.matchAll(/UPDATE\s+\w+[\s\S]*?RETURNING/g)].map((m) => m[0]);
  assert.ok(ups.length >= 1, 'the module issues at least one UPDATE');
  for (const up of ups) {
    const where = up.split('WHERE')[1] || '';
    assert.match(where, /\bid = \$\d+/, `every UPDATE is pinned to one id: ${up.slice(0, 40)}`);
    /* And re-asserts who owns the row in the same statement, so a row that
       changed underneath is missed rather than written to. */
    assert.match(where, /seed_tag|lower\(username\)/, 'and re-asserts ownership in its own WHERE');
    /* Every UPDATE constrains is_admin in its own WHERE, in one of three ways,
       and which one is the whole point rather than a detail:
         IS NOT TRUE              -- never touch a staff account (the ordinary
                                     password reset, and the promote itself,
                                     which may only promote a non-admin)
         IS NOT DISTINCT FROM $n  -- re-assert whatever was inspected (the
                                     official activation, because on beta the
                                     protected @atwe may already be an admin)
       A statement that mentions no admin column at all is the thing this
       forbids, because that is the one that could write to a staff row blind. */
    assert.match(where, /is_admin\s+(IS NOT TRUE|IS NOT DISTINCT FROM \$\d+)/,
      'and constrains is_admin in its own WHERE');
  }
  assert.doesNotMatch(MOD_CODE, /\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i);
});
