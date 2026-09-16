/* THE OFFICIAL @atwe ACCOUNT: WHO MAY GIVE IT A LOGIN, AND SUPERADMIN.
 *
 * The founder's decision (16 Sep 2026) is that the app's own @atwe account is
 * meant to have a real login AND superadmin access in BOTH environments, with
 * beta switched on first and production following later through its own
 * deliberate activation. The two environments stay completely separate --
 * separate databases, passwords, sessions and JWT state -- so "both" means the
 * same CAPABILITY, never shared account data.
 *
 * WHAT THIS FILE IS FOR. That is a real widening of a posture the app used to
 * state absolutely ("nobody signs in as it"), so the widening has to be one
 * named, readable policy rather than a condition smeared through the identity
 * checks. Section 5a of seed/beta-account.js is that policy; this file proves
 * the three things that make it safe:
 *
 *   1. PRODUCTION IS UNCHANGED TODAY, and provably so -- not "we did not mean
 *      to change it" but "there is no combination of environment variables that
 *      changes it", including the future approval phrase itself.
 *   2. THE IDENTITY CHECKS ARE NOT WEAKENED. Exactly one refusal moved behind
 *      the policy (`is_admin`); every other one refuses in every environment,
 *      and scopes still refuse everywhere.
 *   3. @atwe STAYS PROTECTED EITHER WAY -- no delete, no revoke, no rename, no
 *      account-type change, in beta or production, admin or not.
 *
 * The unit half needs no database and always runs. The live half re-uses the
 * same opt-in flag as the authorization suite, for the same measured reason:
 * `node --test` runs files concurrently and a third server against one Postgres
 * tipped the fixed-delay money tests over.
 *
 *   TEST_DATABASE_URL=... ATWE_LIVE_BETA_AUTHZ=1 node --test test/beta-official-admin.test.js
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const jstext = require('../tools/jstext');
const account = require('../seed/beta-account');
const betaAccess = require('../beta-access');
const h = require('./helpers');

const ROOT = path.join(__dirname, '..');
const MOD_CODE = jstext.scan(fs.readFileSync(path.join(ROOT, 'seed', 'beta-account.js'), 'utf8')).code;
const SVC_CODE = jstext.scan(fs.readFileSync(path.join(ROOT, 'beta-access.js'), 'utf8')).code;
const CLI_CODE = jstext.scan(fs.readFileSync(path.join(ROOT, 'tools', 'seed-beta.js'), 'utf8')).code;

/* An environment `checkEnvironment` calls beta, spelled out rather than copied
   from process.env so this file can never depend on how it was invoked. */
const BETA_ENV = {
  ATWE_ENV: 'beta',
  APP_URL: 'https://beta.atwe.com',
  DATABASE_URL: 'postgres://u:p@beta-db.internal:5432/atwe_beta',
  RAILWAY_ENVIRONMENT_NAME: '',
  PROD_DATABASE_URL_FINGERPRINT: '',
};
const PROD_ENV = {
  ATWE_ENV: 'production',
  APP_URL: 'https://atwe.com',
  DATABASE_URL: 'postgres://u:p@prod-db.internal:5432/atwe',
};

/* The row `ensureOfficialAccount` really creates, once beta tooling has given
   it a password (hence the keep-tag). */
const OFFICIAL = {
  id: 7, username: 'atwe', email: 'no-reply+atwe@atwe.internal', name: 'Atwe',
  account_type: 'business', is_demo: false, is_admin: false, admin_perms: [], admin_role: null,
  verified: true, email_verified: true, headline: 'Product news and tips from Atwe',
  status: 'active', deactivated: false, totp_enabled: false,
  stripe_customer_id: null, stripe_connect_id: null, oauth_provider: null,
  seed_tag: 'beta-keep', created_at: new Date(),
};
const ORDINARY = { ...OFFICIAL, id: 9, username: 'someshop', email: 'shop@test.local', name: 'Some Shop', seed_tag: 'beta' };

/* Run `fn` with `env` merged into process.env, then put it back exactly.
   beta-access.js reads process.env directly -- its routes run inside a real
   server -- so a test about environment behaviour has to stand in one. */
async function withEnv(env, fn) {
  const keys = ['ATWE_ENV', 'APP_URL', 'DATABASE_URL', 'RAILWAY_ENVIRONMENT_NAME',
                'RAILWAY_ENVIRONMENT', 'PROD_DATABASE_URL_FINGERPRINT', 'ATWE_OFFICIAL_PROD_ACTIVATION'];
  const saved = {};
  for (const k of keys) saved[k] = process.env[k];
  try {
    for (const k of keys) delete process.env[k];
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    return await fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

function fakeDb(handler) {
  const sql = [];
  return { sql, query: async (text, params) => { sql.push({ text, params }); return handler(text, params); } };
}
/* A db that answers findOfficial with `row`, and any UPDATE with one row. */
const officialDb = (row) => fakeDb((text) => (
  /^\s*UPDATE/i.test(text) ? { rows: [{ id: row.id, username: row.username }], rowCount: 1 }
    : { rows: row ? [row] : [], rowCount: row ? 1 : 0 }));

/* ═══ 1. THE POLICY ══════════════════════════════════════════════════════ */

test('1. beta permits both a login and superadmin', () => {
  const p = account.officialAccessPolicy(BETA_ENV);
  assert.equal(p.environment, 'beta');
  assert.equal(p.allowLogin, true);
  assert.equal(p.allowAdmin, true);
  assert.equal(account.officialAdminAllowed(BETA_ENV), true);
  assert.equal(account.officialLoginAllowed(BETA_ENV), true);
});

test('1b. production permits neither, today', () => {
  const p = account.officialAccessPolicy(PROD_ENV);
  assert.equal(p.environment, 'production');
  assert.equal(p.allowLogin, false);
  assert.equal(p.allowAdmin, false);
});

test('1c. the approval phrase ALONE changes nothing — the lane ships switched off', () => {
  /* This is the check that makes "production is unchanged today" a fact. Even
     an operator who knows the phrase and sets it gets the same answer, because
     the lane in the source is false and both keys are required. */
  const p = account.officialAccessPolicy({ ...PROD_ENV, ATWE_OFFICIAL_PROD_ACTIVATION: account.PROD_ACTIVATION_PHRASE });
  assert.equal(p.approved, true, 'the runtime key is recognised');
  assert.equal(p.allowLogin, false, 'and still buys nothing on its own');
  assert.equal(p.allowAdmin, false);
  assert.equal(account.OFFICIAL_ACCESS.production.allowLogin, false);
  assert.equal(account.OFFICIAL_ACCESS.production.allowAdmin, false);
});

test('1d. anything that is not provably beta is treated as production', () => {
  /* The stricter lane is the fallback, so a half-configured or unrecognised box
     never lands in the looser one. Each of these fails one beta check. */
  for (const env of [
    {},
    { ATWE_ENV: 'beta' },                                             // no APP_URL
    { ATWE_ENV: 'beta', APP_URL: 'https://atwe.com', DATABASE_URL: 'postgres://x@y/z' }, // prod host
    { ATWE_ENV: 'staging', APP_URL: 'https://beta.atwe.com', DATABASE_URL: 'postgres://x@y/z' },
    { ...BETA_ENV, RAILWAY_ENVIRONMENT_NAME: 'production' },
  ]) {
    const p = account.officialAccessPolicy(env);
    assert.equal(p.environment, 'production', `should fall to the strict lane: ${JSON.stringify(env)}`);
    assert.equal(p.allowAdmin, false);
  }
});

test('1e. the gate refuses production in words, and names BOTH steps', () => {
  assert.doesNotThrow(() => account.assertOfficialAccessAllowed(BETA_ENV, 'admin'));
  assert.doesNotThrow(() => account.assertOfficialAccessAllowed(BETA_ENV, 'login'));
  for (const what of ['admin', 'login']) {
    assert.throws(() => account.assertOfficialAccessAllowed(PROD_ENV, what), (e) => {
      assert.match(e.message, /not switched on for production yet/);
      assert.match(e.message, /OFFICIAL_ACCESS/, 'it names the code change');
      assert.match(e.message, /ATWE_OFFICIAL_PROD_ACTIVATION/, 'and the runtime approval');
      assert.match(e.message, /Neither one alone/);
      return true;
    }, `${what} must refuse on production`);
  }
});

/* ═══ 2. PROMOTING, AND EVERYTHING IT REFUSES ════════════════════════════ */

test('2. an exact official beta account is promoted, and ONE column is written', async () => {
  const db = officialDb(OFFICIAL);
  const out = await account.promoteOfficialAdmin(db, { username: 'atwe', env: BETA_ENV });
  assert.equal(out.already, false);
  assert.equal(out.seedTag, 'beta-keep');

  const upd = db.sql.find((q) => /^\s*UPDATE/i.test(q.text));
  const [set, where] = upd.text.split('WHERE');
  assert.match(set, /SET\s+is_admin = true/);
  /* Nothing else is touched. The keep-tag in particular is only re-asserted. */
  for (const col of ['password_hash', 'username', 'email', 'name', 'account_type',
                     'seed_tag', 'verified', 'admin_perms', 'admin_role', 'status', 'deactivated']) {
    assert.doesNotMatch(set, new RegExp(`(^|[\\s,(])${col}\\s*=`, 'm'), `promote must not set ${col}`);
  }
  /* And the whole identity is re-asserted in the statement's own WHERE, so a
     row that changed underneath is missed rather than promoted. */
  assert.match(where, /\bid = \$1/);
  assert.match(where, /lower\(username\)/);
  assert.match(where, /lower\(email\)/);
  assert.match(where, /account_type\s*=\s*'business'/);
  assert.match(where, /seed_tag\s*= \$4/);
  assert.match(where, /is_demo\s+IS NOT TRUE/);
  assert.match(where, /is_admin\s+IS NOT TRUE/, 'it may only promote a non-admin');
  assert.match(where, /jsonb_array_length/, 'and never a row carrying scopes');
  assert.ok(upd.params.includes('beta-keep'));
});

test('2b. off beta it refuses BEFORE reading a single row', async () => {
  const db = officialDb(OFFICIAL);
  await assert.rejects(() => account.promoteOfficialAdmin(db, { username: 'atwe', env: PROD_ENV }),
    /not switched on for production yet/);
  assert.equal(db.sql.length, 0, 'no query may be issued at all');
});

test('2c. an ordinary beta business account is refused', async () => {
  const db = officialDb(ORDINARY);
  await assert.rejects(() => account.promoteOfficialAdmin(db, { username: 'someshop', env: BETA_ENV }),
    /not the built-in Atwe account/);
  assert.ok(!db.sql.some((q) => /^\s*UPDATE/i.test(q.text)), 'nothing was written');
});

test('2d. an arbitrary account wearing the handle is refused, one reason at a time', async () => {
  /* Every provenance and safety check still applies with the policy WIDE OPEN.
     Only `is_admin` moved behind it; these did not. */
  const cases = [
    [{ email: 'me@gmail.com' }, /was not made by the app itself/],
    [{ name: 'Atwe Inc' }, /name/],
    [{ account_type: 'personal' }, /account type/],
    [{ is_demo: true }, /is_demo/],
    [{ admin_perms: ['users'] }, /staff scopes/],
    [{ totp_enabled: true }, /two-factor/],
    [{ status: 'suspended' }, /status/],
    [{ deactivated: true }, /deactivated/],
    [{ stripe_customer_id: 'cus_1' }, /Stripe customer/],
    [{ oauth_provider: 'google' }, /sign-in provider/],
  ];
  for (const [patch, expect] of cases) {
    const why = account.officialMismatch({ ...OFFICIAL, ...patch }, 'atwe', { allowAdmin: true });
    assert.ok(why, `must still refuse ${JSON.stringify(patch)} even on beta`);
    assert.match(why, expect);
    await assert.rejects(() => account.promoteOfficialAdmin(officialDb({ ...OFFICIAL, ...patch }), { env: BETA_ENV }),
      /not the built-in Atwe account/);
  }
});

test('2e. it refuses an account beta tooling does not already own', async () => {
  /* seed_tag beta-keep is what activate-official writes. A superadmin nobody
     can sign into is of no use, so the password comes first, deliberately. */
  await assert.rejects(() => account.promoteOfficialAdmin(officialDb({ ...OFFICIAL, seed_tag: null }), { env: BETA_ENV }),
    /not yet a protected beta account/);
});

test('2f. promoting twice writes nothing the second time', async () => {
  const db = officialDb({ ...OFFICIAL, is_admin: true });
  const out = await account.promoteOfficialAdmin(db, { env: BETA_ENV });
  assert.equal(out.already, true);
  assert.ok(!db.sql.some((q) => /^\s*UPDATE/i.test(q.text)), 'idempotent, and silent about it');
});

test('2g. there is no "promote anybody" helper, and no username a caller controls', () => {
  /* The exported surface may grant staff access to exactly one account. */
  const granters = Object.keys(account).filter((k) => /promote|grantAdmin|makeAdmin|setAdmin/i.test(k));
  assert.deepEqual(granters, ['promoteOfficialAdmin'], `unexpected granter(s): ${granters.join(', ')}`);
  /* Even that one resolves the handle itself rather than trusting a caller: the
     only UPDATE that sets is_admin re-asserts the built-in email. */
  const ups = [...MOD_CODE.matchAll(/UPDATE\s+users[\s\S]*?RETURNING/g)].map((m) => m[0]);
  const admins = ups.filter((u) => /SET\s+is_admin/.test(u));
  assert.equal(admins.length, 1, 'exactly one statement in the module grants admin');
  assert.match(admins[0].split('WHERE')[1], /lower\(email\)/);
});

/* ═══ 3. THE IDENTITY CHECKS WERE NOT WEAKENED ═══════════════════════════ */

test('3. without the policy saying yes, an admin @atwe still fails identity', () => {
  const admin = { ...OFFICIAL, is_admin: true };
  assert.match(account.officialMismatch(admin, 'atwe'), /superadmin is not permitted/,
    'the DEFAULT is the strict answer, so a caller that forgets gets it');
  assert.match(account.officialMismatch(admin, 'atwe', { allowAdmin: false }), /superadmin is not permitted/);
  assert.equal(account.officialMismatch(admin, 'atwe', { allowAdmin: true }), null);
});

test('3b. scopes are refused in EVERY environment, policy or no policy', () => {
  const scoped = { ...OFFICIAL, is_admin: true, admin_perms: ['users', 'revenue'] };
  assert.match(account.officialMismatch(scoped, 'atwe', { allowAdmin: true }), /staff scopes/);
});

test('3c. the module still cannot reach a second database', () => {
  assert.doesNotMatch(MOD_CODE, /PROD_DATABASE_URL|DATABASE_URL|pg\.Client|new Pool/i);
  assert.doesNotMatch(MOD_CODE, /\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i);
});

test('3d. nothing anywhere renames the account or changes its type', () => {
  for (const [name, code] of [['seed/beta-account.js', MOD_CODE], ['beta-access.js', SVC_CODE]]) {
    for (const up of [...code.matchAll(/UPDATE\s+users[\s\S]*?RETURNING/g)].map((m) => m[0])) {
      const set = up.split('WHERE')[0];
      for (const col of ['username', 'account_type', 'name']) {
        assert.doesNotMatch(set, new RegExp(`(^|[\\s,(])${col}\\s*=`, 'm'),
          `${name} must never set ${col}`);
      }
    }
  }
});

/* ═══ 4. THE BETA ACCESS SCREEN ══════════════════════════════════════════ */

test('4. a protected superadmin is labelled as one, and only where permitted', () => {
  const admin = { ...OFFICIAL, is_admin: true, demo_follows: 0 };
  const shown = betaAccess.safeAccount(admin, { allowAdmin: true });
  assert.equal(shown.official, true);
  assert.equal(shown.officialVerified, true);
  assert.equal(shown.protectedAdmin, true);
  assert.equal(shown.betaLabel, 'Protected beta account');

  /* The same row where the policy says no: still shown, because the tag is a
     fact, but not recognised and therefore untouchable. */
  const strict = betaAccess.safeAccount(admin, {});
  assert.equal(strict.protectedAdmin, false);
  assert.equal(strict.officialVerified, false);

  /* An ordinary staff account is never "protected", whatever the policy says. */
  assert.equal(betaAccess.safeAccount({ ...ORDINARY, is_admin: true }, { allowAdmin: true }).protectedAdmin, false);
});

test('4b. no credential ever leaves in the shape, admin or not', () => {
  const out = betaAccess.safeAccount({ ...OFFICIAL, is_admin: true, password_hash: '$2b$10$secret', totp_secret: 'ABC' },
    { allowAdmin: true });
  assert.doesNotMatch(JSON.stringify(out), /password|\$2b\$|totp_secret|ABC/i);
});

test('4c. @atwe stays protected: no revoke, no test world, no delete', async () => {
  const db = officialDb({ ...OFFICIAL, is_admin: true, demo_follows: 0 });
  /* Revoke and join-test-world both ask for 'ordinary', which refuses the
     official account outright -- before the staff carve-out is ever reached, so
     the carve-out cannot widen either of them. Asserted under a BETA policy,
     i.e. the most permissive state that exists. */
  await withEnv(BETA_ENV, () => assert.rejects(() => betaAccess.assertManageable(db, 7, 'ordinary'),
    /official Atwe account\. It is protected/));
  /* And there is no row deletion anywhere to protect it from. Scoped to SQL:
     `delete id.role` is an ordinary JS delete on a plain object and matching it
     would fail this on correct code. */
  assert.doesNotMatch(SVC_CODE, /DELETE\s+FROM|DROP\s+TABLE|TRUNCATE/i);
  const promote = CLI_CODE.slice(CLI_CODE.indexOf('doPromoteOfficialAdmin'),
                                 CLI_CODE.indexOf('async function doReset'));
  assert.ok(promote.length > 200, 'the promote command was located');
  assert.doesNotMatch(promote, /DELETE\s+FROM|DROP\s+TABLE|TRUNCATE/i);
});

test('4d. the ONE thing it may still do is set a beta password', async () => {
  const db = officialDb({ ...OFFICIAL, is_admin: true, demo_follows: 0 });
  /* The service reads process.env itself (the routes run inside a real server),
     so stand in a beta environment rather than passing a flag it does not take. */
  const acct = await withEnv(BETA_ENV, () => betaAccess.assertManageable(db, 7, 'any'));
  assert.equal(acct.protectedAdmin, true, 'the staff refusal steps aside for exactly this account');

  /* And on production the same row is not recognised at all, so even the
     password door is shut: admin @atwe fails identity there, today. */
  const strict = officialDb({ ...OFFICIAL, is_admin: true, demo_follows: 0 });
  await withEnv(PROD_ENV, () => assert.rejects(() => betaAccess.assertManageable(strict, 7, 'any'),
    /no longer matches the account the app creates/));
});

test('4e. an ordinary staff account is still refused by both doors', async () => {
  for (const patch of [{ is_admin: true }, { admin_perms: ['users'] }]) {
    const db = officialDb({ ...ORDINARY, ...patch, demo_follows: 0 });
    await assert.rejects(() => betaAccess.assertManageable(db, 9, 'any'), /staff access/);
  }
});

test('4f. the screen shows the state and offers no control for it', () => {
  const ADMIN_HTML = fs.readFileSync(path.join(ROOT, 'public', 'admin.html'), 'utf8');
  /* The Beta Access view ONLY. An earlier version sliced from the first mention
     of the section name, which is a CSS comment near the top of the file, and
     so swept in the entire dashboard -- including the Users tab's own admin
     toggle, which is a different screen and legitimately has one. */
  const from = ADMIN_HTML.indexOf('async function renderBetaAccessView');
  const to = ADMIN_HTML.indexOf('async function baRefreshOpen');
  assert.ok(from > 0 && to > from, 'the Beta Access view was located');
  const view = ADMIN_HTML.slice(from, to);
  assert.match(view, /a\.protectedAdmin/, 'the view reads the flag');
  assert.match(view, /Superadmin/, 'and says so plainly');
  /* No toggle, button or request that would grant it from the browser. */
  assert.doesNotMatch(view, /is_admin|makeAdmin|promote|grantAdmin/i,
    'the dashboard must never be able to grant this');
});

/* ═══ 5. THE CONSOLE COMMAND ═════════════════════════════════════════════ */

test('5. the command exists, is dispatched, and takes no username', () => {
  assert.match(CLI_CODE, /'promote-official-admin'/);
  assert.match(CLI_CODE, /cmd === 'promote-official-admin'\s*\)\s*return await doPromoteOfficialAdmin/);
  const body = CLI_CODE.slice(CLI_CODE.indexOf('async function doPromoteOfficialAdmin'),
                              CLI_CODE.indexOf('async function doReset'));
  assert.match(body, /account\.OFFICIAL_USERNAME/, 'it resolves the handle itself');
  assert.doesNotMatch(body, /opts\.(username|identity|user)\b/, 'and reads no name from argv');
  assert.match(body, /account\.promoteOfficialAdmin\(/, 'the refusals live in the service layer');
  assert.match(body, /env: process\.env/, 'and the policy decides, not a flag');
  /* It cannot seed, reset or delete on the way past. */
  for (const bad of ['seedDemo', 'teardownDemo', 'doReset', 'DELETE', 'DROP']) {
    assert.doesNotMatch(body, new RegExp(bad), `promote must not mention ${bad}`);
  }
});

test('5b. activate-official asks the policy before it hands out a login', () => {
  const body = CLI_CODE.slice(CLI_CODE.indexOf('async function doActivateOfficial'),
                              CLI_CODE.indexOf('async function doPromoteOfficialAdmin'));
  assert.match(body, /assertOfficialAccessAllowed\(process\.env, 'login'\)/);
});

test('5c. @yiddiweller needs no special case anywhere', () => {
  /* Founder accounts other than the built-in one become superadmins the ordinary
     way, through the dashboard's Staff tab, identically in both environments.
     Naming one in this machinery would be a second, unaudited door. */
  for (const [name, code] of [['seed/beta-account.js', MOD_CODE], ['beta-access.js', SVC_CODE], ['tools/seed-beta.js', CLI_CODE]]) {
    assert.doesNotMatch(code, /yiddiweller/i, `${name} must not name a human account`);
  }
});

/* ═══ 6. AGAINST A REAL DATABASE (opt-in) ════════════════════════════════ */

if (!h.SKIP && process.env.ATWE_LIVE_BETA_AUTHZ === '1') {
  const auth = require('../auth');
  let pool, official, officialTok;

  test('live setup: a real beta server and a real built-in @atwe row', async () => {
    await h.startServer({
      ATWE_ENV: 'beta',
      APP_URL: 'http://localhost',
      RAILWAY_ENVIRONMENT_NAME: '', RAILWAY_ENVIRONMENT: '',
      PROD_DATABASE_URL_FINGERPRINT: '',
    });
    pool = h.getPool();
    /* The app creates @atwe itself on boot; if a previous run left one, reuse
       it and put it back to how ensureOfficialAccount makes it. */
    await pool.query(
      `UPDATE users SET is_admin = false, admin_perms = '[]'::jsonb, admin_role = NULL, seed_tag = NULL,
              email = 'no-reply+atwe@atwe.internal'
        WHERE lower(username) = 'atwe'`);
    /* And free the activated address, in case a crashed run left a fixture on
       it. Scoped to this suite's own throwaway handle, never a real account. */
    await pool.query(`DELETE FROM users WHERE lower(username) = 'emailsquatter'`);
    const { rows } = await pool.query(`SELECT id FROM users WHERE lower(username) = 'atwe'`);
    assert.ok(rows[0], 'the server created its own @atwe account on boot');
    official = { id: rows[0].id };
  });

  test('live: activate gives it a beta password, and the keep-tag', async () => {
    const hash = await auth.hashPassword('beta-official-pass-123');
    const out = await account.activateOfficial(pool, { passwordHash: hash, allowAdmin: true });
    assert.equal(out.seedTag, 'beta-keep');
    assert.equal(out.isAdmin, false, 'not an admin yet — that is a separate act');
  });

  test('live: it refuses to take ceo@atwe.com off another account', async () => {
    /* The squatter is a throwaway, and it is deleted again below. This is the
       one refusal that cannot be proved with a fake db alone, because the whole
       point is what a real UNIQUE index would otherwise do to us. */
    await pool.query(
      `INSERT INTO users (name, email, password_hash, username, account_type)
       VALUES ('Squatter', 'ceo@atwe.com', 'x', 'emailsquatter', 'personal')`);
    await assert.rejects(
      () => account.setOfficialEmail(pool, { env: BETA_ENV }),
      /already belongs to @emailsquatter/);
    const still = (await pool.query('SELECT email FROM users WHERE id = $1', [official.id])).rows[0];
    assert.equal(still.email, 'no-reply+atwe@atwe.internal', 'and @atwe was not moved');
    await pool.query(`DELETE FROM users WHERE lower(username) = 'emailsquatter'`);
  });

  test('live: the email moves to ceo@atwe.com and NOTHING else changes', async () => {
    const before = (await pool.query(
      `SELECT username, name, account_type, seed_tag, password_hash, email_verified, verified,
              is_admin, admin_perms, admin_role, status, headline
         FROM users WHERE id = $1`, [official.id])).rows[0];
    assert.equal(before.seed_tag, 'beta-keep', 'it is the protected beta account before the move');

    const out = await account.setOfficialEmail(pool, { env: BETA_ENV });
    assert.equal(out.already, false);
    assert.equal(out.from, 'no-reply+atwe@atwe.internal');
    assert.equal(out.to, 'ceo@atwe.com');

    const after = (await pool.query(
      `SELECT email, username, name, account_type, seed_tag, password_hash, email_verified, verified,
              is_admin, admin_perms, admin_role, status, headline
         FROM users WHERE id = $1`, [official.id])).rows[0];
    assert.equal(after.email, 'ceo@atwe.com', 'the address moved');
    for (const col of Object.keys(before)) {
      assert.deepEqual(after[col], before[col], `${col} must be untouched by an email move`);
    }
    /* Spelled out, because these three are what the founder asked to be sure of. */
    assert.equal(after.password_hash, before.password_hash, 'the beta password is not rotated');
    assert.equal(after.seed_tag, 'beta-keep', 'still protected from a beta reset');
    assert.equal(after.is_admin, false, 'and the move grants nothing');
  });

  test('live: the activated row is still the canonical official account', async () => {
    const { row } = await account.findOfficial(pool);
    assert.equal(row.email, 'ceo@atwe.com');
    assert.equal(account.officialEmailState(row.email), 'activated');
    assert.equal(account.officialMismatch(row), null,
      'the canonical checks recognise the activated identity');
  });

  test('live: running it again writes nothing', async () => {
    const before = (await pool.query('SELECT email, password_hash FROM users WHERE id = $1', [official.id])).rows[0];
    const out = await account.setOfficialEmail(pool, { env: BETA_ENV });
    assert.equal(out.already, true);
    const after = (await pool.query('SELECT email, password_hash FROM users WHERE id = $1', [official.id])).rows[0];
    assert.deepEqual(after, before);
  });

  test('live: production refuses the move, against the real database', async () => {
    await assert.rejects(
      () => account.setOfficialEmail(pool, { env: { ATWE_ENV: 'production', APP_URL: 'https://atwe.com',
                                                    DATABASE_URL: 'postgres://u:p@prod-db.internal:5432/atwe' } }),
      /not switched on for production yet/);
  });

  test('live: promote makes it a superadmin and changes nothing else', async () => {
    const before = (await pool.query(
      `SELECT username, email, name, account_type, seed_tag, password_hash, verified, admin_perms
         FROM users WHERE id = $1`, [official.id])).rows[0];

    const out = await account.promoteOfficialAdmin(pool, { env: { ...BETA_ENV, DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgres://x@beta-db/y' } });
    assert.equal(out.already, false);

    const after = (await pool.query(
      `SELECT username, email, name, account_type, seed_tag, password_hash, verified, admin_perms, is_admin, admin_role
         FROM users WHERE id = $1`, [official.id])).rows[0];
    assert.equal(after.is_admin, true, 'it is a superadmin');
    assert.equal(after.seed_tag, 'beta-keep', 'and still protected from reset');
    assert.deepEqual(after.admin_perms, [], 'with no scopes invented for it');
    assert.equal(after.admin_role, null);
    for (const col of ['username', 'email', 'name', 'account_type', 'password_hash', 'verified']) {
      assert.deepEqual(after[col], before[col], `${col} must be untouched`);
    }
  });

  test('live: that superadmin reaches the Beta Access API', async () => {
    const row = (await pool.query('SELECT id, email FROM users WHERE id = $1', [official.id])).rows[0];
    officialTok = auth.signToken({ id: row.id, email: row.email, is_admin: true });
    await pool.query('INSERT INTO auth_sessions (user_id, token_hash, user_agent, ip) VALUES ($1,$2,$3,$4)',
      [row.id, auth.hashToken(officialTok), 'official-admin-test', '127.0.0.1']);

    const r = await h.api('GET', '/api/admin/beta/accounts', { token: officialTok });
    assert.strictEqual(r.status, 200, `@atwe as superadmin should be served: ${JSON.stringify(r.body)}`);
    const me = (r.body.accounts || []).find((a) => a.username === 'atwe');
    assert.ok(me, 'and it lists itself');
    assert.equal(me.protectedAdmin, true, 'labelled as the protected superadmin');
    assert.equal(me.official, true);
    assert.equal(me.officialVerified, true, 'admin no longer breaks its identity on beta');
  });

  test('live: the password reset still works, and it stays a superadmin', async () => {
    const me = (await h.api('GET', '/api/admin/beta/accounts', { token: officialTok })).body.accounts
      .find((a) => a.username === 'atwe');
    const r = await h.api('POST', `/api/admin/beta/accounts/${me.id}/password`,
      { token: officialTok, body: { password: 'another-beta-pass-456', confirm: 'another-beta-pass-456' } });
    assert.strictEqual(r.status, 200, `reset should succeed: ${JSON.stringify(r.body)}`);

    const after = (await pool.query('SELECT is_admin, seed_tag FROM users WHERE id = $1', [official.id])).rows[0];
    assert.equal(after.is_admin, true, 'the reset did not demote it');
    assert.equal(after.seed_tag, 'beta-keep', 'nor move it onto the tag reset deletes');
  });

  test('live: it is still protected from revoke', async () => {
    /* The reset above signed every session out, so mint a fresh one. */
    const row = (await pool.query('SELECT id, email FROM users WHERE id = $1', [official.id])).rows[0];
    officialTok = auth.signToken({ id: row.id, email: row.email, is_admin: true });
    await pool.query('INSERT INTO auth_sessions (user_id, token_hash, user_agent, ip) VALUES ($1,$2,$3,$4)',
      [row.id, auth.hashToken(officialTok), 'official-admin-test', '127.0.0.1']);

    const r = await h.api('POST', `/api/admin/beta/accounts/${official.id}/access`,
      { token: officialTok, body: { enabled: false } });
    assert.strictEqual(r.status, 400, 'revoke must refuse the official account');
    assert.match(r.body.error || '', /official Atwe account\. It is protected/);
    const after = (await pool.query('SELECT status FROM users WHERE id = $1', [official.id])).rows[0];
    assert.equal(after.status, 'active', 'and it is still able to sign in');
  });

  test('live teardown', async () => {
    /* Put the row back the way the app makes it, so a later run of any other
       suite against this database finds an ordinary built-in account. */
    await pool.query(
      `UPDATE users SET is_admin = false, seed_tag = NULL, email = 'no-reply+atwe@atwe.internal'
        WHERE lower(username) = 'atwe'`);
    await h.stopServer();
  });
}
