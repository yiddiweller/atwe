/* ADMIN -> BETA ACCESS. The service layer behind the dashboard screen.
 *
 * WHY THIS FILE EXISTS RATHER THAN LOGIC IN ROUTE HANDLERS. The same rules have
 * to hold whether somebody types `node tools/seed-beta.js add-account` on a
 * console or presses a button in the dashboard, and the only way two doors stay
 * in step is if they walk through the same room. So the decisions live here and
 * in seed/beta-account.js; the routes in server.js are a thin skin over them.
 *
 * NOTHING HERE HASHES, PRINTS, LOGS OR RETURNS A PASSWORD. A caller hashes with
 * auth.hashPassword and passes the hash, exactly as the CLI does, so no code
 * path in this file can leak one by accident. `safeAccount` below is the ONLY
 * shape that ever leaves this module, and it names every field explicitly --
 * a `SELECT *` here would one day ship a credential column nobody meant to.
 *
 * THREE THINGS IT REFUSES TO DO, and they are the point:
 *   1. run anywhere but a beta environment (envState, below),
 *   2. touch an account beta tooling did not create,
 *   3. grant anybody staff access.
 */
'use strict';

const path = require('path');
const guard = require(path.join(__dirname, 'tools', 'seed-guard.js'));
const account = require(path.join(__dirname, 'seed', 'beta-account.js'));

/* ---- 1. AM I ALLOWED TO BE HERE AT ALL? -------------------------------- */

/* Deliberately `checkEnvironment` and NOT the seeder's full report.
 *
 * `checkEnvironment` answers "is this the beta deployment?" -- ATWE_ENV is
 * exactly "beta", APP_URL is a beta host rather than a production one, the
 * database is not production, and Railway does not say otherwise. That is the
 * question this screen has to pass, and it is the same function the CLI gates
 * on, so the two can never disagree about what "beta" means.
 *
 * `checkIntegrations` answers a DIFFERENT question -- "can anything here reach
 * the real world?" -- and it is right for the seeder, which builds a hundred
 * accounts and a world of content. It is the wrong gate for this screen, and
 * saying so is more honest than quietly inheriting it: creating one account
 * sends no mail (the row is written email_verified already), and joining the
 * test world writes follows, DMs and notification ROWS with no push and no
 * mail. So a configured SMTP key is a thing to SHOW a staffer, not a reason to
 * refuse them a password reset. It is reported by `integrationState` and
 * rendered on the page.
 */
function envState(env) {
  const e = guard.checkEnvironment(env || process.env);
  return { ok: e.ok, failures: e.failures, info: e.info };
}

function isBeta(env) { return envState(env).ok; }

/* Informational only. Never blocks anything in this file. */
function integrationState(env) {
  const i = guard.checkIntegrations(env || process.env);
  return { seen: i.seen, blockers: i.blockers, warnings: i.warnings };
}

/* The error every route raises when the environment is wrong. Worded for the
   person reading it, and it never names a credential or a host. */
function envRefusal(state) {
  return {
    error: 'Beta Access only works on the beta environment.',
    detail: (state && state.failures) || [],
  };
}

/* ---- 2. WHAT COUNTS AS A BETA-MANAGED ACCOUNT -------------------------- */

/* Two kinds, and nothing else is ever listed:
 *
 *   ORDINARY   seed_tag = 'beta'       -- created by beta tooling
 *   PROTECTED  seed_tag = 'beta-keep'  -- AND the exact canonical @atwe identity
 *
 * An untagged account in the beta database belongs to somebody else and is not
 * this screen's business. That is why the criteria are spelled out rather than
 * inferred: this must never quietly become a general users admin.
 *
 * The protected row is matched on the tag AND the handle. Its identity is then
 * verified separately (section 3) so an unrecognised row is SHOWN and clearly
 * marked rather than hidden -- a row that exists and carries the tag is a fact,
 * and hiding facts from an operations screen is how people get surprised. */
const TAG = account.TAG;                       // 'beta'
const KEEP_TAG = account.KEEP_TAG;             // 'beta-keep'
const OFFICIAL_USERNAME = account.OFFICIAL_USERNAME;

/* How `demo.immerseInDemo` itself decides somebody is already in the test world
   (it returns 0 and writes nothing at or above this many demo follows). Read
   the same number here so the badge on screen can never disagree with what the
   button will actually do. */
const IMMERSED_MIN = 20;

/* Every column this screen may read. No password_hash, no totp_secret, no
   totp_recovery, no stripe ids, no oauth id, no session or device token -- and
   naming them explicitly is what keeps a future column out by default. */
const ACCOUNT_COLS = `
  u.id, u.name, u.email, u.username, u.account_type, u.headline, u.bio,
  u.is_admin, u.admin_perms, u.admin_role, u.is_demo,
  u.verified, u.email_verified, u.status, u.status_reason, u.suspended_until,
  u.deactivated, u.totp_enabled, u.seed_tag, u.created_at,
  (SELECT COUNT(*)::int FROM follows f JOIN users du ON du.id = f.following_id
    WHERE f.follower_id = u.id AND du.is_demo = true) AS demo_follows`;

const OWNED_BY_BETA = `(u.seed_tag = $1 OR (u.seed_tag = $2 AND lower(u.username) = $3))`;
const OWNED_ARGS = [TAG, KEEP_TAG, OFFICIAL_USERNAME];

/* ---- 3. THE SHAPE THAT LEAVES THIS MODULE ------------------------------ */

/* `officialMismatch` is the app's own canonical identity test, reused verbatim
   rather than re-implemented, so the screen and `activate-official` agree about
   what the built-in account IS. A protected row that fails it keeps
   `protected: true` (it carries the tag) but loses `verified`, and every action
   refuses -- see assertManageable. */
function safeAccount(row) {
  if (!row) return null;
  const official = row.seed_tag === KEEP_TAG
    && String(row.username || '').toLowerCase() === OFFICIAL_USERNAME;
  const mismatch = official ? account.officialMismatch(row, OFFICIAL_USERNAME) : null;
  const perms = Array.isArray(row.admin_perms) ? row.admin_perms : [];
  const follows = row.demo_follows || 0;
  return {
    id: row.id,
    username: row.username || null,
    name: row.name || null,
    email: row.email || null,
    accountType: row.account_type === 'business' ? 'business' : 'personal',
    headline: row.headline || null,
    bio: row.bio || null,
    /* What the screen calls it, decided here rather than in the markup so the
       label and the rule behind it cannot drift apart. */
    betaStatus: official ? 'protected' : 'beta',
    betaLabel: official ? 'Protected beta account' : 'Beta account',
    official,
    /* Only meaningful for the official row: does it still match the identity
       the app itself creates? null for an ordinary beta account. */
    officialVerified: official ? mismatch === null : null,
    officialProblem: official ? mismatch : null,
    /* Access. `staff` is reported so the screen can SHOW it; nothing here ever
       sets it, and every write below refuses an account that carries it. */
    staff: row.is_admin === true || perms.length > 0,
    isAdmin: row.is_admin === true,
    adminRole: row.admin_role || null,
    adminPerms: perms,
    verified: row.verified === true,
    emailVerified: row.email_verified === true,
    twoFactor: row.totp_enabled === true,
    accountStatus: row.status || 'active',
    statusReason: row.status_reason || null,
    suspendedUntil: row.suspended_until || null,
    deactivated: row.deactivated === true,
    isDemo: row.is_demo === true,
    inTestWorld: follows >= IMMERSED_MIN,
    demoFollows: follows,
    createdAt: row.created_at || null,
  };
}

/* ---- 4. READS ---------------------------------------------------------- */

async function listAccounts(db) {
  const { rows } = await db.query(
    `SELECT ${ACCOUNT_COLS} FROM users u
      WHERE ${OWNED_BY_BETA}
      ORDER BY (u.seed_tag = $2) DESC, lower(u.username)`, OWNED_ARGS);
  return rows.map(safeAccount);
}

async function getAccount(db, id) {
  const n = parseInt(id, 10);
  if (!Number.isInteger(n)) return null;
  const { rows } = await db.query(
    `SELECT ${ACCOUNT_COLS} FROM users u
      WHERE u.id = $4 AND ${OWNED_BY_BETA}`, OWNED_ARGS.concat([n]));
  return rows[0] ? safeAccount(rows[0]) : null;
}

/* ---- 5. THE ONE GATE EVERY WRITE GOES THROUGH -------------------------- */

/* Returns the account, or throws a sentence a staffer can act on.
 *
 * `allow` says which kinds this particular action may touch:
 *   'ordinary'  -- a seed_tag='beta' account only
 *   'official'  -- the built-in @atwe only, and only when its identity verifies
 *   'any'       -- either
 *
 * NOTHING calls this with 'any' for a destructive action. Delete does not exist
 * in this module at all. */
async function assertManageable(db, id, allow) {
  const acct = await getAccount(db, id);
  if (!acct) {
    throw new Error('That account is not managed by beta tooling, so this screen will not touch it.');
  }
  if (acct.official) {
    if (allow === 'ordinary') {
      throw new Error('That is the official Atwe account. It is protected and has its own separate flow.');
    }
    if (!acct.officialVerified) {
      throw new Error(`@${OFFICIAL_USERNAME} no longer matches the account the app creates: ${acct.officialProblem} ` +
                      'Refusing every action on it until that is understood.');
    }
  } else if (allow === 'official') {
    throw new Error('That is not the official Atwe account.');
  }
  if (acct.staff) {
    throw new Error('That account carries staff access. Beta Access never changes a staff login.');
  }
  return acct;
}

/* ---- 6. WRITES --------------------------------------------------------- */

/* Create. A thin, honest wrapper: every refusal (duplicate username, duplicate
   email, a reserved handle) is createBetaAccount's own, so the CLI and this
   screen refuse for identical reasons in identical words.
 *
 * `role` is pinned to 'member' HERE rather than trusted from the caller. The
 * underlying function still accepts 'admin' because the CLI has a use for it;
 * this door does not, so it cannot be asked for through the dashboard at all.
 * A future "staff beta account" would be a new, separate, deliberate action --
 * not a field somebody can set on this form. */
async function createAccount(db, { identity, passwordHash } = {}) {
  const id = Object.assign({}, identity || {});
  delete id.role;
  const made = await account.createBetaAccount(db, {
    identity: Object.assign(id, { role: 'member' }),
    passwordHash,
    tag: TAG,
    claimReserved: false,          // a reserved handle is refused from here, always
  });
  return getAccount(db, made.id);
}

/* Reset a password. Two accounts, two completely separate paths, and that is
   deliberate: the official account gets the canonical-identity check that
   `activate-official` performs, an ordinary one gets the seed_tag ownership
   check, and neither is ever reached by the other's route. */
async function resetPassword(db, { id, passwordHash } = {}) {
  const acct = await assertManageable(db, id, 'any');
  if (acct.official) {
    /* Re-runs every identity check and re-asserts them inside its own UPDATE.
       It writes password_hash, email_verified and seed_tag = 'beta-keep' --
       the tag it already holds, so this can never move it onto the tag reset
       deletes. */
    const done = await account.activateOfficial(db, { passwordHash, username: OFFICIAL_USERNAME });
    return { id: done.id, username: done.username, official: true, seedTag: done.seedTag };
  }
  const done = await account.resetBetaPassword(db, { userId: acct.id, passwordHash, tag: TAG });
  return { id: done.id, username: done.username, official: false, seedTag: TAG };
}

/* Join the beta test world. Additive only, and idempotent: demo.immerseInDemo
   returns 0 without writing anything once the account already follows enough of
   the demo population. It never calls seedDemo, never recreates the discovery
   population, never creates shops or any commerce fixture. */
async function joinTestWorld(db, id) {
  /* ORDINARY ACCOUNTS ONLY, and that is a deliberate narrowing rather than an
     oversight. The screen offers the official @atwe exactly one action -- a beta
     password -- so the API offers it exactly one too. Making the platform's own
     voice follow forty sample accounts is not something anybody asked for, and
     an action the UI does not draw should not be reachable by hand either. */
  const acct = await assertManageable(db, id, 'ordinary');
  const before = acct.demoFollows;
  const r = await account.immerseAccount(db, acct.id);
  const after = await getAccount(db, acct.id);
  return {
    account: after,
    followedNow: r.followed || 0,
    alreadyIn: (r.followed || 0) === 0 && before >= IMMERSED_MIN,
    note: r.note,
  };
}

/* ---- 7. VALIDATION THE ROUTES BORROW ----------------------------------- */

/* Both are the seeder's own rules, re-exported rather than re-implemented, so
   server.js requires exactly one module for this feature and the dashboard can
   never be laxer than the console.

   `passwordProblem` is tools/seed-guard.js's: a minimum length and a refusal of
   the obvious openings. `identityProblemFor` is seed/beta-account.js's: it
   rejects a forbidden field (a password, a token, an is_admin) outright rather
   than ignoring it, so a hand-rolled request cannot smuggle one past the form. */
function passwordProblem(pw) { return guard.passwordProblem(pw); }
function identityProblemFor(identity) { return account.identityProblem(identity); }

module.exports = {
  TAG, KEEP_TAG, OFFICIAL_USERNAME, IMMERSED_MIN,
  passwordProblem, identityProblemFor,
  envState, isBeta, integrationState, envRefusal,
  safeAccount, listAccounts, getAccount, assertManageable,
  createAccount, resetPassword, joinTestWorld,
};
