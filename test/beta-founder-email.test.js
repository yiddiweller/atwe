/* THE FOUNDER'S OWN BETA ACCOUNT MOVES TO ITS FINAL EMAIL, AND NOTHING ELSE MOVES.
 *
 * @yiddiweller on beta is an ORDINARY account that beta tooling created with
 * add-account. Its final login email is yiddiweller@gmail.com, and the app's own
 * Settings -> Change email is the right door for that edit -- except that door
 * refuses on beta today, correctly, because SMTP is off there and it will not
 * strand somebody on an address they can never verify.
 *
 * WHAT THIS FILE IS FOR. A command that edits an account's email without a
 * password and without a verification link is a serious thing to add, so the
 * whole of its safety is that it is NARROW: one account, one address, both
 * hardcoded, one column written, no argument that moves any of it. These tests
 * are what keep it narrow. If somebody later adds a username option, an email
 * option or a second column, several of them go red.
 *
 * THE OTHER HALF IS WHAT IT DELIBERATELY DOES NOT DO. Beta's ADMIN_EMAIL really
 * is this address, on purpose, because the founder's own account is meant to
 * hold superadmin -- the exact opposite of the @atwe rule, where the same clash
 * refuses. So the consequence has to be stated rather than hidden, and the
 * promotion has to stay in the one place it already lives: db.init(), on boot.
 * This command must never write is_admin, and that is asserted from several
 * directions.
 *
 * ALL OFFLINE AND ALWAYS RUNS. The live half lives in
 * test/beta-official-admin.test.js: node --test runs FILES concurrently, and a
 * third live server against one Postgres is what tipped the fixed-delay money
 * tests over once already.
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

const TARGET = 'yiddiweller@gmail.com';
const SEEDED = 'founder+beta@beta.atwe.com';

/* The row add-account leaves behind: seed_tag 'beta', a real password, no staff
   access of any kind. */
const FOUNDER = {
  id: 42, username: 'yiddiweller', email: SEEDED, name: 'Yiddi Weller',
  account_type: 'personal', is_demo: false, is_admin: false, admin_perms: [], admin_role: null,
  verified: true, email_verified: true, headline: 'Building Atwe',
  status: 'active', deactivated: false, totp_enabled: false,
  stripe_customer_id: null, stripe_connect_id: null, oauth_provider: null,
  seed_tag: 'beta', created_at: new Date(),
};
const MIGRATED = { ...FOUNDER, email: TARGET };

function founderDb(row, holder = null) {
  const sql = [];
  return {
    sql,
    query: async (text, params) => {
      sql.push({ text, params });
      if (/^\s*UPDATE/i.test(text)) {
        return { rows: [{ id: row.id, username: row.username, email: params[0] }], rowCount: 1 };
      }
      if (/email ILIKE/.test(text)) {
        const rows = holder ? (Array.isArray(holder) ? holder : [holder]) : [];
        return { rows, rowCount: rows.length };
      }
      return row ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 };
    },
  };
}
const writes = (db) => db.sql.filter((q) => /^\s*(INSERT|UPDATE|DELETE)/i.test(q.text));

/* ═══ 1. THE TARGET IS FIXED, AND NOTHING CAN MOVE IT ════════════════════ */

test('1. exactly one account and exactly one address, both hardcoded', () => {
  assert.equal(account.FOUNDER_USERNAME, 'yiddiweller');
  assert.equal(account.FOUNDER_EMAIL, TARGET);
  /* Already canonical, or the command would write something db.init()'s own
     lower(email) predicate might then not match. */
  assert.equal(account.normalizeEmail(TARGET), TARGET, 'lowercase, no surrounding whitespace');
  assert.doesNotMatch(TARGET, /\s/);
});

test('2. no argument, option or environment variable moves the target', async () => {
  /* The function signature takes `env` and nothing else. If a username or email
     parameter is ever added, this fails. */
  const fn = MOD_CODE.slice(MOD_CODE.indexOf('async function setFounderEmail'));
  const sig = fn.slice(0, fn.indexOf(')') + 1);
  assert.match(sig, /^async function setFounderEmail\(db, \{ env = null \} = \{\}\)$/,
    `the signature must take no target: ${sig}`);
  const body = fn.slice(0, fn.indexOf('\n}\n') + 1);
  /* Scoped to how a target could ARRIVE, not to the word: jstext strips comments
     but keeps strings, and the SQL literal legitimately contains "SET email =". */
  assert.doesNotMatch(body, /opts\./, 'it reads no caller options');
  assert.doesNotMatch(body, /process\.env\.ATWE_FOUNDER|process\.env\.FOUNDER/,
    'and no environment variable names a target');
  assert.doesNotMatch(body, /\busername\s*=\s*(?!\$)[a-zA-Z]/, 'the handle is never reassigned');

  /* And the constants are literals, not env lookups. */
  assert.match(MOD_CODE, /const FOUNDER_USERNAME = 'yiddiweller';/);
  assert.match(MOD_CODE, /const FOUNDER_EMAIL = 'yiddiweller@gmail\.com';/);
  assert.doesNotMatch(MOD_CODE, /FOUNDER_USERNAME = \(?process\.env/);
  assert.doesNotMatch(MOD_CODE, /FOUNDER_EMAIL = \(?process\.env/);

  /* Even if a caller passes extras, they are ignored: the row is found by the
     hardcoded handle and the write uses the hardcoded address. */
  const db = founderDb(FOUNDER);
  const out = await account.setFounderEmail(db, {
    env: BETA_ENV, username: 'someoneelse', email: 'attacker@evil.net',
  });
  assert.equal(out.to, TARGET);
  assert.equal(writes(db)[0].params[0], TARGET, 'the address written is the hardcoded one');
  assert.equal(writes(db)[0].params[2], 'yiddiweller', 'and the row is found by the hardcoded handle');
});

test('3. the CLI exposes no target either', () => {
  const fn = CLI_CODE.slice(CLI_CODE.indexOf('async function doSetFounderEmail'));
  const body = fn.slice(0, fn.indexOf('\nasync function '));
  assert.match(body, /const uname = account\.FOUNDER_USERNAME/);
  assert.match(body, /const target = account\.FOUNDER_EMAIL/);
  assert.doesNotMatch(body, /opts\.(username|user|email|account|target)/, 'no option can redirect it');
  assert.match(body, /account\.setFounderEmail\(db, \{ env: process\.env \}\)/,
    'and it passes nothing but the environment');
  /* --dry-run and --yes are the only flags it honours. */
  assert.match(body, /opts\.dryRun/);
  assert.match(body, /opts\.yes/);
  assert.match(CLI_CODE, /'set-founder-email'[\s\S]{0,260}?includes\(cmd\)/, 'the command is allowed');
  assert.match(CLI_CODE, /cmd === 'set-founder-email'\) return await doSetFounderEmail/, 'and dispatched');
});

/* ═══ 2. WHO IT REFUSES ══════════════════════════════════════════════════ */

test('4. it refuses outside beta, before reading anything at all', async () => {
  for (const env of [PROD_ENV, {}, { ATWE_ENV: 'staging' },
                     { ...BETA_ENV, APP_URL: 'https://atwe.com' },
                     { ...BETA_ENV, RAILWAY_ENVIRONMENT_NAME: 'production' }]) {
    const db = founderDb(FOUNDER);
    await assert.rejects(() => account.setFounderEmail(db, { env }), /does not look like beta/,
      `must refuse: ${JSON.stringify(env)}`);
    assert.equal(db.sql.length, 0, 'and not even SELECT from the database');
  }
  /* The refusal names the variable to fix rather than saying "not beta". */
  await assert.rejects(() => account.setFounderEmail(founderDb(FOUNDER), { env: PROD_ENV }),
    /ATWE_ENV must be exactly "beta"/);
});

test('5. it refuses a missing account, and any row that is not the founder\'s', async () => {
  const empty = founderDb(null);
  await assert.rejects(() => account.setFounderEmail(empty, { env: BETA_ENV }),
    /no @yiddiweller account exists/);
  assert.equal(writes(empty).length, 0);

  for (const [what, patch, expect] of [
    ['a different username', { username: 'someoneelse' }, /username/],
    ['an untagged real member', { seed_tag: null }, /seed_tag is unset/],
    ['the app\'s own @atwe row', { seed_tag: 'beta-keep' }, /beta-keep.*separate flow/s],
    ['some other tag', { seed_tag: 'demo' }, /seed_tag/],
    ['seeded sample data', { is_demo: true }, /is_demo/],
  ]) {
    const db = founderDb({ ...FOUNDER, ...patch });
    await assert.rejects(() => account.setFounderEmail(db, { env: BETA_ENV }), expect,
      `must refuse ${what}`);
    assert.equal(writes(db).length, 0, `and write nothing for ${what}`);
  }
});

test('6. it refuses a staff state the next boot would silently WIDEN', async () => {
  /* The point: moving this row onto ADMIN_EMAIL means db.init() writes
     is_admin = true on it. A scoped staffer is a deliberately narrower thing,
     and a suspended account should not be promoted at all. */
  for (const [what, patch, expect] of [
    ['a scoped staffer', { admin_perms: ['users', 'revenue'] }, /staff scopes.*FULL superadmin/s],
    ['a named staff role', { admin_role: 'support' }, /staff role/],
    ['a suspended account', { status: 'suspended' }, /not active.*promote a suspended/s],
    ['a banned account', { status: 'banned' }, /not active/],
  ]) {
    const db = founderDb({ ...FOUNDER, ...patch });
    await assert.rejects(() => account.setFounderEmail(db, { env: BETA_ENV }), expect,
      `must refuse ${what}`);
    assert.equal(writes(db).length, 0, `and write nothing for ${what}`);
  }
  /* An account that is ALREADY a superadmin is expected, not unsafe. */
  const admin = founderDb({ ...FOUNDER, is_admin: true });
  const out = await account.setFounderEmail(admin, { env: BETA_ENV });
  assert.equal(out.already, false, 'an existing superadmin migrates normally');
  assert.equal(writes(admin)[0].params[5], true, 'and its own admin state is re-asserted, not overwritten');
});

test('7. two rows holding the handle stops everything', async () => {
  const db = { sql: [], query: async (t) => { db.sql.push({ text: t }); return { rows: [FOUNDER, { ...FOUNDER, id: 43 }], rowCount: 2 }; } };
  await assert.rejects(() => account.setFounderEmail(db, { env: BETA_ENV }), /2 accounts hold @yiddiweller/);
});

/* ═══ 3. COLLISIONS, THE SAME LOGIC @atwe USES ═══════════════════════════ */

const SAME_ADDRESS = [
  ['exact', 'yiddiweller@gmail.com'],
  ['all upper', 'YIDDIWELLER@GMAIL.COM'],
  ['mixed case', 'YiddiWeller@Gmail.Com'],
  ['spaces', '  yiddiweller@gmail.com  '],
  ['tab and newline', '\tyiddiweller@gmail.com\n'],
  ['CRLF and case', '\r\nYIDDIWELLER@Gmail.com\t'],
  ['non-breaking spaces', ' yiddiweller@gmail.com '],
  ['em space and a BOM', ' YiddiWeller@GMAIL.com﻿'],
];

test('8. EVERY case and whitespace variant is one address, and each refuses', async () => {
  for (const [what, stored] of SAME_ADDRESS) {
    assert.equal(account.normalizeEmail(stored), TARGET, `${what} normalises to the target`);
    const db = founderDb(FOUNDER, { id: 99, username: 'foundersquatter', email: stored, seed_tag: null });
    await assert.rejects(() => account.setFounderEmail(db, { env: BETA_ENV }),
      /already belongs to @foundersquatter/, `a duplicate stored as ${what} must refuse`);
    assert.equal(writes(db).length, 0, `and write nothing for ${what}`);
  }
  /* users.email is TEXT UNIQUE and compares raw bytes, so most of those are
     DISTINCT keys: the constraint would not have caught them. */
  assert.equal(new Set(SAME_ADDRESS.map(([, v]) => v)).size, SAME_ADDRESS.length);
});

test('9. it reuses the @atwe collision sweep rather than a second one', () => {
  const fn = MOD_CODE.slice(MOD_CODE.indexOf('async function setFounderEmail'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 1);
  assert.match(body, /findEmailOwners\(db, FOUNDER_EMAIL, row\.id\)/,
    'one implementation, so the two can never disagree about what a duplicate is');
  assert.doesNotMatch(body, /findByEmail/, 'not the older lower(email) lookup, which misses padding');
  /* All holders are named, never just the first. */
  assert.match(body, /owners\.map/);
});

test('10. a near-miss address does not block the move, and self never collides', async () => {
  for (const other of ['xyiddiweller@gmail.com', 'yiddiweller@gmail.como', 'yiddiweller@gmail.co', 'other@gmail.com']) {
    const db = founderDb(FOUNDER, { id: 99, username: 'notit', email: other, seed_tag: null });
    const out = await account.setFounderEmail(db, { env: BETA_ENV });
    assert.equal(out.already, false, `${other} must not block the move`);
  }
  const self = founderDb(FOUNDER, { ...FOUNDER, email: TARGET });
  assert.equal((await account.setFounderEmail(self, { env: BETA_ENV })).already, false,
    'its own row is excluded from the sweep');
});

/* ═══ 4. WHAT IT WRITES, AND WHAT IT LEAVES ALONE ════════════════════════ */

test('11. it writes ONE column, and that column is email', async () => {
  const db = founderDb(FOUNDER);
  const out = await account.setFounderEmail(db, { env: BETA_ENV });
  assert.equal(out.from, SEEDED);
  assert.equal(out.to, TARGET);

  const w = writes(db);
  assert.equal(w.length, 1, 'one statement writes');
  const sql = w[0].text;
  const setClause = sql.slice(sql.indexOf('SET'), sql.indexOf('WHERE'));
  assert.match(setClause, /SET email = \$1/);
  assert.equal(setClause.split('=').length, 2, 'and nothing else is assigned');
  for (const col of ['password_hash', 'is_admin', 'admin_perms', 'admin_role', 'seed_tag', 'username',
                     'name', 'account_type', 'status', 'verified', 'email_verified', 'headline',
                     'bio', 'deactivated', 'totp_enabled', 'dob', 'categories']) {
    assert.doesNotMatch(setClause, new RegExp(`\\b${col}\\s*=`), `${col} must not be written`);
  }
});

test('12. it stores EXACTLY yiddiweller@gmail.com', async () => {
  const db = founderDb(FOUNDER);
  const written = writes(db).length ? null : (await account.setFounderEmail(db, { env: BETA_ENV }), writes(db)[0].params[0]);
  assert.equal(written, 'yiddiweller@gmail.com');
  assert.equal(written, account.normalizeEmail(written), 'lowercase, no surrounding whitespace');
  assert.doesNotMatch(written, /\s/, 'no whitespace anywhere');
  /* The value must satisfy db.init()'s OWN predicate, or the promotion this
     migration exists to enable would silently never happen. */
  const dbjs = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
  assert.match(dbjs, /UPDATE users SET is_admin = true WHERE lower\(email\) = \$1/,
    'db.init() still promotes by lower(email)');
  assert.match(dbjs, /\(process\.env\.ADMIN_EMAIL \|\| ''\)\.trim\(\)\.toLowerCase\(\)/,
    'and normalises ADMIN_EMAIL with trim+lower, which our stored value matches');
  assert.equal(written.toLowerCase(), 'yiddiweller@gmail.com'.trim().toLowerCase());
});

test('13. the UPDATE re-asserts the row, so one that changed underneath is missed', async () => {
  const db = founderDb(FOUNDER);
  await account.setFounderEmail(db, { env: BETA_ENV });
  const where = writes(db)[0].text.split('WHERE')[1];
  for (const clause of [/id = \$2/, /lower\(username\) = \$3/, /lower\(trim\(email\)\)\s*= \$4/,
                        /seed_tag\s*= \$5/, /is_demo\s+IS NOT TRUE/,
                        /is_admin IS NOT DISTINCT FROM \$6/,
                        /jsonb_array_length\(COALESCE\(admin_perms/]) {
    assert.match(where, clause, `the WHERE must carry ${clause}`);
  }
  assert.equal(writes(db)[0].params[4], 'beta', 'the tag is re-asserted, never rewritten');
  assert.equal(writes(db)[0].params[5], false, 'and the row\'s OWN admin state');
});

test('14. running it again writes nothing', async () => {
  const db = founderDb(MIGRATED);
  const out = await account.setFounderEmail(db, { env: BETA_ENV });
  assert.equal(out.already, true);
  assert.equal(out.email, TARGET);
  assert.equal(writes(db).length, 0);
});

test('15. a duplicate claimed mid-flight becomes a sentence, not a stack trace', async () => {
  const db = {
    sql: [],
    query: async (text) => {
      db.sql.push({ text });
      if (/^\s*UPDATE/i.test(text)) { const e = new Error('duplicate key'); e.code = '23505'; throw e; }
      if (/email ILIKE/.test(text)) return { rows: [], rowCount: 0 };
      return { rows: [FOUNDER], rowCount: 1 };
    },
  };
  await assert.rejects(() => account.setFounderEmail(db, { env: BETA_ENV }),
    /was claimed by another account while this was running\. Nothing was written/);
});

/* ═══ 5. IT GRANTS NOTHING — ADMIN_EMAIL IS THE EXISTING MECHANISM ═══════ */

test('16. the migration cannot grant staff access, from any direction', () => {
  const fn = MOD_CODE.slice(MOD_CODE.indexOf('async function setFounderEmail'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 1);
  assert.doesNotMatch(body, /SET\s+is_admin/, 'no admin column is written');
  assert.doesNotMatch(body, /is_admin\s*=\s*true/);
  assert.doesNotMatch(body, /admin_perms\s*=|admin_role\s*=/);
  assert.doesNotMatch(body, /password_hash\s*=/, 'and no password either');
  assert.doesNotMatch(body, /hashPassword|passwordHash|readPassword/);

  const cliFn = CLI_CODE.slice(CLI_CODE.indexOf('async function doSetFounderEmail'));
  const cliBody = cliFn.slice(0, cliFn.indexOf('\nasync function '));
  /* The CLI QUOTES db.init()'s statement in its explanation, so matching the text
     is meaningless here. What matters is that it issues no statement of its own:
     every write goes through account.setFounderEmail, which is checked above. */
  assert.doesNotMatch(cliBody, /db\.query\(/, 'the CLI runs no SQL of its own');
  assert.doesNotMatch(cliBody, /promoteOfficialAdmin|account\.promote/, 'and calls no granter');
  const writesInCli = cliBody.split('\n').filter((l) => /SET\s+is_admin/.test(l) && !/console\.log/.test(l));
  assert.deepEqual(writesInCli, [], `every mention of SET is_admin must be console output: ${writesInCli}`);

  /* Still exactly ONE statement in the whole module that grants superadmin, and
     it is the @atwe one. */
  assert.equal((MOD_CODE.match(/SET\s+is_admin\s*=\s*true/g) || []).length, 1);
  assert.match(MOD_CODE.slice(MOD_CODE.indexOf('async function promoteOfficialAdmin')),
    /SET\s+is_admin\s*=\s*true/);
});

test('17. the ADMIN_EMAIL consequence is reported, deliberately, and never acted on', () => {
  /* Reporting only. `founderIsAdminEmail` answers a question; nothing acts. */
  assert.equal(account.founderIsAdminEmail({ ADMIN_EMAIL: TARGET }), true);
  for (const spelled of SAME_ADDRESS.map(([, v]) => v)) {
    assert.equal(account.founderIsAdminEmail({ ADMIN_EMAIL: spelled }), true,
      `however it is spelled: ${JSON.stringify(spelled)}`);
  }
  for (const other of ['ceo@atwe.com', 'someone@gmail.com', '', undefined]) {
    assert.equal(account.founderIsAdminEmail({ ADMIN_EMAIL: other }), false);
  }
  const fn = MOD_CODE.slice(MOD_CODE.indexOf('function founderIsAdminEmail'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 1);
  assert.doesNotMatch(body, /db\.query|UPDATE|is_admin\s*=/, 'it reads an environment variable and returns a boolean');

  /* And it does NOT refuse on the clash, which is the opposite of @atwe. */
  const set = MOD_CODE.slice(MOD_CODE.indexOf('async function setFounderEmail'));
  assert.doesNotMatch(set.slice(0, set.indexOf('\n}\n')), /ADMIN_EMAIL/,
    'the migration itself does not even consult ADMIN_EMAIL: the clash is expected here');

  /* The CLI is where it is said out loud. */
  const cliFn = CLI_CODE.slice(CLI_CODE.indexOf('async function doSetFounderEmail'));
  const cliBody = cliFn.slice(0, cliFn.indexOf('\nasync function '));
  assert.match(cliBody, /founderIsAdminEmail\(process\.env\)/, 'the CLI checks it');
  assert.match(cliBody, /does NOT write is_admin/, 'and says the command grants nothing');
  assert.match(cliBody, /db\.init\(\)/, 'names the existing mechanism');
  assert.match(cliBody, /next boot or deploy/i, 'and when it will happen');
});

test('18. no new promotion mechanism was invented', () => {
  /* The existing one is db.init()'s, on boot. Nothing here re-implements it, and
     the seed CLI never calls db.init() as a side channel to trigger it. */
  assert.doesNotMatch(MOD_CODE, /WHERE lower\(email\) = \$1[\s\S]{0,40}ADMIN_EMAIL/);
  /* THE ONE db.init() IN THIS CLI IS A SCHEMA BOOTSTRAP, NOT A PROMOTION TRIGGER,
     and the distinction is load-bearing because db.init() is where the ADMIN_EMAIL
     promotion lives. `ensureSeedTag` calls it, every command calls `ensureSeedTag`,
     and it would be easy to conclude that running any seed command promotes the
     account. It does not: `ensureSeedTag` RETURNS EARLY when users.seed_tag
     already exists, and on beta it does (that is how these accounts are tagged),
     so db.init() never runs from here. */
  const ensure = CLI_CODE.slice(CLI_CODE.indexOf('async function ensureSeedTag'));
  const ensureBody = ensure.slice(0, ensure.indexOf('\n}\n') + 1);
  assert.match(ensureBody, /if \(r\.rowCount\) return false;[\s\S]{0,200}?await db\.init\(\)/,
    'the early return comes BEFORE the init, so a database that already has the column never boots it');

  /* And the migration command itself never calls it directly. */
  const fnStart = CLI_CODE.indexOf('async function doSetFounderEmail');
  const fnBody = CLI_CODE.slice(fnStart, CLI_CODE.indexOf('\nasync function ', fnStart + 1));
  const calls = fnBody.split('\n').filter((l) => /db\.init\(/.test(l) && !/console\.(log|error)/.test(l));
  assert.deepEqual(calls, [], `it must not boot the schema to force a promotion: ${calls}`);
  assert.ok(/db\.init\(\)/.test(fnBody), 'but it does NAME the existing mechanism, so an operator knows');

  /* Exactly one db.init() call site in the whole CLI, and it is ensureSeedTag's. */
  const allCalls = CLI_CODE.split('\n').filter((l) => /await db\.init\(\)/.test(l));
  assert.equal(allCalls.length, 1, `one db.init() call site: ${allCalls}`);
  const dbjs = jstext.scan(fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8')).code;
  assert.equal((dbjs.match(/SET is_admin = true WHERE lower\(email\)/g) || []).length, 1,
    'there is still exactly one ADMIN_EMAIL promotion, in db.js');
});

/* ═══ 6. REACH, AND THE SEPARATION FROM @atwe ════════════════════════════ */

test('19. no HTTP route, API or dashboard can invoke it', () => {
  for (const f of ['server.js', 'beta-access.js', path.join('public', 'admin.html'), path.join('public', 'index.html')]) {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const name of ['setFounderEmail', 'findFounder', 'founderMismatch', 'FOUNDER_EMAIL', 'founderIsAdminEmail']) {
      assert.doesNotMatch(code, new RegExp(name), `${f} must not be able to reach ${name}`);
    }
  }
  /* The ACCOUNT must not be named in anything that serves requests. index.html is
     excluded deliberately and for a reason worth writing down: it carries a
     "Designed by yiddiweller.com" credit in the app's own copy, which is a link
     in a footer and has nothing to do with this account's identity. Matching on
     the bare word there would be failing on unrelated prose. */
  for (const f of ['server.js', 'beta-access.js', path.join('public', 'admin.html')]) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), /yiddiweller/i,
      `${f} must not name a human account`);
  }
  assert.doesNotMatch(CLI_CODE, /app\.(get|post|patch|put|delete)\(/, 'the CLI declares no routes');
});

test('20. it is NOT governed by the official-account access policy', () => {
  /* Deliberate separation: a future production activation of @atwe must not
     silently also open a door onto a human's account. */
  const fn = MOD_CODE.slice(MOD_CODE.indexOf('async function setFounderEmail'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 1);
  assert.doesNotMatch(body, /assertOfficialAccessAllowed|officialAccessPolicy|OFFICIAL_ACCESS/,
    'the founder migration does not ride on the @atwe policy');
  assert.match(body, /guard\.checkEnvironment/, 'it gates on "is this beta", which is what was asked');
  /* And the production lane is still shut, unaffected by any of this. */
  assert.equal(account.OFFICIAL_ACCESS.production.allowLogin, false);
  assert.equal(account.OFFICIAL_ACCESS.production.allowAdmin, false);
});

test('21. no production database or credential is reachable from this module', () => {
  assert.doesNotMatch(MOD_CODE, /PROD_DATABASE_URL|new Pool|pg\.Client|require\('pg'\)/,
    'it is handed a db, it never opens one');
  assert.doesNotMatch(MOD_CODE, /password\s*:\s*['"`]|secret\s*:\s*['"`]/, 'and carries no credential');
});
