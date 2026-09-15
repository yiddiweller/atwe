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

module.exports = {
  TAG, FORBIDDEN_FIELDS, ALLOWED_FIELDS, ACCOUNT_TYPES, ROLES,
  identityProblem, normalizeIdentity,
  findByUsername, findByEmail, reservationFor,
  createBetaAccount, immerseAccount,
};
