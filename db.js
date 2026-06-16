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
  // Profile: a chosen @username, a base64 avatar image, and a banner photo.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banner TEXT;`);
  // Short profile bio shown on the user's profile.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;`);
  // Date of birth — collected at signup for the 18+ age gate.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS dob DATE;`);
  // Presence: when the user was last connected (for "last seen").
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ;`);
  // Contact privacy (who can call / video / DM you). Default: everyone.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pc_everyone BOOLEAN NOT NULL DEFAULT true;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pc_following BOOLEAN NOT NULL DEFAULT false;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pc_followers BOOLEAN NOT NULL DEFAULT false;`);

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
  // Pending signups — a signup isn't a real account until the emailed 6-digit
  // code is confirmed. Keyed by lower(email); replaced if the user re-requests.
  await query(`
    CREATE TABLE IF NOT EXISTS pending_signups (
      email         TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      dob           DATE,
      username      TEXT,
      code_hash     TEXT NOT NULL,
      attempts      INTEGER NOT NULL DEFAULT 0,
      expires_at    TIMESTAMPTZ NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // Auth lookups use WHERE lower(email) = $1 — index that expression.
  await query(`CREATE INDEX IF NOT EXISTS users_lower_email_idx ON users(lower(email));`);

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

  // Support / contact requests from the Help center.
  await query(`
    CREATE TABLE IF NOT EXISTS support_requests (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      email      TEXT NOT NULL,
      message    TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Direct messages between an admin and a user (a per-user thread).
  // `sender` is 'admin' or 'user'; the read_by_* flags drive the unread
  // badges shown to each side. Deleting a user removes their thread.
  await query(`
    CREATE TABLE IF NOT EXISTS admin_messages (
      id            SERIAL PRIMARY KEY,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sender        TEXT NOT NULL,
      body          TEXT NOT NULL,
      read_by_user  BOOLEAN NOT NULL DEFAULT false,
      read_by_admin BOOLEAN NOT NULL DEFAULT false,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS admin_messages_user_idx ON admin_messages(user_id, created_at);`);
  // Optional photo attachment on a message (base64 data URL).
  await query(`ALTER TABLE admin_messages ADD COLUMN IF NOT EXISTS image TEXT;`);

  // AtChat — direct messages between two users (X-style DMs).
  await query(`
    CREATE TABLE IF NOT EXISTS at_messages (
      id           SERIAL PRIMARY KEY,
      sender_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body         TEXT NOT NULL DEFAULT '',
      image        TEXT,
      read_at      TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS at_messages_pair_idx ON at_messages(sender_id, recipient_id, created_at);`);
  await query(`CREATE INDEX IF NOT EXISTS at_messages_inbox_idx ON at_messages(recipient_id, read_at);`);
  // Rich attachments: video, audio (voice notes) and files. `image` still holds
  // photos; `media` holds everything else (a base64 data URL), with its kind
  // ('video'|'audio'|'file') and, for files, the original filename.
  await query(`ALTER TABLE at_messages ADD COLUMN IF NOT EXISTS media TEXT;`);
  await query(`ALTER TABLE at_messages ADD COLUMN IF NOT EXISTS media_kind TEXT;`);
  await query(`ALTER TABLE at_messages ADD COLUMN IF NOT EXISTS media_name TEXT;`);
  // "Delete conversation (for me)" — messages before cleared_at are hidden from me.
  await query(`
    CREATE TABLE IF NOT EXISTS at_cleared (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      other_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cleared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, other_id)
    );
  `);

  // Call log — one row per participant per call (so each side keeps its own
  // history and can delete it independently). `direction` is 'in'/'out' from the
  // owner's point of view; `missed` marks a call that never connected.
  await query(`
    CREATE TABLE IF NOT EXISTS calls (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      peer_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      direction  TEXT NOT NULL DEFAULT 'out',
      media      TEXT NOT NULL DEFAULT 'audio',
      missed     BOOLEAN NOT NULL DEFAULT false,
      duration   INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS calls_user_idx ON calls(user_id, created_at DESC);`);

  // Reserved (locked) usernames — admins hold these so no one can register or
  // switch to them until they're unlocked. `username` is stored lowercased.
  await query(`
    CREATE TABLE IF NOT EXISTS reserved_usernames (
      username   TEXT PRIMARY KEY,
      note       TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Blocks — one-way: blocker hides blocked's content and can't be contacted by them.
  await query(`
    CREATE TABLE IF NOT EXISTS blocks (
      blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (blocker_id, blocked_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS blocks_blocker_idx ON blocks(blocker_id);`);

  // Reports — a user flags another for the admin dashboard to review.
  await query(`
    CREATE TABLE IF NOT EXISTS reports (
      id          SERIAL PRIMARY KEY,
      reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reported_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason      TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Post-notification subscriptions (the profile "bell"): user_id is notified
  // when target_id publishes a new top-level post.
  await query(`
    CREATE TABLE IF NOT EXISTS post_notify (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, target_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS post_notify_target_idx ON post_notify(target_id);`);

  // Contact allow-list — when privacy is "selected only", these users may reach you.
  await query(`
    CREATE TABLE IF NOT EXISTS contact_allow (
      owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      allowed_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (owner_id, allowed_id)
    );
  `);

  // Contacts — a one-way saved list (you add people by their @username; you
  // can't rename them — their own display name/handle is shown).
  await query(`
    CREATE TABLE IF NOT EXISTS contacts (
      owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      contact_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (owner_id, contact_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS contacts_owner_idx ON contacts(owner_id);`);
  // Owner-private details attached to a contact (their profile name/handle/avatar
  // still come from the users row; these are extra address-book fields).
  for (const col of ['email', 'phone', 'socials', 'website', 'address', 'about', 'notes']) {
    await query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ${col} TEXT;`);
  }

  // AtChat social layer — follows + public posts.
  await query(`
    CREATE TABLE IF NOT EXISTS follows (
      follower_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (follower_id, following_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS follows_following_idx ON follows(following_id);`);
  await query(`
    CREATE TABLE IF NOT EXISTS posts (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body       TEXT NOT NULL DEFAULT '',
      image      TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS posts_user_idx ON posts(user_id, created_at DESC);`);
  await query(`
    CREATE TABLE IF NOT EXISTS post_likes (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (post_id, user_id)
    );
  `);
  // Replies: a reply is just a post that points at its parent (X-style threads).
  // Deleting a post cascades to its replies.
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES posts(id) ON DELETE CASCADE;`);
  await query(`CREATE INDEX IF NOT EXISTS posts_parent_idx ON posts(parent_id, created_at);`);
  // Posts can carry a video (a base64 data URL) alongside the optional image.
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS media TEXT;`);
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS media_kind TEXT;`);
  // Whether a post appears in the main (For You / Following) feed. Circle-only
  // posts set this false. Existing posts default true so they keep showing.
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS to_main BOOLEAN NOT NULL DEFAULT true;`);
  // Optional location tag on a post.
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS location TEXT;`);
  // Scheduled posts: created_at is set to the publish time and the post stays
  // hidden from feeds until then; scheduled_at marks it as scheduled.
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;`);

  // Notifications — likes, replies, follows and contact-adds aimed at a user.
  // (Declared after `posts` so the post_id FK resolves.)
  await query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type       TEXT NOT NULL,
      post_id    INTEGER REFERENCES posts(id) ON DELETE CASCADE,
      read       BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, created_at DESC);`);

  // Polls on posts — options + one vote per user.
  await query(`
    CREATE TABLE IF NOT EXISTS post_poll_options (
      id       SERIAL PRIMARY KEY,
      post_id  INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      text     TEXT NOT NULL
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS post_poll_options_post_idx ON post_poll_options(post_id);`);
  await query(`
    CREATE TABLE IF NOT EXISTS post_poll_votes (
      post_id   INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      option_id INTEGER NOT NULL REFERENCES post_poll_options(id) ON DELETE CASCADE,
      PRIMARY KEY (post_id, user_id)
    );
  `);

  // CIRCLES — industry/community feeds (circle@username). The creator is admin.
  await query(`
    CREATE TABLE IF NOT EXISTS circles (
      id         SERIAL PRIMARY KEY,
      username   TEXT,
      name       TEXT NOT NULL,
      bio        TEXT,
      avatar     TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  try {
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS circles_username_unique_idx ON circles(lower(username)) WHERE username IS NOT NULL;`);
  } catch (e) {
    console.warn('⚠️  Could not build the unique circle username index:', e.message);
  }
  await query(`
    CREATE TABLE IF NOT EXISTS circle_members (
      circle_id INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
      user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (circle_id, user_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS circle_members_user_idx ON circle_members(user_id);`);
  // A post can be shared into one or more circles (many-to-many).
  await query(`
    CREATE TABLE IF NOT EXISTS post_circles (
      post_id   INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      circle_id INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
      PRIMARY KEY (post_id, circle_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS post_circles_circle_idx ON post_circles(circle_id, post_id);`);

  // FEEDS — broadcast channels (feeds@username). Only the creator/admin posts;
  // everyone else follows to watch. `open` = anyone joins instantly; otherwise
  // joins require admin approval (pending rows live in feed_requests).
  await query(`
    CREATE TABLE IF NOT EXISTS feeds (
      id         SERIAL PRIMARY KEY,
      username   TEXT,
      name       TEXT NOT NULL,
      bio        TEXT,
      avatar     TEXT,
      open       BOOLEAN NOT NULL DEFAULT true,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  try {
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS feeds_username_unique_idx ON feeds(lower(username)) WHERE username IS NOT NULL;`);
  } catch (e) {
    console.warn('⚠️  Could not build the unique feed username index:', e.message);
  }
  await query(`
    CREATE TABLE IF NOT EXISTS feed_members (
      feed_id   INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
      user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (feed_id, user_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS feed_members_user_idx ON feed_members(user_id);`);
  await query(`
    CREATE TABLE IF NOT EXISTS feed_requests (
      feed_id      INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (feed_id, user_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS feed_requests_feed_idx ON feed_requests(feed_id);`);
  // A post can be broadcast into one feed (admin-only).
  await query(`
    CREATE TABLE IF NOT EXISTS post_feeds (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
      PRIMARY KEY (post_id, feed_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS post_feeds_feed_idx ON post_feeds(feed_id, post_id);`);
  // Feed notifications (request / approval) deep-link via feed_id, not post_id.
  await query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS feed_id INTEGER REFERENCES feeds(id) ON DELETE CASCADE;`);

  // AtChat group chats — multi-person threads.
  await query(`
    CREATE TABLE IF NOT EXISTS at_groups (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS at_group_members (
      group_id     INTEGER NOT NULL REFERENCES at_groups(id) ON DELETE CASCADE,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (group_id, user_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS at_group_members_user_idx ON at_group_members(user_id);`);
  await query(`
    CREATE TABLE IF NOT EXISTS at_group_messages (
      id         SERIAL PRIMARY KEY,
      group_id   INTEGER NOT NULL REFERENCES at_groups(id) ON DELETE CASCADE,
      sender_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body       TEXT NOT NULL DEFAULT '',
      image      TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS at_group_messages_group_idx ON at_group_messages(group_id, created_at);`);
  // Rich attachments on group messages (see at_messages above).
  await query(`ALTER TABLE at_group_messages ADD COLUMN IF NOT EXISTS media TEXT;`);
  await query(`ALTER TABLE at_group_messages ADD COLUMN IF NOT EXISTS media_kind TEXT;`);
  await query(`ALTER TABLE at_group_messages ADD COLUMN IF NOT EXISTS media_name TEXT;`);
  // Group identity: a @username (the creator becomes admin) + a display avatar.
  // `name` stays the display name; `username` is unique and grants admin (created_by).
  await query(`ALTER TABLE at_groups ADD COLUMN IF NOT EXISTS username TEXT;`);
  await query(`ALTER TABLE at_groups ADD COLUMN IF NOT EXISTS avatar TEXT;`);
  try {
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS at_groups_username_unique_idx ON at_groups(lower(username)) WHERE username IS NOT NULL;`);
  } catch (e) {
    console.warn('⚠️  Could not build the unique group username index:', e.message);
  }

  await query(
    `CREATE INDEX IF NOT EXISTS chats_user_idx ON chats(user_id);`
  );
  await query(
    `CREATE INDEX IF NOT EXISTS projects_user_idx ON projects(user_id);`
  );

  // Usernames must be unique (case-insensitive). Building the unique index is
  // isolated so that any pre-existing duplicates can't abort the rest of init:
  // we first NULL out collisions (keeping the lowest id), then create it.
  try {
    await query(`
      UPDATE users SET username = NULL
      WHERE username IS NOT NULL AND id NOT IN (
        SELECT MIN(id) FROM users WHERE username IS NOT NULL GROUP BY lower(username)
      );
    `);
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique_idx ON users(lower(username)) WHERE username IS NOT NULL;`);
  } catch (e) {
    console.warn('⚠️  Could not build the unique username index:', e.message);
  }

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
