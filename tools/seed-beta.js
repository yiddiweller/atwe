#!/usr/bin/env node
/* SEED THE BETA WORLD -- and refuse to do anything else.
 *
 *   node tools/seed-beta.js check    what would happen, and why it would or would not be allowed
 *   node tools/seed-beta.js status   what this database currently holds that is tagged beta
 *   node tools/seed-beta.js seed     build the beta world
 *   node tools/seed-beta.js reset    remove EXACTLY what this tool created, and nothing else
 *
 * THREE RULES THIS FILE EXISTS TO ENFORCE.
 *
 * 1. IT CANNOT RUN AGAINST PRODUCTION BY ACCIDENT. Every check lives in
 *    tools/seed-guard.js as a pure function so the whole refusal surface is unit
 *    tested with no database (test/seed-guard.test.js). `check` is the same code
 *    path `seed` runs; there is no "just this once" flag that skips it.
 *
 * 2. RESET DELETES BY seed_tag AND BY NOTHING ELSE. There is deliberately NO
 *    `is_demo` clause anywhere in the reset path. A reset that reasoned about
 *    is_demo would delete demo accounts this tool never created -- on a database
 *    someone else had already been using, that is somebody's work. Every account
 *    this tool creates OR adopts is tagged first; what is not tagged is not ours
 *    and is reported, never removed.
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
const bcrypt = require('bcryptjs');

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
  if (!again.rowCount) throw new Error('users.seed_tag still missing after db.init(). Deploy this branch first.');
  return true;
}

/* -------------------------------------------------------------------- tags */

/* Tag everything this run is responsible for. Runs more than once during a
   seed, deliberately: each stage can create rows, and a row that is created and
   never tagged is a row reset can never remove. Cheap and idempotent.
   `sinceId` is the highest user id that existed BEFORE this run. */
async function tagEverything(db, sinceId) {
  const out = {};

  /* Anything created during this run, plus every demo account -- the demo
     population IS the beta world's discovery layer, so it is adopted, tagged
     and therefore removable. */
  out.users = (await db.query(
    `UPDATE users SET seed_tag = $1
      WHERE (id > $2 OR is_demo = true) AND seed_tag IS DISTINCT FROM $1`, [TAG, sinceId])).rowCount;

  /* The three SET NULL survivors demo.js writes. Tagged while their owner still
     points at them, because after the delete the owner column is null. */
  out.at_groups = (await db.query(
    `UPDATE at_groups SET seed_tag = $1
      WHERE seed_tag IS DISTINCT FROM $1
        AND created_by IN (SELECT id FROM users WHERE seed_tag = $1)`, [TAG])).rowCount;
  out.communities = (await db.query(
    `UPDATE communities SET seed_tag = $1
      WHERE seed_tag IS DISTINCT FROM $1
        AND created_by IN (SELECT id FROM users WHERE seed_tag = $1)`, [TAG])).rowCount;
  out.ad_campaigns = (await db.query(
    `UPDATE ad_campaigns SET seed_tag = $1
      WHERE seed_tag IS DISTINCT FROM $1
        AND advertiser_id IN (SELECT id FROM users WHERE seed_tag = $1)`, [TAG])).rowCount;
  /* gift_cards tag themselves at insert, but a card bought by a tagged account
     is ours too. */
  out.gift_cards = (await db.query(
    `UPDATE gift_cards SET seed_tag = $1
      WHERE seed_tag IS DISTINCT FROM $1
        AND buyer_id IN (SELECT id FROM users WHERE seed_tag = $1)`, [TAG])).rowCount;

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

  let pw = process.env.BETA_SEED_PASSWORD || '';
  if (!pw) pw = await promptHidden('Beta account password (not echoed): ');
  const problem = guard.passwordProblem(pw);
  if (problem) { console.error(`\nThe beta password is ${problem}. Nothing was changed.`); return 1; }

  await ensureSeedTag(db);

  const before = await counts(db);
  const maxId = (await db.query('SELECT COALESCE(MAX(id),0)::int AS m FROM users')).rows[0].m;

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
  if (before._untagged_demo) {
    console.log(`  demo users NOT tagged     ${before._untagged_demo}  <-- these will be ADOPTED and tagged "${TAG}",`);
    console.log('                            which means a later reset WILL remove them.');
  }

  if (!opts.yes) {
    const a = await promptVisible(`\nType "seed ${TAG}" to proceed, anything else to stop: `);
    if (a !== `seed ${TAG}`) { console.log('Stopped. Nothing was changed.'); return 1; }
  }

  console.log('\nSeeding...');
  const hash = await bcrypt.hash(pw, 10);
  pw = null;

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

  let tagged = await tagEverything(db, maxId);
  console.log(`  tagged    ${Object.entries(tagged).map(([k, v]) => `${k} ${v}`).join(', ')}`);

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

  /* Again, because the stages above create rows. */
  tagged = await tagEverything(db, maxId);

  const after = await counts(db);
  console.log('\nDONE');
  for (const t of TAGGED_TABLES) console.log(`  ${t.padEnd(16)}${after[t]} tagged "${TAG}"`);
  console.log(`  ${'users total'.padEnd(16)}${after._users_total}`);
  if (after._untagged_demo) {
    console.log(`\n  ${after._untagged_demo} demo user(s) are still untagged. They were not created here ` +
                'and reset will NOT remove them.');
  }
  console.log(`\nSign in at ${process.env.APP_URL} as ${identity.email} with the password you supplied.`);
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
      const r = await client.query(`DELETE FROM ${t} WHERE seed_tag = $1`, [TAG]);
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
  const opts = {
    yes: argv.includes('--yes'),
    identity: (argv.find((a) => a.startsWith('--identity=')) || '').split('=')[1] || null,
  };

  if (!['check', 'status', 'seed', 'reset'].includes(cmd)) {
    console.error(`Unknown command "${cmd}". Use: check | status | seed | reset`);
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
    return cmd === 'seed' ? await doSeed(db, opts) : await doReset(db, opts);
  } finally {
    try { await db.getPool().end(); } catch (e) { /* nothing to close */ }
  }
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error(`\n${e.message}`);
  process.exit(1);
});
