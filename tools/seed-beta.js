#!/usr/bin/env node
/* SEED THE BETA WORLD -- and refuse to do anything else.
 *
 *   node tools/seed-beta.js check    what would happen, and why it would or would not be allowed
 *   node tools/seed-beta.js status   what this database currently holds that is tagged beta
 *   node tools/seed-beta.js seed     build the beta world
 *   node tools/seed-beta.js add-account <file.json>
 *                                    add ONE account to the world already there
 *   node tools/seed-beta.js activate-official
 *                                    give the app's OWN @atwe account a beta password
 *   node tools/seed-beta.js set-official-email
 *                                    move that same @atwe account from the address the app
 *                                    creates it with to its activated login email. Refuses if
 *                                    ADMIN_EMAIL is that same address, since db.init() would
 *                                    then promote it on the next boot by itself
 *   node tools/seed-beta.js set-founder-email
 *                                    move the founder's OWN beta account (@yiddiweller, made by
 *                                    add-account) to its final login email. Nothing else; it
 *                                    grants no staff access
 *   node tools/seed-beta.js promote-official-admin
 *                                    make that same @atwe account a superadmin, where the
 *                                    official-account access policy permits it (beta today)
 *   node tools/seed-beta.js reset    remove EXACTLY what this tool created, and nothing else
 *
 * THREE RULES THIS FILE EXISTS TO ENFORCE.
 *
 * 1. IT CANNOT RUN AGAINST PRODUCTION BY ACCIDENT. Every check lives in
 *    tools/seed-guard.js as a pure function so the whole refusal surface is unit
 *    tested with no database (test/seed-guard.test.js). `check` is the same code
 *    path `seed` runs; there is no "just this once" flag that skips it.
 *
 * 2. IT ONLY EVER CLAIMS WHAT IT MADE, AND RESET DELETES BY seed_tag ALONE.
 *    The accounts this run creates are captured as an EXACT set of ids (before
 *    and after), never inferred from an id ordering and never from `is_demo`.
 *    A pre-existing demo account is somebody else's row: the seed REFUSES
 *    rather than adopting it. There is deliberately no `is_demo` clause
 *    anywhere in the reset path -- what is not tagged is reported, never
 *    removed.
 *
 * 3. NO CREDENTIAL IS EVER PRINTED. The password comes from BETA_SEED_PASSWORD
 *    or a hidden prompt -- never from a file, never echoed, never logged, and
 *    never placed in any object this tool prints. The database is identified by
 *    host and name only; the connection string carries a password.
 *
 * It does not deploy, does not touch main, and reads no production row: the
 * whole world is generated here, so "did we leak a real member?" cannot be
 * answered wrongly.
 */
'use strict';

const readline = require('readline');
const stream = require('stream');
const path = require('path');
const fs = require('fs');
const auth = require(path.join(__dirname, '..', 'auth'));
const account = require(path.join(__dirname, '..', 'seed', 'beta-account'));

const guard = require(path.join(__dirname, 'seed-guard'));

const TAG = 'beta';

/* The five tables that carry seed_tag. Four of them are here because their
   owner column is ON DELETE SET NULL, so the row OUTLIVES the user it belongs
   to -- deleting the users would leave them behind as orphans. `users` is here
   because it is the anchor everything else cascades from. This list came out of
   an audit of every users FK in db.js, not from memory. */
const TAGGED_TABLES = ['users', 'at_groups', 'communities', 'ad_campaigns', 'gift_cards'];

/* ---------------------------------------------------------------- identity */

/* What the beta account looks like. NOT a secret, and deliberately has no
   password field -- see rule 3. */
const DEFAULT_IDENTITY = {
  email: 'founder@beta.atwe.com',
  username: 'founder',
  name: 'Atwe Founder',
  headline: 'Building Atwe',
  bio: 'Testing the beta build.',
  accountType: 'personal',
  role: 'member',
};

function loadIdentity(file) {
  const p = file || path.join(__dirname, '..', 'seed', 'beta-identity.json');
  if (!fs.existsSync(p)) return { id: { ...DEFAULT_IDENTITY }, source: 'built-in defaults' };
  let raw;
  try { raw = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { throw new Error(`could not read ${p}: ${e.message}`); }

  for (const k of ['password', 'passwordHash', 'password_hash', 'secret']) {
    if (k in raw) {
      throw new Error(`${p} contains a "${k}" field. Credentials never live in a file. ` +
                      'Remove it and use BETA_SEED_PASSWORD or the prompt.');
    }
  }
  const id = { ...DEFAULT_IDENTITY, ...raw };
  /* Explicit, never inferred: an admin account tests a different product. */
  if (!['member', 'admin'].includes(id.role)) {
    throw new Error(`${p}: "role" must be exactly "member" or "admin". It is ${JSON.stringify(id.role)}.`);
  }
  if (!['personal', 'business'].includes(id.accountType)) {
    throw new Error(`${p}: "accountType" must be "personal" or "business".`);
  }
  return { id, source: p };
}

/* Two real, non-demo shops so the commerce journey is testable end to end.
   /api/orders/buy refuses any listing whose seller is_demo, so a demo-owned
   shop cannot be checked out -- these must be ordinary accounts. */
const SELLERS = [
  { email: 'harbour@beta.atwe.com', username: 'harbourgoods', name: 'Harbour Goods',
    headline: 'Small-batch homeware', bio: 'Made in the workshop, shipped the same week.' },
  { email: 'northlight@beta.atwe.com', username: 'northlightstudio', name: 'Northlight Studio',
    headline: 'Photography and brand work', bio: 'Studio days, brand audits, presets.' },
];

/* ------------------------------------------------------------------ prompt */

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('BETA_SEED_PASSWORD is not set and there is no terminal to prompt on. ' +
                       'Set BETA_SEED_PASSWORD in the shell that runs this command.'));
      return;
    }
    const muted = new stream.Writable({
      write(chunk, enc, cb) { if (!muted.on_) process.stdout.write(chunk, enc); cb(); },
    });
    muted.on_ = false;
    const rl = readline.createInterface({ input: process.stdin, output: muted, terminal: true });
    rl.question(question, (answer) => {
      muted.on_ = false;
      process.stdout.write('\n');
      rl.close();
      resolve(answer);
    });
    muted.on_ = true;
  });
}

function promptVisible(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('This command needs a typed confirmation and there is no terminal. ' +
                       'Pass --yes only if you are certain.'));
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => { rl.close(); resolve(String(a || '').trim()); });
  });
}

/* A password reaches this tool from exactly two places and is hashed by the
   app's own auth.hashPassword. It is never read from a file, never printed,
   never logged, and never placed in any object this tool prints. */
async function readPassword() {
  let pw = process.env.BETA_SEED_PASSWORD || '';
  if (!pw) pw = await promptHidden('Beta account password (not echoed): ');
  const problem = guard.passwordProblem(pw);
  if (problem) throw new Error(`The beta password is ${problem}. Nothing was changed.`);
  return pw;
}

/* ---------------------------------------------------------------- preflight */

function printReport(env) {
  const e = guard.checkEnvironment(env);
  const i = guard.checkIntegrations(env);

  console.log('\nTARGET');
  console.log(`  ATWE_ENV                  ${e.info.ATWE_ENV}`);
  console.log(`  APP_URL host              ${e.info.APP_URL_host}`);
  console.log(`  database                  ${e.info.database}`);
  console.log(`  production fingerprint    ${e.info.fingerprint_guard}`);
  console.log(`  Railway environment       ${e.info.RAILWAY_ENVIRONMENT_NAME}`);

  console.log('\nINTEGRATIONS');
  for (const s of i.seen) console.log(`  ${s.name.padEnd(26)}${s.state}`);

  if (e.failures.length) {
    console.log('\nREFUSED - this does not look like beta:');
    for (const f of e.failures) console.log(`  x ${f}`);
  }
  if (i.blockers.length) {
    console.log('\nREFUSED - something here can reach the real world:');
    for (const b of i.blockers) console.log(`  x ${b}`);
  }
  if (i.warnings.length) {
    console.log('\nWARNINGS (not blocking):');
    for (const w of i.warnings) console.log(`  ! ${w}`);
  }
  return { ok: e.ok && i.ok, env: e, integrations: i };
}

/* ------------------------------------------------------------------ schema */

async function ensureSeedTag(db) {
  const r = await db.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'seed_tag' LIMIT 1`);
  if (r.rowCount) return false;
  console.log('  users.seed_tag is missing -- running db.init() to apply the schema (idempotent)...');
  await db.init();
  const again = await db.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'seed_tag' LIMIT 1`);
  if (!again.rowCount) {
    throw new Error('users.seed_tag still missing after db.init(). ' +
                    'Promote this work to the beta branch and let Railway deploy beta first.');
  }
  return true;
}

/* -------------------------------------------------------------------- tags */

/* THE EXACT SET OF ACCOUNTS THIS RUN CREATED -- never a heuristic.
 *
 * An earlier version tagged `id > maxIdBeforeThisRun OR is_demo = true`, which
 * would BLANKET-ADOPT every demo account already sitting in the database. That
 * is wrong on a database somebody else had been using: those accounts are their
 * work, and adopting them would quietly put them inside reset's blast radius.
 *
 * So the ids are captured exactly -- the set of user ids before, the set after,
 * and the difference. Nothing is inferred from an id ordering, and `is_demo` is
 * never a reason to claim a row. */
async function userIds(db) {
  const r = await db.query('SELECT id FROM users');
  return new Set(r.rows.map((x) => x.id));
}

function newlyCreated(before, after) {
  const out = [];
  for (const id of after) if (!before.has(id)) out.push(id);
  return out;
}

async function tagUsers(db, ids) {
  if (!ids.length) return 0;
  const r = await db.query(
    `UPDATE users SET seed_tag = $1 WHERE id = ANY($2::int[]) AND seed_tag IS DISTINCT FROM $1`,
    [TAG, ids]);
  return r.rowCount;
}

/* The three SET NULL survivors demo.js writes, plus gift cards. Keyed on the
   accounts ALREADY tagged, so a row can only become ours if its owner is ours.
   Tagged while the owner column still names them -- after the delete it is
   null. Runs more than once during a seed, deliberately: each stage can create
   rows, and a row created and never tagged is one reset can never remove. */
async function tagSurvivors(db) {
  const out = {};
  const pairs = [['at_groups', 'created_by'], ['communities', 'created_by'],
                 ['ad_campaigns', 'advertiser_id'], ['gift_cards', 'buyer_id']];
  for (const [table, owner] of pairs) {
    const r = await db.query(
      `UPDATE ${table} SET seed_tag = $1
        WHERE seed_tag IS DISTINCT FROM $1
          AND ${owner} IN (SELECT id FROM users WHERE seed_tag = $1)`, [TAG]);
    out[table] = r.rowCount;
  }
  return out;
}

async function counts(db) {
  const out = {};
  for (const t of TAGGED_TABLES) {
    const r = await db.query(`SELECT COUNT(*)::int AS n FROM ${t} WHERE seed_tag = $1`, [TAG]);
    out[t] = r.rows[0].n;
  }
  const all = await db.query('SELECT COUNT(*)::int AS n FROM users');
  out._users_total = all.rows[0].n;
  const stray = await db.query(
    `SELECT COUNT(*)::int AS n FROM users WHERE is_demo = true AND seed_tag IS DISTINCT FROM $1`, [TAG]);
  out._untagged_demo = stray.rows[0].n;
  return out;
}

/* ------------------------------------------------------------------- users */

/* Two statements rather than one ON CONFLICT, because "was this row created?"
   from an upsert means reading the xmax system column, and that idiom is a
   version-dependent cast away from throwing. This is unambiguous. */
async function upsertUser(db, u, hash) {
  const found = await db.query('SELECT id FROM users WHERE lower(email) = lower($1)', [u.email]);
  if (found.rowCount) {
    /* Re-tag only. An account that already exists may be one somebody is using;
       this never rewrites their password, name or role. */
    await db.query('UPDATE users SET seed_tag = $1 WHERE id = $2', [TAG, found.rows[0].id]);
    return { id: found.rows[0].id, created: false };
  }
  const r = await db.query(
    `INSERT INTO users (name, email, password_hash, username, email_verified, dob,
                        headline, bio, account_type, is_admin, is_demo, seed_tag)
     VALUES ($1,$2,$3,$4,true,'1990-01-01',$5,$6,$7,$8,false,$9)
     RETURNING id`,
    [u.name, u.email, hash, u.username, u.headline, u.bio, u.accountType || 'personal', !!u.isAdmin, TAG]);
  return { id: r.rows[0].id, created: true };
}

/* -------------------------------------------------------------------- seed */

async function doSeed(db, opts) {
  const { id: identity, source } = loadIdentity(opts.identity);

  let pw;
  try { pw = await readPassword(); }
  catch (e) { console.error(`\n${e.message}`); return 1; }

  await ensureSeedTag(db);

  const before = await counts(db);

  /* REFUSE rather than adopt. Demo accounts this tool did not create belong to
     whoever made them; claiming them would put them inside reset's reach. */
  if (before._untagged_demo) {
    console.error(`\nREFUSED. ${before._untagged_demo} demo account(s) in this database are not tagged "${TAG}", ` +
                  'so this tool did not create them.');
    console.error('  Adopting them would mean a later reset deletes somebody else\'s rows, so it will not.');
    console.error('  Either remove them first (the admin dashboard\'s demo switch, turned off, does exactly that),');
    console.error('  or -- if they came from an interrupted run of THIS tool -- tag them by hand and re-run:');
    console.error(`    UPDATE users SET seed_tag = '${TAG}' WHERE is_demo = true AND seed_tag IS NULL;`);
    console.error('\nNothing was changed.');
    return 1;
  }

  console.log('\nWHAT WILL BE CREATED');
  console.log(`  identity file             ${source}`);
  console.log(`  account                   @${identity.username} <${identity.email}>`);
  console.log(`  role                      ${identity.role}${identity.role === 'admin' ? '  <-- staff dashboard access' : '  (ordinary member - tests the real product)'}`);
  console.log(`  beta shops                ${SELLERS.map((s) => '@' + s.username).join(', ')}`);
  console.log('  discovery population      ~100 demo accounts with posts, jobs, events, courses');
  console.log('  commerce                  wallet history, orders, cart, offers, invoices, gift card, loyalty');
  console.log('\nTHIS DATABASE NOW');
  console.log(`  users total               ${before._users_total}`);
  console.log(`  already tagged "${TAG}"      ${before.users}`);

  if (!opts.yes) {
    const a = await promptVisible(`\nType "seed ${TAG}" to proceed, anything else to stop: `);
    if (a !== `seed ${TAG}`) { console.log('Stopped. Nothing was changed.'); return 1; }
  }

  console.log('\nSeeding...');
  const hash = await auth.hashPassword(pw);   // the app's own hasher, never a local copy
  pw = null;

  /* Everything created from here is tagged by exact id. */
  const idsBefore = await userIds(db);

  const me = await upsertUser(db, { ...identity, isAdmin: identity.role === 'admin' }, hash);
  console.log(`  account   @${identity.username} (${me.created ? 'created' : 'already existed, re-tagged'})`);

  const sellers = [];
  for (const s of SELLERS) {
    const r = await upsertUser(db, { ...s, accountType: 'business' }, hash);
    sellers.push({ id: r.id, name: s.name });
  }
  console.log(`  shops     ${sellers.length}`);

  /* demo.js is fail-safe per block and logs its own failures, so it runs on the
     pool exactly as the admin dashboard runs it -- inside one transaction a
     single caught error would abort every statement after it. */
  const demo = require(path.join(__dirname, '..', 'demo'));
  const demoCount = await demo.seedDemo(db, me.id);
  console.log(`  discovery ${demoCount} accounts`);

  const created = newlyCreated(idsBefore, await userIds(db));
  const taggedUsers = await tagUsers(db, created);
  let tagged = await tagSurvivors(db);
  console.log(`  tagged    ${created.length} account(s) created here (${taggedUsers} newly tagged), ` +
              Object.entries(tagged).map(([k, v]) => `${k} ${v}`).join(', '));

  const followed = await demo.immerseInDemo(db, me.id);
  console.log(`  following ${followed}`);

  const pool = db.getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { seedCommerce } = require(path.join(__dirname, '..', 'seed', 'beta-commerce'));
    const c = await seedCommerce(client, { meId: me.id, sellers, tag: TAG });
    await client.query('COMMIT');
    console.log(c && c.skipped ? '  commerce  already seeded, skipped'
                               : `  commerce  ${Object.entries(c).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`  commerce  FAILED and was rolled back: ${e.message}`);
  } finally { client.release(); }

  /* Again, because the stages above create rows. Exact ids once more, so a row
     made by immerse or commerce cannot slip through untagged. */
  await tagUsers(db, newlyCreated(idsBefore, await userIds(db)));
  tagged = await tagSurvivors(db);

  const after = await counts(db);
  console.log('\nDONE');
  for (const t of TAGGED_TABLES) console.log(`  ${t.padEnd(16)}${after[t]} tagged "${TAG}"`);
  console.log(`  ${'users total'.padEnd(16)}${after._users_total}`);
  if (after._untagged_demo) {
    console.log(`\n  ${after._untagged_demo} demo user(s) are untagged. They were not created here ` +
                'and reset will NOT remove them.');
  }
  console.log(`\nSign in at ${process.env.APP_URL} as ${identity.email} with the password you supplied.`);
  return 0;
}

/* ------------------------------------------------------- add ONE account */

/* Adds a single beta account to the world that is ALREADY there. It never
   calls seedDemo, never creates the discovery population, never creates a
   shop or any commerce fixture, and never deletes or overwrites anything.
   All of that lives in doSeed and is not reachable from here. */
async function doAddAccount(db, opts) {
  if (!opts.identity) {
    console.error('\nUsage: node tools/seed-beta.js add-account <identity.json> [--commerce] [--no-immerse] [--claim-reserved]');
    return 2;
  }

  let raw;
  try { raw = JSON.parse(fs.readFileSync(opts.identity, 'utf8')); }
  catch (e) { console.error(`\nCould not read ${opts.identity}: ${e.message}`); return 1; }

  let id;
  try { id = account.normalizeIdentity(raw); }
  catch (e) { console.error(`\nREFUSED. ${opts.identity}: ${e.message}`); return 1; }

  await ensureSeedTag(db);

  /* Everything that would make this refuse is checked BEFORE the password is
     asked for, so nobody types a secret into a run that was never going to
     happen. */
  const clash = await account.findByUsername(db, id.username);
  if (clash) {
    console.error(`\nREFUSED. @${id.username} already exists (id ${clash.id}, seed_tag ${clash.seed_tag || 'none'}).`);
    console.error('  This tool never overwrites a profile, re-tags an account or resets a password.');
    console.error('  Pick a different username, or remove that account deliberately by hand first.');
    return 1;
  }
  const mail = await account.findByEmail(db, id.email);
  if (mail) {
    console.error(`\nREFUSED. ${id.email} already belongs to @${mail.username || mail.id}. Nothing was changed.`);
    return 1;
  }
  const reserved = await account.reservationFor(db, id.username);
  if (reserved && !opts.claimReserved) {
    console.error(`\nREFUSED. "${id.username}" is a RESERVED username.`);
    console.error('  Atwe locks these (routes.js SYSTEM_ROUTES) so nobody can impersonate the company');
    console.error('  or shadow a route, and the app refuses them at signup and at username-change.');
    console.error('  Creating one is a deliberate act by the legitimate owner:');
    console.error(`    node tools/seed-beta.js add-account ${opts.identity} --claim-reserved`);
    console.error('  The reservation row is LEFT IN PLACE, so the name stays locked against everyone else.');
    return 1;
  }

  console.log('\nWHAT WILL BE ADDED');
  console.log(`  identity file             ${opts.identity}`);
  console.log(`  account                   @${id.username} <${id.email}>`);
  console.log(`  display name              ${id.name}`);
  console.log(`  account type              ${id.accountType}`);
  console.log(`  role                      ${id.role}${id.role === 'admin' ? '  <-- STAFF ACCESS' : '  (ordinary member - no staff access)'}`);
  console.log(`  reserved name             ${reserved ? 'yes, claiming it deliberately (row left in place)' : 'no'}`);
  console.log(`  join the existing world   ${opts.immerse ? 'yes - follows, DMs, notifications, one group' : 'no (--no-immerse)'}`);
  console.log(`  commerce history          ${opts.commerce ? 'yes (--commerce)' : 'no - not the default'}`);
  console.log('\n  NOT touched: the demo population, shops, global commerce fixtures, any existing account.');

  const before = await counts(db);
  console.log(`\n  users in this database    ${before._users_total}  (tagged "${TAG}": ${before.users})`);

  if (!opts.yes) {
    const a = await promptVisible(`\nType "add ${id.username}" to create it, anything else to stop: `);
    if (a !== `add ${id.username}`) { console.log('Stopped. Nothing was changed.'); return 1; }
  }

  let pw;
  try { pw = await readPassword(); }
  catch (e) { console.error(`\n${e.message}`); return 1; }
  const hash = await auth.hashPassword(pw);
  pw = null;

  let made;
  try {
    made = await account.createBetaAccount(db, {
      identity: raw, passwordHash: hash, tag: TAG, claimReserved: opts.claimReserved,
    });
  } catch (e) { console.error(`\nREFUSED. ${e.message}`); return 1; }
  console.log(`\n  created                   @${made.username} (id ${made.id}), seed_tag "${TAG}"`);

  if (opts.immerse) {
    try {
      const r = await account.immerseAccount(db, made.id);
      console.log(`  joined the world          following ${r.followed} account(s); ${r.note}`);
    } catch (e) { console.error(`  joined the world          FAILED (the account still exists): ${e.message}`); }
  }

  if (opts.commerce) {
    const pool = db.getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const sellers = (await client.query(
        `SELECT id, name FROM users WHERE seed_tag = $1 AND is_demo = false AND id <> $2 ORDER BY id LIMIT 2`,
        [TAG, made.id])).rows;
      if (sellers.length < 2) {
        await client.query('ROLLBACK');
        console.error('  commerce                  SKIPPED: needs two existing beta shops to buy from.');
      } else {
        const { seedCommerce } = require(path.join(__dirname, '..', 'seed', 'beta-commerce'));
        const c = await seedCommerce(client, { meId: made.id, sellers, tag: TAG });
        await client.query('COMMIT');
        console.log(c && c.skipped ? '  commerce                  already seeded, skipped'
                                   : `  commerce                  ${Object.entries(c).map(([k, v]) => `${k} ${v}`).join(', ')}`);
      }
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`  commerce                  FAILED and was rolled back: ${e.message}`);
    } finally { client.release(); }
  }

  const after = await counts(db);
  console.log(`\nDONE. users ${before._users_total} -> ${after._users_total}, tagged "${TAG}" ${before.users} -> ${after.users}.`);
  console.log(`Sign in at ${process.env.APP_URL} as ${id.email} with the password you supplied.`);
  return 0;
}

/* ------------------------------ activate the app's OWN @atwe account */

/* NOT add-account. @atwe already exists on every database, because server.js
   creates it itself on boot so the platform can post as itself. This command
   gives that existing account a beta password so somebody can sign in as it,
   and it refuses every row it cannot prove is that account. It creates nothing,
   deletes nothing, renames nothing and promotes nothing. */
async function doActivateOfficial(db, opts) {
  const uname = account.OFFICIAL_USERNAME;

  await ensureSeedTag(db);

  const { row, count } = await account.findOfficial(db, uname);
  if (count > 1) {
    console.error(`\nREFUSED. ${count} accounts hold @${uname}. Something is wrong with the unique index; not touching any of them.`);
    return 1;
  }
  if (!row) {
    console.error(`\nREFUSED. There is no @${uname} account in this database.`);
    console.error('  The app creates it itself on boot (server.js ensureOfficialAccount), so either this');
    console.error('  database has never run the app, or something removed it. Start the beta app once, then retry.');
    return 1;
  }

  /* If an identity file was named, it must DESCRIBE this same account. It is
     never used to write anything -- it only has to agree, so that pointing this
     command at the wrong file is caught rather than silently ignored. */
  if (opts.identity) {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(opts.identity, 'utf8')); }
    catch (e) { console.error(`\nCould not read ${opts.identity}: ${e.message}`); return 1; }
    let id;
    try { id = account.normalizeIdentity(raw); }
    catch (e) { console.error(`\nREFUSED. ${opts.identity}: ${e.message}`); return 1; }
    if (id.username !== uname) {
      console.error(`\nREFUSED. ${opts.identity} describes @${id.username}, but this command only ever acts on @${uname}.`);
      return 1;
    }
    if (id.role !== 'member') {
      console.error(`\nREFUSED. ${opts.identity} asks for role "${id.role}". This command never grants staff access.`);
      return 1;
    }
    console.log(`\n  identity file             ${opts.identity} (checked, never written)`);
  }

  /* THE POLICY DECIDES WHETHER A LOGIN MAY EXIST HERE AT ALL, before any
     identity work. On beta it says yes; production is a separate, deliberate
     activation that is switched off today. The tool is already refusing to run
     off beta at all, so this is belt and braces -- and it is the line the future
     production flow flips rather than a new one somebody has to remember. */
  const policy = account.officialAccessPolicy(process.env);
  try { account.assertOfficialAccessAllowed(process.env, 'login'); }
  catch (e) { console.error(`\nREFUSED. ${e.message}`); return 1; }

  const problem = account.officialMismatch(row, uname, { allowAdmin: policy.allowAdmin });
  if (problem) {
    console.error(`\nREFUSED. @${uname} exists, but it is not provably the account the app created:`);
    console.error(`  ${problem}`);
    console.error('\n  This command only ever activates the built-in account, and only when every');
    console.error('  identity check passes. It will not overwrite an account it cannot account for.');
    return 1;
  }

  const want = account.officialIdentity(uname);
  console.log('\nTHE ACCOUNT THIS WILL ACTIVATE');
  console.log(`  id                        ${row.id}`);
  console.log(`  username                  @${row.username}`);
  console.log(`  email                     ${row.email}   [${account.officialEmailState(row.email, uname) || 'not canonical'}]`);
  console.log(`  name                      ${row.name}`);
  console.log(`  account type              ${row.account_type}`);
  console.log(`  staff access              ${row.is_admin ? 'superadmin (a protected, permitted state here)' : 'none (is_admin false, no scopes)'}`
            + '  <-- and this command changes neither');
  console.log(`  seed_tag now              ${row.seed_tag == null ? 'none' : `"${row.seed_tag}"`}`);
  console.log(`  headline                  ${row.headline || '(none)'}${row.headline === want.headline ? '' : '   [differs from the app default; not required]'}`);
  console.log(`  verified seal             ${row.verified ? 'yes' : 'no'}${row.verified ? '' : '   [app default is yes; not required]'}`);

  console.log('\nWHAT WILL CHANGE, and nothing else');
  console.log('  password_hash             set to the beta password you are about to type');
  console.log('  email_verified            true');
  console.log(`  seed_tag                  "${account.KEEP_TAG}"  <-- deliberately NOT "${TAG}": see below`);
  console.log('\n  NOT touched: username, email, name, account type, the verified seal, the headline,');
  console.log('  every admin column, and every Stripe / OAuth / two-factor / device column.');
  console.log(`\n  RESET SAFETY. "${TAG}" is what reset deletes. This row is tagged "${account.KEEP_TAG}"`);
  console.log('  instead, so a beta reset does not match it, and reset separately refuses to delete');
  console.log(`  @${uname} by name even if somebody re-tags it by hand. The app\'s own account survives.`);
  console.log(`\n  join the existing world   ${opts.immerse ? 'yes - follows, DMs, notifications, one group' : 'no (--no-immerse)'}`);
  console.log('  commerce history          no - this command never adds any');

  if (opts.dryRun) { console.log('\n--dry-run: nothing was written.'); return 0; }

  if (!opts.yes) {
    const a = await promptVisible(`\nType "activate ${uname}" to give it a beta password, anything else to stop: `);
    if (a !== `activate ${uname}`) { console.log('Stopped. Nothing was changed.'); return 1; }
  }

  let pw;
  try { pw = await readPassword(); }
  catch (e) { console.error(`\n${e.message}`); return 1; }
  const hash = await auth.hashPassword(pw);
  pw = null;

  let done;
  try { done = await account.activateOfficial(db, { passwordHash: hash, username: uname, allowAdmin: policy.allowAdmin }); }
  catch (e) { console.error(`\nREFUSED. ${e.message}`); return 1; }
  console.log(`\n  activated                 @${done.username} (id ${done.id}), seed_tag "${done.seedTag}"`);

  if (opts.immerse) {
    try {
      const r = await account.immerseAccount(db, done.id);
      console.log(`  joined the world          following ${r.followed} account(s); ${r.note}`);
    } catch (e) { console.error(`  joined the world          FAILED (the account is still activated): ${e.message}`); }
  }

  console.log(`\nDONE. Sign in at ${process.env.APP_URL} as @${done.username} (or ${row.email}) with the password you supplied.`);
  console.log('No account was created, renamed, promoted or deleted.');
  return 0;
}

/* ------------------------------------------- promote the official account */

/* The one action in this tool that grants staff access, and it can grant it to
   exactly one account: the app's own @atwe, already activated, on an environment
   the official-account access policy permits (seed/beta-account.js section 5a --
   beta today, production later by a separate deliberate step). Every refusal
   lives in account.promoteOfficialAdmin, which this function only reports; there
   is no username argument and no flag that widens it. */
async function doPromoteOfficialAdmin(db, opts) {
  const uname = account.OFFICIAL_USERNAME;
  await ensureSeedTag(db);

  const { row, count } = await account.findOfficial(db, uname);
  if (count > 1) {
    console.error(`\nREFUSED. ${count} accounts hold @${uname}. Not touching any of them.`);
    return 1;
  }
  if (!row) {
    console.error(`\nREFUSED. There is no @${uname} account in this database.`);
    return 1;
  }

  const problem = account.officialMismatch(row, uname, { allowAdmin: true });
  if (problem) {
    console.error(`\nREFUSED. @${uname} exists, but it is not provably the account the app created:`);
    console.error(`  ${problem}`);
    return 1;
  }
  if (row.seed_tag !== account.KEEP_TAG) {
    console.error(`\nREFUSED. @${uname} is not a protected beta account yet.`);
    console.error(`  seed_tag is ${row.seed_tag == null ? 'unset' : `"${row.seed_tag}"`}, not "${account.KEEP_TAG}".`);
    console.error('  Run "node tools/seed-beta.js activate-official" first, so it has a beta password,');
    console.error('  then promote it. A superadmin nobody can sign into is of no use.');
    return 1;
  }

  console.log('\nTHE ACCOUNT THIS WILL PROMOTE');
  console.log(`  id                        ${row.id}`);
  console.log(`  username                  @${row.username}`);
  console.log(`  email                     ${row.email}   [${account.officialEmailState(row.email, uname) || 'not canonical'}]`);
  console.log(`  account type              ${row.account_type}`);
  console.log(`  seed_tag                  "${row.seed_tag}"`);
  console.log(`  staff access now          ${row.is_admin ? 'superadmin already' : 'none'}`);

  if (row.is_admin === true) {
    console.log('\nNothing to do: it is already a superadmin. Nothing was written.');
    return 0;
  }

  console.log('\nWHAT WILL CHANGE, and nothing else');
  console.log('  is_admin                  true   <-- this app\'s whole superadmin model');
  console.log('\n  NOT touched: admin_perms, admin_role, the password, username, email, name,');
  console.log('  account type, seed_tag, the verified seal, and every Stripe / OAuth / 2FA column.');
  const pol = account.officialAccessPolicy(process.env);
  console.log(`\n  ENVIRONMENT               ${pol.environment}  (the access policy permits this here)`);
  console.log('  Production is a separate, deliberate activation and is switched off today, so the');
  console.log('  same command against production refuses and changes nothing.');
  console.log(`\n  To undo it, set is_admin = false on user ${row.id} in this beta database.`);

  if (opts.dryRun) { console.log('\n--dry-run: nothing was written.'); return 0; }

  if (!opts.yes) {
    const a = await promptVisible(`\nType "promote ${uname}" to make it a beta superadmin, anything else to stop: `);
    if (a !== `promote ${uname}`) { console.log('Stopped. Nothing was changed.'); return 1; }
  }

  let done;
  try {
    done = await account.promoteOfficialAdmin(db, { username: uname, env: process.env });
  } catch (e) { console.error(`\nREFUSED. ${e.message}`); return 1; }

  console.log(`\n  promoted                  @${done.username} (id ${done.id}) is now a superadmin on this ${pol.environment} environment`);
  console.log('\nDONE. No account was created, renamed, re-passworded or deleted.');
  return 0;
}

/* ------------------------------------ move the official account's email */

/* Carries the app's own @atwe from the internal address it is created with to
   its activated login email (seed/beta-account.js section 5c). It has no
   username argument and no flag that widens it; every refusal lives in
   account.setOfficialEmail, which this function only reports.

   It never types a password, never reads one, and never grants anything. The
   email move and the admin promotion are separate commands on purpose: two
   different powers, decided one at a time. */
async function doSetOfficialEmail(db, opts) {
  const uname = account.OFFICIAL_USERNAME;
  await ensureSeedTag(db);

  const { row, count } = await account.findOfficial(db, uname);
  if (count > 1) {
    console.error(`\nREFUSED. ${count} accounts hold @${uname}. Not touching any of them.`);
    return 1;
  }
  if (!row) {
    console.error(`\nREFUSED. There is no @${uname} account in this database.`);
    return 1;
  }

  /* The policy first, before any identity work, exactly as activate-official
     does: the activated address IS the login identity, so this is the `login`
     power and nothing new. */
  const policy = account.officialAccessPolicy(process.env);
  try { account.assertOfficialAccessAllowed(process.env, 'login'); }
  catch (e) { console.error(`\nREFUSED. ${e.message}`); return 1; }

  const problem = account.officialMismatch(row, uname, { allowAdmin: policy.allowAdmin });
  if (problem) {
    console.error(`\nREFUSED. @${uname} exists, but it is not provably the account the app created:`);
    console.error(`  ${problem}`);
    return 1;
  }
  if (row.seed_tag !== account.KEEP_TAG) {
    console.error(`\nREFUSED. @${uname} is not a protected beta account yet.`);
    console.error(`  seed_tag is ${row.seed_tag == null ? 'unset' : `"${row.seed_tag}"`}, not "${account.KEEP_TAG}".`);
    console.error('  Run "node tools/seed-beta.js activate-official" first, so it has a beta password,');
    console.error('  then move its email. A login address on an account nobody can sign into buys nothing.');
    return 1;
  }

  const want = account.officialEmails(uname);
  const state = account.officialEmailState(row.email, uname);

  console.log('\nTHE ACCOUNT THIS WILL MOVE');
  console.log(`  id                        ${row.id}`);
  console.log(`  username                  @${row.username}`);
  console.log(`  email now                 ${row.email}   [${state}]`);
  console.log(`  account type              ${row.account_type}`);
  console.log(`  seed_tag                  "${row.seed_tag}"`);
  console.log(`  staff access now          ${row.is_admin ? 'superadmin' : 'none'}  <-- and this command changes neither it nor the password`);

  if (state === 'activated') {
    console.log(`\nNothing to do: it already signs in as ${want.activated}. Nothing was written.`);
    return 0;
  }

  /* ADMIN_EMAIL IS SHOWN WHETHER OR NOT IT CLASHES. An operator deciding
     whether to run this should be able to see the variable that could turn it
     into a staff grant, not discover it in a refusal. */
  const adminEmail = account.normalizeEmail(process.env.ADMIN_EMAIL);
  const clash = adminEmail && adminEmail === account.normalizeEmail(want.activated);
  console.log(`  ADMIN_EMAIL here          ${process.env.ADMIN_EMAIL ? process.env.ADMIN_EMAIL : '(not set)'}`
            + (clash ? '   <-- SAME ADDRESS. See below.' : '   (a different address, so this move grants nothing)'));

  if (clash) {
    console.log(`\nSTOP. ADMIN_EMAIL on this service is the very address @${uname} would move to.`);
    console.log('  db.init() promotes whatever account holds ADMIN_EMAIL to superadmin on EVERY boot,');
    console.log(`  so this move would hand @${uname} staff access at the next restart, on its own, with`);
    console.log('  nobody deciding to and none of the checks in promote-official-admin running.');
    console.log('\n  Point ADMIN_EMAIL at a person\'s own address instead, then run this again, and grant');
    console.log('  staff access deliberately with "node tools/seed-beta.js promote-official-admin".');
    if (!opts.allowAdminEmailMatch) {
      console.error('\nREFUSED. Nothing was written.');
      console.error('  If you genuinely want the boot promotion to be the admin path, re-run with');
      console.error('  --allow-admin-email-match. There is no default that does this for you.');
      return 1;
    }
    console.log('\n  --allow-admin-email-match was supplied, so this will go ahead. You are choosing to let');
    console.log(`  the next restart promote @${uname}.`);
  }

  console.log('\nWHAT WILL CHANGE, and nothing else');
  console.log(`  email                     ${want.dormant}`);
  console.log(`                            -> ${want.activated}`);
  console.log('\n  NOT touched: password_hash, email_verified, seed_tag, username, name, account type,');
  console.log('  every admin column, the verified seal, the headline, and every Stripe / OAuth / 2FA column.');
  console.log(`\n  ENVIRONMENT               ${policy.environment}  (the access policy permits a login identity here)`);
  console.log('  Production is a separate, deliberate activation and is switched off today, so the');
  console.log('  same command against production refuses and changes nothing.');
  console.log(`\n  ONE WAY. Nothing in this tool writes ${want.dormant} back.`);
  console.log(`  To undo it by hand, set email = '${want.dormant}' on user ${row.id} in this beta database.`);

  if (opts.dryRun) { console.log('\n--dry-run: nothing was written.'); return 0; }

  if (!opts.yes) {
    const a = await promptVisible(`\nType "move ${uname}" to change its email, anything else to stop: `);
    if (a !== `move ${uname}`) { console.log('Stopped. Nothing was changed.'); return 1; }
  }

  let done;
  try {
    done = await account.setOfficialEmail(db, {
      username: uname, env: process.env,
      /* Never inferred, never defaulted: it is this flag or nothing. */
      allowAdminEmailMatch: opts.allowAdminEmailMatch === true,
    });
  }
  catch (e) { console.error(`\nREFUSED. ${e.message}`); return 1; }

  console.log(`\n  moved                     @${done.username} (id ${done.id}) now signs in as ${done.email}`);
  console.log(`\nDONE. Sign in at ${process.env.APP_URL} as @${done.username} (or ${done.email}) with the SAME password as before.`);
  console.log('No password was changed, no staff access was granted, and no account was created or deleted.');
  return 0;
}

/* --------------------------------- the founder's own beta account's email */

/* Corrects ONE beta-owned account's email, and that is the whole of it. No
   username argument, no email argument, no flag that widens either: the only
   pair this command knows is hardcoded in seed/beta-account.js section 5d.

   IT IS NOT THE @atwe FLOW AND MUST NOT BE READ AS ONE. That account is the
   app's own, is being given powers it never had, and is governed by the
   official-account access policy. This is an ordinary account a person created
   with add-account, and this writes one column.

   The app's own Settings -> Change email is the right door and stays it. It
   cannot be used on beta today because SMTP is off there, so it refuses before
   changing anything rather than stranding somebody on an address they can never
   verify. Correct behaviour, and the reason this exists. */
async function doSetFounderEmail(db, opts) {
  const uname = account.FOUNDER_USERNAME;
  const target = account.FOUNDER_EMAIL;
  await ensureSeedTag(db);

  const { row, count } = await account.findFounder(db);
  if (count > 1) {
    console.error(`\nREFUSED. ${count} accounts hold @${uname}. Not touching any of them.`);
    return 1;
  }
  const problem = account.founderMismatch(row);
  if (problem) {
    console.error(`\nREFUSED. @${uname} cannot be migrated:`);
    console.error(`  ${problem}`);
    return 1;
  }

  const already = account.normalizeEmail(row.email) === account.normalizeEmail(target);

  console.log('\nTHE ACCOUNT THIS WILL MOVE');
  console.log(`  id                        ${row.id}`);
  console.log(`  username                  @${row.username}`);
  console.log(`  name                      ${row.name}`);
  console.log(`  email now                 ${row.email}`);
  console.log(`  account type              ${row.account_type}`);
  console.log(`  seed_tag                  "${row.seed_tag}"  (beta tooling made this account)`);
  console.log(`  staff access now          ${row.is_admin ? 'superadmin' : 'none'}`
            + '  <-- and this command changes neither it nor the password');

  if (already) {
    console.log(`\nNothing to do: it already signs in as ${target}. Nothing was written.`);
    /* Still worth saying, because the promotion is a SEPARATE event that may not
       have happened yet even though the email is already right. */
    if (account.founderIsAdminEmail(process.env) && !row.is_admin) {
      console.log('\n  NOTE. ADMIN_EMAIL on this service is this address, and this account is not a');
      console.log('  superadmin yet. The next boot or deploy will promote it (db.js, db.init()).');
    }
    return 0;
  }

  console.log('\nWHAT WILL CHANGE, and nothing else');
  console.log(`  email                     ${row.email}`);
  console.log(`                            -> ${target}`);
  console.log('\n  NOT touched: password_hash, username, name, account type, seed_tag, is_admin,');
  console.log('  admin_perms, admin_role, status, the verified seal, the headline, the bio, and every');
  console.log('  Stripe / OAuth / 2FA column. Posts, follows, messages and world immersion are rows in');
  console.log('  other tables keyed on this account id, which does not change, so none of them move.');

  /* THE ONE CONSEQUENCE THIS COMMAND DOES NOT CAUSE BUT MUST NOT HIDE. */
  const isAdminEmail = account.founderIsAdminEmail(process.env);
  console.log(`\n  ADMIN_EMAIL here          ${process.env.ADMIN_EMAIL ? process.env.ADMIN_EMAIL : '(not set)'}`);
  if (isAdminEmail) {
    console.log('\n  THIS IS DELIBERATE FOR THIS ACCOUNT, and it is the opposite of the @atwe rule.');
    console.log('  ADMIN_EMAIL on this service IS this address, on purpose, because the founder\'s own');
    console.log('  account is meant to hold superadmin. So, plainly:');
    console.log('    * this command does NOT write is_admin, and never will');
    console.log('    * on the NEXT boot or deploy, db.init() runs');
    console.log('      UPDATE users SET is_admin = true WHERE lower(email) = <ADMIN_EMAIL>');
    console.log(`    * that will match this account and promote @${uname} to superadmin`);
    console.log('  That existing mechanism is being reused on purpose. No new one was invented, and');
    console.log('  there is no way to trigger it from here short of restarting the service.');
    if (row.is_admin) console.log('  (It is already a superadmin, so the next boot will change nothing.)');
  } else {
    console.log('  That is NOT this address, so nothing will promote this account on the next boot.');
    console.log(`  To give it staff access, use the dashboard's Staff tab.`);
  }

  if (opts.dryRun) { console.log('\n--dry-run: nothing was written.'); return 0; }

  if (!opts.yes) {
    const a = await promptVisible(`\nType "move ${uname}" to change its email, anything else to stop: `);
    if (a !== `move ${uname}`) { console.log('Stopped. Nothing was changed.'); return 1; }
  }

  let done;
  try { done = await account.setFounderEmail(db, { env: process.env }); }
  catch (e) { console.error(`\nREFUSED. ${e.message}`); return 1; }

  console.log(`\n  moved                     @${done.username} (id ${done.id}) now signs in as ${done.email}`);
  console.log(`\nDONE. Sign in at ${process.env.APP_URL} as @${done.username} (or ${done.email}) with the SAME password as before.`);
  console.log('No password was changed, no staff access was granted, and no account was created or deleted.');
  if (isAdminEmail && !done.isAdmin) {
    console.log(`\nNEXT BOOT: ADMIN_EMAIL matches, so db.init() will make @${done.username} a superadmin.`);
  }
  return 0;
}

/* ------------------------------------------------------------------- reset */

async function doReset(db, opts) {
  await ensureSeedTag(db);
  const before = await counts(db);

  console.log('\nWHAT WILL BE DELETED');
  for (const t of TAGGED_TABLES) console.log(`  ${t.padEnd(16)}${before[t]} row(s) tagged "${TAG}"`);
  console.log('\n  Everything those users own is removed by the database\'s own foreign keys.');
  console.log(`  NOTHING is selected by is_demo. ${before._untagged_demo} untagged demo user(s) will be LEFT ALONE.`);
  console.log(`  @${account.OFFICIAL_USERNAME} (the app's own account) is EXCLUDED by name and is never deleted.`);
  console.log(`  users in this database after the delete: about ${before._users_total - before.users}`);

  if (!before.users && !TAGGED_TABLES.some((t) => before[t])) {
    console.log('\nNothing is tagged. Nothing to do.');
    return 0;
  }

  if (!opts.yes) {
    const a = await promptVisible(`\nType "reset ${TAG}" to delete these rows, anything else to stop: `);
    if (a !== `reset ${TAG}`) { console.log('Stopped. Nothing was changed.'); return 1; }
  }

  const pool = db.getPool();
  const client = await pool.connect();
  const removed = {};
  try {
    await client.query('BEGIN');
    /* Survivors first, while they still name their owner -- then the users,
       which cascades everything genuinely owned. No DROP, no TRUNCATE, and no
       predicate anywhere but seed_tag. */
    for (const t of ['at_groups', 'communities', 'ad_campaigns', 'gift_cards', 'users']) {
      /* THE APP'S OWN @atwe ACCOUNT IS NEVER DELETED, whatever it is tagged.
         server.js creates it on boot so the platform can post as itself, and
         deleting it would cascade away every post it ever made, hand it a new
         id and a new random password on the next boot, and leave the admin
         "post as Atwe" route answering "no @atwe account exists" until then.
         It should never carry this tag in the first place (activate-official
         writes "beta-keep"), so this excludes nothing today -- it is here so a
         hand-tagged row cannot turn a routine reset into that outage.
         IS DISTINCT FROM, not <>, so a NULL username still matches and is
         still deleted: a row with no handle is not the official account. */
      const guard = t === 'users' ? ' AND lower(username) IS DISTINCT FROM $2' : '';
      const args  = t === 'users' ? [TAG, account.OFFICIAL_USERNAME] : [TAG];
      const r = await client.query(`DELETE FROM ${t} WHERE seed_tag = $1${guard}`, args);
      removed[t] = r.rowCount;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`\nFAILED and rolled back. Nothing was deleted: ${e.message}`);
    return 1;
  } finally { client.release(); }

  const after = await counts(db);
  console.log('\nDELETED');
  for (const [t, n] of Object.entries(removed)) console.log(`  ${t.padEnd(16)}${n}`);
  console.log(`\n  users remaining           ${after._users_total}`);
  console.log(`  still tagged "${TAG}"        ${after.users}`);
  console.log(`  untagged demo users left  ${after._untagged_demo}`);
  return 0;
}

/* -------------------------------------------------------------------- main */

async function main() {
  const argv = process.argv.slice(2);
  const cmd = (argv.find((a) => !a.startsWith('-')) || 'check').toLowerCase();
  const positional = argv.filter((a) => !a.startsWith('-'));
  const opts = {
    yes: argv.includes('--yes'),
    commerce: argv.includes('--commerce'),
    immerse: !argv.includes('--no-immerse'),
    claimReserved: argv.includes('--claim-reserved'),
    dryRun: argv.includes('--dry-run'),
    /* Spelled out in full on purpose. It lets set-official-email proceed when
       ADMIN_EMAIL is the address being moved to, i.e. when the next boot would
       promote @atwe by itself. Nothing else sets it and there is no default. */
    allowAdminEmailMatch: argv.includes('--allow-admin-email-match'),
    identity: (argv.find((a) => a.startsWith('--identity=')) || '').split('=')[1] || positional[1] || null,
  };

  if (!['check', 'status', 'seed', 'reset', 'add-account', 'activate-official',
        'set-official-email', 'promote-official-admin', 'set-founder-email'].includes(cmd)) {
    console.error(`Unknown command "${cmd}". Use: check | status | seed | add-account | ` +
                  'activate-official | set-official-email | promote-official-admin | ' +
                  'set-founder-email | reset');
    return 2;
  }

  const report = printReport(process.env);

  if (cmd === 'check') {
    console.log(report.ok
      ? `\nALLOWED. "seed" would run against ${guard.dbLabel(process.env.DATABASE_URL)}.`
      : '\nREFUSED. Fix the items above first.');
    return report.ok ? 0 : 1;
  }

  if (!report.ok) {
    console.error('\nREFUSED. Nothing was read and nothing was changed.');
    return 1;
  }

  const db = require(path.join(__dirname, '..', 'db'));
  if (!db.isConfigured()) { console.error('\nDATABASE_URL is not configured.'); return 1; }

  try {
    if (cmd === 'status') {
      await ensureSeedTag(db);
      const c = await counts(db);
      console.log('\nTAGGED IN THIS DATABASE');
      for (const t of TAGGED_TABLES) console.log(`  ${t.padEnd(16)}${c[t]}`);
      console.log(`  ${'users total'.padEnd(16)}${c._users_total}`);
      console.log(`  ${'untagged demo'.padEnd(16)}${c._untagged_demo}  (not ours - reset leaves these)`);
      return 0;
    }
    if (cmd === 'add-account') return await doAddAccount(db, opts);
    if (cmd === 'activate-official') return await doActivateOfficial(db, opts);
    if (cmd === 'set-official-email') return await doSetOfficialEmail(db, opts);
    if (cmd === 'set-founder-email') return await doSetFounderEmail(db, opts);
    if (cmd === 'promote-official-admin') return await doPromoteOfficialAdmin(db, opts);
    return cmd === 'seed' ? await doSeed(db, opts) : await doReset(db, opts);
  } finally {
    try { await db.getPool().end(); } catch (e) { /* nothing to close */ }
  }
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error(`\n${e.message}`);
  process.exit(1);
});
