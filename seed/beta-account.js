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

   WHY IT CANNOT BE SIGNED INTO TODAY, and this is deliberate rather than an
   oversight: the account is created with a password of 48 random bytes that is
   hashed immediately and never shown to anybody. server.js says so in its own
   words -- "Nobody signs in as it ... so there is no shared login to leak."
   Staff post as it through an admin route instead. Activating a login for it is
   therefore a REAL, if small, widening of that posture, which is why this is
   beta-only, narrow, and refuses anything it cannot positively identify. */

const OFFICIAL_USERNAME = (process.env.ATWE_OFFICIAL_USERNAME || 'atwe').toLowerCase();

/* NOT "beta". Reset deletes `WHERE seed_tag = 'beta'`, so tagging the app's own
   account that way would make a routine beta reset DELETE it -- and with it, by
   cascade, every post it had ever made. It would come back on the next boot with
   a fresh random password (breaking this login) and a different id, and until
   that boot the admin "post as Atwe" route would answer "no @atwe account
   exists". A distinct value records that beta tooling touched the row while
   being invisible to a predicate that tests for equality with "beta". */
const KEEP_TAG = 'beta-keep';

/* Exactly what `ensureOfficialAccount` writes. */
function officialIdentity(username = OFFICIAL_USERNAME) {
  return {
    username,
    email: `no-reply+${username}@atwe.internal`,
    name: 'Atwe',
    accountType: 'business',
    headline: 'Product news and tips from Atwe',
  };
}

/* Returns a plain-English reason to REFUSE, or null when this row is provably
   the account server.js made. Split into two kinds of check on purpose.

   PROVENANCE -- things a human signup could not have produced, so matching them
   proves where the row came from. The email is the strongest of the four:
   "@atwe.internal" is not a deliverable domain and signup requires a code that
   really arrives, so no person could hold this address.

   SAFETY -- this hands somebody a working password, so it also refuses any row
   that would make that password more powerful than an ordinary member's, or
   that is not in a state where a plain login is the whole story.

   Deliberately NOT required: `headline` and `verified`. Those are editable
   product copy and a badge; staff changing either does not make the row a
   different account, and refusing over them would be a false alarm on the real
   one. They are reported instead. */
function officialMismatch(row, username = OFFICIAL_USERNAME) {
  const want = officialIdentity(username);
  if (!row) return `no @${username} account exists in this database`;

  const s = (v) => String(v == null ? '' : v).trim().toLowerCase();
  if (s(row.username) !== want.username) return `its username is "${row.username}", not "${want.username}"`;
  if (s(row.email) !== want.email) {
    return `its email is "${row.email}", but the built-in account is created with "${want.email}". ` +
           'Refusing: this row was not made by the app itself.';
  }
  if (s(row.name) !== want.name.toLowerCase()) return `its name is "${row.name}", not "${want.name}"`;
  if (s(row.account_type) !== want.accountType) return `its account type is "${row.account_type}", not "${want.accountType}"`;
  if (row.is_demo === true) return 'it is flagged is_demo, so it is seeded sample data rather than the built-in account';

  if (row.is_admin === true) {
    return 'it carries ADMIN rights. Refusing: this command hands out a password, and it will never hand out a staff login.';
  }
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
async function activateOfficial(db, { passwordHash, username = OFFICIAL_USERNAME } = {}) {
  if (!passwordHash || typeof passwordHash !== 'string' || !passwordHash.startsWith('$2')) {
    throw new Error('activateOfficial needs a bcrypt hash from auth.hashPassword');
  }
  const uname = String(username).toLowerCase();
  const { row, count } = await findOfficial(db, uname);
  if (count > 1) throw new Error(`${count} accounts hold @${uname}. Refusing to touch any of them.`);
  const problem = officialMismatch(row, uname);
  if (problem) throw new Error(`@${uname} is not the built-in Atwe account: ${problem}`);

  const r = await db.query(
    `UPDATE users
        SET password_hash = $1, email_verified = true, seed_tag = $2
      WHERE id = $3
        AND lower(username) = $4
        AND lower(email)    = $5
        AND account_type    = 'business'
        AND is_demo  IS NOT TRUE
        AND is_admin IS NOT TRUE
      RETURNING id, username`,
    [passwordHash, KEEP_TAG, row.id, uname, officialIdentity(uname).email]);
  if (!r.rowCount) throw new Error('the account changed while this was running. Nothing was written.');
  return { id: r.rows[0].id, username: r.rows[0].username, seedTag: KEEP_TAG, wasTagged: row.seed_tag != null };
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
  findOfficial, activateOfficial, resetBetaPassword,
};
