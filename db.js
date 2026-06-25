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

// Every industry category (the full signup set) seeded as an official, verified
// circle so people can jump straight into their field — they still create their
// own circles (e.g. their company) on top. [name, @username]
const OFFICIAL_CIRCLES = [
  ['Accounting', 'accounting'],
  ['Advertising', 'advertising'],
  ['Aerospace', 'aerospace'],
  ['Agriculture', 'agriculture'],
  ['AI & Machine Learning', 'aiandmachinelearning'],
  ['Animation', 'animation'],
  ['Apparel & Fashion', 'apparelandfashion'],
  ['Appliance Repair', 'appliancerepair'],
  ['Architecture', 'architecture'],
  ['Auto Dealership', 'autodealership'],
  ['Auto Detailing', 'autodetailing'],
  ['Auto Repair', 'autorepair'],
  ['Auto Parts', 'autoparts'],
  ['Aviation', 'aviation'],
  ['Bakery', 'bakery'],
  ['Banking', 'banking'],
  ['Bar & Nightlife', 'barandnightlife'],
  ['Barber', 'barber'],
  ['Beauty & Cosmetics', 'beautyandcosmetics'],
  ['Biotech', 'biotech'],
  ['Blockchain & Crypto', 'blockchainandcrypto'],
  ['Bookkeeping', 'bookkeeping'],
  ['Branding', 'branding'],
  ['Brewery & Winery', 'breweryandwinery'],
  ['Building Materials', 'buildingmaterials'],
  ['Butcher', 'butcher'],
  ['Cabinetry', 'cabinetry'],
  ['Cafe & Coffee', 'cafeandcoffee'],
  ['Cannabis', 'cannabis'],
  ['Car Wash', 'carwash'],
  ['Carpentry', 'carpentry'],
  ['Catering', 'catering'],
  ['Charity & Nonprofit', 'charityandnonprofit'],
  ['Chemicals', 'chemicals'],
  ['Childcare & Daycare', 'childcareanddaycare'],
  ['Chiropractic', 'chiropractic'],
  ['Cleaning Services', 'cleaningservices'],
  ['Coaching', 'coaching'],
  ['Commercial Real Estate', 'commercialrealestate'],
  ['Concrete', 'concrete'],
  ['Construction', 'construction'],
  ['Consulting', 'consulting'],
  ['Content Creation', 'contentcreation'],
  ['Copywriting', 'copywriting'],
  ['Courier & Delivery', 'courieranddelivery'],
  ['Cybersecurity', 'cybersecurity'],
  ['Dairy', 'dairy'],
  ['Data & Analytics', 'dataandanalytics'],
  ['Demolition', 'demolition'],
  ['Dental', 'dental'],
  ['Dermatology', 'dermatology'],
  ['Design (Graphic)', 'designgraphic'],
  ['Design (Industrial)', 'designindustrial'],
  ['Design (Interior)', 'designinterior'],
  ['Design (UX/UI)', 'designuxui'],
  ['Distribution', 'distribution'],
  ['DevOps', 'devops'],
  ['Drywall', 'drywall'],
  ['E-commerce', 'ecommerce'],
  ['Education', 'education'],
  ['Electrician', 'electrician'],
  ['Electronics', 'electronics'],
  ['Energy', 'energy'],
  ['Engineering', 'engineering'],
  ['Environmental Services', 'environmentalservices'],
  ['Esports', 'esports'],
  ['Event Planning', 'eventplanning'],
  ['Excavation', 'excavation'],
  ['Export & Import', 'exportandimport'],
  ['Fabrication', 'fabrication'],
  ['Farming', 'farming'],
  ['Fencing', 'fencing'],
  ['Film & TV', 'filmandtv'],
  ['Financial Advisory', 'financialadvisory'],
  ['Fintech', 'fintech'],
  ['Fishing', 'fishing'],
  ['Fitness & Personal Training', 'fitnessandpersonaltraining'],
  ['Flooring', 'flooring'],
  ['Food Distribution', 'fooddistribution'],
  ['Food Manufacturing', 'foodmanufacturing'],
  ['Food Truck', 'foodtruck'],
  ['Forestry', 'forestry'],
  ['Freight', 'freight'],
  ['Furniture', 'furniture'],
  ['Game Development', 'gamedevelopment'],
  ['Glazing', 'glazing'],
  ['Government & Public Sector', 'governmentandpublicsector'],
  ['Grocery', 'grocery'],
  ['Handyman', 'handyman'],
  ['Hardware', 'hardware'],
  ['Healthcare', 'healthcare'],
  ['Home Care', 'homecare'],
  ['Home Security', 'homesecurity'],
  ['Home Staging', 'homestaging'],
  ['Horticulture', 'horticulture'],
  ['Hospitality', 'hospitality'],
  ['Hotel & Lodging', 'hotelandlodging'],
  ['HR & Recruiting', 'hrandrecruiting'],
  ['HVAC', 'hvac'],
  ['Illustration', 'illustration'],
  ['Import & Export', 'importandexport'],
  ['Influencer & Creator', 'influencerandcreator'],
  ['Insurance', 'insurance'],
  ['Interior Design', 'interiordesign'],
  ['Investment', 'investment'],
  ['IT Services', 'itservices'],
  ['Janitorial', 'janitorial'],
  ['Jewelry', 'jewelry'],
  ['Journalism', 'journalism'],
  ['Landscaping', 'landscaping'],
  ['Law & Legal', 'lawandlegal'],
  ['Lending & Mortgage', 'lendingandmortgage'],
  ['Locksmith', 'locksmith'],
  ['Logistics', 'logistics'],
  ['Machining', 'machining'],
  ['Maintenance', 'maintenance'],
  ['Manufacturing', 'manufacturing'],
  ['Marine & Maritime', 'marineandmaritime'],
  ['Marketing', 'marketing'],
  ['Masonry', 'masonry'],
  ['Massage Therapy', 'massagetherapy'],
  ['Mechanical', 'mechanical'],
  ['Media', 'media'],
  ['Medical', 'medical'],
  ['Mental Health & Therapy', 'mentalhealthandtherapy'],
  ['Mining', 'mining'],
  ['Moving Services', 'movingservices'],
  ['Music', 'music'],
  ['Nail Salon', 'nailsalon'],
  ['Networking & Telecom', 'networkingandtelecom'],
  ['Notary', 'notary'],
  ['Nursing', 'nursing'],
  ['Nutrition & Dietetics', 'nutritionanddietetics'],
  ['Oil & Gas', 'oilandgas'],
  ['Optometry', 'optometry'],
  ['Outdoor & Recreation', 'outdoorandrecreation'],
  ['Packaging', 'packaging'],
  ['Painting', 'painting'],
  ['Paralegal', 'paralegal'],
  ['Payroll', 'payroll'],
  ['Pest Control', 'pestcontrol'],
  ['Pharmacy', 'pharmacy'],
  ['Photography', 'photography'],
  ['Physical Therapy', 'physicaltherapy'],
  ['Plastics', 'plastics'],
  ['Plumbing', 'plumbing'],
  ['Podcasting', 'podcasting'],
  ['Pool Services', 'poolservices'],
  ['Printing', 'printing'],
  ['Private Equity', 'privateequity'],
  ['Private Investigation', 'privateinvestigation'],
  ['Property Management', 'propertymanagement'],
  ['Public Relations', 'publicrelations'],
  ['Publishing', 'publishing'],
  ['Real Estate', 'realestate'],
  ['Real Estate Development', 'realestatedevelopment'],
  ['Recycling', 'recycling'],
  ['Religious Organization', 'religiousorganization'],
  ['Renewable Energy', 'renewableenergy'],
  ['Restaurant', 'restaurant'],
  ['Retail', 'retail'],
  ['Ride-share', 'rideshare'],
  ['Roofing', 'roofing'],
  ['Sales', 'sales'],
  ['Salon & Spa', 'salonandspa'],
  ['Security Services', 'securityservices'],
  ['Shipping', 'shipping'],
  ['Skincare', 'skincare'],
  ['Social Media Management', 'socialmediamanagement'],
  ['Software Development', 'softwaredevelopment'],
  ['Solar', 'solar'],
  ['Sporting Goods', 'sportinggoods'],
  ['Sports & Athletics', 'sportsandathletics'],
  ['Staffing', 'staffing'],
  ['Startups', 'startups'],
  ['Streaming', 'streaming'],
  ['Supply Chain', 'supplychain'],
  ['Surveying', 'surveying'],
  ['Tattoo', 'tattoo'],
  ['Tax Services', 'taxservices'],
  ['Telecommunications', 'telecommunications'],
  ['Textiles', 'textiles'],
  ['Tiling', 'tiling'],
  ['Tourism', 'tourism'],
  ['Towing', 'towing'],
  ['Trade Union', 'tradeunion'],
  ['Translation', 'translation'],
  ['Transportation', 'transportation'],
  ['Trucking', 'trucking'],
  ['Tutoring', 'tutoring'],
  ['Union & Labor', 'unionandlabor'],
  ['Utilities', 'utilities'],
  ['Venture Capital', 'venturecapital'],
  ['Veterinary', 'veterinary'],
  ['Videography', 'videography'],
  ['Virtual Assistant', 'virtualassistant'],
  ['Warehousing', 'warehousing'],
  ['Waste Management', 'wastemanagement'],
  ['Web Design', 'webdesign'],
  ['Web Development', 'webdevelopment'],
  ['Wedding Planning', 'weddingplanning'],
  ['Welding', 'welding'],
  ['Wholesale', 'wholesale'],
  ['Woodworking', 'woodworking'],
  ['Yoga & Wellness', 'yogaandwellness'],
];

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
  // Whether the account has a usable password. Google-only accounts start false
  // (they sign in with Google); set true once a password is set via reset.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS has_password BOOLEAN NOT NULL DEFAULT true;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;`);
  // Profile: a chosen @username, a base64 avatar image, and a banner photo.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banner TEXT;`);
  // Short profile bio shown on the user's profile.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;`);
  // Profile extras: where you're based, a link, and social handles (shown on
  // your profile). `socials` is a JSON object keyed by platform.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS location TEXT;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS website TEXT;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS socials JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  // Public contact details on the profile (separate from the login email).
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS contact_email TEXT;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;`);
  // A short status note ("Open to work", "Hiring", …) shown on the profile.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS note TEXT;`);
  // Date of birth — collected at signup for the 18+ age gate.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS dob DATE;`);
  // Business categories/industries the member belongs to (array of strings).
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS categories JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  // 'personal' | 'business' — chosen at signup. Business accounts are real Atwe
  // accounts (no separate company@username page) that post jobs and render with an
  // app-shaped (rounded-square) avatar.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'personal';`);
  // Business verification: 'none' | 'pending' (requested) | 'verified' (admin-approved).
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS business_verify_status TEXT NOT NULL DEFAULT 'none';`);
  // Presence: when the user was last connected (for "last seen").
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ;`);
  // Contact privacy (who can call / video / DM you). Default: everyone.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pc_everyone BOOLEAN NOT NULL DEFAULT true;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pc_following BOOLEAN NOT NULL DEFAULT false;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pc_followers BOOLEAN NOT NULL DEFAULT false;`);
  // Opt-in: only accepted connections may start a DM with me (overrides pc_*).
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS dm_connections_only BOOLEAN NOT NULL DEFAULT false;`);
  // X-style verification: a granted-by-admin `verified` flag, and the time the
  // user applied (pending review). Eligibility (Pro + complete profile +
  // confirmed email + 30-day-old account) is computed at apply time.
  // AtChat per-user chat-list prefs, synced across devices: pinned conversation
  // keys (["d2","g10"]) and the "unread only" filter toggle.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_pins JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_archived JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_muted JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  // Per-DM mute expiry: { "d2": <epoch ms> } — a key present here mutes until that
  // time; a muted key absent here (or value 0) is muted "Always". Expired entries
  // are pruned client-side and ignored by the unread query.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_mute_until JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_unread_only BOOLEAN NOT NULL DEFAULT false;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_requested_at TIMESTAMPTZ;`);

  // Active login sessions — one row per signed-in device. We store only a
  // SHA-256 hash of the JWT so a session can be revoked ("log out everywhere"
  // / remove a device) without trusting the stateless token alone.
  await query(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      user_agent TEXT,
      ip         TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id, last_seen DESC);`);
  // Approximate "City, Country" resolved from the login IP (best-effort; may be null).
  await query(`ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS location TEXT;`);

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
  // Page-by-page signup verifies the email first, so a pending row starts with
  // only the email + code; the rest is filled in at the final step.
  await query(`ALTER TABLE pending_signups ALTER COLUMN name DROP NOT NULL;`);
  await query(`ALTER TABLE pending_signups ALTER COLUMN password_hash DROP NOT NULL;`);
  await query(`ALTER TABLE pending_signups ADD COLUMN IF NOT EXISTS account_type TEXT;`);
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

  // App-wide settings (key → JSON value). Used for the site lock / private-test
  // gate (whether the site is locked, until when, and the tester access code).
  await query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key        TEXT PRIMARY KEY,
      value      JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
  // "Delete for me" on a single message — the user ids who hid this row. A row is
  // hidden from a user when their id is in this array. "Delete for everyone"
  // sets `deleted_all` (and clears the content) so both sides see a "This message
  // was deleted" tombstone, which each side can then clear for themselves.
  await query(`ALTER TABLE at_messages ADD COLUMN IF NOT EXISTS deleted_for INTEGER[] NOT NULL DEFAULT '{}';`);
  await query(`ALTER TABLE at_messages ADD COLUMN IF NOT EXISTS deleted_all BOOLEAN NOT NULL DEFAULT false;`);
  // "Hide message" — user ids who concealed this row in their own view (privacy
  // for sensitive content, e.g. a card or SSN). Shown masked behind a "Tap to
  // show" eye until tapped; persists per-user across reloads.
  await query(`ALTER TABLE at_messages ADD COLUMN IF NOT EXISTS hidden_for INTEGER[] NOT NULL DEFAULT '{}';`);
  // Emoji reactions — a JSONB map of user_id → emoji (one reaction per person,
  // iMessage-style). Empty object means no reactions.
  await query(`ALTER TABLE at_messages ADD COLUMN IF NOT EXISTS reactions JSONB NOT NULL DEFAULT '{}';`);
  // Starred (bookmarked) messages — user ids who starred this row, for their own
  // reference. Per-user, shows a small star on the bubble.
  await query(`ALTER TABLE at_messages ADD COLUMN IF NOT EXISTS starred_by INTEGER[] NOT NULL DEFAULT '{}';`);
  // Pinned messages — pinned_at set means the message is pinned for the whole
  // conversation (WhatsApp-style); shown in a pin banner. (Group counterpart is
  // added just after the at_group_messages table is created, below.)
  await query(`ALTER TABLE at_messages ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;`);
  // Disappearing messages — when a conversation has a timer on, new messages get
  // an expires_at and are filtered out (and eventually purged) after it passes.
  await query(`ALTER TABLE at_messages ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;`);
  // Per-DM disappearing-timer setting (shared by both sides; pair normalized a<b).
  await query(`
    CREATE TABLE IF NOT EXISTS dm_disappearing (
      a       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      b       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      seconds INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (a, b)
    );
  `);
  // Reply / quote — the id of the message this one is replying to (null = none).
  await query(`ALTER TABLE at_messages ADD COLUMN IF NOT EXISTS reply_to INTEGER;`);
  // Edited — true once the sender has edited the message body.
  await query(`ALTER TABLE at_messages ADD COLUMN IF NOT EXISTS edited BOOLEAN NOT NULL DEFAULT false;`);
  // Forwarded — true when the message was forwarded (shows a "Forwarded" label).
  await query(`ALTER TABLE at_messages ADD COLUMN IF NOT EXISTS forwarded BOOLEAN NOT NULL DEFAULT false;`);
  // Structured payload for rich message types (poll / event / location / contact).
  // Shape: { t:'poll'|'event'|'location'|'contact', ... } — interactive types keep
  // their live state here too (poll votes, event RSVPs).
  await query(`ALTER TABLE at_messages ADD COLUMN IF NOT EXISTS meta JSONB;`);
  // Idempotency key: the client's optimistic message id. A resend (retry / double-tap /
  // resync) carries the same key so the server returns the original row instead of
  // inserting a duplicate. NULLs are distinct, so sends without a key are unaffected.
  await query(`ALTER TABLE at_messages ADD COLUMN IF NOT EXISTS client_id TEXT;`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS at_messages_client_idx ON at_messages(sender_id, client_id);`);
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

  // Chat requests — when someone outside your "who can contact you" rules wants
  // to message you, they send a request you can allow/decline. Accepting adds
  // them to contact_allow (the grant), so they can then DM/call you. One row per
  // (requester → recipient) pair; status is pending | accepted | declined.
  await query(`
    CREATE TABLE IF NOT EXISTS chat_requests (
      id           SERIAL PRIMARY KEY,
      requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body         TEXT,
      status       TEXT NOT NULL DEFAULT 'pending',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS chat_requests_pair_idx ON chat_requests(requester_id, recipient_id);`);
  await query(`CREATE INDEX IF NOT EXISTS chat_requests_inbox_idx ON chat_requests(recipient_id, status);`);

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
  // Reposts (X-style): a user re-shares a post to their followers. One row per
  // (post, user); the count + your state come off this table.
  await query(`
    CREATE TABLE IF NOT EXISTS post_reposts (
      post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (post_id, user_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS post_reposts_user_idx ON post_reposts(user_id, created_at DESC);`);
  // Quote posts: a new post embedding another (the quoted post stays if the quoter is deleted).
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS quote_id INTEGER REFERENCES posts(id) ON DELETE SET NULL;`);
  // Who can reply to a post: 'everyone' | 'following' (people the author follows)
  // | 'mentioned' (only @mentioned accounts). Top-level posts only.
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS reply_scope TEXT NOT NULL DEFAULT 'everyone';`);
  // Bookmarks (private saves) — one row per (post, user); never shown to others.
  await query(`
    CREATE TABLE IF NOT EXISTS post_bookmarks (
      post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (post_id, user_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS post_bookmarks_user_idx ON post_bookmarks(user_id, created_at DESC);`);
  // Bookmark folders (X-style): organize saved posts. A bookmark with a NULL
  // folder_id is "unsorted". Deleting a folder leaves its bookmarks (folder → null).
  await query(`
    CREATE TABLE IF NOT EXISTS bookmark_folders (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS bookmark_folders_user_idx ON bookmark_folders(user_id);`);
  await query(`ALTER TABLE post_bookmarks ADD COLUMN IF NOT EXISTS folder_id INTEGER REFERENCES bookmark_folders(id) ON DELETE SET NULL;`);
  // Hashtags — one row per (post, tag); populated on post create. Powers tag
  // pages + trending.
  await query(`
    CREATE TABLE IF NOT EXISTS post_hashtags (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      tag     TEXT NOT NULL,
      PRIMARY KEY (post_id, tag)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS post_hashtags_tag_idx ON post_hashtags(tag);`);
  // Post views — deduped one-per-viewer-per-day; powers the view count on posts.
  await query(`
    CREATE TABLE IF NOT EXISTS post_views (
      post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      viewer_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      viewed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS post_views_post_idx ON post_views(post_id);`);
  // Lists (X-style curated timelines) — a named set of accounts owned by a user.
  await query(`
    CREATE TABLE IF NOT EXISTS lists (
      id         SERIAL PRIMARY KEY,
      owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS lists_owner_idx ON lists(owner_id, created_at DESC);`);
  await query(`
    CREATE TABLE IF NOT EXISTS list_members (
      list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (list_id, user_id)
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
  // Post editing (X-style): when set, the post was edited after publishing. The
  // body is editable by the author for a limited window; this stamps the change.
  // Multi-image posts: an array of base64 images (the single `image` column stays
  // the first one for backward compatibility / list previews).
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS images TEXT[];`);
  // Promoted posts (paid reach): when promoted_until is in the future the post is
  // injected at the top of others' For You feed with a "Promoted" label.
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS promoted_until TIMESTAMPTZ;`);
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;`);

  // Feeds — short-form status posts shown to a member's followers: a text status
  // (words on a background colour), a photo, or a small video (base64 data URL,
  // same as post media). Text statuses expire after 24h (expires_at set);
  // photos/videos are permanent (expires_at null). Follower-gated at read time.
  await query(`
    CREATE TABLE IF NOT EXISTS feed_posts (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind       TEXT NOT NULL,
      text       TEXT,
      bg         TEXT,
      media      TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS feed_posts_user_idx ON feed_posts(user_id, created_at DESC);`);
  await query(`CREATE INDEX IF NOT EXISTS feed_posts_exp_idx ON feed_posts(expires_at);`);

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
  // Official, Atwe-seeded industry circles: verified and not user-deletable.
  await query(`ALTER TABLE circles ADD COLUMN IF NOT EXISTS official BOOLEAN NOT NULL DEFAULT false;`);
  // Circle deletion requests: a creator can't delete a circle outright — they file
  // a request the Atwe team reviews. One open request per circle (status pending).
  await query(`
    CREATE TABLE IF NOT EXISTS circle_delete_requests (
      id           SERIAL PRIMARY KEY,
      circle_id    INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
      requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reason       TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS circle_delete_requests_circle_idx ON circle_delete_requests(circle_id);`);
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

  // Jobs board (the networking engine): listings + applications.
  await query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id          SERIAL PRIMARY KEY,
      posted_by   INTEGER REFERENCES users(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      company     TEXT,
      location    TEXT,
      industry    TEXT,
      type        TEXT,
      remote      BOOLEAN NOT NULL DEFAULT false,
      description TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS jobs_created_idx ON jobs(created_at DESC);`);
  await query(`CREATE INDEX IF NOT EXISTS jobs_industry_idx ON jobs(lower(industry));`);
  // Richer job details: pay range + cadence, and a free-text hours/schedule note.
  await query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_min INTEGER;`);
  await query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_max INTEGER;`);
  await query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_period TEXT;`);   // year | month | week | day | hour
  await query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS hours TEXT;`);           // e.g. "40 hrs/week", "Mon–Fri 9–5"
  // Monetization: a boosted/featured job is featured until this time (NULL = not).
  await query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS featured_until TIMESTAMPTZ;`);
  await query(`
    CREATE TABLE IF NOT EXISTS job_applications (
      job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      note       TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (job_id, user_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS job_applications_user_idx ON job_applications(user_id);`);
  // Hiring pipeline: a poster moves each applicant through statuses.
  await query(`ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'applied';`); // applied|reviewed|shortlisted|rejected|hired
  // Employers can bookmark candidates (workers / people) they like.
  await query(`
    CREATE TABLE IF NOT EXISTS saved_candidates (
      owner_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      candidate_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (owner_id, candidate_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS saved_candidates_owner_idx ON saved_candidates(owner_id);`);
  await query(`
    CREATE TABLE IF NOT EXISTS saved_jobs (
      job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (job_id, user_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS saved_jobs_user_idx ON saved_jobs(user_id);`);
  // "Open to work" listings — the other half of the jobs marketplace. One per user;
  // businesses browse these in the Workers tab the way seekers browse jobs.
  await query(`
    CREATE TABLE IF NOT EXISTS worker_listings (
      user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      role        TEXT,
      location    TEXT,
      schedule    TEXT,
      rate_min    INTEGER,
      rate_max    INTEGER,
      rate_period TEXT,
      remote      BOOLEAN NOT NULL DEFAULT false,
      about       TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS worker_listings_updated_idx ON worker_listings(updated_at DESC);`);
  // Resumes — AI-built (or manual) CVs a seeker can manage + download. `data` holds
  // the structured resume JSON ({ answers, resume }); one user can have many.
  await query(`
    CREATE TABLE IF NOT EXISTS resumes (
      id          TEXT PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title       TEXT,
      data        JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS resumes_user_idx ON resumes(user_id, updated_at DESC);`);
  // Easy Apply: an application can carry an attached resume (snapshotted at apply
  // time so the employer can view it without cross-user access) + a cover note.
  await query(`ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS resume_id TEXT;`);
  await query(`ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS resume_title TEXT;`);
  await query(`ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS resume_data JSONB;`);
  // Screening questions (employer knockouts) + the applicant's answers.
  await query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS screening JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  await query(`ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS answers JSONB;`);
  // Open-to-Work visibility: 'off' | 'recruiters' (businesses only) | 'everyone'
  // ('everyone' shows the public #OpenToWork ring on the avatar).
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS otw_visibility TEXT NOT NULL DEFAULT 'off';`);
  // Reports — generalize the existing (reporter_id, reported_id) user-report table
  // into a unified flag for jobs / worker listings / users / posts, with a status
  // so admins can work a queue. Migrate in place (idempotent).
  await query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS target_type TEXT;`);
  await query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS target_id INTEGER;`);
  await query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS note TEXT;`);
  await query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';`);
  await query(`ALTER TABLE reports ALTER COLUMN reported_id DROP NOT NULL;`).catch(() => {});
  // Backfill legacy user reports into the new shape.
  await query(`UPDATE reports SET target_type = 'user', target_id = reported_id WHERE target_type IS NULL AND reported_id IS NOT NULL;`).catch(() => {});
  await query(`CREATE INDEX IF NOT EXISTS reports_status_idx ON reports(status, created_at DESC);`);
  try { await query(`CREATE UNIQUE INDEX IF NOT EXISTS reports_open_unique_idx ON reports(reporter_id, target_type, target_id) WHERE status = 'open';`); }
  catch (e) { console.warn('⚠️  Could not build the reports unique index:', e.message); }

  // Company / business pages — claimable profiles with industry, followers + jobs.
  await query(`
    CREATE TABLE IF NOT EXISTS companies (
      id         SERIAL PRIMARY KEY,
      username   TEXT,
      name       TEXT NOT NULL,
      industry   TEXT,
      location   TEXT,
      website    TEXT,
      size       TEXT,
      logo       TEXT,
      about      TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  try { await query(`CREATE UNIQUE INDEX IF NOT EXISTS companies_username_unique_idx ON companies(lower(username)) WHERE username IS NOT NULL;`); }
  catch (e) { console.warn('⚠️  Could not build the unique company username index:', e.message); }
  await query(`CREATE INDEX IF NOT EXISTS companies_industry_idx ON companies(lower(industry));`);
  await query(`
    CREATE TABLE IF NOT EXISTS company_followers (
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (company_id, user_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS company_followers_user_idx ON company_followers(user_id);`);
  // A job can belong to a company.
  await query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL;`);

  // Professional profile: a short headline + a work-experience timeline. An entry
  // may link to a company page (company_id), which powers the page's "People here".
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS headline TEXT;`);
  await query(`
    CREATE TABLE IF NOT EXISTS experiences (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      company    TEXT,
      company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
      start_year INTEGER,
      end_year   INTEGER,            -- NULL = current role ("present")
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS experiences_user_idx ON experiences(user_id);`);
  await query(`CREATE INDEX IF NOT EXISTS experiences_company_idx ON experiences(company_id) WHERE company_id IS NOT NULL;`);
  // An experience can link to a business *account* (the new model; company_id was the
  // old company@username page). This powers a business profile's "People here".
  await query(`ALTER TABLE experiences ADD COLUMN IF NOT EXISTS company_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;`);
  await query(`CREATE INDEX IF NOT EXISTS experiences_company_user_idx ON experiences(company_user_id) WHERE company_user_id IS NOT NULL;`);

  // Saved job searches → job alerts. A new job matching a saved search (notify on)
  // pushes a 'job_match' notification to that user.
  await query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE;`);
  await query(`
    CREATE TABLE IF NOT EXISTS saved_searches (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label      TEXT,
      q          TEXT,
      industry   TEXT,
      location   TEXT,
      type       TEXT,
      remote     BOOLEAN NOT NULL DEFAULT false,
      notify     BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS saved_searches_user_idx ON saved_searches(user_id);`);
  await query(`CREATE INDEX IF NOT EXISTS saved_searches_notify_idx ON saved_searches(notify) WHERE notify = true;`);

  // Professional events (LinkedIn-style): a host (person or business) runs an
  // online or in-person event; people RSVP "going" or "interested".
  await query(`
    CREATE TABLE IF NOT EXISTS events (
      id          SERIAL PRIMARY KEY,
      host_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      starts_at   TIMESTAMPTZ NOT NULL,
      ends_at     TIMESTAMPTZ,
      online      BOOLEAN NOT NULL DEFAULT true,
      location    TEXT,
      cover       TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS events_start_idx ON events(starts_at);`);
  await query(`CREATE INDEX IF NOT EXISTS events_host_idx ON events(host_id, starts_at);`);
  await query(`
    CREATE TABLE IF NOT EXISTS event_rsvps (
      event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status     TEXT NOT NULL DEFAULT 'going',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (event_id, user_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS event_rsvps_user_idx ON event_rsvps(user_id);`);

  // Connections — the professional graph (mutual, distinct from follows). A request
  // is one row (requester→addressee, status 'pending'); accepting flips it to
  // 'accepted'. "Are we connected" checks either direction.
  await query(`
    CREATE TABLE IF NOT EXISTS connections (
      id           SERIAL PRIMARY KEY,
      requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status       TEXT NOT NULL DEFAULT 'pending',  -- pending | accepted
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (requester_id, addressee_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS connections_addressee_idx ON connections(addressee_id, status);`);
  await query(`CREATE INDEX IF NOT EXISTS connections_requester_idx ON connections(requester_id, status);`);

  // Profile views — "who viewed your profile". One row per (viewer, viewed),
  // upserted to the latest view time.
  await query(`
    CREATE TABLE IF NOT EXISTS profile_views (
      viewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      viewed_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (viewer_id, viewed_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS profile_views_viewed_idx ON profile_views(viewed_id, viewed_at DESC);`);
  // Job views — powers poster analytics (views, unique viewers, apply-rate over
  // time). Deduped to one row per viewer per job per day in the insert.
  await query(`
    CREATE TABLE IF NOT EXISTS job_views (
      job_id    INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      viewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      viewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS job_views_job_idx ON job_views(job_id, viewed_at DESC);`);

  // Skills + endorsements. A user lists skills; anyone may endorse one (one vote each).
  await query(`
    CREATE TABLE IF NOT EXISTS user_skills (
      id      SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name    TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  try { await query(`CREATE UNIQUE INDEX IF NOT EXISTS user_skills_unique_idx ON user_skills(user_id, lower(name));`); }
  catch (e) { console.warn('⚠️  Could not build the unique user_skills index:', e.message); }
  await query(`
    CREATE TABLE IF NOT EXISTS skill_endorsements (
      skill_id    INTEGER NOT NULL REFERENCES user_skills(id) ON DELETE CASCADE,
      endorser_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (skill_id, endorser_id)
    );
  `);

  // Skill assessments (LinkedIn-style): pass a quiz → a verified-skill badge.
  await query(`ALTER TABLE user_skills ADD COLUMN IF NOT EXISTS assessed BOOLEAN NOT NULL DEFAULT false;`);
  // A short-lived assessment session holds the (server-only) answer key between
  // the generate and submit calls, so scoring is never trusted from the client.
  await query(`
    CREATE TABLE IF NOT EXISTS skill_assessments (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      skill_id   INTEGER NOT NULL REFERENCES user_skills(id) ON DELETE CASCADE,
      answer_key INTEGER[] NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);

  // Written recommendations (LinkedIn-style): an author writes a recommendation
  // about a subject. It starts 'pending' (awaiting the subject's approval) and
  // becomes 'visible' on the subject's profile when they show it.
  await query(`
    CREATE TABLE IF NOT EXISTS recommendations (
      id           SERIAL PRIMARY KEY,
      author_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      relationship TEXT,
      body         TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS recommendations_pair_idx ON recommendations(author_id, subject_id);`);
  await query(`CREATE INDEX IF NOT EXISTS recommendations_subject_idx ON recommendations(subject_id, status);`);

  // Featured items (LinkedIn-style): a curated row of highlights pinned to the
  // top of a profile — your own posts, or external links.
  await query(`
    CREATE TABLE IF NOT EXISTS featured_items (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL DEFAULT 'link',
      post_id     INTEGER REFERENCES posts(id) ON DELETE CASCADE,
      url         TEXT,
      title       TEXT,
      description TEXT,
      image       TEXT,
      position    INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS featured_user_idx ON featured_items(user_id, position, created_at);`);

  // Scheduled messages (WhatsApp-style): a text message queued to send later.
  // A server-side flusher delivers due rows into at_messages / at_group_messages.
  await query(`
    CREATE TABLE IF NOT EXISTS scheduled_messages (
      id           SERIAL PRIMARY KEY,
      sender_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind         TEXT NOT NULL DEFAULT 'dm',
      recipient_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      group_id     INTEGER REFERENCES at_groups(id) ON DELETE CASCADE,
      body         TEXT NOT NULL,
      send_at      TIMESTAMPTZ NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS scheduled_due_idx ON scheduled_messages(send_at);`);
  await query(`CREATE INDEX IF NOT EXISTS scheduled_sender_idx ON scheduled_messages(sender_id, send_at);`);

  // Chat labels / folders (WhatsApp Business-style): a user tags their DMs and
  // groups with colored labels and filters the chat list by them.
  await query(`
    CREATE TABLE IF NOT EXISTS chat_labels (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      color      TEXT NOT NULL DEFAULT 'blue',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS chat_labels_user_idx ON chat_labels(user_id);`);
  await query(`
    CREATE TABLE IF NOT EXISTS chat_label_items (
      label_id  INTEGER NOT NULL REFERENCES chat_labels(id) ON DELETE CASCADE,
      kind      TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      PRIMARY KEY (label_id, kind, target_id)
    );
  `);

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
  // Per-member mute: a muted group/channel doesn't add to the unread badge.
  await query(`ALTER TABLE at_group_members ADD COLUMN IF NOT EXISTS muted BOOLEAN NOT NULL DEFAULT false;`);
  // Timed mute: NULL = muted "Always"; a future timestamp = muted until then.
  // Effective mute is `muted AND (muted_until IS NULL OR muted_until > now())`.
  await query(`ALTER TABLE at_group_members ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ;`);

  // Group join requests (for shareable group@username links). The group admin
  // (at_groups.created_by) approves; approval moves the row into at_group_members.
  await query(`
    CREATE TABLE IF NOT EXISTS group_requests (
      group_id     INTEGER NOT NULL REFERENCES at_groups(id) ON DELETE CASCADE,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (group_id, user_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS group_requests_group_idx ON group_requests(group_id);`);
  // Group notifications (request / approval) deep-link via group_id.
  await query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES at_groups(id) ON DELETE CASCADE;`);

  // Group "Cloud" — a shared drive per group: folders, files (base64), and
  // collaborative sheets. parent_id NULL = root; cascade so deleting a folder
  // removes its contents and deleting a group removes the whole cloud.
  await query(`
    CREATE TABLE IF NOT EXISTS group_cloud (
      id          SERIAL PRIMARY KEY,
      group_id    INTEGER NOT NULL REFERENCES at_groups(id) ON DELETE CASCADE,
      parent_id   INTEGER REFERENCES group_cloud(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL,
      name        TEXT NOT NULL,
      owner_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      mime        TEXT,
      media_kind  TEXT,
      size_bytes  BIGINT,
      data        TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS group_cloud_loc_idx ON group_cloud(group_id, parent_id);`);
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
  await query(`ALTER TABLE at_group_messages ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;`);
  await query(`ALTER TABLE at_group_messages ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;`);
  await query(`ALTER TABLE at_group_messages ADD COLUMN IF NOT EXISTS starred_by INTEGER[] NOT NULL DEFAULT '{}';`);
  await query(`ALTER TABLE at_groups ADD COLUMN IF NOT EXISTS disappearing INTEGER NOT NULL DEFAULT 0;`);
  // Rich attachments on group messages (see at_messages above).
  await query(`ALTER TABLE at_group_messages ADD COLUMN IF NOT EXISTS media TEXT;`);
  await query(`ALTER TABLE at_group_messages ADD COLUMN IF NOT EXISTS media_kind TEXT;`);
  await query(`ALTER TABLE at_group_messages ADD COLUMN IF NOT EXISTS media_name TEXT;`);
  await query(`ALTER TABLE at_group_messages ADD COLUMN IF NOT EXISTS forwarded BOOLEAN NOT NULL DEFAULT false;`);
  // Structured payload for rich message types (poll / event / location / contact).
  await query(`ALTER TABLE at_group_messages ADD COLUMN IF NOT EXISTS meta JSONB;`);
  // Idempotency key (see at_messages.client_id) — dedupes resent group messages.
  // Scoped per (group, sender): a client_id only needs to be unique within a group,
  // so reusing one across two groups can't return the other group's row. (Replaces
  // an earlier global (sender_id, client_id) index.)
  await query(`ALTER TABLE at_group_messages ADD COLUMN IF NOT EXISTS client_id TEXT;`);
  await query(`DROP INDEX IF EXISTS at_group_messages_client_idx;`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS at_group_messages_gclient_idx ON at_group_messages(group_id, sender_id, client_id);`);
  // Group identity: a @username (the creator becomes admin) + a display avatar.
  // `name` stays the display name; `username` is unique and grants admin (created_by).
  await query(`ALTER TABLE at_groups ADD COLUMN IF NOT EXISTS username TEXT;`);
  await query(`ALTER TABLE at_groups ADD COLUMN IF NOT EXISTS avatar TEXT;`);
  // Broadcast / "channel" mode: only the admin (created_by) can post; everyone
  // else reads (WhatsApp-Channel style).
  await query(`ALTER TABLE at_groups ADD COLUMN IF NOT EXISTS broadcast BOOLEAN NOT NULL DEFAULT false;`);
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

  // Seed the official industry circles (idempotent — skips any handle already taken).
  try {
    const ar = adminEmail ? await query('SELECT id FROM users WHERE lower(email) = $1', [adminEmail]) : { rows: [] };
    const ownerId = ar.rows[0] ? ar.rows[0].id : null;
    let seeded = 0;
    for (const [name, slug] of OFFICIAL_CIRCLES) {
      const r = await query(
        `INSERT INTO circles (username, name, created_by, official)
         SELECT $1, $2, $3, true
         WHERE NOT EXISTS (SELECT 1 FROM circles WHERE lower(username) = lower($1))`,
        [slug, name, ownerId]
      );
      seeded += r.rowCount || 0;
    }
    const slugs = OFFICIAL_CIRCLES.map(([, s]) => s.toLowerCase());
    // Keep existing seeded circles flagged official (in case the column was added later).
    await query(`UPDATE circles SET official = true WHERE official = false AND lower(username) = ANY($1)`, [slugs]);
    // Retire stale official circles that are no longer in the set — but only empty
    // ones (never remove a circle someone has joined).
    await query(
      `DELETE FROM circles c WHERE c.official = true AND lower(c.username) <> ALL($1::text[])
        AND NOT EXISTS (SELECT 1 FROM circle_members m WHERE m.circle_id = c.id)`,
      [slugs]
    );
    if (seeded) console.log(`🟣  Seeded ${seeded} official industry circle(s).`);
  } catch (e) {
    console.warn('⚠️  Could not seed official circles:', e.message);
  }

  console.log('🗄️   Database ready (users, projects, chats).');
}

// Read a single app setting (returns the parsed JSON value, or null).
async function getSetting(key) {
  const { rows } = await query('SELECT value FROM app_settings WHERE key = $1', [key]);
  return rows[0] ? rows[0].value : null;
}

// Upsert a single app setting.
async function setSetting(key, value) {
  await query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
}

module.exports = { init, query, getPool, isConfigured, getSetting, setSetting };
