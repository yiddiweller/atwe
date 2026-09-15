/* WHAT MAY BE SEEDED, AND WHAT MUST BE REFUSED.
 *
 * Every check lives here, as PURE FUNCTIONS over an env object, so the whole
 * refusal surface can be unit-tested with no database and no network
 * (test/seed-guard.test.js). A guard you cannot test is a guard nobody trusts.
 *
 * The rule this file exists to enforce: the beta seeder must be IMPOSSIBLE to
 * point at production by accident, and must refuse to run while any integration
 * that can touch the real world is configured.
 *
 * Nothing here reads process.env directly. Callers pass it in.
 */
'use strict';
const crypto = require('crypto');

/* Every host Atwe serves in production, in every spelling. Checked as a WHOLE
   host, never as a substring: "beta.atwe.com" contains "atwe.com" and must not
   be mistaken for it. */
const PROD_HOSTS = new Set([
  'atwe.com', 'www.atwe.com', 'admin.atwe.com',
  'atwe.ai', 'www.atwe.ai', 'admin.atwe.ai',
  'atwe.app', 'www.atwe.app', 'admin.atwe.app',
  'atwe.co', 'www.atwe.co', 'admin.atwe.co',
]);

/* Railway names its environments. This is a real, Railway-provided variable
   (docs.railway.com/variables/reference) and NOT one we invented -- but it only
   exists when the process runs ON Railway, so its ABSENCE proves nothing and is
   never a failure. Present and production-shaped IS a failure. */
const PROD_ENV_NAMES = new Set(['production', 'prod', 'main', 'live']);

function hostOf(url) {
  if (!url) return '';
  try { return new URL(url).hostname.toLowerCase(); }
  catch (e) { return String(url).trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0]; }
}

function fingerprint(s) {
  return crypto.createHash('sha256').update(String(s || ''), 'utf8').digest('hex');
}

/* A connection string carries a password, so it is never printed, never logged
   and never compared by value in a report -- only by this hash. */
function dbLabel(url) {
  if (!url) return '(no DATABASE_URL)';
  try {
    const u = new URL(url);
    return `${u.hostname}/${String(u.pathname || '').replace(/^\//, '') || '?'}`;
  } catch (e) { return '(unparseable DATABASE_URL)'; }
}

/* ---- 1. AM I POINTED AT BETA? ------------------------------------------- */
function checkEnvironment(env) {
  const fail = [];
  const info = {};

  const atweEnv = String(env.ATWE_ENV || '').trim().toLowerCase();
  info.ATWE_ENV = atweEnv || '(unset)';
  if (atweEnv !== 'beta') {
    fail.push(`ATWE_ENV must be exactly "beta" (it is ${atweEnv ? `"${atweEnv}"` : 'unset'}). ` +
              'Set it on the beta service only. Nothing inherits it.');
  }

  const appHost = hostOf(env.APP_URL);
  info.APP_URL_host = appHost || '(unset)';
  if (!appHost) {
    fail.push('APP_URL is unset, so the target cannot be identified.');
  } else if (PROD_HOSTS.has(appHost)) {
    fail.push(`APP_URL points at the production host "${appHost}".`);
  } else if (!/(^|\.)beta\./.test(appHost) && !/^beta\./.test(appHost) && appHost !== 'localhost') {
    fail.push(`APP_URL host "${appHost}" is neither a beta host nor localhost. ` +
              'Expected something like beta.atwe.com.');
  }

  const dbUrl = env.DATABASE_URL || '';
  const guard = String(env.PROD_DATABASE_URL_FINGERPRINT || '').trim().toLowerCase();
  info.database = dbLabel(dbUrl);
  info.fingerprint_guard = guard ? 'set' : '(not set)';
  if (!dbUrl) {
    fail.push('DATABASE_URL is unset.');
  } else {
    const dbHost = hostOf(dbUrl);
    if (PROD_HOSTS.has(dbHost)) fail.push(`DATABASE_URL points at the production host "${dbHost}".`);
    if (guard) {
      if (fingerprint(dbUrl) === guard) {
        fail.push('DATABASE_URL matches PROD_DATABASE_URL_FINGERPRINT. This IS the production database.');
      }
    }
  }

  /* Corroborating only. Absent is normal (running from a laptop). */
  const rw = String(env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_ENVIRONMENT || '').trim().toLowerCase();
  info.RAILWAY_ENVIRONMENT_NAME = rw || '(absent - not running on Railway)';
  if (rw && PROD_ENV_NAMES.has(rw)) {
    fail.push(`Railway reports this is the "${rw}" environment.`);
  }

  return { ok: fail.length === 0, failures: fail, info };
}

/* ---- 2. CAN ANYTHING REACH THE REAL WORLD? ------------------------------ */
/* The beta Railway environment was DUPLICATED FROM PRODUCTION, so assume every
   dangerous credential is present until proven otherwise. A credential is not
   safe merely because it sits in the beta project.
 *
 * `block` = refuse the seed. `warn` = report, do not refuse. */
const INTEGRATIONS = [
  { name: 'Stripe',        block: true,  vars: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_ID', 'STRIPE_BOOST_PRICE_ID', 'STRIPE_PROMOTE_PRICE_ID'],
    why: 'can charge a real card, move real money and fire real webhooks' },
  { name: 'Email (SMTP)',  block: true,  vars: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'],
    why: 'can deliver mail to a real inbox from an address your members trust' },
  { name: 'Push (VAPID)',  block: true,  vars: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'],
    why: 'can send a notification to a real phone' },
  { name: 'SMS (Twilio)',  block: true,  vars: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'SMS_API_KEY'],
    why: 'can send a real text message and bill for it' },
  { name: 'Shipping labels (Shippo)', block: true, vars: ['SHIPPO_API_KEY', 'SHIPPO_WEBHOOK_SECRET'],
    why: 'buys real, non-refundable carrier labels' },
  { name: 'Object storage (S3/R2)',   block: true, vars: ['S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_ENDPOINT', 'CDN_URL'],
    why: 'beta writes and deletes could land in the production media bucket',
    allowVar: 'BETA_S3_APPROVED',
    allowNote: 'set BETA_S3_APPROVED=1 once S3_BUCKET is a SEPARATE beta bucket with its own token' },
  { name: 'Tax / carrier rates', block: true, vars: ['TAX_API_KEY', 'SHIPPING_API_KEY'],
    why: 'calls a billable third-party pricing API' },
  { name: 'Cloudflare TURN', block: false, vars: ['CLOUDFLARE_TURN_KEY_ID', 'CLOUDFLARE_TURN_API_TOKEN', 'TURN_CREDENTIAL'],
    why: 'relays real call media and consumes the production TURN allowance' },
  { name: 'Anthropic',       block: false, vars: ['ANTHROPIC_API_KEY'],
    why: 'spends against the key; no other real-world side effect' },
];

function checkIntegrations(env) {
  const blockers = [];
  const warnings = [];
  const seen = [];

  for (const it of INTEGRATIONS) {
    const set = it.vars.filter((v) => String(env[v] || '').trim() !== '');
    if (!set.length) { seen.push({ name: it.name, state: 'disabled' }); continue; }
    const approved = it.allowVar && String(env[it.allowVar] || '').trim() !== '';
    if (approved) {
      seen.push({ name: it.name, state: 'approved for beta', vars: set });
      warnings.push(`${it.name} is CONFIGURED and explicitly approved via ${it.allowVar}. ` +
                    'You are asserting these are beta-only credentials.');
      continue;
    }
    seen.push({ name: it.name, state: it.block ? 'CONFIGURED - blocks seeding' : 'configured', vars: set });
    const line = `${it.name} is configured (${set.join(', ')}) - ${it.why}.` +
                 (it.allowNote ? ` To proceed: ${it.allowNote}.` : ' Remove these variables from the beta service.');
    (it.block ? blockers : warnings).push(line);
  }

  return { ok: blockers.length === 0, blockers, warnings, seen };
}

/* ---- 3. THE PASSWORD ---------------------------------------------------- */
/* Never from a file, never printed, never returned in any report object. */
function passwordProblem(pw) {
  const s = String(pw || '');
  if (!s) return 'no password supplied';
  if (s.length < 10) return 'too short (minimum 10 characters)';
  if (/^(password|atwe|beta|test|123)/i.test(s)) return 'starts with an obvious word';
  return null;
}

module.exports = {
  PROD_HOSTS, PROD_ENV_NAMES, INTEGRATIONS,
  hostOf, fingerprint, dbLabel,
  checkEnvironment, checkIntegrations, passwordProblem,
};
