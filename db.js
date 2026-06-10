/* ═══════════════════════════════════════════════
   DATABASE  —  PostgreSQL access + schema bootstrap
   ───────────────────────────────────────────────
   Connection comes from DATABASE_URL (Railway injects this when you
   attach a Postgres plugin). If it's unset, the server still boots and
   /api/health works, but any DB-backed route returns a clear error so
   the failure mode is obvious instead of a crash on startup.
═══════════════════════════════════════════════ */
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

// SSL: on for remote hosts, off for localhost. Override with DB_SSL=true|false.
function resolveSsl() {
  if (process.env.DB_SSL === 'true') return { rejectUnauthorized: false };
  if (process.env.DB_SSL === 'false') return false;
  if (!connectionString) return false;
  const local = /@(localhost|127\.0\.0\.1)/.test(connectionString);
  return local ? false : { rejectUnauthorized: false };
}

const pool = connectionString
  ? new Pool({ connectionString, ssl: resolveSsl() })
  : null;

function isConfigured() {
  return !!pool;
}

function getPool() {
  if (!pool) {
    throw new Error(
      'Database not configured. Set DATABASE_URL (attach a PostgreSQL plugin on Railway).'
    );
  }
  return pool;
}

// Thin query helper so route code reads cleanly.
function query(text, params) {
  return getPool().query(text, params);
}

// Create tables if they don't exist, then promote the ADMIN_EMAIL user.
async function init() {
  if (!pool) {
    console.warn(
      '⚠️  DATABASE_URL not set — auth, history, projects and admin are disabled until a Postgres instance is attached.'
    );
    return;
  }

  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      name          TEXT NOT NULL,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      plan          TEXT NOT NULL DEFAULT 'free',
      is_admin      BOOLEAN NOT NULL DEFAULT false,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Incremental columns (idempotent) — email verification + Stripe linkage.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;`);

  // Single-use tokens for email verification and password reset.
  // We store only a SHA-256 hash of the token, never the raw value.
  await query(`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type       TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS auth_tokens_user_idx ON auth_tokens(user_id);`);

  await query(`
    CREATE TABLE IF NOT EXISTS projects (
      id         TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS chats (
      id         TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      title      TEXT NOT NULL,
      messages   JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await query(
    `CREATE INDEX IF NOT EXISTS chats_user_idx ON chats(user_id);`
  );
  await query(
    `CREATE INDEX IF NOT EXISTS projects_user_idx ON projects(user_id);`
  );

  // Seed admin: any existing account matching ADMIN_EMAIL is promoted.
  // New signups with that email are flagged admin in the signup handler.
  const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (adminEmail) {
    await query(
      `UPDATE users SET is_admin = true WHERE lower(email) = $1`,
      [adminEmail]
    );
  }

  console.log('🗄️   Database ready (users, projects, chats).');
}

module.exports = { init, query, getPool, isConfigured };
