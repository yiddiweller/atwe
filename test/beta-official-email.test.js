/* THE OFFICIAL @atwe ACCOUNT HAS TWO LEGITIMATE EMAILS, AND ONE WAY BETWEEN THEM.
 *
 * The founder's final identity model (16 Sep 2026): the activated official
 * account signs in as ceo@atwe.com, in both environments. The app still CREATES
 * the row with no-reply+atwe@atwe.internal, so a genuine @atwe is in one of two
 * states and both are canonical.
 *
 * THE RISK THIS FILE EXISTS FOR. The obvious way to make ceo@atwe.com work is to
 * stop checking the email, and that would quietly delete the strongest
 * provenance signal the tool has. So the check became an ALLOWLIST OF TWO, and
 * these tests are what keep it two: a dormant row passes, an activated row
 * passes, and a third address refuses exactly as it always did.
 *
 * The transition itself is the other half. It is one narrow operation that moves
 * one column in one direction on one account, and everything it must NOT do --
 * touch the password, grant admin, move the tag, work off beta, take an address
 * off somebody else -- is asserted here rather than left to the comment above it.
 *
 * ALL OF THIS IS OFFLINE AND ALWAYS RUNS. The live half deliberately lives in
 * test/beta-official-admin.test.js instead: `node --test` runs FILES
 * concurrently, and that file already owns the real @atwe row (it promotes it
 * and puts it back). Two files mutating one row in two processes is a race, so
 * the live email checks sit beside the live admin ones, in one process, in
 * order.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const jstext = require('../tools/jstext');
const account = require('../seed/beta-account');

const ROOT = path.join(__dirname, '..');
const MOD_CODE = jstext.scan(fs.readFileSync(path.join(ROOT, 'seed', 'beta-account.js'), 'utf8')).code;
const CLI_CODE = jstext.scan(fs.readFileSync(path.join(ROOT, 'tools', 'seed-beta.js'), 'utf8')).code;

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

const DORMANT_EMAIL = 'no-reply+atwe@atwe.internal';
const ACTIVE_EMAIL = 'ceo@atwe.com';

/* The row as beta tooling leaves it after activate-official: a real password,
   the keep-tag, and still the address the app created it with. */
const DORMANT = {
  id: 7, username: 'atwe', email: DORMANT_EMAIL, name: 'Atwe',
  account_type: 'business', is_demo: false, is_admin: false, admin_perms: [], admin_role: null,
  verified: true, email_verified: true, headline: 'Product news and tips from Atwe',
  status: 'active', deactivated: false, totp_enabled: false,
  stripe_customer_id: null, stripe_connect_id: null, oauth_provider: null,
  seed_tag: 'beta-keep', created_at: new Date(),
};
const ACTIVATED = { ...DORMANT, email: ACTIVE_EMAIL };

/* A db that answers findOfficial with `row`, findByEmail with `holder` (null =
   the address is free), and any UPDATE with one row. Every statement is kept so
   a test can assert on what was NOT written as easily as on what was. */
function officialDb(row, holder = null) {
  const sql = [];
  return {
    sql,
    query: async (text, params) => {
      sql.push({ text, params });
      if (/^\s*UPDATE/i.test(text)) {
        return { rows: [{ id: row.id, username: row.username, email: params[0] }], rowCount: 1 };
      }
      /* findEmailOwners' collision sweep. `holder` may be one row or several. */
      if (/email ILIKE/.test(text)) {
        const rows = holder ? (Array.isArray(holder) ? holder : [holder]) : [];
        return { rows, rowCount: rows.length };
      }
      return row ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 };
    },
  };
}
const joined = (db) => db.sql.map((q) => q.text).join('\n');
const writes = (db) => db.sql.filter((q) => /^\s*(INSERT|UPDATE|DELETE)/i.test(q.text));

/* ═══ 1. THE TWO STATES ══════════════════════════════════════════════════ */

test('1. the two canonical addresses are exactly what the founder decided', () => {
  const em = account.officialEmails();
  assert.equal(em.dormant, DORMANT_EMAIL, 'the address the app itself writes');
  assert.equal(em.activated, ACTIVE_EMAIL, 'the activated login identity');
  assert.equal(account.OFFICIAL_EMAIL_ACTIVATED, ACTIVE_EMAIL);
  /* The dormant one follows the username because server.js builds it that way;
     the activated one must NOT, because it is a real mailbox, not a pattern. */
  assert.equal(account.officialEmails('other').dormant, 'no-reply+other@atwe.internal');
  assert.equal(account.officialEmails('other').activated, ACTIVE_EMAIL);
});

test('1b. the dormant address is still the app\'s own literal, read from server.js', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(server, /no-reply\+\$\{ATWE_OFFICIAL_USERNAME\}@atwe\.internal/,
    'if the app changes how it creates the account, this fails rather than refusing the real row for ever');
  assert.equal(account.officialIdentity().email, DORMANT_EMAIL,
    'officialIdentity still describes the CREATED state');
  assert.equal(account.officialIdentity().emailActivated, ACTIVE_EMAIL);
});

test('2. each state is recognised, and nothing else is', () => {
  assert.equal(account.officialEmailState(DORMANT_EMAIL), 'dormant');
  assert.equal(account.officialEmailState(ACTIVE_EMAIL), 'activated');
  /* Postgres UNIQUE on a TEXT email is case sensitive, so the state test must
     not be: CEO@Atwe.com is the same mailbox. */
  assert.equal(account.officialEmailState('CEO@Atwe.com'), 'activated');
  assert.equal(account.officialEmailState('  ceo@atwe.com  '), 'activated');
  for (const third of ['me@gmail.com', 'ceo@atwe.co', 'ceo@atwe.com.evil.net', 'atwe@atwe.com',
                       'no-reply+atwe@atwe.com', '', null, undefined]) {
    assert.equal(account.officialEmailState(third), null, `"${third}" is not a canonical address`);
  }
});

test('3. the canonical identity accepts BOTH states and refuses a third address', () => {
  assert.equal(account.officialMismatch(DORMANT), null, 'the dormant built-in row passes');
  assert.equal(account.officialMismatch(ACTIVATED), null, 'the activated row passes');
  const why = account.officialMismatch({ ...DORMANT, email: 'me@gmail.com' });
  assert.ok(why, 'an arbitrary address must still refuse');
  assert.match(why, /was not made by the app itself/);
  assert.match(why, /no-reply\+atwe@atwe\.internal/, 'and the refusal names both legitimate addresses');
  assert.match(why, /ceo@atwe\.com/);
});

test('4. moving the email does not weaken ANY other identity check', () => {
  /* Every refusal from before, re-run against the ACTIVATED row. If the email
     change had been made by loosening the function, these would start passing. */
  const cases = [
    ['a different username', { username: 'someoneelse' }, /username/],
    ['a renamed account', { name: 'Atwe Inc' }, /name/],
    ['a personal account', { account_type: 'personal' }, /account type/],
    ['seeded sample data', { is_demo: true }, /is_demo/],
    ['a scoped staffer', { admin_perms: ['users'] }, /staff scopes/],
    ['two-factor enabled', { totp_enabled: true }, /two-factor/],
    ['a suspended account', { status: 'suspended' }, /status/],
    ['a deactivated account', { deactivated: true }, /deactivated/],
    ['a Stripe customer', { stripe_customer_id: 'cus_1' }, /Stripe customer/],
    ['a linked provider', { oauth_provider: 'google' }, /sign-in provider/],
    ['a seeded row', { seed_tag: 'beta' }, /seed_tag/],
  ];
  for (const [what, patch, expect] of cases) {
    const why = account.officialMismatch({ ...ACTIVATED, ...patch });
    assert.ok(why, `an activated row that is ${what} must still refuse`);
    assert.match(why, expect, `and say why, for ${what}`);
  }
  /* And admin is still refused unless the policy was asked and said yes. */
  assert.match(account.officialMismatch({ ...ACTIVATED, is_admin: true }),
    /superadmin is not permitted/);
  assert.equal(account.officialMismatch({ ...ACTIVATED, is_admin: true }, 'atwe', { allowAdmin: true }), null);
});

/* ═══ 2. THE TRANSITION ══════════════════════════════════════════════════ */

test('5. on beta it moves the address, and writes exactly one column', async () => {
  const db = officialDb(DORMANT);
  const out = await account.setOfficialEmail(db, { env: BETA_ENV });
  assert.equal(out.already, false);
  assert.equal(out.from, DORMANT_EMAIL);
  assert.equal(out.to, ACTIVE_EMAIL);
  assert.equal(out.email, ACTIVE_EMAIL);

  const w = writes(db);
  assert.equal(w.length, 1, 'one statement writes, and it is an UPDATE');
  const sql = w[0].text;
  assert.match(sql, /SET email = \$1/);
  /* The SET clause, on its own, must name nothing else. Bounded at WHERE so the
     identity clauses below it are not mistaken for writes. */
  const setClause = sql.slice(sql.indexOf('SET'), sql.indexOf('WHERE'));
  for (const col of ['password_hash', 'is_admin', 'admin_perms', 'admin_role', 'seed_tag',
                     'email_verified', 'username', 'name', 'account_type', 'verified', 'status']) {
    assert.doesNotMatch(setClause, new RegExp(`\\b${col}\\s*=`), `${col} must not be written`);
  }
  assert.deepEqual(w[0].params[0], ACTIVE_EMAIL, 'and the one value written is the activated address');
});

test('6. the UPDATE re-asserts the whole identity, so a changed row is missed', async () => {
  const db = officialDb(DORMANT);
  await account.setOfficialEmail(db, { env: BETA_ENV });
  const where = writes(db)[0].text.split('WHERE')[1];
  /* `lower(trim(email))`, not `lower(email)`: the classifier normalises, so the
     write must normalise identically or a padded stored value is classified
     dormant and then matched by nothing. */
  for (const clause of [/id = \$2/, /lower\(username\) = \$3/, /lower\(trim\(email\)\)\s*= \$4/,
                        /account_type\s*= 'business'/, /seed_tag\s*= \$5/,
                        /is_demo\s+IS NOT TRUE/, /is_admin IS NOT DISTINCT FROM \$6/]) {
    assert.match(where, clause, `the WHERE must carry ${clause}`);
  }
  /* `IS NOT DISTINCT FROM` rather than a fixed value: it re-asserts the row's
     OWN admin state, so promoting or demoting mid-flight misses rather than
     writing to a row that was never inspected. */
  assert.equal(writes(db)[0].params[5], false, 'the row was not an admin, so that is what is asserted');
  assert.equal(writes(db)[0].params[3], DORMANT_EMAIL, 'and only the dormant address is ever overwritten');
});

test('7. running it again is a no-op that writes nothing', async () => {
  const db = officialDb(ACTIVATED);
  const out = await account.setOfficialEmail(db, { env: BETA_ENV });
  assert.equal(out.already, true, 'idempotent');
  assert.equal(out.email, ACTIVE_EMAIL);
  assert.equal(writes(db).length, 0, 'and nothing at all is written');
});

test('8. it refuses an account that is not provably the built-in one, and writes nothing', async () => {
  for (const [what, patch] of [
    ['a different username', { username: 'someshop' }],
    ['a third-party email', { email: 'me@gmail.com' }],
    ['a personal account', { account_type: 'personal' }],
    ['a renamed account', { name: 'Not Atwe' }],
    ['seeded sample data', { is_demo: true }],
    ['a scoped staffer', { admin_perms: ['users'] }],
    ['two-factor enabled', { totp_enabled: true }],
    ['a Stripe customer', { stripe_customer_id: 'cus_1' }],
  ]) {
    const db = officialDb({ ...DORMANT, ...patch });
    await assert.rejects(() => account.setOfficialEmail(db, { env: BETA_ENV }),
      /not the built-in Atwe account/, `it must refuse ${what}`);
    assert.equal(writes(db).length, 0, `and write nothing for ${what}`);
  }
  /* No row at all. */
  const empty = officialDb(null);
  await assert.rejects(() => account.setOfficialEmail(empty, { env: BETA_ENV }), /no @atwe account exists/);
  assert.equal(writes(empty).length, 0);
});

test('9. it refuses a row beta tooling does not already own', async () => {
  for (const tag of [null, 'beta']) {
    const db = officialDb({ ...DORMANT, seed_tag: tag });
    await assert.rejects(() => account.setOfficialEmail(db, { env: BETA_ENV }),
      tag === null ? /not yet a protected beta account/ : /seed_tag/);
    assert.equal(writes(db).length, 0);
  }
});

test('10. it refuses when another account already holds ceo@atwe.com', async () => {
  const db = officialDb(DORMANT, { id: 42, username: 'someoneelse', email: ACTIVE_EMAIL, seed_tag: null });
  await assert.rejects(() => account.setOfficialEmail(db, { env: BETA_ENV }),
    /already belongs to @someoneelse/);
  assert.equal(writes(db).length, 0, 'it never takes an address off another account');
  assert.match(joined(db), /email ILIKE/, 'and it really did look');
});

test('10a. one normaliser decides what "the same address" means', () => {
  assert.equal(account.normalizeEmail('  CEO@ATWE.COM  '), ACTIVE_EMAIL);
  assert.equal(account.normalizeEmail('\tCeo@Atwe.com\n'), ACTIVE_EMAIL);
  assert.equal(account.normalizeEmail(' ceo@atwe.com﻿'), ACTIVE_EMAIL, 'unicode padding too');
  assert.equal(account.normalizeEmail(null), '');
  assert.equal(account.normalizeEmail(undefined), '');
  /* The stored canonical value must already BE canonical, or the transition
     would write something it then does not recognise. */
  assert.equal(account.normalizeEmail(account.OFFICIAL_EMAIL_ACTIVATED), account.OFFICIAL_EMAIL_ACTIVATED);
  assert.equal(account.OFFICIAL_EMAIL_ACTIVATED, 'ceo@atwe.com', 'lowercase, no surrounding space');
});

/* Every way one address can be spelled differently and still be one address.
   The tab and newline cases are not hypothetical: `lower(trim(email))` was
   written first, and both slipped through it AND through the UNIQUE index,
   because Postgres' trim() strips spaces only while JavaScript's strips all
   whitespace. Proved against a real database before this was rewritten. */
const SAME_ADDRESS = [
  ['exact', 'ceo@atwe.com'],
  ['all upper', 'CEO@ATWE.COM'],
  ['mixed case', 'Ceo@Atwe.com'],
  ['leading and trailing spaces', '  ceo@atwe.com  '],
  ['tab and newline', '\tceo@atwe.com\n'],
  ['CRLF and case together', '\r\nCEO@Atwe.Com\t'],
  ['non-breaking spaces', ' ceo@atwe.com '],
  ['em space and a BOM', ' Ceo@ATWE.com﻿'],
];

test('10b. EVERY case and whitespace variant is one address, and each one refuses', async () => {
  for (const [what, stored] of SAME_ADDRESS) {
    assert.equal(account.normalizeEmail(stored), ACTIVE_EMAIL, `${what} normalises to the target`);
    const db = officialDb(DORMANT, { id: 42, username: 'squatter', email: stored, seed_tag: null });
    await assert.rejects(() => account.setOfficialEmail(db, { env: BETA_ENV }),
      /already belongs to @squatter/, `a duplicate stored as ${what} must refuse`);
    assert.equal(writes(db).length, 0, `and write nothing for ${what}`);
  }
});

test('10c. the check does NOT lean on the UNIQUE index, and cannot', () => {
  /* The point of 10b: users.email is TEXT UNIQUE, which compares raw bytes, so
     "  ceo@atwe.com  " is a DIFFERENT key from "ceo@atwe.com". The constraint
     would not fire on most of those variants. Anything that refuses them has to
     be our own check, which is why the SQL narrows and JS decides. */
  const distinctKeys = new Set(SAME_ADDRESS.map(([, v]) => v));
  assert.equal(distinctKeys.size, SAME_ADDRESS.length,
    'every variant is a distinct byte string, i.e. a distinct UNIQUE key');
  const fn = MOD_CODE.slice(MOD_CODE.indexOf('async function findEmailOwners'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 1);
  assert.match(body, /ILIKE/, 'SQL narrows');
  assert.match(body, /normalizeEmail\(row\.email\) === target/, 'and JS decides');
  assert.match(body, /replace\(/, 'with LIKE wildcards escaped');
});

test('10d. a near-miss is NOT the same address and must not block the move', async () => {
  for (const other of ['xceo@atwe.com', 'ceo@atwe.comm', 'ceo@atwe.co', 'other@atwe.com', 'ceo@atwe.com.evil.net']) {
    assert.notEqual(account.normalizeEmail(other), ACTIVE_EMAIL);
    /* The ILIKE deliberately over-fetches (a superstring contains the target),
       so the JS filter is what keeps this from being a false refusal. */
    const db = officialDb(DORMANT, { id: 42, username: 'notit', email: other, seed_tag: null });
    const out = await account.setOfficialEmail(db, { env: BETA_ENV });
    assert.equal(out.already, false, `${other} must not block the move`);
  }
});

test('10e. @atwe never collides with ITSELF', async () => {
  /* Two ways this could go wrong: the sweep returning the caller's own row, and
     a re-run finding the address it just wrote. Both must be silent. */
  const dormantSelf = officialDb(DORMANT, { ...DORMANT, email: ACTIVE_EMAIL });
  const out = await account.setOfficialEmail(dormantSelf, { env: BETA_ENV });
  assert.equal(out.already, false, 'its own row is excluded from the collision sweep');

  const already = officialDb(ACTIVATED, ACTIVATED);
  const out2 = await account.setOfficialEmail(already, { env: BETA_ENV });
  assert.equal(out2.already, true, 'and a re-run is a no-op, not a self-collision');
  assert.equal(writes(already).length, 0);
});

test('10f. several holders are ALL named, not just the first one found', async () => {
  const db = officialDb(DORMANT, [
    { id: 42, username: 'squatterA', email: 'CEO@ATWE.COM', seed_tag: null },
    { id: 43, username: 'squatterB', email: '  ceo@atwe.com ', seed_tag: null },
  ]);
  await assert.rejects(() => account.setOfficialEmail(db, { env: BETA_ENV }), (err) => {
    assert.match(err.message, /@squatterA/);
    assert.match(err.message, /@squatterB/, 'taking rows[0] would have hidden this one');
    return true;
  });
  assert.equal(writes(db).length, 0);
});

test('10g. the transition writes EXACTLY the canonical value', async () => {
  const db = officialDb(DORMANT);
  const out = await account.setOfficialEmail(db, { env: BETA_ENV });
  const written = writes(db)[0].params[0];
  assert.equal(written, 'ceo@atwe.com');
  assert.equal(written, account.normalizeEmail(written), 'lowercase, no surrounding whitespace');
  assert.doesNotMatch(written, /\s/, 'no whitespace anywhere in the stored value');
  assert.equal(out.email, 'ceo@atwe.com');
  /* And the dormant side of the WHERE is normalised the same way, so a padded
     stored value is still matched by the write rather than missed. */
  assert.equal(writes(db)[0].params[3], 'no-reply+atwe@atwe.internal');
  assert.match(writes(db)[0].text, /lower\(trim\(email\)\)\s*= \$4/);
});

/* ═══ 2b. ADMIN_EMAIL MUST NOT TURN THIS INTO A STAFF GRANT ══════════════ */

test('10h. it refuses when ADMIN_EMAIL is the address being moved to', async () => {
  /* db.init() promotes whatever holds ADMIN_EMAIL on EVERY boot, so this move
     would grant @atwe superadmin at the next restart with nobody deciding to. */
  for (const [what, adminEmail] of SAME_ADDRESS) {
    const db = officialDb(DORMANT);
    await assert.rejects(
      () => account.setOfficialEmail(db, { env: { ...BETA_ENV, ADMIN_EMAIL: adminEmail } }),
      /ADMIN_EMAIL/, `a clash spelled as ${what} must refuse`);
    assert.equal(writes(db).length, 0, `and write nothing for ${what}`);
  }
  /* The refusal has to say what it costs and where the real door is. */
  const db = officialDb(DORMANT);
  await assert.rejects(() => account.setOfficialEmail(db, { env: { ...BETA_ENV, ADMIN_EMAIL: ACTIVE_EMAIL } }),
    (err) => {
      assert.match(err.message, /promotes whatever account holds ADMIN_EMAIL to superadmin on every boot/i);
      assert.match(err.message, /promote-official-admin/, 'and points at the deliberate path');
      return true;
    });
});

test('10i. an unrelated ADMIN_EMAIL is not a clash', async () => {
  for (const adminEmail of ['yiddiweller@gmail.com', 'ceo@atwe.co', '', undefined]) {
    const db = officialDb(DORMANT);
    const out = await account.setOfficialEmail(db, { env: { ...BETA_ENV, ADMIN_EMAIL: adminEmail } });
    assert.equal(out.already, false, `ADMIN_EMAIL "${adminEmail}" must not block the move`);
  }
});

test('10j. the override is explicit, has no default, and is never inferred', async () => {
  const env = { ...BETA_ENV, ADMIN_EMAIL: ACTIVE_EMAIL };
  /* Only the exact boolean true opens it. Nothing truthy-by-accident does. */
  for (const bad of [undefined, null, false, 0, '', 'yes', 'true', 1, {}]) {
    const db = officialDb(DORMANT);
    await assert.rejects(() => account.setOfficialEmail(db, { env, allowAdminEmailMatch: bad }), /ADMIN_EMAIL/);
  }
  const db = officialDb(DORMANT);
  const out = await account.setOfficialEmail(db, { env, allowAdminEmailMatch: true });
  assert.equal(out.already, false, 'a deliberate override proceeds');

  /* The default in the signature is false, and the CLI sets it from a flag
     somebody has to type in full. */
  assert.match(MOD_CODE, /allowAdminEmailMatch = false/, 'the default is off');
  assert.match(CLI_CODE, /allowAdminEmailMatch: argv\.includes\('--allow-admin-email-match'\)/,
    'and the CLI takes it from one spelled-out flag');
  assert.match(CLI_CODE, /allowAdminEmailMatch: opts\.allowAdminEmailMatch === true/,
    'passed on as an exact boolean, never inferred');
  assert.doesNotMatch(CLI_CODE, /allowAdminEmailMatch:\s*true[,\s]*\}/, 'and never hardcoded true');
});

test('10k. promote-official-admin remains the deliberate admin path', () => {
  /* The whole point of 10h: an email move must not become a staff grant. The
     one statement that grants it is still somewhere else entirely. */
  const fn = MOD_CODE.slice(MOD_CODE.indexOf('async function setOfficialEmail'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 1);
  assert.doesNotMatch(body, /SET\s+is_admin/, 'the transition grants nothing');
  assert.match(CLI_CODE, /cmd === 'promote-official-admin'\) return await doPromoteOfficialAdmin/,
    'and the deliberate command is still there');
});

test('10b. a unique violation at write time becomes a sentence, not a stack trace', async () => {
  /* The check above races: somebody can claim the address between the look and
     the write. users.email is UNIQUE, so the database catches it -- this is
     about what the operator is told. */
  const db = {
    sql: [],
    query: async (text) => {
      db.sql.push({ text });
      if (/^\s*UPDATE/i.test(text)) { const e = new Error('duplicate key'); e.code = '23505'; throw e; }
      if (/email ILIKE/.test(text)) return { rows: [], rowCount: 0 };
      return { rows: [DORMANT], rowCount: 1 };
    },
  };
  await assert.rejects(() => account.setOfficialEmail(db, { env: BETA_ENV }),
    /was claimed by another account while this was running\. Nothing was written/);
});

test('11. two accounts holding @atwe stops everything', async () => {
  const db = {
    sql: [],
    query: async (text) => {
      db.sql.push({ text });
      return { rows: [DORMANT, { ...DORMANT, id: 8 }], rowCount: 2 };
    },
  };
  await assert.rejects(() => account.setOfficialEmail(db, { env: BETA_ENV }), /2 accounts hold @atwe/);
});

/* ═══ 3. THE POLICY GOVERNS IT ═══════════════════════════════════════════ */

test('12. beta permits the transition; production refuses it today', async () => {
  assert.equal(account.officialLoginAllowed(BETA_ENV), true);
  assert.equal(account.officialLoginAllowed(PROD_ENV), false);

  const db = officialDb(DORMANT);
  await assert.rejects(() => account.setOfficialEmail(db, { env: PROD_ENV }),
    /not switched on for production yet/);
  assert.equal(db.sql.length, 0, 'production does not even READ the row');
});

test('12b. the production approval phrase ALONE still changes nothing', async () => {
  /* The same fact the admin suite asserts, re-asserted for this door: the lane
     in the source ships false, so knowing the phrase buys nothing. */
  const withKey = { ...PROD_ENV, ATWE_OFFICIAL_PROD_ACTIVATION: account.PROD_ACTIVATION_PHRASE };
  assert.equal(account.officialAccessPolicy(withKey).approved, true, 'the key is recognised');
  assert.equal(account.officialLoginAllowed(withKey), false, 'and still opens nothing');
  const db = officialDb(DORMANT);
  await assert.rejects(() => account.setOfficialEmail(db, { env: withKey }), /not switched on for production/);
  assert.equal(db.sql.length, 0);
});

test('12c. an unrecognised or half-configured environment gets the STRICTER lane', async () => {
  for (const env of [{}, { ATWE_ENV: 'staging' }, { ATWE_ENV: 'beta', APP_URL: 'https://atwe.com' },
                     { ...BETA_ENV, RAILWAY_ENVIRONMENT_NAME: 'production' }]) {
    assert.equal(account.officialLoginAllowed(env), false, `must not be treated as beta: ${JSON.stringify(env)}`);
    const db = officialDb(DORMANT);
    await assert.rejects(() => account.setOfficialEmail(db, { env }));
    assert.equal(db.sql.length, 0);
  }
});

test('13. it is the LOGIN power, not a third policy nobody remembers', () => {
  const fn = MOD_CODE.slice(MOD_CODE.indexOf('async function setOfficialEmail'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 1);
  assert.match(body, /assertOfficialAccessAllowed\(e, 'login'\)/,
    'the activated address IS the login identity, so it goes through the same gate as activate-official');
  assert.doesNotMatch(body, /allowLogin\s*=|allowAdmin\s*=|OFFICIAL_ACCESS\s*\[/,
    'and it re-decides nothing for itself');
});

/* ═══ 4. WHAT IT MUST NOT DO ═════════════════════════════════════════════ */

test('14. it cannot grant admin, and cannot change a password', () => {
  const fn = MOD_CODE.slice(MOD_CODE.indexOf('async function setOfficialEmail'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 1);
  assert.doesNotMatch(body, /SET is_admin|is_admin\s*=\s*true/, 'no admin is ever granted here');
  /* Scoped to CODE, not to the word: the function's own refusal sentence names
     a password ("run activate-official first so it has a beta password"), and
     failing on that would be failing on helpful prose. */
  assert.doesNotMatch(body, /password_hash\s*=/, 'no password column is written');
  assert.doesNotMatch(body, /hashPassword|passwordHash|readPassword/,
    'no hash is taken, made or reaches this function at all');
  assert.equal((body.match(/db\.query\(/g) || []).length, 1,
    'it issues exactly one statement of its own, the UPDATE; the two reads go ' +
    'through findOfficial and findByEmail, which are shared and read-only');
  /* The whole tree still has exactly ONE statement that grants superadmin, and
     it is not this one. */
  const grants = MOD_CODE.match(/SET\s+is_admin\s*=\s*true/g) || [];
  assert.equal(grants.length, 1, 'exactly one SET is_admin in the module');
  assert.match(MOD_CODE.slice(MOD_CODE.indexOf('async function promoteOfficialAdmin')), /SET\s+is_admin\s*=\s*true/,
    'and it lives in promoteOfficialAdmin');
});

test('15. nothing anywhere writes the dormant address back', () => {
  /* The one-way door. A write of the internal address would let a row that had
     spent its provenance quietly re-acquire the appearance of it. */
  for (const [name, code] of [['seed/beta-account.js', MOD_CODE], ['tools/seed-beta.js', CLI_CODE]]) {
    const updates = code.match(/UPDATE users[\s\S]{0,400}?RETURNING/g) || [];
    for (const u of updates) {
      assert.doesNotMatch(u, /SET[\s\S]*?no-reply\+/,
        `${name} must never write the internal address into a row`);
    }
    assert.doesNotMatch(code, /email\s*=\s*['"`]no-reply/, `${name} must not assign the dormant address`);
  }
});

test('16. the CLI command takes no username and grants nothing', () => {
  const fn = CLI_CODE.slice(CLI_CODE.indexOf('async function doSetOfficialEmail'));
  const body = fn.slice(0, fn.indexOf('\nasync function '));
  assert.match(body, /const uname = account\.OFFICIAL_USERNAME/,
    'it resolves @atwe itself; there is no username argument');
  assert.doesNotMatch(body, /opts\.(username|user|account)/, 'and no option can redirect it');
  assert.doesNotMatch(body, /readPassword|hashPassword|is_admin\s*=/, 'it neither passwords nor promotes');
  assert.match(body, /assertOfficialAccessAllowed\(process\.env, 'login'\)/);
  assert.match(body, /account\.setOfficialEmail\(db, \{/);
  assert.match(body, /username: uname, env: process\.env,/);
  /* And it is reachable: listed, dispatched, and documented. */
  assert.match(CLI_CODE, /'set-official-email'[\s\S]{0,200}?includes\(cmd\)/,
    'the command is in the allowed list');
  assert.match(CLI_CODE, /cmd === 'set-official-email'\) return await doSetOfficialEmail/);
});

test('17. no HTTP route can reach the transition', () => {
  /* Same rule as promoteOfficialAdmin: an identity move is an operator action
     with a terminal, not a button somebody can be talked into pressing. */
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const svc = fs.readFileSync(path.join(ROOT, 'beta-access.js'), 'utf8');
  const admin = fs.readFileSync(path.join(ROOT, 'public', 'admin.html'), 'utf8');
  for (const [name, code] of [['server.js', server], ['beta-access.js', svc], ['admin.html', admin]]) {
    assert.doesNotMatch(code, /setOfficialEmail/, `${name} must not be able to move the official email`);
  }
  assert.doesNotMatch(admin, /ceo@atwe\.com/, 'and the dashboard hardcodes no address of its own');
});

test('18. the module exports the new pieces, and nothing that widens them', () => {
  for (const k of ['officialEmails', 'officialEmailState', 'setOfficialEmail', 'OFFICIAL_EMAIL_ACTIVATED']) {
    assert.ok(k in account, `${k} must be exported`);
  }
  /* There is no "set any account's email" helper, and there must never be one:
     an ordinary member changes their address through the app's own
     password-gated change-email route. */
  const granters = Object.keys(account).filter((k) => /^set[A-Z]/.test(k));
  assert.deepEqual(granters, ['setOfficialEmail'], `only the official transition may exist: ${granters}`);
});
