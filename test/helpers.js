// Shared harness for the money + auth test suite. No new dependencies — uses only
// Node built-ins (node:test / node:assert / child_process / global fetch, Node 18+)
// plus `pg` and `../auth`, which the app already depends on.
//
// The suite needs a writable Postgres it can create/own tables in. Point it at one
// with TEST_DATABASE_URL (falls back to DATABASE_URL). With neither set the whole
// suite is SKIPPED (never failed) — matching the app's graceful-degradation ethos,
// so `npm test` is a no-op in an env without a database rather than a red build.
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

// The server child and this test process must sign/verify JWTs with the SAME secret,
// so pin it here BEFORE requiring ../auth (auth.js reads JWT_SECRET at module load).
const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-money-auth';
process.env.JWT_SECRET = JWT_SECRET;
const auth = require('../auth');

const DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '';
const SKIP = !DB_URL;
const PORT = Number(process.env.TEST_PORT || 3987);
const BASE = `http://127.0.0.1:${PORT}`;

let child = null;
let pool = null;

function uniq(p) { return `${p}_${crypto.randomUUID().slice(0, 8)}`; }

async function api(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, body: json || {} };
}

// Seed a ready-to-use, email-verified account with a known password + username so
// tests can log in through the real /api/auth/login endpoint. Bypasses the 2-step
// emailed-code signup (which isn't hermetic without capturing console output).
async function seedUser({ balanceCents = 0, accountType = 'personal' } = {}) {
  const email = uniq('t') + '@test.local';
  const username = uniq('u');
  const password = 'testpass123';
  const hash = await auth.hashPassword(password);
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, username, account_type, email_verified, balance_cents)
     VALUES ($1,$2,$3,$4,$5,true,$6) RETURNING id`,
    ['Test ' + username, email, hash, username, accountType, balanceCents]
  );
  return { id: rows[0].id, email, username, password, balanceCents };
}

// Mint an authenticated token WITHOUT hitting the rate-limited /api/auth/login
// endpoint: sign a JWT with the shared secret and seed the matching auth_sessions
// row that requireAuth checks. (The login-*behaviour* tests still call the real
// endpoint directly — a handful of hits, comfortably under its 12/min limit.)
async function login(user) {
  const token = auth.signToken({ id: user.id, email: user.email, is_admin: false });
  await pool.query(
    'INSERT INTO auth_sessions (user_id, token_hash, user_agent, ip) VALUES ($1,$2,$3,$4)',
    [user.id, auth.hashToken(token), 'money-auth-test', '127.0.0.1']
  );
  return token;
}

function waitForHealth(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    (async function poll() {
      try {
        const res = await fetch(BASE + '/api/health');
        if (res.ok) return resolve(true);
      } catch { /* not up yet */ }
      if (Date.now() > deadline) return reject(new Error('server did not become healthy'));
      setTimeout(poll, 250);
    })();
  });
}

async function startServer(extraEnv = {}) {
  if (SKIP) return;
  pool = new Pool({ connectionString: DB_URL, ssl: false });
  const env = {
    ...process.env,
    DATABASE_URL: DB_URL,
    DB_SSL: 'false',
    JWT_SECRET,
    PORT: String(PORT),
    NODE_ENV: 'test',
    // Force the demo (no-Stripe) money paths so wallet flows are exercisable offline.
    STRIPE_SECRET_KEY: '',
    ANTHROPIC_API_KEY: '',
    // Small, deterministic velocity ceiling so the cap is testable.
    WALLET_DAILY_CAP_CENTS: '500',
    WALLET_WEEKLY_CAP_CENTS: '100000',
    ...extraEnv,
  };
  child = spawn('node', [path.join(__dirname, '..', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  await waitForHealth();
}

async function stopServer() {
  if (pool) { await pool.end().catch(() => {}); pool = null; }
  if (child) { child.kill('SIGKILL'); child = null; }
}

module.exports = { SKIP, api, seedUser, login, uniq, startServer, stopServer, getPool: () => pool };
