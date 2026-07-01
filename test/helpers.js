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

async function login(user) {
  const r = await api('POST', '/api/auth/login', { body: { email: user.email, password: user.password } });
  if (r.status !== 200 || !r.body.token) throw new Error('login failed: ' + JSON.stringify(r.body));
  return r.body.token;
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
    JWT_SECRET: 'test-secret-money-auth',
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
