/* ADD ONE BETA ACCOUNT. Reusable logic, no CLI.
 *
 * Deliberately free of prompts, argv, console output and process.exit, so the
 * same functions can back `tools/seed-beta.js add-account` today and an
 * Admin -> Beta Access screen later. Everything here takes a db handle and
 * plain values, returns plain objects, and throws an Error whose message is
 * safe to show a person.
 *
 * WHAT IT DOES NOT DO, and this is the point of the file existing separately
 * from the full seeder: it never calls seedDemo, never creates the discovery
 * population, never creates shops or global commerce fixtures, never deletes
 * anything, and never updates a row it did not just insert.
 *
 * A PASSWORD NEVER REACHES THIS FILE IN PLAINTEXT. The caller hashes it with
 * auth.hashPassword and passes the hash, so nothing here can log or store one
 * by accident.
 */
'use strict';

const path = require('path');
const guard = require(path.join(__dirname, '..', 'tools', 'seed-guard.js'));

const TAG = 'beta';

/* ---- 1. THE IDENTITY FILE -------------------------------------------- */

/* A credential never lives in a file. These names are refused outright rather
   than ignored, because silently dropping a "password" field would leave
   somebody believing they had set one. */
const FORBIDDEN_FIELDS = [
  'password', 'passwordHash', 'password_hash', 'pass', 'pwd',
  'secret', 'token', 'apiKey', 'api_key', 'accessToken', 'access_token',
  'refreshToken', 'refresh_token', 'sessionToken', 'session_token', 'session',
  'totp', 'totpSecret', 'totp_secret', 'totpRecovery', 'totp_recovery', 'mfa', '2fa',
  'stripeCustomerId', 'stripe_customer_id', 'stripeConnectId', 'stripe_connect_id',
  'stripeSubscriptionId', 'stripe_subscription_id',
  'oauth', 'oauthProvider', 'oauth_provider', 'oauthId', 'oauth_id',
  'isAdmin', 'is_admin', 'adminPerms', 'admin_perms', 'adminRole', 'admin_role',
  'pushToken', 'push_token', 'deviceToken', 'device_token', 'credentials',
];

/* Everything a beta identity file may carry. All of it is ordinary public
   profile text; none of it is a credential or a permission. */
const ALLOWED_FIELDS = [
  'email', 'username', 'name', 'headline', 'bio', 'accountType', 'role', 'categories',
  '_comment', '_note',
];

/* The app has exactly two account types (db.js: users.account_type, and every
   read in server.js is `=== 'business' ? 'business' : 'personal'`). A company
   IS a business account -- Atwe has no separate company page. */
const ACCOUNT_TYPES = ['personal', 'business'];
const ROLES = ['member', 'admin'];

function identityProblem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'the file must contain a JSON object';

  const keys = Object.keys(raw);
  const lower = new Map(keys.map((k) => [k.toLowerCase(), k]));
  for (const bad of FORBIDDEN_FIELDS) {
    const hit = lower.get(bad.toLowerCase());
    if (hit) {
      return `it contains a "${hit}" field. An identity file carries public profile text only. ` +
             'A password comes from BETA_SEED_PASSWORD or the prompt; a role is a flag, not a file field.';
    }
  }
  const unknown = keys.filter((k) => !ALLOWED_FIELDS.includes(k));
  if (unknown.length) {
    return `unknown field(s): ${unknown.join(', ')}. Allowed: ${ALLOWED_FIELDS.filter((f) => f[0] !== '_').join(', ')}.`;
  }

  if (!raw.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(raw.email))) return 'a valid "email" is required';
  if (!raw.username || !/^[a-z0-9_]{2,24}$/i.test(String(raw.username))) {
    return '"username" is required and must be 2-24 characters, letters/numbers/underscore only';
  }
  if (!raw.name || !String(raw.name).trim()) return 'a "name" is required';
  if (raw.accountType != null && !ACCOUNT_TYPES.includes(raw.accountType)) {
    return `"accountType" must be one of: ${ACCOUNT_TYPES.join(', ')}`;
  }
  if (raw.role != null && !ROLES.includes(raw.role)) return `"role" must be one of: ${ROLES.join(', ')}`;
  if (raw.categories != null && !Array.isArray(raw.categories)) return '"categories" must be an array of strings';
  return null;
}

function normalizeIdentity(raw) {
  const problem = identityProblem(raw);
  if (problem) throw new Error(problem);
  return {
    email: String(raw.email).trim().toLowerCase(),
    username: String(raw.username).trim().toLowerCase(),
    name: String(raw.name).trim(),
    headline: raw.headline ? String(raw.headline).trim() : null,
    bio: raw.bio ? String(raw.bio).trim() : null,
    accountType: raw.accountType || 'personal',
    role: raw.role || 'member',
    categories: Array.isArray(raw.categories) ? raw.categories.map(String).slice(0, 8) : null,
  };
}

/* ---- 2. WHAT IS ALREADY THERE ---------------------------------------- */

/* Case-insensitive, matching the app's own users_username_unique_idx on
   lower(username). Returns the existing row, or null. */
async function findByUsername(db, username) {
  const r = await db.query(
    `SELECT id, username, email, seed_tag, is_admin FROM users WHERE lower(username) = lower($1)`,
    [String(username || '')]);
  return r.rows[0] || null;
}

async function findByEmail(db, email) {
  const r = await db.query(
    `SELECT id, username, email, seed_tag FROM users WHERE lower(email) = lower($1)`,
    [String(email || '')]);
  return r.rows[0] || null;
}

/* THE ONE NORMALISATION, so nothing can disagree about what "the same address"
   means. Trim THEN lower, matching what `db.init()` already does to
   ADMIN_EMAIL (`(process.env.ADMIN_EMAIL || '').trim().toLowerCase()`). */
function normalizeEmail(v) { return String(v == null ? '' : v).trim().toLowerCase(); }

/* EVERY account that logically holds this address, minus one id.

   `findByEmail` above is NOT good enough for a collision check and this was
   proved against a real database rather than argued: it compares
   `lower(email) = lower($1)`, which catches CEO@ATWE.COM but NOT a stored
   "  ceo@atwe.com  ". Postgres' UNIQUE on a TEXT column compares raw bytes, so
   the padded value is a DIFFERENT key -- the constraint does not fire either,
   and both the check and the database wave it through. Two accounts then hold
   what every human and every lower()-based lookup in the app reads as one
   address.

   IT NARROWS IN SQL AND DECIDES IN JS, and that split is not fastidiousness --
   `lower(trim(email))` was written first and a padded row STILL got through,
   because POSTGRES' `trim()` STRIPS SPACES ONLY while JavaScript's `.trim()`
   strips every whitespace character. A value padded with a tab or a newline
   compared equal to nobody in SQL and equal to the target in JS, so the two
   sides of one check disagreed about what "the same address" means. Rather than
   chase Postgres and JavaScript into agreeing across Unicode, the ILIKE finds
   every row that CONTAINS the address in any case, and `normalizeEmail` -- the
   one normaliser, the same function the rest of this file uses -- says which of
   them really is it. A superstring like "xceo@atwe.comy" is found and then
   correctly rejected.

   It returns ALL matches rather than `rows[0]`. Taking the first row is its own
   hazard: with several colliding rows the one that comes back is arbitrary, and
   if it happened to be the caller's own row the check would pass and hand the
   decision straight back to the constraint this exists to not rely on.

   The ILIKE cannot use an index, so this is a sequential scan of `users`. That
   is the right trade: it runs once, from an operator's terminal, on a beta
   database, and being certain matters more than being quick. */
async function findEmailOwners(db, email, exceptId = null) {
  const target = normalizeEmail(email);
  if (!target) return [];
  const except = exceptId == null ? null : parseInt(exceptId, 10);
  /* The address is ours, but escape anyway: a `%` or `_` reaching a LIKE
     pattern is how a check quietly starts matching everything. */
  const like = `%${target.replace(/([\\%_])/g, '\\$1')}%`;
  const r = await db.query(
    `SELECT id, username, email, seed_tag FROM users
      WHERE email ILIKE $1 ESCAPE '\\'
      ORDER BY id`, [like]);
  return r.rows.filter((row) => normalizeEmail(row.email) === target
    && (except == null || row.id !== except));
}

/* Atwe LOCKS a list of names (routes.js SYSTEM_ROUTES, seeded into
   reserved_usernames on every boot) so nobody can register a name that would
   impersonate the company or shadow a route -- "atwe" is on that list. This
   tool inserts a row directly and therefore bypasses the app's own
   usernameReserved() gate, so it asks the question itself and REFUSES unless
   the caller says explicitly that this is the legitimate owner claiming it.
   The reservation row is deliberately LEFT IN PLACE: a name somebody already
   holds is unaffected by it, so the name stays locked against everyone else. */
async function reservationFor(db, username) {
  try {
    const r = await db.query(
      `SELECT username FROM reserved_usernames WHERE lower(username) = lower($1)`,
      [String(username || '')]);
    return r.rowCount > 0;
  } catch (e) {
    return false;   // table not bootstrapped yet: nothing is reserved
  }
}

/* ---- 3. CREATE ------------------------------------------------------- */

/* Every column is named explicitly, so everything NOT named here keeps its
   schema default: stripe_customer_id, stripe_connect_id, oauth_provider,
   totp_secret, totp_recovery, admin_perms, admin_role, push tokens and every
   other credential column stay NULL/empty. No production row is read, and
   nothing is copied from anywhere.

   `seed_tag` is written in the INSERT itself rather than by a later pass, so
   a crash can never leave an untagged account that reset cannot remove. */
async function createBetaAccount(db, { identity, passwordHash, tag = TAG, claimReserved = false } = {}) {
  const id = normalizeIdentity(identity);
  if (!passwordHash || typeof passwordHash !== 'string' || !passwordHash.startsWith('$2')) {
    throw new Error('createBetaAccount needs a bcrypt hash from auth.hashPassword');
  }

  const existingUser = await findByUsername(db, id.username);
  if (existingUser) {
    throw new Error(
      `@${id.username} already exists (id ${existingUser.id}, seed_tag ${existingUser.seed_tag || 'none'}). ` +
      'Refusing: this tool never overwrites, re-tags or re-passwords an account it did not create.');
  }
  const existingEmail = await findByEmail(db, id.email);
  if (existingEmail) {
    throw new Error(
      `${id.email} already belongs to @${existingEmail.username || existingEmail.id}. ` +
      'Refusing rather than touching that account.');
  }
  if (await reservationFor(db, id.username) && !claimReserved) {
    throw new Error(
      `"${id.username}" is a RESERVED username (routes.js SYSTEM_ROUTES -> reserved_usernames). ` +
      'Atwe locks it so nobody can impersonate the company or shadow a route. Creating it is a ' +
      'deliberate act by the legitimate owner: re-run with --claim-reserved. The reservation row ' +
      'is left in place, so the name stays locked against everyone else.');
  }

  const r = await db.query(
    `INSERT INTO users (name, email, password_hash, username, email_verified, dob,
                        headline, bio, account_type, categories,
                        is_admin, is_demo, seed_tag)
     VALUES ($1,$2,$3,$4,true,'1990-01-01',$5,$6,$7,$8::jsonb,$9,false,$10)
     RETURNING id`,
    [id.name, id.email, passwordHash, id.username, id.headline, id.bio,
     id.accountType, id.categories ? JSON.stringify(id.categories) : null,
     id.role === 'admin', tag]);

  return { id: r.rows[0].id, username: id.username, accountType: id.accountType, role: id.role };
}

/* ---- 4. JOIN THE WORLD THAT IS ALREADY THERE ------------------------- */

/* demo.js's immerseInDemo was audited line by line before being reused here.
   It makes FOUR writes and they are all additive rows belonging to, or
   addressed to, this one account:
       INSERT follows           (follower_id = the new account)
       INSERT at_messages       (recipient_id = the new account)
       INSERT notifications     (user_id     = the new account)
       INSERT at_group_members  (user_id     = the new account, existing group)
   There is NO UPDATE, NO DELETE, and no call to seedDemo -- so it cannot
   duplicate or mutate the global beta world, only attach somebody to it.
   Every row cascades away with the account, so reset stays complete.

   It needs the demo population to already exist; on an empty database it
   returns 0 and changes nothing. */
async function immerseAccount(db, userId) {
  const demo = require(path.join(__dirname, '..', 'demo'));
  const followed = await demo.immerseInDemo(db, userId);
  return { followed, note: 'follows + DMs + notifications + one group membership, all owned by this account' };
}

/* ---- 5. THE APP'S OWN BUILT-IN ACCOUNT ------------------------------- */

/* @atwe is NOT a seeded account and never was. server.js creates it itself
   (`ensureOfficialAccount`, called on every boot) so the platform can post as
   itself from day one, and @atwe is a RESERVED handle precisely so nobody else
   can ever hold it. Everything below is read out of that function rather than
   invented, so if the app's own definition changes this stops matching and
   refuses instead of guessing.

   WHY IT CANNOT BE SIGNED INTO AS CREATED: the account is made with a password
   of 48 random bytes that is hashed immediately and never shown to anybody.
   server.js says so in its own words -- "Nobody signs in as it ... so there is
   no shared login to leak." Staff post as it through an admin route instead.

   Giving it a login, and separately giving it superadmin, is therefore a REAL
   widening of that posture. It is a widening the founder now wants in BOTH
   environments -- beta first, production later by an explicit controlled step --
   so which environment may do what is a POLICY, stated once in section 5a, and
   not an assumption scattered through these checks. What never changes is that
   every action refuses any row it cannot positively identify as the account the
   app itself created. */

const OFFICIAL_USERNAME = (process.env.ATWE_OFFICIAL_USERNAME || 'atwe').toLowerCase();

/* NOT "beta". Reset deletes `WHERE seed_tag = 'beta'`, so tagging the app's own
   account that way would make a routine beta reset DELETE it -- and with it, by
   cascade, every post it had ever made. It would come back on the next boot with
   a fresh random password (breaking this login) and a different id, and until
   that boot the admin "post as Atwe" route would answer "no @atwe account
   exists". A distinct value records that beta tooling touched the row while
   being invisible to a predicate that tests for equality with "beta". */
const KEEP_TAG = 'beta-keep';

/* ---- 5-EMAIL. THE OFFICIAL ACCOUNT HAS TWO LEGITIMATE EMAILS ---------

   PRODUCT DECISION (16 Sep 2026, the founder): the ACTIVATED official account
   signs in as ceo@atwe.com, in both environments. The row is still CREATED by
   the app with an internal address, so a genuine @atwe is in one of exactly two
   states, and both are canonical:

     DORMANT    no-reply+atwe@atwe.internal   as `ensureOfficialAccount` writes it
     ACTIVATED  ceo@atwe.com                  after the transition in section 5c

   THIS IS AN ALLOWLIST OF TWO, NOT A LOOSENING. Every other address refuses
   exactly as it always did -- a real person's, a typo, a hijacked row. What
   changed is that the set has a second member, not that the check became a
   shrug. There is deliberately no pattern, no domain rule and no environment
   variable here: two exact strings, or no.

   IT IS A ONE-WAY DOOR, and the transition is what makes it one. Nothing in
   this tree ever writes the internal address, so a row cannot be walked
   backwards to re-acquire provenance it has already spent; `setOfficialEmail`
   only ever writes the activated address, and only over the dormant one.

   WHAT THE MOVE COSTS, said plainly rather than glossed. "@atwe.internal" is
   not a deliverable domain and signup demands a code that really arrives, so
   the dormant address was on its own proof that no person could hold the row.
   ceo@atwe.com is a real mailbox, so that particular proof is spent. What
   carries the weight afterwards is the rest of the set, and it is not thin:
   `users.email` is UNIQUE and `users` holds a unique index on lower(username),
   so exactly one row can ever be @atwe and exactly one row can ever hold that
   address; the app itself created it; and `officialMismatch` still demands the
   name, the business account type, no demo flag, no staff scopes, no
   two-factor, no Stripe or OAuth attachment, an active status and the beta
   keep-tag. The transition additionally refuses if any other account already
   holds ceo@atwe.com.

   Whoever controls that mailbox can start a password reset for @atwe. That is
   inherent in giving the account a real address at all; it is the founder's own
   company domain; and it is exactly why the address is a constant in this file
   rather than anything a caller, a flag or an identity file can supply. */

/* The activated login identity. Deliberately NOT derived from the username the
   way the dormant one is: it is a real mailbox on the company's own domain, not
   a pattern, and it must not move if ATWE_OFFICIAL_USERNAME ever does. */
const OFFICIAL_EMAIL_ACTIVATED = 'ceo@atwe.com';

/* The two, together. The dormant one is built the way server.js builds it. */
function officialEmails(username = OFFICIAL_USERNAME) {
  return {
    dormant: `no-reply+${String(username).toLowerCase()}@atwe.internal`,
    activated: OFFICIAL_EMAIL_ACTIVATED,
  };
}

/* Which state is this row's email in -- 'dormant', 'activated', or null for
   "neither, so this is not the official account". The ONE place the two
   addresses are compared, so nothing else can invent a third answer. */
function officialEmailState(email, username = OFFICIAL_USERNAME) {
  const e = normalizeEmail(email);
  const want = officialEmails(username);
  if (e === normalizeEmail(want.dormant)) return 'dormant';
  if (e === normalizeEmail(want.activated)) return 'activated';
  return null;
}

/* Exactly what `ensureOfficialAccount` writes, i.e. the DORMANT state. `.email`
   stays the created address on purpose: this function documents what the app
   itself produces, and test 19 reads it against server.js's own literal. The
   activated address is offered beside it rather than replacing it. */
function officialIdentity(username = OFFICIAL_USERNAME) {
  return {
    username,
    email: `no-reply+${username}@atwe.internal`,
    emailActivated: OFFICIAL_EMAIL_ACTIVATED,
    emails: officialEmails(username),
    name: 'Atwe',
    accountType: 'business',
    headline: 'Product news and tips from Atwe',
  };
}

/* ---- 5a. THE OFFICIAL-ACCOUNT ACCESS POLICY ---------------------------

   PRODUCT DECISION (16 Sep 2026, the founder): the built-in @atwe account is
   meant to have a real login and superadmin access in BOTH environments, not
   only beta. Beta is simply the one that is switched on first.

   So this is a POLICY WITH TWO LANES, not a beta-only escape hatch. Writing it
   as "beta may, production may never" would bake in an assumption the founder
   has explicitly retired, and the production lane would then have to be
   invented under time pressure on the day it is wanted.

   Each lane answers two separate questions, because they are separate powers:

     allowLogin   may @atwe be given a password somebody can sign in with?
     allowAdmin   may @atwe hold superadmin (is_admin) at the same time?

   TODAY, and this is the whole of what ships: beta allows both, production
   allows neither. Production therefore behaves EXACTLY as it always has, and
   `PRODUCTION` below is the one line a later, deliberate production activation
   changes.

   PRODUCTION NEEDS TWO INDEPENDENT KEYS, and that is the point of the shape.
   Flipping the table is a code change: reviewed, committed, and shipped through
   main like anything else. It is still not enough on its own -- the deployment
   must ALSO carry the approval phrase below. So a stray environment variable
   cannot open production, and neither can a careless merge; it takes both, by
   two different people's actions, in two different places.

   WHAT IS NOT IN HERE. Nothing about which HUMAN accounts may be staff:
   @yiddiweller or anybody else becomes a superadmin through the dashboard's own
   Staff tab, in either environment, exactly as they always have. This file is
   only ever about the app's own built-in @atwe row, which no signup can create
   and no ordinary tool may touch. */

/* The two lanes. `beta` is live; `production` is the future, switched off. */
const OFFICIAL_ACCESS = {
  beta:       { allowLogin: true,  allowAdmin: true  },
  /* PRODUCTION ACTIVATION CHANGES THESE TWO VALUES AND NOTHING ELSE. Until
     then, every production answer below is false whatever the environment says,
     which is what makes "production is unchanged today" a fact rather than a
     promise -- and it is asserted that way in test/beta-official-admin.test.js,
     including with the approval phrase deliberately present. */
  production: { allowLogin: false, allowAdmin: false },
};

/* The second key. Deliberately a phrase rather than a truthy flag: nothing sets
   a variable to this by accident, and it reads as a decision in a deploy log. */
const PROD_ACTIVATION_PHRASE = 'activate-official-account';

/* Which lane is this, and what does it permit?

   "Beta" is `checkEnvironment` -- the SAME function the Beta Access routes and
   the whole seed CLI gate on, which demands ATWE_ENV exactly "beta", a beta
   APP_URL host, a database that is not production, and a Railway environment
   that does not say otherwise. Re-deriving a looser test here would let the two
   disagree about what beta means, which is the one thing this file exists to
   prevent. Anything that is not provably beta is treated as production, so an
   unrecognised or half-configured box gets the STRICTER lane, never the looser
   one. */
function officialAccessPolicy(env) {
  const e = env || process.env;
  if (guard.checkEnvironment(e).ok) {
    return Object.assign({ environment: 'beta', approved: true }, OFFICIAL_ACCESS.beta);
  }
  const approved = String(e.ATWE_OFFICIAL_PROD_ACTIVATION || '').trim() === PROD_ACTIVATION_PHRASE;
  const lane = OFFICIAL_ACCESS.production;
  return {
    environment: 'production',
    approved,
    /* BOTH keys, always. Neither alone opens anything. */
    allowLogin: lane.allowLogin === true && approved,
    allowAdmin: lane.allowAdmin === true && approved,
  };
}

/* Thin readers, so a call site says what it is asking about. */
function officialAdminAllowed(env) { return officialAccessPolicy(env).allowAdmin === true; }
function officialLoginAllowed(env) { return officialAccessPolicy(env).allowLogin === true; }

/* The gate every action that GRANTS one of these powers must pass through, so a
   new command cannot quietly skip the policy. `what` is 'login' or 'admin'. */
function assertOfficialAccessAllowed(env, what) {
  const p = officialAccessPolicy(env);
  const ok = what === 'admin' ? p.allowAdmin : p.allowLogin;
  if (ok) return p;
  const power = what === 'admin' ? 'superadmin access' : 'a sign-in password';
  if (p.environment === 'beta') {
    throw new Error(`giving @${OFFICIAL_USERNAME} ${power} is not permitted on this beta environment.`);
  }
  throw new Error(
    `giving @${OFFICIAL_USERNAME} ${power} is not switched on for production yet, so nothing was changed. ` +
    'It takes two separate, deliberate steps: the production lane in ' +
    'seed/beta-account.js OFFICIAL_ACCESS must be turned on and shipped, AND the deployment must carry ' +
    `ATWE_OFFICIAL_PROD_ACTIVATION="${PROD_ACTIVATION_PHRASE}". Neither one alone does anything.`);
}

/* Returns a plain-English reason to REFUSE, or null when this row is provably
   the account server.js made. Split into two kinds of check on purpose.

   PROVENANCE -- things a human signup could not have produced, so matching them
   proves where the row came from. The email must be one of the two canonical
   addresses in section 5-EMAIL and nothing else. While it is the DORMANT one it
   is the strongest single signal there is, because "@atwe.internal" is not a
   deliverable domain and signup demands a code that really arrives, so no
   person could hold it. Once it is the ACTIVATED one that particular proof is
   spent and the weight sits on the rest of this function plus the two unique
   indexes; section 5-EMAIL sets out that trade in full.

   SAFETY -- this hands somebody a working password, so it also refuses any row
   that would make that password more powerful than an ordinary member's, or
   that is not in a state where a plain login is the whole story.

   Deliberately NOT required: `headline` and `verified`. Those are editable
   product copy and a badge; staff changing either does not make the row a
   different account, and refusing over them would be a false alarm on the real
   one. They are reported instead. */
function officialMismatch(row, username = OFFICIAL_USERNAME, opts = {}) {
  const want = officialIdentity(username);
  if (!row) return `no @${username} account exists in this database`;

  const s = (v) => String(v == null ? '' : v).trim().toLowerCase();
  if (s(row.username) !== want.username) return `its username is "${row.username}", not "${want.username}"`;
  /* TWO legitimate addresses and nothing else -- section 5-EMAIL. The message
     names both, so a person reading a refusal can tell "this row was never
     ours" apart from "somebody moved the address by hand". */
  if (officialEmailState(row.email, username) === null) {
    const em = officialEmails(username);
    return `its email is "${row.email}", but the built-in account holds either "${em.dormant}" ` +
           `(as the app creates it) or "${em.activated}" (once activated). ` +
           'Refusing: this row was not made by the app itself, or its address was changed by ' +
           'something other than the official email transition.';
  }
  if (s(row.name) !== want.name.toLowerCase()) return `its name is "${row.name}", not "${want.name}"`;
  if (s(row.account_type) !== want.accountType) return `its account type is "${row.account_type}", not "${want.accountType}"`;
  if (row.is_demo === true) return 'it is flagged is_demo, so it is seeded sample data rather than the built-in account';

  /* The ONE thing the access policy can relax, and only when the caller has
     asked the policy and been told yes. Left alone it is the original refusal,
     so every caller that does not opt in gets the stricter answer. */
  if (row.is_admin === true && opts.allowAdmin !== true) {
    return 'it carries ADMIN rights, and superadmin is not permitted for the official account in this environment. ' +
           'Refusing: an action that hands out a password will not hand out a staff login it was not told to expect.';
  }
  /* Scopes are refused in EVERY environment. `is_admin` alone is this app's
     superadmin model; a scoped staffer is a separate, weaker thing that the
     protected account is not and was never asked to be. */
  const perms = Array.isArray(row.admin_perms) ? row.admin_perms : [];
  if (perms.length) return `it carries staff scopes (${perms.join(', ')}). Refusing for the same reason as admin.`;
  if (row.totp_enabled === true) return 'it has two-factor enabled, so a password alone would not sign in. Refusing rather than disabling it.';
  if (row.status && s(row.status) !== 'active') return `its status is "${row.status}", not active`;
  if (row.deactivated === true) return 'it is deactivated (hibernated)';
  for (const [col, what] of [['stripe_customer_id', 'a Stripe customer'], ['stripe_connect_id', 'a Stripe Connect account'],
                             ['oauth_provider', 'a linked sign-in provider']]) {
    if (row[col]) return `it has ${what} attached, which the built-in account never does`;
  }
  if (row.seed_tag != null && s(row.seed_tag) !== KEEP_TAG) {
    return `it is tagged seed_tag "${row.seed_tag}". The built-in account is untagged; a tagged row is seeded data.`;
  }
  return null;
}

/* Every column the checks above read, so a caller cannot accidentally judge the
   row on a partial SELECT. Also returns how MANY rows hold the handle: more than
   one would mean the unique index is gone and nothing here should be trusted. */
async function findOfficial(db, username = OFFICIAL_USERNAME) {
  const r = await db.query(
    `SELECT id, name, email, username, account_type, is_demo, is_admin, admin_perms, admin_role,
            verified, email_verified, headline, status, deactivated, totp_enabled,
            stripe_customer_id, stripe_connect_id, oauth_provider, seed_tag, created_at
       FROM users WHERE lower(username) = $1`, [String(username).toLowerCase()]);
  return { row: r.rows[0] || null, count: r.rowCount };
}

/* Gives the app's own account a password somebody can sign in with, in beta.

   It writes THREE columns and no others: the hash, `email_verified` (needed only
   where REQUIRE_EMAIL_VERIFICATION is on, and already true on a real built-in
   row), and the keep-tag. Username, email, name, account type, the verified
   seal, the headline, every admin column and every external credential are left
   exactly as they are -- so this can neither rename the account nor promote it.

   The identity is re-asserted inside the UPDATE's own WHERE, not merely checked
   beforehand, so if anything changed the row between the check and the write it
   affects zero rows and reports that instead of writing to a row it never
   inspected. */
async function activateOfficial(db, { passwordHash, username = OFFICIAL_USERNAME, allowAdmin = false } = {}) {
  if (!passwordHash || typeof passwordHash !== 'string' || !passwordHash.startsWith('$2')) {
    throw new Error('activateOfficial needs a bcrypt hash from auth.hashPassword');
  }
  const uname = String(username).toLowerCase();
  const { row, count } = await findOfficial(db, uname);
  if (count > 1) throw new Error(`${count} accounts hold @${uname}. Refusing to touch any of them.`);
  const problem = officialMismatch(row, uname, { allowAdmin: allowAdmin === true });
  if (problem) throw new Error(`@${uname} is not the built-in Atwe account: ${problem}`);

  /* `is_admin IS NOT DISTINCT FROM $6` re-asserts the row's OWN admin state
     rather than demanding a fixed one, which is strictly stronger than the
     hardcoded `IS NOT TRUE` it replaces: if anything promotes or demotes the
     account between the check above and this write, the statement affects zero
     rows and says so instead of writing to a row it never inspected. Off beta
     `officialMismatch` has already refused an admin row, so $6 is false there,
     and since `users.is_admin` is BOOLEAN NOT NULL DEFAULT false (db.js) that
     is EXACTLY equivalent to the `IS NOT TRUE` this replaced -- the equivalence
     depends on the NOT NULL, so check it before relaxing that column. It also writes NO admin column,
     so this can still neither promote nor demote anybody.

     `lower(email) = $5` re-asserts the row's OWN address for the same reason,
     and since section 5-EMAIL it has to: there are now TWO canonical addresses,
     so naming a fixed one here would make this refuse the account the moment it
     moved to its activated email. `officialMismatch` has already proved the
     value is one of the two, so this narrows the write to the row that was
     actually inspected rather than widening anything. */
  const r = await db.query(
    `UPDATE users
        SET password_hash = $1, email_verified = true, seed_tag = $2
      WHERE id = $3
        AND lower(username) = $4
        AND lower(trim(email)) = $5
        AND account_type    = 'business'
        AND is_demo  IS NOT TRUE
        AND is_admin IS NOT DISTINCT FROM $6
      RETURNING id, username`,
    [passwordHash, KEEP_TAG, row.id, uname, normalizeEmail(row.email), row.is_admin === true]);
  if (!r.rowCount) throw new Error('the account changed while this was running. Nothing was written.');
  return {
    id: r.rows[0].id, username: r.rows[0].username, seedTag: KEEP_TAG,
    wasTagged: row.seed_tag != null, isAdmin: row.is_admin === true,
  };
}

/* ---- 5b. PROMOTE THE BUILT-IN ACCOUNT, BETA ONLY ---------------------

   The ONE action that grants staff access anywhere in beta tooling, and it is
   deliberately shaped so it can do nothing else:

     * it takes no username from a caller that matters -- it resolves @atwe
       itself and refuses any row that is not provably that account,
     * it requires `allowAdmin`, which only `officialAdminAllowed(env)` returns
       true for, i.e. a real beta environment,
     * it requires seed_tag `beta-keep`, so beta tooling must already own this
       row (activate-official runs first). An account nobody can sign into has
       no use for staff access,
     * it writes ONE column, `is_admin`. No admin_perms, no admin_role: in this
       app `is_admin` alone IS superadmin (auth.requireAdmin re-reads exactly
       that column and never consults scopes), so inventing more would widen the
       change without widening what it buys,
     * and the WHERE re-asserts the whole identity -- including the row's own
       already-validated email, so promoting still works after the account has
       moved to ceo@atwe.com -- so a row that changed underneath is missed
       rather than promoted.

   There is no matching "promote anybody" helper and there must never be one:
   ordinary staff access is granted through the dashboard's own Staff tab. */
async function promoteOfficialAdmin(db, { username = OFFICIAL_USERNAME, env = null } = {}) {
  /* The policy decides, not the caller: there is no flag a call site can pass
     to skip this, which is what stops a future command from re-deciding it. */
  assertOfficialAccessAllowed(env || process.env, 'admin');
  const uname = String(username).toLowerCase();
  const { row, count } = await findOfficial(db, uname);
  if (count > 1) throw new Error(`${count} accounts hold @${uname}. Refusing to touch any of them.`);
  const problem = officialMismatch(row, uname, { allowAdmin: true });
  if (problem) throw new Error(`@${uname} is not the built-in Atwe account: ${problem}`);
  if (row.seed_tag !== KEEP_TAG) {
    throw new Error(`@${uname} is not yet a protected beta account (seed_tag is ${row.seed_tag == null ? 'unset' : `"${row.seed_tag}"`}, ` +
                    `not "${KEEP_TAG}"). Run activate-official first so it has a beta password, then promote it.`);
  }
  if (row.is_admin === true) return { id: row.id, username: row.username, seedTag: KEEP_TAG, already: true };

  const r = await db.query(
    `UPDATE users
        SET is_admin = true
      WHERE id = $1
        AND lower(username) = $2
        AND lower(trim(email)) = $3
        AND account_type    = 'business'
        AND seed_tag        = $4
        AND is_demo  IS NOT TRUE
        AND is_admin IS NOT TRUE
        AND jsonb_array_length(COALESCE(admin_perms, '[]'::jsonb)) = 0
      RETURNING id, username`,
    [row.id, uname, normalizeEmail(row.email), KEEP_TAG]);
  if (!r.rowCount) throw new Error('the account changed while this was running. Nothing was written.');
  return { id: r.rows[0].id, username: r.rows[0].username, seedTag: KEEP_TAG, already: false };
}

/* ---- 5c. MOVE THE BUILT-IN ACCOUNT TO ITS ACTIVATED LOGIN EMAIL ------

   The founder's final identity model (16 Sep 2026) is that @atwe signs in as
   ceo@atwe.com. The app still CREATES the row with an internal address, so
   something has to carry it across, and that something is deliberately one
   narrow operation rather than a relaxed check somewhere.

   ONE ACCOUNT, ONE DIRECTION, ONE COLUMN.

     * ONE ACCOUNT. It resolves @atwe itself; the CLI passes no username, and a
       row that is not provably the built-in account is refused by the same
       `officialMismatch` every other official action uses.
     * ONE DIRECTION. It writes only the ACTIVATED address, and only over the
       DORMANT one. Being handed the activated address already is a no-op that
       writes nothing, so re-running it is safe. Nothing anywhere writes the
       internal address back.
     * ONE COLUMN, `email`. Not the password, not `seed_tag`, not the account
       type, not one admin column, not the verified seal, not the headline. The
       WHERE re-asserts every one of those, so a row that changed underneath is
       missed rather than written to.

   IT IS THE `login` POWER, NOT A NEW ONE. The activated address IS the login
   identity, so it goes through `assertOfficialAccessAllowed(env, 'login')` --
   the same gate `activate-official` passes. Beta permits it today; production's
   lane is shut, so the identical command against production changes nothing and
   says why. No third policy, no separate switch to remember.

   `email_verified` IS DELIBERATELY LEFT ALONE, and the reason is worth stating
   because the app's own change-email route does the opposite. That route serves
   a MEMBER moving to an address they must prove they control, so it clears the
   flag and mails a link. This is an OPERATOR moving the company's own account
   to the company's own domain, from a CLI that already required a beta
   deployment, the canonical identity and the keep-tag. Clearing the flag here
   would buy no proof at all -- there is no inbox in this loop -- and on a
   deployment with REQUIRE_EMAIL_VERIFICATION it would lock the account out of
   the login this whole exercise exists to give it. The honest reading is that
   the column was never a proof for this row: `ensureOfficialAccount` writes it
   true at creation for an address that can never receive anything.

   THE ADDRESS MUST BE FREE. `users.email` is UNIQUE, so a duplicate would fail
   the UPDATE anyway -- the explicit check is what turns a constraint violation
   into a sentence naming who holds it. The unique violation is still caught, in
   case somebody claims the address between the check and the write. */
async function setOfficialEmail(db, { username = OFFICIAL_USERNAME, env = null,
                                    allowAdminEmailMatch = false } = {}) {
  const e = env || process.env;
  assertOfficialAccessAllowed(e, 'login');

  const uname = String(username).toLowerCase();
  const { row, count } = await findOfficial(db, uname);
  if (count > 1) throw new Error(`${count} accounts hold @${uname}. Refusing to touch any of them.`);

  /* The full canonical test, relaxed in exactly one place and only where the
     policy says so: an already-promoted @atwe must not be refused here, or the
     address could never be moved after a promotion. Everything else -- the
     name, the type, the demo flag, staff scopes, two-factor, status, Stripe,
     OAuth, the tag -- refuses exactly as it always has. */
  const problem = officialMismatch(row, uname, { allowAdmin: officialAdminAllowed(e) });
  if (problem) throw new Error(`@${uname} is not the built-in Atwe account: ${problem}`);

  /* Beta tooling must already own this row. A dormant @atwe nobody can sign
     into has no use for a login address, and moving it would spend the
     strongest provenance signal there is for nothing. */
  if (row.seed_tag !== KEEP_TAG) {
    throw new Error(`@${uname} is not yet a protected beta account (seed_tag is ` +
      `${row.seed_tag == null ? 'unset' : `"${row.seed_tag}"`}, not "${KEEP_TAG}"). ` +
      'Run activate-official first so it has a beta password, then move its email.');
  }

  const want = officialEmails(uname);
  const state = officialEmailState(row.email, uname);
  if (state === 'activated') {
    return {
      id: row.id, username: row.username, email: row.email,
      from: row.email, to: want.activated, already: true, isAdmin: row.is_admin === true,
    };
  }
  /* `officialMismatch` has already refused anything that is neither state, so
     this can only be 'dormant'. Asserted rather than assumed, because a silent
     fall-through here would be an unguarded write. */
  if (state !== 'dormant') {
    throw new Error(`@${uname} holds "${row.email}", which is neither canonical address. Nothing was written.`);
  }

  /* NOBODY ELSE MAY HOLD THIS ADDRESS, case- and whitespace-insensitively, and
     this check must stand on its own rather than leaning on the UNIQUE index --
     see `findEmailOwners`, where the reason is a real hole proved against a real
     database. It reports EVERY holder, so a tidy-up is done once rather than
     discovered one row at a time. */
  const owners = await findEmailOwners(db, want.activated, row.id);
  if (owners.length) {
    const who = owners.map((o) => `@${o.username || `account ${o.id}`} ("${o.email}")`).join(', ');
    throw new Error(`${want.activated} already belongs to ${who}. ` +
      'Refusing: this never takes an address off another account, and it treats ' +
      'differences of case or surrounding space as the same address. Free it first, then run this again.');
  }

  /* ADMIN_EMAIL IS A THIRD, SILENT DOOR ONTO SUPERADMIN, and this transition is
     what could open it. `db.init()` runs
     `UPDATE users SET is_admin = true WHERE lower(email) = <ADMIN_EMAIL>` on
     EVERY boot, so moving @atwe onto an address that matches it would promote
     the account on the next restart -- bypassing promoteOfficialAdmin and every
     check inside it, without anybody deciding to.

     Refused rather than warned, because the promotion would happen later, on a
     restart nobody is watching. The comparison is trim+lower on both sides,
     which is a SUPERSET of what db.init() does (it trims only its own side), so
     this refuses in every case that would really promote and in a few that
     would not -- the conservative direction.

     `allowAdminEmailMatch` exists for an operator who genuinely wants the boot
     promotion to be the admin path. It has no default, is never inferred, and
     the CLI only sets it from a spelled-out flag. */
  const adminEmail = normalizeEmail(e.ADMIN_EMAIL);
  if (adminEmail && adminEmail === normalizeEmail(want.activated) && allowAdminEmailMatch !== true) {
    throw new Error(
      `this environment's ADMIN_EMAIL is "${e.ADMIN_EMAIL}", which is the same address @${uname} ` +
      `would move to. db.init() promotes whatever account holds ADMIN_EMAIL to superadmin on every ` +
      `boot, so this move would grant @${uname} staff access at the next restart on its own. ` +
      'Refusing. Point ADMIN_EMAIL at a person\'s own address instead, then run this again, and ' +
      'grant staff access deliberately with "node tools/seed-beta.js promote-official-admin".');
  }

  let r;
  try {
    r = await db.query(
      `UPDATE users
          SET email = $1
        WHERE id = $2
          AND lower(username) = $3
          AND lower(trim(email)) = $4
          AND account_type    = 'business'
          AND seed_tag        = $5
          AND is_demo  IS NOT TRUE
          AND is_admin IS NOT DISTINCT FROM $6
        RETURNING id, username, email`,
      [normalizeEmail(want.activated), row.id, uname, normalizeEmail(want.dormant),
       KEEP_TAG, row.is_admin === true]);
  } catch (err) {
    if (err && err.code === '23505') {
      throw new Error(`${want.activated} was claimed by another account while this was running. Nothing was written.`);
    }
    throw err;
  }
  if (!r.rowCount) throw new Error('the account changed while this was running. Nothing was written.');
  return {
    id: r.rows[0].id, username: r.rows[0].username, email: r.rows[0].email,
    from: want.dormant, to: want.activated, already: false, isAdmin: row.is_admin === true,
  };
}

/* ---- 6. RESET AN ORDINARY BETA ACCOUNT'S PASSWORD -------------------- */

/* The admin-side counterpart to createBetaAccount, and deliberately the same
   shape: one guarded UPDATE, three refusals, nothing else touched.

   OWNERSHIP IS RE-ASSERTED INSIDE THE UPDATE'S OWN WHERE rather than merely
   checked beforehand, exactly as activateOfficial does. If anything changed the
   row between the check and the write, the statement affects zero rows and says
   so, instead of writing to a row it never inspected.

   `seed_tag = 'beta'` is the whole ownership test and it is what keeps this
   away from two kinds of account at once: a real member (untagged) and the
   app's own @atwe (tagged "beta-keep"). The admin and staff-scope clauses are
   belt and braces on top -- this hands somebody a working password, so it will
   never hand out one that carries staff access, whatever the row says.

   ONE COLUMN IS WRITTEN. Not the username, not the email, not the tag, not the
   verified seal, not a single admin or credential column. */
async function resetBetaPassword(db, { userId, passwordHash, tag = TAG } = {}) {
  if (!passwordHash || typeof passwordHash !== 'string' || !passwordHash.startsWith('$2')) {
    throw new Error('resetBetaPassword needs a bcrypt hash from auth.hashPassword');
  }
  const id = parseInt(userId, 10);
  if (!Number.isInteger(id)) throw new Error('resetBetaPassword needs a numeric account id');

  const found = await db.query(
    `SELECT id, username, seed_tag, is_admin, admin_perms FROM users WHERE id = $1`, [id]);
  const row = found.rows[0];
  if (!row) throw new Error('that account no longer exists');
  if (row.seed_tag !== tag) {
    throw new Error(
      `@${row.username || row.id} was not created by beta tooling` +
      `${row.seed_tag === KEEP_TAG ? ' -- it is the app\'s own built-in account, which has its own separate flow' : ''}. ` +
      'Refusing: this only ever touches accounts beta tooling made.');
  }
  if (row.is_admin === true) throw new Error('that account carries admin rights, and this never re-passwords a staff login');

  const r = await db.query(
    `UPDATE users
        SET password_hash = $1
      WHERE id = $2
        AND seed_tag     = $3
        AND is_demo  IS NOT TRUE
        AND is_admin IS NOT TRUE
        AND jsonb_array_length(COALESCE(admin_perms, '[]'::jsonb)) = 0
      RETURNING id, username`,
    [passwordHash, id, tag]);
  if (!r.rowCount) throw new Error('the account changed while this was running. Nothing was written.');
  return { id: r.rows[0].id, username: r.rows[0].username };
}

module.exports = {
  TAG, FORBIDDEN_FIELDS, ALLOWED_FIELDS, ACCOUNT_TYPES, ROLES,
  identityProblem, normalizeIdentity,
  findByUsername, findByEmail, reservationFor,
  createBetaAccount, immerseAccount,
  OFFICIAL_USERNAME, KEEP_TAG, officialIdentity, officialMismatch,
  OFFICIAL_EMAIL_ACTIVATED, officialEmails, officialEmailState, setOfficialEmail,
  normalizeEmail, findEmailOwners,
  findOfficial, activateOfficial, resetBetaPassword,
  officialAccessPolicy, officialAdminAllowed, officialLoginAllowed,
  assertOfficialAccessAllowed, promoteOfficialAdmin,
  OFFICIAL_ACCESS, PROD_ACTIVATION_PHRASE,
};
