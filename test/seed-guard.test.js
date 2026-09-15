/* The beta seeder's refusal surface, tested with no database and no network.
   Every case here is a way somebody could point the seeder at production. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const G = require('../tools/seed-guard.js');

/* A minimal environment that SHOULD pass, so each test below can break exactly
   one thing and prove that one thing is what refuses. */
const BETA = {
  ATWE_ENV: 'beta',
  APP_URL: 'https://beta.atwe.com',
  DATABASE_URL: 'postgres://u:p@beta-db.internal:5432/atwe_beta',
};

test('the happy beta environment passes', () => {
  const r = G.checkEnvironment(BETA);
  assert.strictEqual(r.ok, true, r.failures.join(' | '));
});

test('refuses unless ATWE_ENV is exactly beta', () => {
  for (const v of [undefined, '', 'production', 'Beta ', 'betaa', 'dev']) {
    const r = G.checkEnvironment({ ...BETA, ATWE_ENV: v });
    if (String(v || '').trim().toLowerCase() === 'beta') continue;
    assert.strictEqual(r.ok, false, `ATWE_ENV=${JSON.stringify(v)} should refuse`);
  }
});

test('refuses every production host spelling in APP_URL', () => {
  for (const h of G.PROD_HOSTS) {
    const r = G.checkEnvironment({ ...BETA, APP_URL: `https://${h}` });
    assert.strictEqual(r.ok, false, `APP_URL ${h} should refuse`);
    assert.ok(r.failures.some((f) => f.includes('production host')), h);
  }
});

test('beta.atwe.com is NOT mistaken for atwe.com (whole-host match)', () => {
  const r = G.checkEnvironment({ ...BETA, APP_URL: 'https://beta.atwe.com' });
  assert.strictEqual(r.ok, true, r.failures.join(' | '));
});

test('refuses an APP_URL that is neither beta nor localhost', () => {
  const r = G.checkEnvironment({ ...BETA, APP_URL: 'https://staging.example.com' });
  assert.strictEqual(r.ok, false);
});

test('refuses a DATABASE_URL matching the production fingerprint', () => {
  const prod = 'postgres://real:secret@prod-db.internal:5432/railway';
  const r = G.checkEnvironment({
    ...BETA, DATABASE_URL: prod,
    PROD_DATABASE_URL_FINGERPRINT: G.fingerprint(prod),
  });
  assert.strictEqual(r.ok, false);
  assert.ok(r.failures.some((f) => f.includes('IS the production database')));
});

test('a non-matching fingerprint does not refuse', () => {
  const r = G.checkEnvironment({ ...BETA, PROD_DATABASE_URL_FINGERPRINT: G.fingerprint('something else') });
  assert.strictEqual(r.ok, true, r.failures.join(' | '));
});

test('refuses when Railway says this is production', () => {
  for (const n of ['production', 'Prod', 'LIVE', 'main']) {
    const r = G.checkEnvironment({ ...BETA, RAILWAY_ENVIRONMENT_NAME: n });
    assert.strictEqual(r.ok, false, `RAILWAY_ENVIRONMENT_NAME=${n} should refuse`);
  }
});

test('an ABSENT Railway variable is never a failure', () => {
  const r = G.checkEnvironment(BETA);           // no RAILWAY_* at all
  assert.strictEqual(r.ok, true, r.failures.join(' | '));
  assert.ok(String(r.info.RAILWAY_ENVIRONMENT_NAME).includes('absent'));
});

test('a beta-named Railway environment passes', () => {
  const r = G.checkEnvironment({ ...BETA, RAILWAY_ENVIRONMENT_NAME: 'beta' });
  assert.strictEqual(r.ok, true, r.failures.join(' | '));
});

test('no credentials at all = nothing blocks', () => {
  const r = G.checkIntegrations({});
  assert.strictEqual(r.ok, true, r.blockers.join(' | '));
});

test('each real-action integration blocks on its own', () => {
  const cases = {
    STRIPE_SECRET_KEY: 'Stripe',
    SMTP_HOST: 'Email',
    VAPID_PRIVATE_KEY: 'Push',
    TWILIO_ACCOUNT_SID: 'SMS',
    SHIPPO_API_KEY: 'Shipping',
    S3_BUCKET: 'storage',
    TAX_API_KEY: 'Tax',
  };
  for (const [v, label] of Object.entries(cases)) {
    const r = G.checkIntegrations({ [v]: 'x' });
    assert.strictEqual(r.ok, false, `${v} should block`);
    assert.ok(r.blockers.some((b) => b.includes(label)), `${v} -> ${label}`);
  }
});

test('storage can be approved explicitly, and only storage has that door', () => {
  const on = G.checkIntegrations({ S3_BUCKET: 'atwe-media-beta', BETA_S3_APPROVED: '1' });
  assert.strictEqual(on.ok, true, on.blockers.join(' | '));
  assert.ok(on.warnings.some((w) => w.includes('BETA_S3_APPROVED')));
  // The same escape hatch must NOT exist for Stripe.
  const stripe = G.checkIntegrations({ STRIPE_SECRET_KEY: 'sk_live_x', BETA_S3_APPROVED: '1' });
  assert.strictEqual(stripe.ok, false);
});

test('advisory integrations warn but never block', () => {
  const r = G.checkIntegrations({ ANTHROPIC_API_KEY: 'x', CLOUDFLARE_TURN_KEY_ID: 'y' });
  assert.strictEqual(r.ok, true, r.blockers.join(' | '));
  assert.strictEqual(r.warnings.length, 2);
});

test('an empty-string credential counts as unset', () => {
  const r = G.checkIntegrations({ STRIPE_SECRET_KEY: '', SMTP_HOST: '   ' });
  assert.strictEqual(r.ok, true, r.blockers.join(' | '));
});

test('the password rule rejects weak or missing values', () => {
  assert.ok(G.passwordProblem(''));
  assert.ok(G.passwordProblem('short'));
  assert.ok(G.passwordProblem('password123456'));
  assert.strictEqual(G.passwordProblem('a-real-beta-passphrase'), null);
});

test('no report field ever carries the connection string', () => {
  const url = 'postgres://user:SUPERSECRET@beta-db.internal:5432/atwe_beta';
  const r = G.checkEnvironment({ ...BETA, DATABASE_URL: url });
  const dumped = JSON.stringify(r);
  assert.ok(!dumped.includes('SUPERSECRET'), 'the password leaked into the report');
  assert.ok(r.info.database.includes('beta-db.internal'));
});
