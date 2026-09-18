/* Shared fixture setup for the probes that need a signed-in account.
 *
 * WHY THIS EXISTS. mehub, mesearch and searchsweep each hardcoded
 * `postgres://atwe:atwe@localhost:5432/atwescore` and ignored DATABASE_URL, so they
 * seeded their account into ONE database while the server under test ran against
 * ANOTHER. The token then had no session the server could see, the app booted signed
 * out, and every gated surface came back empty: mehub reported "0 sections, 0 rows,
 * 0px tall" and crashed on a missing back arrow, mesearch crashed on a missing search
 * bar, and all seven of searchsweep's "offers Atwe AI" checks failed with "found 0".
 * Nothing was wrong with the app. They only ever passed because whoever ran them
 * happened to have the server on that same hardcoded address.
 *
 * Two rules come out of that, and both live here so no probe has to remember them:
 *   1. The fixture and the server MUST share a database. `dbUrl()` reads DATABASE_URL
 *      (keeping the old string as the fallback so an existing setup still works).
 *   2. A probe must PROVE its fixture took before it measures anything. `signIn` asks
 *      the server whether the session exists and fails by name if it does not, so a
 *      misconfiguration reads as a misconfiguration instead of as a broken product.
 */
'use strict';
const crypto = require('crypto');
const ROOT = '/home/user/atwe';

/* auth and pg are required LAZILY, and for auth that is load-bearing. auth reads
   JWT_SECRET once, AT REQUIRE TIME, so a probe that sets the secret AFTER requiring
   this file would mint tokens with the insecure dev fallback while the server it talks
   to uses the real one - every request then 401s and the run blames the product.
   cluster.js documents that exact trap, so requiring this fixture must have no side
   effect on that ordering. pg is lazy for a smaller reason: notifguard and twoperson
   deliberately require it inside a try so they can degrade where it is absent, and a
   top-level require here would have taken that away. */
let _auth = null;
const authMod = () => (_auth || (_auth = require(ROOT + '/auth')));

const DEFAULT_DB = 'postgres://atwe:atwe@localhost:5432/atwescore';
const dbUrl = () => process.env.DATABASE_URL || DEFAULT_DB;
/* The app under test. PORT is honoured because several probes compute their own base
   as `PORT || 3262` - if this helper ignored it, it would ask a different server than
   the probe is driving and its answer would mean nothing. */
const base = () => process.env.BASE || 'http://localhost:' + (process.env.PORT || 3262);
const newPool = () => new (require(ROOT + '/node_modules/pg').Pool)({ connectionString: dbUrl(), ssl: false });

/* A ready-to-use account in the SAME database the server is using, plus its token. */
async function seedAccount(pool, opts = {}) {
  const { business = false, admin = false, onboarded = true, balanceCents = 0, prefix = 'qa' } = opts;
  const email = crypto.randomUUID().slice(0, 8) + '@t.local';
  const username = prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 9);
  const auth = authMod();
  const hash = await auth.hashPassword('x'.repeat(12));
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, username, email_verified, onboarded, account_type, is_admin, balance_cents)
     VALUES ('QA', $1, $2, $3, true, $4, $5, $6, $7) RETURNING id`,
    [email, hash, username, onboarded, business ? 'business' : 'personal', admin, balanceCents]
  );
  const id = rows[0].id;
  const token = auth.signToken({ id, email, is_admin: admin });
  await pool.query(
    "INSERT INTO auth_sessions (token_hash, user_id, user_agent, ip) VALUES ($1, $2, 'qa', '1.1.1.1')",
    [crypto.createHash('sha256').update(token).digest('hex'), id]
  );
  return { id, email, username, token };
}

/* Does the SERVER agree this token has a session? This is the check that turns a
   database mismatch into a named failure instead of an empty screen. */
async function serverSees(token) {
  const r = await fetch(base() + '/api/auth/me', { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) return { ok: false, status: r.status };
  const j = await r.json().catch(() => ({}));
  return { ok: true, user: j.user || null };
}

/* THE INVARIANT, as one call a probe can make without giving up its own sign-in.
 *
 * Most probes seed their own account and then drive the page themselves - per theme,
 * per width, with their own wait, sometimes in a loop. Handing all of that to signIn()
 * would change what they measure. What they were ALL missing is the one question that
 * separates "the product is broken" from "the probe and the server are on different
 * databases": does the server know this session? Call this straight after minting it.
 *
 * `username` is optional and is worth passing: it proves the server resolved the token
 * to the account this probe just seeded, not merely to some account. */
async function assertServerSees(token, username) {
  const seen = await serverSees(token);
  const wrongUser = username && seen.ok && seen.user && seen.user.username !== username;
  if (!seen.ok || !seen.user || wrongUser) {
    throw new Error(
      'FIXTURE NOT VISIBLE TO THE SERVER: seeded' + (username ? ' @' + username : '') + ' into ' + dbUrl() +
      ' but ' + base() + '/api/auth/me answered ' + (seen.status || JSON.stringify(seen.user)) +
      '. The probe and the server are almost certainly on different databases - set DATABASE_URL ' +
      'to the one the server was started with.'
    );
  }
  return seen.user;
}

/* Sign the page in and PROVE it: the server must know the session, and the app must
   boot past the login gate. Throws with the likely cause named. */
async function signIn(page, account, { waitMs = 5200 } = {}) {
  await assertServerSees(account.token, account.username);
  await page.goto(base(), { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => {
    localStorage.clear();
    localStorage.setItem('atwe_token', t);
    localStorage.setItem('atwe_intro_seen', JSON.stringify(['beam', 'circles', 'ai', 'wallet']));
  }, account.token);
  await page.goto(base(), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(waitMs);
  // The app must really be past the gate. An empty surface measured while signed out
  // is the exact failure this helper exists to stop.
  const boot = await page.evaluate(() => {
    const login = document.getElementById('loginOverlay');
    const ob = document.getElementById('onboardingFlow');
    return {
      loginUp: !!login && !login.classList.contains('hidden'),
      obUp: !!ob && !ob.classList.contains('hidden'),
    };
  });
  if (boot.loginUp) throw new Error('the app booted to the LOGIN GATE as @' + account.username + ' - the session was not accepted');
  return boot;
}

/* Bounded, condition-based wait on something in the page. */
async function waitUntil(page, fn, arg, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await page.evaluate(fn, arg)) return true;
    if (Date.now() > end) return false;
    await page.waitForTimeout(150);
  }
}

module.exports = { dbUrl, base, newPool, seedAccount, serverSees, assertServerSees, signIn, waitUntil, DEFAULT_DB };
