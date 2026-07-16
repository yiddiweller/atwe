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
// During schema bootstrap (init), tolerate forward-reference ordering: a statement
// that fails because it references a table created LATER in init() is recorded and
// replayed afterwards, instead of aborting the whole bootstrap. This makes a brand-new
// database initialize regardless of the order of statements in init(). Outside
// bootstrap, query behaves normally (errors propagate to the caller).
let _bootstrapping = false;
const _deferredDDL = [];
function query(text, params) {
  const p = getPool().query(text, params);
  if (!_bootstrapping) return p;
  return p.catch((e) => { _deferredDDL.push({ text, params, err: e.message }); return { rows: [], rowCount: 0 }; });
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
// Run the schema bootstrap with forward-reference tolerance, then replay any deferred
// statements (those that referenced a not-yet-created table) until they all apply.
async function init() {
  if (!pool) {
    console.warn(
      '⚠️  DATABASE_URL not set — auth, history, projects and admin are disabled until a Postgres instance is attached.'
    );
    return;
  }
  _bootstrapping = true;
  _deferredDDL.length = 0;
  try { await initSchema(); }
  finally { _bootstrapping = false; }
  let pending = _deferredDDL.splice(0);
  for (let pass = 0; pass < 8 && pending.length; pass++) {
    const next = [];
    for (const s of pending) { try { await pool.query(s.text, s.params); } catch (e) { s.err = e.message; next.push(s); } }
    if (next.length === pending.length) break; // no progress — stop retrying
    pending = next;
  }
  if (pending.length) console.warn(`⚠️  ${pending.length} schema statement(s) could not be applied (e.g. "${pending[0].err}").`);
}

async function initSchema() {
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
  // The real recurring Stripe subscription behind a Pro plan (mode:'subscription'
  // Checkout) — without this, downgrading in-app could only ever flip the local
  // `plan` column and never actually stopped Stripe from billing the customer's
  // card every cycle. Set on checkout completion, cleared once cancelled.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_pro_subscription_id TEXT;`);
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
  // Circle SECTOR follows: an array of sector keys (["trades","food"]) a member follows
  // to get the whole industry's combined feed in one place (vs joining each sub-circle).
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS circle_group_follows JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_muted JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  // Per-category notification preferences: { "likes": false, ... } — a category
  // absent here defaults ON. Only the muteable social categories are gated; money,
  // messages, requests and job notifications always deliver.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  // Quality filters (X-style "muted notifications"): mute social notifications
  // from actors matching a property — { "new_account": true, ... }. All default
  // OFF (opt-in), and they never apply to people you follow.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_filters JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  // Account-privacy / visibility controls (X / WhatsApp / LinkedIn parity):
  //  - presence_visibility: who sees your online/last-active dot (everyone|connections|nobody)
  //  - connections_visible: whether others can see your connections list
  //  - who_can_request: who may send you a connection request (everyone|network|nobody)
  //  - who_can_add_groups: who may add you to group chats (everyone|connections|nobody)
  //  - share_profile_updates: broadcast a notification to connections when you update your profile
  //  - personalized: opt in/out of activity-based feed & recommendation personalization
  //  - deactivated/deactivated_at: hibernate (temporary deactivation; login reactivates)
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS presence_visibility TEXT NOT NULL DEFAULT 'everyone';`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS connections_visible BOOLEAN NOT NULL DEFAULT true;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS who_can_request TEXT NOT NULL DEFAULT 'everyone';`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS who_can_add_groups TEXT NOT NULL DEFAULT 'everyone';`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS share_profile_updates BOOLEAN NOT NULL DEFAULT true;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS personalized BOOLEAN NOT NULL DEFAULT true;`);
  //  - silence_unknown_callers: WhatsApp-style — an incoming 1:1 call from someone
  //    you don't already know (not a saved contact / connection / follow / prior DM)
  //    is silently declined instead of ringing; it still lands as a missed-call record.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS silence_unknown_callers BOOLEAN NOT NULL DEFAULT false;`);
  //  - Quiet hours / DND: while enabled and inside [dnd_start_min, dnd_end_min)
  //    (minutes since the user's local midnight; overnight windows wrap), push
  //    notification alerts are suppressed — the notification is still recorded
  //    in-app, only the banner/sound is muted. `dnd_tz_offset` is the device's
  //    UTC offset in minutes (local = UTC + offset), captured client-side so the
  //    server can evaluate the window without its own timezone.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS dnd_enabled BOOLEAN NOT NULL DEFAULT false;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS dnd_start_min INTEGER NOT NULL DEFAULT 1320;`); // 22:00
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS dnd_end_min INTEGER NOT NULL DEFAULT 420;`);   // 07:00
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS dnd_tz_offset INTEGER NOT NULL DEFAULT 0;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated BOOLEAN NOT NULL DEFAULT false;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;`);
  // Admin enforcement status (distinct from self-service `deactivated` hibernation):
  //   active   — normal
  //   suspended — temporary lock; `suspended_until` set (auto-lifts when past)
  //   banned   — permanent lock
  // `status_reason` is the moderator note, `status_by`/`status_at` the audit trail.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status_reason TEXT;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status_by INTEGER;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status_at TIMESTAMPTZ;`);
  await query(`CREATE INDEX IF NOT EXISTS users_status_idx ON users(status) WHERE status <> 'active';`);
  // Staff RBAC (least-privilege admin access). `is_admin` = superadmin (full access);
  // a scoped staff member has is_admin=false but carries permission scopes here
  // (e.g. ['refunds','ads']). `admin_role` is just the preset label for display.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_perms JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_role TEXT;`);
  // Wallet fraud hold — freeze OUTGOING money (send/cashout/pay/tip) on a suspicious
  // or compromised account while a case is investigated; incoming money still lands.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_frozen BOOLEAN NOT NULL DEFAULT false;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_frozen_reason TEXT;`);
  // Sign-in method for the "Connected accounts" display (google|apple|null).
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider TEXT;`);
  // New-user onboarding: whether they've completed the guided first-run flow, and
  // the goal they picked (hiring|job|network|sell|explore) — used to tailor it.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarded BOOLEAN NOT NULL DEFAULT false;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS intent TEXT;`);
  // Feature-intro sheets already shown to this account (array of sheet ids, e.g.
  // ["beam","circles"]). Per-account so a sheet never reappears across sessions,
  // devices or reinstalls; extensible — a new sheet just adds its id here.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS intro_seen JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  // Per-DM mute expiry: { "d2": <epoch ms> } — a key present here mutes until that
  // time; a muted key absent here (or value 0) is muted "Always". Expired entries
  // are pruned client-side and ignored by the unread query.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_mute_until JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_unread_only BOOLEAN NOT NULL DEFAULT false;`);
  // Locked / hidden chats (WhatsApp-style): a list of thread keys ("d2"/"g5") the
  // user has hidden behind a passcode, plus the bcrypt-hashed passcode itself.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_locked JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_lock_pin TEXT;`);
  // Per-conversation chat wallpaper/theme: { "d2": "<presetId>", "g5": "..." }.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_themes JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  // Two-factor (TOTP): the base32 secret (stored once enrollment begins) and a
  // flag set when the user confirms a code. Cleared on disable.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false;`);
  // Single-use 2FA recovery codes (SHA-256 hashes; plaintext shown once at setup).
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_recovery TEXT[] NOT NULL DEFAULT '{}';`);
  // Privacy: read receipts (reciprocal, like WhatsApp) + anonymous profile views
  // (LinkedIn private mode — your visits aren't recorded against you).
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS read_receipts BOOLEAN NOT NULL DEFAULT true;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS private_profile_views BOOLEAN NOT NULL DEFAULT false;`);
  // Creator subscriptions: a user can charge a monthly price for subscriber-only
  // posts. 0 (the default) = subscriptions off.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sub_price_cents INTEGER NOT NULL DEFAULT 0;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sub_blurb TEXT;`);
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

  // Admin Vault — a private, admin-only "drive" for sensitive files, folders and
  // secrets (PDFs, passwords, API keys). `kind` ∈ folder|file|secret; folders nest
  // via `parent_id` (adjacency list, root = NULL). File bytes and secret values are
  // stored ENCRYPTED AT REST (AES-256-GCM: enc_iv + enc_tag + enc_data, all base64);
  // folder rows and `name`/`note` metadata are plaintext. Never served publicly —
  // only through requireAdmin routes over HTTPS.
  await query(`
    CREATE TABLE IF NOT EXISTS admin_drive (
      id         TEXT PRIMARY KEY,
      parent_id  TEXT REFERENCES admin_drive(id) ON DELETE CASCADE,
      kind       TEXT NOT NULL,
      name       TEXT NOT NULL,
      mime       TEXT,
      size_bytes BIGINT DEFAULT 0,
      enc_iv     TEXT,
      enc_tag    TEXT,
      enc_data   TEXT,
      note       TEXT,
      created_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS admin_drive_parent_idx ON admin_drive(parent_id);`);

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
  // Multiple parallel conversations with the same person (Gmail-thread style): an
  // extra conversation is a `dm_threads` row (pair normalized a<b, optional title);
  // its messages carry that `thread_id`. `thread_id IS NULL` = the original/main
  // conversation, so all existing behavior is unchanged and extra threads are purely
  // additive. The chat list stays one row per person; a badge shows the count.
  await query(`
    CREATE TABLE IF NOT EXISTS dm_threads (
      id         SERIAL PRIMARY KEY,
      a          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- lower id
      b          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- higher id
      title      TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS dm_threads_pair_idx ON dm_threads(a, b);`);
  await query(`ALTER TABLE at_messages ADD COLUMN IF NOT EXISTS thread_id INTEGER REFERENCES dm_threads(id) ON DELETE CASCADE;`);
  await query(`CREATE INDEX IF NOT EXISTS at_messages_thread_idx ON at_messages(thread_id);`);
  // Secret messages (Telegram-style self-destruct): a `secret` message is shown once
  // and then vanishes. The countdown starts when the recipient first sees it — their
  // read stamps `expires_at = now() + SECRET_SECONDS`, after which every read query's
  // `expires_at > now()` filter drops it for both sides.
  await query(`ALTER TABLE at_messages ADD COLUMN IF NOT EXISTS secret BOOLEAN NOT NULL DEFAULT false;`);
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
  // Cached AI transcript of a voice note (computed once, stored so it isn't re-run).
  await query(`ALTER TABLE at_messages ADD COLUMN IF NOT EXISTS transcript TEXT;`);
  await query(`ALTER TABLE at_messages ADD COLUMN IF NOT EXISTS images TEXT[];`); // multi-image messages
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
  // View-once media (WhatsApp-style): the photo/video can be opened once by the
  // recipient, then it's gone. `viewed_by` records who has opened it.
  await query(`ALTER TABLE at_messages ADD COLUMN IF NOT EXISTS view_once BOOLEAN NOT NULL DEFAULT false;`);
  await query(`ALTER TABLE at_messages ADD COLUMN IF NOT EXISTS viewed_by INTEGER[] NOT NULL DEFAULT '{}';`);
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
  // "Silence unknown callers": a suppressed incoming call still logs a callee-side
  // row flagged silenced, so it shows in Recent labeled "Silenced" (never lost).
  await query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS silenced BOOLEAN NOT NULL DEFAULT false;`);

  // Call links (WhatsApp-style): a shareable code anyone signed-in can tap to join
  // an ad-hoc group call — no prior connection/group membership needed. The link
  // row persists (until revoked); the actual call room is ephemeral + in-memory.
  await query(`
    CREATE TABLE IF NOT EXISTS call_links (
      id         SERIAL PRIMARY KEY,
      code       TEXT NOT NULL UNIQUE,
      host_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      TEXT,
      media      TEXT NOT NULL DEFAULT 'video',
      active     BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS call_links_host_idx ON call_links(host_id, created_at DESC);`);

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
  // Optional per-handle price: when set (cents), the reserved name is a self-serve
  // PAID claim any member can buy from their wallet balance; NULL = not for sale
  // (admin-grant only). See the "handle claim" routes in server.js.
  await query(`ALTER TABLE reserved_usernames ADD COLUMN IF NOT EXISTS price_cents INTEGER;`);

  // Site traffic analytics — one row per app page-view (navigations only, not API
  // or asset requests). `visitor` is a stable hash of ip+user-agent so we can count
  // unique visitors without storing PII beyond the raw ip (kept for geo lookup).
  // Location is resolved once per ip into `ip_geo` (below) and JOINed at query time,
  // so a later resolution backfills the location of all that ip's past views.
  await query(`
    CREATE TABLE IF NOT EXISTS page_views (
      id         BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ip         TEXT,
      visitor    TEXT,
      path       TEXT
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS page_views_created_idx ON page_views(created_at DESC);`);
  await query(`CREATE INDEX IF NOT EXISTS page_views_ip_idx ON page_views(ip);`);
  // Client crash telemetry: the app beacons a report when a previous session died
  // WHILE VISIBLE without a clean pagehide (iOS jetsam / WebContent crash). Gives
  // us the device (ua = exact iOS version), surface and session lifetime for
  // crashes we can't reproduce locally. Read via GET /api/admin/client-crashes.
  await query(`
    CREATE TABLE IF NOT EXISTS client_crashes (
      id         BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ua         TEXT,
      surface    TEXT,
      alive_sec  INTEGER,
      standalone BOOLEAN,
      vw         INTEGER,
      vh         INTEGER,
      dpr        REAL,
      build      TEXT,
      ip         TEXT
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS client_crashes_created_idx ON client_crashes(created_at DESC);`);
  // Per-ip geo cache (resolved best-effort via geoip.js, once per ip). JOINed to
  // page_views for the "top locations" breakdown.
  await query(`
    CREATE TABLE IF NOT EXISTS ip_geo (
      ip          TEXT PRIMARY KEY,
      country     TEXT,
      city        TEXT,
      place       TEXT,
      resolved_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
  // Stories / Status: ephemeral 24h photo/text updates shown to your followers.
  // Reads always filter `expires_at > now()`; a light periodic sweep deletes the
  // expired rows. `story_views` powers unseen-rings + the author's seen-by list.
  await query(`
    CREATE TABLE IF NOT EXISTS stories (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind       TEXT NOT NULL DEFAULT 'image',   -- image | video | text
      media      TEXT,                            -- base64 data URL (image/video); null for text
      caption    TEXT,                            -- caption (image/video) or body (text)
      bg         TEXT,                            -- background preset id (text stories)
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours'
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS stories_user_idx ON stories(user_id, created_at);`);
  await query(`CREATE INDEX IF NOT EXISTS stories_exp_idx ON stories(expires_at);`);
  await query(`
    CREATE TABLE IF NOT EXISTS story_views (
      story_id  INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      viewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (story_id, viewer_id)
    );
  `);
  // Close Friends: a private story audience. A story with audience='close' is shown
  // only to people on the author's close-friends list (IG green-ring style).
  await query(`ALTER TABLE stories ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'all';`);
  await query(`
    CREATE TABLE IF NOT EXISTS close_friends (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      friend_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, friend_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS close_friends_friend_idx ON close_friends(friend_id);`);
  // Story highlights: a permanent collection pinned to a profile. Items snapshot the
  // story content (kind/media/caption/bg) so they survive the 24h story expiry.
  await query(`
    CREATE TABLE IF NOT EXISTS story_highlights (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      cover      TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS story_highlights_user_idx ON story_highlights(user_id, created_at);`);
  await query(`
    CREATE TABLE IF NOT EXISTS story_highlight_items (
      id           SERIAL PRIMARY KEY,
      highlight_id INTEGER NOT NULL REFERENCES story_highlights(id) ON DELETE CASCADE,
      kind         TEXT NOT NULL,
      media        TEXT,
      caption      TEXT,
      bg           TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS story_highlight_items_idx ON story_highlight_items(highlight_id, created_at);`);
  // Quick replies (WhatsApp-Business-style canned responses): saved message templates
  // a user inserts into a chat, optionally triggered by a "/shortcut".
  await query(`
    CREATE TABLE IF NOT EXISTS quick_replies (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      shortcut   TEXT,
      title      TEXT NOT NULL,
      body       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS quick_replies_user_idx ON quick_replies(user_id, created_at DESC);`);
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
  // Global feed ordering: makes the For You recent-fallback + any created_at DESC
  // scan over top-level main-feed posts an index scan (stop at LIMIT) instead of a
  // full table sort — a key part of the Home-load speed fix.
  await query(`CREATE INDEX IF NOT EXISTS posts_feed_created_idx ON posts(created_at DESC) WHERE parent_id IS NULL AND to_main = true;`);
  await query(`
    CREATE TABLE IF NOT EXISTS post_likes (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (post_id, user_id)
    );
  `);
  // When the like happened — lets the For You ranker decay author affinity so a
  // recent like counts more than a months-old one (existing rows default to now()).
  await query(`ALTER TABLE post_likes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();`);
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
  // Business storefront / shop: products, a per-buyer cart, and orders. Atwe's
  // commerce is chat-coordinated (an order opens a DM thread) — digital / service
  // / local goods, not shipping logistics.
  await query(`
    CREATE TABLE IF NOT EXISTS products (
      id           SERIAL PRIMARY KEY,
      business_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      description  TEXT,
      price_cents  INTEGER NOT NULL,
      image        TEXT,
      kind         TEXT NOT NULL DEFAULT 'physical',  -- physical | digital | service
      active       BOOLEAN NOT NULL DEFAULT true,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS products_business_idx ON products(business_id);`);
  // Coupons / discount codes (seller-issued). `kind` percent (value 1–100) or fixed
  // (value = cents off). Optional min-order, total usage cap, and expiry. The discount
  // is snapshotted onto the order; a redemption row is written when an order is paid.
  await query(`
    CREATE TABLE IF NOT EXISTS coupons (
      id             SERIAL PRIMARY KEY,
      seller_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code           TEXT NOT NULL,
      kind           TEXT NOT NULL DEFAULT 'percent',
      value          INTEGER NOT NULL,
      min_order_cents INTEGER NOT NULL DEFAULT 0,
      max_uses       INTEGER,
      used_count     INTEGER NOT NULL DEFAULT 0,
      expires_at     TIMESTAMPTZ,
      active         BOOLEAN NOT NULL DEFAULT true,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS coupons_seller_code_idx ON coupons(seller_id, lower(code));`);
  await query(`
    CREATE TABLE IF NOT EXISTS coupon_redemptions (
      id         SERIAL PRIMARY KEY,
      coupon_id  INTEGER NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      order_id   INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // One redemption per (coupon, buyer) — this is what actually enforces the
  // "single-use per customer" rule (the resolve-time SELECT check alone is racy:
  // a buyer could stack many pending orders on the same code). Dedupe any legacy
  // rows first so the unique index can be created.
  await query(`DELETE FROM coupon_redemptions a USING coupon_redemptions b
               WHERE a.id > b.id AND a.coupon_id = b.coupon_id AND a.user_id = b.user_id;`).catch(() => {});
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS coupon_redemptions_unique ON coupon_redemptions(coupon_id, user_id);`);
  // The slot is now CLAIMED at checkout time (order_id NULL until the order exists) so
  // a buyer can't stack the same code across several pending orders before any settle;
  // `redeemed` is only set true — and the coupon's used_count only bumped — once the
  // linked order actually pays (see applyCouponRedemption). An abandoned/failed order
  // releases its claim (DELETE ... WHERE redeemed = false) so the code isn't burned.
  await query(`ALTER TABLE coupon_redemptions ADD COLUMN IF NOT EXISTS redeemed BOOLEAN NOT NULL DEFAULT false;`);
  // Discount snapshot on an order (coupon code + cents off).
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_cents INTEGER NOT NULL DEFAULT 0;`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code TEXT;`);
  // Inventory + shipping for physical goods. `stock` NULL = unlimited (digital/service
  // or sellers who don't track it); 0 = sold out. Shipping is seller-set per item:
  // `ship_free` true = free shipping, otherwise `ship_fee_cents` (a flat fee). Digital/
  // service items never ship. (Atwe stays carrier-API-free: flat fees, no live rates.)
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INTEGER;`);
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS ship_free BOOLEAN NOT NULL DEFAULT true;`);
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS ship_fee_cents INTEGER NOT NULL DEFAULT 0;`);
  // Local pickup: a physical listing can offer in-person pickup (free, no ship-to).
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS pickup BOOLEAN NOT NULL DEFAULT false;`);
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS pickup_location TEXT;`);
  // Multiple product photos (gallery); `image` stays the first for list/back-compat.
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS images TEXT[];`);
  // Digital-product auto-delivery: the content (download link, license key or access
  // instructions) delivered to the buyer the moment a digital order is paid. Only ever
  // exposed to the product owner (for editing) and the buyer of a paid order.
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS digital_content TEXT;`);
  // Product variants (size/colour): a JSONB array of { id, label, priceCents, stock }
  // (priceCents null = use the product price; stock null = unlimited). `image`/price
  // stay the catalog defaults; a chosen variant overrides price + tracks its own stock.
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS variants JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  // A cart line / order line can reference a specific variant (snapshotted on the order).
  await query(`ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS variant_id INTEGER;`);
  // One cart line per (user, product, variant) — variant-aware (COALESCE so a NULL
  // variant is a distinct, single line). Lets a buyer hold two sizes of the same item.
  // The old PRIMARY KEY (user_id, product_id) only allowed one line per product, which
  // would block a second variant — drop it; the unique index below is the real key now.
  await query(`ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_pkey;`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS cart_items_uvp_idx ON cart_items(user_id, product_id, COALESCE(variant_id, 0));`);
  await query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_id INTEGER;`);
  await query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_label TEXT;`);
  // Back-in-stock alerts: a restock notification deep-links to the product.
  await query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS product_id INTEGER REFERENCES products(id) ON DELETE CASCADE;`);
  // Re-engagement push: when we last sent an away member a "what you missed" nudge
  // (rate-limited so we never spam). NULL = never nudged.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_reengaged_at TIMESTAMPTZ;`);
  // Split a bill / request money from several people. A split has a creator + a share
  // per participant; each share is paid into the creator's wallet (one-tap from balance).
  await query(`
    CREATE TABLE IF NOT EXISTS splits (
      id          SERIAL PRIMARY KEY,
      creator_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      total_cents INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS split_shares (
      id           SERIAL PRIMARY KEY,
      split_id     INTEGER NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount_cents INTEGER NOT NULL DEFAULT 0,
      paid         BOOLEAN NOT NULL DEFAULT false,
      paid_at      TIMESTAMPTZ,
      UNIQUE (split_id, user_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS split_shares_user_idx ON split_shares(user_id) WHERE paid = false;`);
  // Money requests (wallet "Request" action): a requester asks a payer for an
  // amount; the payer pays from balance (a normal money send) or declines.
  await query(`
    CREATE TABLE IF NOT EXISTS money_requests (
      id           SERIAL PRIMARY KEY,
      requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      payer_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount_cents INTEGER NOT NULL,
      note         TEXT,
      status       TEXT NOT NULL DEFAULT 'pending',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at  TIMESTAMPTZ
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS money_requests_payer_idx ON money_requests(payer_id) WHERE status = 'pending';`);
  await query(`CREATE INDEX IF NOT EXISTS money_requests_requester_idx ON money_requests(requester_id);`);
  // Geo coordinates for "near me" discovery (businesses/services set their own; optional).
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;`);
  // Referral program: each user gets a shareable code; a new account can claim one
  // referral (sets referred_by) which credits both wallets a one-time bonus. The
  // referrals row's UNIQUE(referred_id) makes the reward idempotent (one per account).
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by INTEGER REFERENCES users(id) ON DELETE SET NULL;`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_idx ON users(lower(referral_code)) WHERE referral_code IS NOT NULL;`);
  await query(`
    CREATE TABLE IF NOT EXISTS referrals (
      id           SERIAL PRIMARY KEY,
      referrer_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      referred_id  INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      reward_cents INTEGER NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON referrals(referrer_id);`);
  // Wishlist / save-for-later (private per user).
  await query(`
    CREATE TABLE IF NOT EXISTS saved_products (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, product_id)
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS cart_items (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      qty        INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, product_id)
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS orders (
      id          SERIAL PRIMARY KEY,
      buyer_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      seller_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      total_cents INTEGER NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',  -- pending | paid | fulfilled | cancelled
      note        TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      paid_at     TIMESTAMPTZ
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS orders_buyer_idx ON orders(buyer_id);`);
  await query(`CREATE INDEX IF NOT EXISTS orders_seller_idx ON orders(seller_id);`);
  // Escrow / buyer protection: a protected order's payment is held (funded from the
  // buyer's wallet balance, debited into escrow) until the buyer confirms receipt
  // (→ released to the seller), opens a dispute (→ admin resolves), or the
  // auto-release window passes. The lifecycle rides on orders.status:
  // pending | paid | fulfilled | cancelled  (normal)  +  escrow | disputed |
  // released | refunded  (protected).
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS escrow BOOLEAN NOT NULL DEFAULT false;`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS auto_release_at TIMESTAMPTZ;`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS dispute_reason TEXT;`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS disputed_by INTEGER;`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS disputed_at TIMESTAMPTZ;`); // when the dispute opened (SLA clock)
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;`);
  await query(`CREATE INDEX IF NOT EXISTS orders_escrow_due_idx ON orders(auto_release_at) WHERE status = 'escrow';`);
  // Physical-goods shipping on an order. The ship-to is SNAPSHOTTED onto the order at
  // checkout (like order_items snapshot name/price) so it's immutable history the seller
  // ships against. `shipping_cents` = summed seller shipping fees. Fulfillment adds a
  // carrier + tracking number and stamps shipped_at/delivered_at; `status` gains
  // 'shipped'/'delivered' for physical orders alongside the existing values.
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_cents INTEGER NOT NULL DEFAULT 0;`);
  // Sales tax snapshot on an order (0 unless a tax provider/rate is configured).
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_cents INTEGER NOT NULL DEFAULT 0;`);
  // Loyalty / rewards points: a balance + lifetime total per user, plus an append-only
  // ledger. Buyers earn points on paid orders (≈1% back) and redeem them for wallet
  // credit (100 points = $1). `points_lifetime` drives a cosmetic status tier.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS points_balance INTEGER NOT NULL DEFAULT 0;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS points_lifetime INTEGER NOT NULL DEFAULT 0;`);
  await query(`
    CREATE TABLE IF NOT EXISTS loyalty_tx (
      id            SERIAL PRIMARY KEY,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      delta         INTEGER NOT NULL,           -- + earned, − redeemed
      reason        TEXT NOT NULL,              -- order | redeem | bonus
      order_id      INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      balance_after INTEGER NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS loyalty_tx_user_idx ON loyalty_tx(user_id, created_at DESC);`);
  // Device-link QR login (WhatsApp-style "Link a device"): a logged-out device shows a
  // QR encoding a short-lived single-use code; a logged-in device scans + approves it,
  // which mints a session/JWT the new device then picks up. Only the code HASH is
  // stored; the minted token is delivered exactly once then the row is consumed.
  await query(`
    CREATE TABLE IF NOT EXISTS device_link_codes (
      id          SERIAL PRIMARY KEY,
      code_hash   TEXT NOT NULL UNIQUE,
      status      TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | consumed
      approver_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      token       TEXT,                              -- minted JWT, delivered once to the new device
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at  TIMESTAMPTZ NOT NULL
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS device_link_codes_exp_idx ON device_link_codes(expires_at);`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS needs_shipping BOOLEAN NOT NULL DEFAULT false;`);
  // Local pickup order: no ship-to; the buyer collects in person at the seller's spot.
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup BOOLEAN NOT NULL DEFAULT false;`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_location TEXT;`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_name TEXT;`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_phone TEXT;`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_line1 TEXT;`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_line2 TEXT;`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_city TEXT;`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_region TEXT;`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_postal TEXT;`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_country TEXT;`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier TEXT;`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking TEXT;`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;`);
  // A real, carrier-purchased shipping label (optional Shippo integration, shiplabels.js) —
  // set alongside carrier/tracking when the seller buys a label instead of entering
  // tracking manually. NULL when unconfigured or the seller shipped manually.
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS label_url TEXT;`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS label_cost_cents INTEGER;`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS label_transaction_id TEXT;`);
  // Claim-before-purchase: a real carrier label purchase is a genuine, non-refundable-
  // by-us external charge, so two overlapping /label/buy requests (double-click, or two
  // business_team members with the `orders` permission clicking at once) must not both
  // buy one. Cleared on failure; a stuck claim (crash mid-request) self-heals after a
  // short grace period.
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS label_claimed_at TIMESTAMPTZ;`);
  // Returns / RMA: a buyer requests a return on a paid order; the seller approves
  // (→ refund) or declines. One open return per order (partial unique below).
  await query(`
    CREATE TABLE IF NOT EXISTS order_returns (
      id          SERIAL PRIMARY KEY,
      order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      buyer_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      seller_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason      TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'requested', -- requested | approved | declined | refunded
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at TIMESTAMPTZ
    );
  `);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS order_returns_open_idx ON order_returns(order_id) WHERE status IN ('requested','approved');`);
  await query(`CREATE INDEX IF NOT EXISTS order_returns_seller_idx ON order_returns(seller_id, created_at DESC);`);
  // A real, carrier-purchased PREPAID return label (optional Shippo integration,
  // shiplabels.js) the seller buys once a return is approved, so the buyer can print it
  // and ship the item back. Additive to the existing approve-refunds-immediately flow —
  // doesn't gate or delay the refund. Visible to BOTH parties (unlike the outbound
  // label, the buyer needs this one to actually ship the return).
  await query(`ALTER TABLE order_returns ADD COLUMN IF NOT EXISTS label_url TEXT;`);
  await query(`ALTER TABLE order_returns ADD COLUMN IF NOT EXISTS label_cost_cents INTEGER;`);
  await query(`ALTER TABLE order_returns ADD COLUMN IF NOT EXISTS label_carrier TEXT;`);
  await query(`ALTER TABLE order_returns ADD COLUMN IF NOT EXISTS label_tracking TEXT;`);
  // Claim-before-purchase: a real carrier label purchase is a genuine, non-refundable-
  // by-us external charge, so two overlapping /label/buy requests (double-click, or two
  // business_team members with the `orders` permission clicking at once) must not both
  // buy one. Cleared on failure; a stuck claim (crash mid-request) self-heals after a
  // short grace period.
  await query(`ALTER TABLE order_returns ADD COLUMN IF NOT EXISTS label_claimed_at TIMESTAMPTZ;`);
  // Gift cards: store credit funded from the buyer's wallet. A unique code is
  // redeemed (once) into the redeemer's wallet balance.
  await query(`
    CREATE TABLE IF NOT EXISTS gift_cards (
      id           SERIAL PRIMARY KEY,
      code         TEXT NOT NULL UNIQUE,
      buyer_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      amount_cents INTEGER NOT NULL,
      message      TEXT,
      redeemed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
      redeemed_at  TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS gift_cards_buyer_idx ON gift_cards(buyer_id, created_at DESC);`);
  // buyer_id is provenance ("who bought/issued it"), not ownership — it must never cascade-
  // delete the row. An admin-issued company card's buyer_id is the ISSUING STAFFER; if that
  // staffer's account is later deleted, a CASCADE would silently destroy every card they
  // minted, including ones another user has since claimed with real, unspent balance. Bring
  // buyer_id in line with owner_id/recipient_id/voided_by below (all SET NULL) — losing
  // provenance on delete is fine, losing someone else's money is not.
  await query(`ALTER TABLE gift_cards ALTER COLUMN buyer_id DROP NOT NULL;`);
  await query(`ALTER TABLE gift_cards DROP CONSTRAINT IF EXISTS gift_cards_buyer_id_fkey;`);
  await query(`ALTER TABLE gift_cards ADD CONSTRAINT gift_cards_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE SET NULL;`);
  // Gift cards are a SEPARATE balance (Apple/Amazon-style), not merged into the wallet:
  //   recipient_id = who it was sent to · owner_id = current holder (spendable) ·
  //   balance_cents = remaining store credit on the card (minted = amount, drawn down on
  //   spend / move-to-wallet). The holder can spend it at checkout OR move some/all into
  //   their main wallet balance. Only the (future) Atwe debit card is tied to the wallet.
  await query(`ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS recipient_id INTEGER REFERENCES users(id) ON DELETE SET NULL;`);
  await query(`ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL;`);
  await query(`ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS balance_cents INTEGER;`);
  // Backfill existing rows: value still on the card = full amount unless already redeemed.
  await query(`UPDATE gift_cards SET balance_cents = CASE WHEN redeemed_by IS NULL THEN amount_cents ELSE 0 END WHERE balance_cents IS NULL;`);
  await query(`UPDATE gift_cards SET owner_id = redeemed_by WHERE owner_id IS NULL AND redeemed_by IS NOT NULL;`);
  await query(`ALTER TABLE gift_cards ADD CONSTRAINT gift_cards_balance_nonneg CHECK (balance_cents IS NULL OR balance_cents >= 0) NOT VALID;`).catch(() => {});
  await query(`CREATE INDEX IF NOT EXISTS gift_cards_owner_idx ON gift_cards(owner_id) WHERE owner_id IS NOT NULL;`);
  await query(`CREATE INDEX IF NOT EXISTS gift_cards_recipient_idx ON gift_cards(recipient_id) WHERE recipient_id IS NOT NULL;`);
  // Card administration (admin dashboard "Cards"): freeze/void a card (fraud/scam) and mark
  // company-issued promo cards. status active|void — a void card can't be claimed/spent/moved
  // but its balance is preserved so it can be un-voided. company_issued = comped by Atwe
  // (no buyer was charged). void_by/at + void_reason for the audit trail.
  await query(`ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';`);
  await query(`ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS void_reason TEXT;`);
  await query(`ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS voided_by INTEGER REFERENCES users(id) ON DELETE SET NULL;`);
  await query(`ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;`);
  await query(`ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS company_issued BOOLEAN NOT NULL DEFAULT false;`);
  await query(`CREATE INDEX IF NOT EXISTS gift_cards_status_idx ON gift_cards(status, created_at DESC);`);
  // Atwe Card (debit) early-access waitlist. The card itself is "coming soon"; this captures
  // who wants in (one row per user, latest email kept) until the real card program is live.
  await query(`
    CREATE TABLE IF NOT EXISTS card_waitlist (
      user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      email      TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // Payment links: a shareable "pay me" link. Fixed amount or payer-chosen; multi-use,
  // each payment transfers from the payer's wallet to the owner. Tracks running total.
  await query(`
    CREATE TABLE IF NOT EXISTS payment_links (
      id             SERIAL PRIMARY KEY,
      code           TEXT NOT NULL UNIQUE,
      user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount_cents   INTEGER,                 -- NULL = payer chooses
      note           TEXT,
      collected_cents INTEGER NOT NULL DEFAULT 0,
      pay_count      INTEGER NOT NULL DEFAULT 0,
      active         BOOLEAN NOT NULL DEFAULT true,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS payment_links_user_idx ON payment_links(user_id, created_at DESC);`);
  // Saved shipping addresses (address book). One per row; one default per user
  // (enforced in app logic). The chosen address is snapshotted onto the order.
  await query(`
    CREATE TABLE IF NOT EXISTS addresses (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      full_name   TEXT NOT NULL,
      phone       TEXT,
      line1       TEXT NOT NULL,
      line2       TEXT,
      city        TEXT NOT NULL,
      region      TEXT,
      postal      TEXT,
      country     TEXT NOT NULL DEFAULT 'US',
      is_default  BOOLEAN NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS addresses_user_idx ON addresses(user_id);`);
  // Per-product reviews (Amazon-style): a 1–5 star rating + optional text, one per
  // (product, reviewer). VERIFIED-PURCHASE only — enforced server-side (the reviewer
  // must have a paid/fulfilled/delivered order containing the product).
  await query(`
    CREATE TABLE IF NOT EXISTS product_reviews (
      id          SERIAL PRIMARY KEY,
      product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      reviewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      body        TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (product_id, reviewer_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS product_reviews_product_idx ON product_reviews(product_id);`);
  // Photos/video attached to a product review (data URLs; images + an optional clip).
  await query(`ALTER TABLE product_reviews ADD COLUMN IF NOT EXISTS media TEXT[] NOT NULL DEFAULT '{}';`);
  // Two-way reviews: a seller rates the BUYER after an order completes (mirrors
  // product_reviews). Feeds the unified trust score. One per order.
  await query(`
    CREATE TABLE IF NOT EXISTS buyer_reviews (
      id          SERIAL PRIMARY KEY,
      order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      subject_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- the buyer being rated
      author_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- the seller rating
      rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      body        TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (order_id, author_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS buyer_reviews_subject_idx ON buyer_reviews(subject_id);`);
  // Saved marketplace searches: a buyer saves a query (+ optional kind); a newly
  // posted listing matching it notifies them (mirrors jobs' saved_searches).
  await query(`
    CREATE TABLE IF NOT EXISTS saved_market_searches (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      q          TEXT NOT NULL,
      kind       TEXT,                            -- physical | digital | service | null = any
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS saved_market_searches_user_idx ON saved_market_searches(user_id);`);
  // Affiliate / creator commissions: any user can generate a referral link for a
  // product; a purchase through it credits them a % of the sale (from the seller's
  // proceeds). `affiliate_links` maps a code → (promoter, product); `affiliate_earnings`
  // logs each paid commission. Orders carry the attributed promoter + commission.
  await query(`
    CREATE TABLE IF NOT EXISTS affiliate_links (
      id          SERIAL PRIMARY KEY,
      code        TEXT NOT NULL UNIQUE,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- the promoter
      product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      clicks      INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, product_id)
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS affiliate_earnings (
      id           SERIAL PRIMARY KEY,
      affiliate_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id   INTEGER REFERENCES products(id) ON DELETE SET NULL,
      amount_cents INTEGER NOT NULL,
      paid         BOOLEAN NOT NULL DEFAULT false,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (order_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS affiliate_earnings_aff_idx ON affiliate_earnings(affiliate_id, created_at);`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS affiliate_id INTEGER;`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission_cents INTEGER NOT NULL DEFAULT 0;`);
  await query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id          SERIAL PRIMARY KEY,
      order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id  INTEGER REFERENCES products(id) ON DELETE SET NULL,
      name        TEXT NOT NULL,        -- snapshot, so later product edits don't change history
      price_cents INTEGER NOT NULL,
      qty         INTEGER NOT NULL DEFAULT 1
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id);`);
  // Make an offer: a buyer proposes a price on a listing; the seller accepts /
  // counters / declines. On accept the buyer pays at the agreed amount, which builds
  // a normal order (so fulfilment/escrow/reviews all work). `turn` = whose move it is.
  await query(`
    CREATE TABLE IF NOT EXISTS offers (
      id           SERIAL PRIMARY KEY,
      product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      buyer_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      seller_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount_cents INTEGER NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',  -- pending | countered | accepted | declined | paid | cancelled
      turn         TEXT NOT NULL DEFAULT 'seller',   -- whose move: 'seller' (buyer offered) | 'buyer' (seller countered)
      order_id     INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS offers_buyer_idx ON offers(buyer_id, created_at);`);
  await query(`CREATE INDEX IF NOT EXISTS offers_seller_idx ON offers(seller_id, created_at);`);
  // Product bundles: a seller groups several of their OWN products into a single
  // bundle sold at one (usually discounted) price. Buying a bundle creates a normal
  // order whose order_items are the bundle's components — so fulfilment, escrow,
  // reviews, shipping and the wallet all work unchanged. `price_cents` is the bundle
  // price the buyer pays; the per-component retail total (and the savings) is derived.
  await query(`
    CREATE TABLE IF NOT EXISTS bundles (
      id          SERIAL PRIMARY KEY,
      seller_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      description TEXT,
      image       TEXT,
      price_cents INTEGER NOT NULL,
      active      BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS bundles_seller_idx ON bundles(seller_id);`);
  await query(`
    CREATE TABLE IF NOT EXISTS bundle_items (
      id         SERIAL PRIMARY KEY,
      bundle_id  INTEGER NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      qty        INTEGER NOT NULL DEFAULT 1
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS bundle_items_bundle_idx ON bundle_items(bundle_id);`);
  // Subscribe & Save (recurring products): a seller can offer a recurring-delivery
  // discount on a physical product (sub_enabled + sub_discount_pct, 0–50%). A buyer
  // then subscribes to receive it on a cadence; each cycle a background flusher
  // creates + pays a normal order from the buyer's wallet balance (so fulfilment,
  // shipping, stock and reviews all work unchanged). ship_to snapshots the address.
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS sub_enabled BOOLEAN NOT NULL DEFAULT false;`);
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS sub_discount_pct INTEGER NOT NULL DEFAULT 0;`);
  // Universal structured details so ANY industry presents properly: an amenities/
  // features checklist (Wi-Fi, A/C, parking…) + a key-value specs grid (bedrooms: 2,
  // size: 900 sqft…). Shown as chips on the listing. Empty by default = unchanged.
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS amenities TEXT[] NOT NULL DEFAULT '{}';`);
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS specs JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  // Rentals vertical: a rental listing (kind='rental') priced per night/month with
  // date-range bookings (see rental_bookings). rental_period gates the booking UI.
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS rental_period TEXT;`); // 'night' | 'month' (null = not a rental)
  // Catalog category / menu section (free text): groups a seller's products into
  // sections on the storefront — restaurant menus (Starters/Mains/Drinks), retail
  // collections, etc. null = "Other" / ungrouped.
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS category TEXT;`);
  await query(`
    CREATE TABLE IF NOT EXISTS product_subscriptions (
      id            SERIAL PRIMARY KEY,
      buyer_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      seller_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      variant_id    INTEGER,
      qty           INTEGER NOT NULL DEFAULT 1,
      interval_days INTEGER NOT NULL,
      discount_pct  INTEGER NOT NULL DEFAULT 0,   -- snapshot at subscribe time
      ship_to       JSONB,                        -- snapshot address (physical goods)
      status        TEXT NOT NULL DEFAULT 'active', -- active | paused | cancelled
      next_at       TIMESTAMPTZ NOT NULL,
      last_order_id INTEGER,
      fail_count    INTEGER NOT NULL DEFAULT 0,    -- consecutive payment/stock failures
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS product_subs_buyer_idx ON product_subscriptions(buyer_id);`);
  await query(`CREATE INDEX IF NOT EXISTS product_subs_due_idx ON product_subscriptions(next_at) WHERE status = 'active';`);
  // Recurring / scheduled payments: a Cash App-style standing order. A user sets up a
  // payment to another @username that runs once at a future date (interval_days NULL)
  // or repeats on a cadence. Each run transfers from the sender's wallet balance.
  await query(`
    CREATE TABLE IF NOT EXISTS scheduled_payments (
      id            SERIAL PRIMARY KEY,
      from_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount_cents  INTEGER NOT NULL,
      note          TEXT,
      interval_days INTEGER,                         -- NULL = one-time; else recurring cadence
      status        TEXT NOT NULL DEFAULT 'active',  -- active | paused | completed | cancelled
      next_at       TIMESTAMPTZ NOT NULL,
      last_paid_at  TIMESTAMPTZ,
      runs          INTEGER NOT NULL DEFAULT 0,
      fail_count    INTEGER NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS sched_pay_from_idx ON scheduled_payments(from_id);`);
  await query(`CREATE INDEX IF NOT EXISTS sched_pay_due_idx ON scheduled_payments(next_at) WHERE status = 'active';`);
  // Invoices / payment requests (the "get paid" layer): a user bills another for
  // work. Delivered as a Pay card in the DM thread; paid via Stripe or demo-grant.
  await query(`
    CREATE TABLE IF NOT EXISTS invoices (
      id           SERIAL PRIMARY KEY,
      issuer_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      customer_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title        TEXT NOT NULL,
      items        JSONB,
      amount_cents INTEGER NOT NULL,
      note         TEXT,
      due_at       TIMESTAMPTZ,
      status       TEXT NOT NULL DEFAULT 'sent',   -- sent | paid | cancelled
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      paid_at      TIMESTAMPTZ
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS invoices_customer_idx ON invoices(customer_id);`);
  await query(`CREATE INDEX IF NOT EXISTS invoices_issuer_idx ON invoices(issuer_id);`);
  // Claim-before-charge: a transient 'paying' status (between 'sent' and 'paid') plus
  // when it was claimed, so a double-tap/two-tab pay can't create two Stripe Checkout
  // sessions for the same invoice, and an abandoned checkout can be retried after a
  // grace period instead of leaving the invoice stuck forever.
  await query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pay_claimed_at TIMESTAMPTZ;`);
  // Quotes / estimates: a service provider sends a customer a priced proposal the
  // customer ACCEPTS or DECLINES *before* work. Accepting converts it into an
  // invoice (invoice_id) the customer then pays — so quotes reuse the whole
  // invoice/payment pipeline. Distinct from "offers" (buyer-initiated on a listing).
  await query(`
    CREATE TABLE IF NOT EXISTS quotes (
      id           SERIAL PRIMARY KEY,
      issuer_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      customer_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title        TEXT NOT NULL,
      items        JSONB,
      amount_cents INTEGER NOT NULL,
      note         TEXT,
      valid_until  TIMESTAMPTZ,
      status       TEXT NOT NULL DEFAULT 'sent',   -- sent | accepted | declined | cancelled | expired
      invoice_id   INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      responded_at TIMESTAMPTZ
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS quotes_customer_idx ON quotes(customer_id, created_at DESC);`);
  await query(`CREATE INDEX IF NOT EXISTS quotes_issuer_idx ON quotes(issuer_id, created_at DESC);`);
  // Followed hashtags (X-style): a user follows a #tag to keep an eye on it.
  await query(`
    CREATE TABLE IF NOT EXISTS hashtag_follows (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tag        TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, tag)
    );
  `);
  // Post views — deduped one-per-viewer-per-day; powers the view count on posts.
  await query(`
    CREATE TABLE IF NOT EXISTS post_views (
      post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      viewer_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      viewed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS post_views_post_idx ON post_views(post_id);`);
  // Dwell time — how long a viewer actually lingers on a post in the feed (the
  // single strongest implicit-interest signal the big platforms use). One row per
  // (post, viewer) accumulating milliseconds; author_id is denormalized so the
  // For You ranker can cheaply find "the authors you spend the most time on".
  await query(`
    CREATE TABLE IF NOT EXISTS post_dwell (
      post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      viewer_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      author_id  INTEGER,
      ms         INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (post_id, viewer_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS post_dwell_affinity_idx ON post_dwell(viewer_id, author_id, updated_at DESC);`);
  // Feed-ranking observability — which ranking SIGNALS drove each served impression
  // (top positions of the For You feed). Joined later to engagement (the same viewer
  // liking/viewing that post) to measure each signal's real lift, so the boost
  // weights can be tuned from data instead of by hand. Pruned to a short window.
  await query(`
    CREATE TABLE IF NOT EXISTS feed_impressions (
      id         BIGSERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      position   INTEGER NOT NULL,
      signals    TEXT[] NOT NULL DEFAULT '{}',
      score      REAL,
      served_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS feed_impressions_served_idx ON feed_impressions(served_at);`);
  await query(`CREATE INDEX IF NOT EXISTS feed_impressions_up_idx ON feed_impressions(user_id, post_id);`);
  // Powers already-seen suppression: "posts served to this viewer in the last few hours".
  await query(`CREATE INDEX IF NOT EXISTS feed_impressions_user_served_idx ON feed_impressions(user_id, served_at);`);
  // Muted accounts (X-style): hide a user's posts from the muter's feeds without
  // blocking or unfollowing. One-directional; the mutee is never notified.
  await query(`
    CREATE TABLE IF NOT EXISTS post_mutes (
      muter_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      muted_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (muter_id, muted_id)
    );
  `);
  // Muted keywords: posts whose body matches any of the muter's words are hidden
  // from their feeds (own posts excepted).
  await query(`
    CREATE TABLE IF NOT EXISTS muted_keywords (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      word       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS muted_keywords_unique_idx ON muted_keywords(user_id, lower(word));`);
  // "Not interested" — a per-post negative signal. The post is hidden from the
  // viewer's feeds, and the viewer's hidden-author tally down-ranks that author.
  await query(`
    CREATE TABLE IF NOT EXISTS post_hides (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      author_id  INTEGER REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, post_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS post_hides_author_idx ON post_hides(user_id, author_id);`);
  // Recent searches — both a "recent searches" affordance and a soft interest signal.
  await query(`
    CREATE TABLE IF NOT EXISTS search_history (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      q          TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, q)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS search_history_recent_idx ON search_history(user_id, created_at DESC);`);
  // Post drafts: half-written posts saved server-side, restorable in the composer.
  await query(`
    CREATE TABLE IF NOT EXISTS post_drafts (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body       TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS post_drafts_user_idx ON post_drafts(user_id);`);
  // A pinned post highlighted at the top of the user's profile (X-style).
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pinned_post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL;`);
  // Creator subscriptions: one row per (subscriber → creator). Access lasts while
  // status='active' AND period_end > now (renewed monthly by the Stripe webhook,
  // or demo-granted for 30 days when Stripe isn't configured).
  await query(`
    CREATE TABLE IF NOT EXISTS creator_subs (
      subscriber_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      creator_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status        TEXT NOT NULL DEFAULT 'active',
      period_end    TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (subscriber_id, creator_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS creator_subs_creator_idx ON creator_subs(creator_id);`);
  // The real recurring Stripe subscription behind a paid creator sub — without this,
  // cancelling in-app could only ever flip `status` and never actually stopped
  // Stripe from renewing/billing the subscriber's card every month.
  await query(`ALTER TABLE creator_subs ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;`);
  // Multi-tier creator subscriptions: a creator can offer several priced tiers
  // (e.g. Supporter / Superfan / VIP), each with its own monthly price + perks blurb
  // and a `level` (higher = more access). A subscription points at the chosen tier
  // (creator_subs.tier_id; NULL = a legacy single-price sub, treated as level 0).
  // Subscriber-only posts may require a minimum tier level (posts.min_tier_level).
  await query(`
    CREATE TABLE IF NOT EXISTS creator_tiers (
      id          SERIAL PRIMARY KEY,
      creator_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      blurb       TEXT,
      level       INTEGER NOT NULL DEFAULT 1,   -- rank; higher unlocks more
      active      BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS creator_tiers_creator_idx ON creator_tiers(creator_id);`);
  await query(`ALTER TABLE creator_subs ADD COLUMN IF NOT EXISTS tier_id INTEGER REFERENCES creator_tiers(id) ON DELETE SET NULL;`);
  // Subscriber-only posts: visible to the author + active subscribers only.
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS subscribers_only BOOLEAN NOT NULL DEFAULT false;`);
  // Minimum subscription tier level required to view a subscriber-only post (0 = any tier).
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS min_tier_level INTEGER NOT NULL DEFAULT 0;`);
  // Pay-per-view: a one-time price to unlock a single post's content. NULL/0 = free.
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS ppv_cents INTEGER;`);
  await query(`
    CREATE TABLE IF NOT EXISTS post_unlocks (
      post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (post_id, user_id)
    );
  `);
  // Alt text (accessibility) for a post's image.
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_alt TEXT;`);
  // Tagged people on a post (IG-style "tag people"). A post can also have one or
  // more co-authors (collaborator posts) — both are user references on the post.
  await query(`
    CREATE TABLE IF NOT EXISTS post_tags (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind    TEXT NOT NULL DEFAULT 'tag',  -- 'tag' (tagged person) | 'author' (co-author)
      PRIMARY KEY (post_id, user_id, kind)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS post_tags_user_idx ON post_tags(user_id, kind);`);
  // Web Push subscriptions (one row per browser/device that opted in).
  await query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint   TEXT NOT NULL,
      p256dh     TEXT NOT NULL,
      auth       TEXT NOT NULL,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_idx ON push_subscriptions(endpoint);`);
  await query(`CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions(user_id);`);
  // Communities (WhatsApp/X-style): an umbrella over several sub-groups + an
  // auto-created broadcast "announcement" channel. Members join the community
  // (and its announcement channel); sub-groups are at_groups linked here.
  await query(`
    CREATE TABLE IF NOT EXISTS communities (
      id                SERIAL PRIMARY KEY,
      name              TEXT NOT NULL,
      description       TEXT,
      avatar            TEXT,
      created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
      announce_group_id INTEGER REFERENCES at_groups(id) ON DELETE SET NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS community_members (
      community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role         TEXT NOT NULL DEFAULT 'member',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (community_id, user_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS community_members_user_idx ON community_members(user_id);`);
  await query(`
    CREATE TABLE IF NOT EXISTS community_groups (
      community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      group_id     INTEGER NOT NULL REFERENCES at_groups(id) ON DELETE CASCADE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (community_id, group_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS community_groups_group_idx ON community_groups(group_id);`);
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
  // A tagged product (Home §product-tag): a blue price chip over the post media that
  // opens the listing. Only ever the poster's OWN active product (validated on write).
  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS product_id INTEGER REFERENCES products(id) ON DELETE SET NULL;`);
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

  // Product tags (multi) — a piece of content (a post, a reel/short feed_post, or a
  // 24h story) can tag up to 5 of the poster's OWN active products. Each tag renders
  // as a blue price chip / "View products" indicator over the media that opens a
  // quick-buy preview → the normal wallet checkout. Backward-compatible with the
  // single legacy `posts.product_id` (that column stays the first tag for old rows /
  // list previews; this table is the source of truth for multi-tags). `content_id`
  // is polymorphic (no FK — ids are never reused since all three sources are SERIAL,
  // so a deleted-content orphan is harmless and never re-read). Deleting a product
  // cascades its tag rows away. Ownership + active are validated on write.
  await query(`
    CREATE TABLE IF NOT EXISTS content_product_tags (
      id           SERIAL PRIMARY KEY,
      content_kind TEXT NOT NULL,               -- 'post' | 'feedpost' | 'story'
      content_id   INTEGER NOT NULL,
      product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      position     INTEGER NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS content_product_tags_unique ON content_product_tags(content_kind, content_id, product_id);`);
  await query(`CREATE INDEX IF NOT EXISTS content_product_tags_lookup ON content_product_tags(content_kind, content_id, position);`);
  await query(`CREATE INDEX IF NOT EXISTS content_product_tags_product_idx ON content_product_tags(product_id);`);
  // Product tag taps (analytics) — a viewer opened the quick-buy preview for a tagged
  // product. Append-only; aggregated for the seller's Business dashboard "tag taps".
  await query(`
    CREATE TABLE IF NOT EXISTS product_tag_taps (
      id           SERIAL PRIMARY KEY,
      product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      content_kind TEXT,
      content_id   INTEGER,
      tapper_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS product_tag_taps_product_idx ON product_tag_taps(product_id, created_at DESC);`);

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
  // TikTok/LinkedIn-Video-style engagement on the immersive shorts/feed viewer:
  // a like/dislike vote, threaded-flat comments (with their own likes), and saves.
  await query(`
    CREATE TABLE IF NOT EXISTS feed_post_likes (
      post_id    INTEGER NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      value      SMALLINT NOT NULL DEFAULT 1,   -- 1 = like, -1 = dislike
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (post_id, user_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS feed_post_likes_post_idx ON feed_post_likes(post_id, value);`);
  await query(`
    CREATE TABLE IF NOT EXISTS feed_post_comments (
      id         SERIAL PRIMARY KEY,
      post_id    INTEGER NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS feed_post_comments_post_idx ON feed_post_comments(post_id, created_at);`);
  await query(`
    CREATE TABLE IF NOT EXISTS feed_comment_likes (
      comment_id INTEGER NOT NULL REFERENCES feed_post_comments(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (comment_id, user_id)
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS feed_post_saves (
      post_id    INTEGER NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (post_id, user_id)
    );
  `);

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
  await query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS auto BOOLEAN NOT NULL DEFAULT false;`); // AI/heuristic auto-flag
  await query(`ALTER TABLE reports ALTER COLUMN reported_id DROP NOT NULL;`).catch(() => {});
  // Backfill legacy user reports into the new shape.
  await query(`UPDATE reports SET target_type = 'user', target_id = reported_id WHERE target_type IS NULL AND reported_id IS NOT NULL;`).catch(() => {});
  await query(`CREATE INDEX IF NOT EXISTS reports_status_idx ON reports(status, created_at DESC);`);
  try { await query(`CREATE UNIQUE INDEX IF NOT EXISTS reports_open_unique_idx ON reports(reporter_id, target_type, target_id) WHERE status = 'open';`); }
  catch (e) { console.warn('⚠️  Could not build the reports unique index:', e.message); }

  // Admin audit log — an append-only record of every staff action (who did what,
  // to whom, when, from where). The #1 accountability tool a real platform needs:
  // insider-abuse forensics, compliance, breach response. Never updated/deleted by
  // the app (only pruned by age). `meta` carries action-specific detail.
  await query(`
    CREATE TABLE IF NOT EXISTS admin_audit (
      id          SERIAL PRIMARY KEY,
      actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_name  TEXT,
      action      TEXT NOT NULL,          -- e.g. user.ban, dispute.resolve, ad.approve
      target_type TEXT,                   -- user | post | order | ad | report | ...
      target_id   TEXT,
      meta        JSONB NOT NULL DEFAULT '{}'::jsonb,
      ip          TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit(created_at DESC);`);
  await query(`CREATE INDEX IF NOT EXISTS admin_audit_actor_idx ON admin_audit(actor_id, created_at DESC);`);
  await query(`CREATE INDEX IF NOT EXISTS admin_audit_target_idx ON admin_audit(target_type, target_id);`);
  await query(`CREATE INDEX IF NOT EXISTS admin_audit_action_idx ON admin_audit(action, created_at DESC);`);

  // AI moderation scanner — an admin sweep of PUBLIC content (posts, group messages,
  // listings, ads, showcases, profiles) for inappropriate behavior. A scan run is a
  // `moderation_scans` row; each hit is a `moderation_flags` row the admin can action.
  // (Private 1:1 DMs are never scanned.)
  await query(`
    CREATE TABLE IF NOT EXISTS moderation_scans (
      id         SERIAL PRIMARY KEY,
      admin_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      scope      TEXT NOT NULL,               -- full | posts | groups | listings | profiles | ads | user | group
      label      TEXT,                        -- human label (e.g. "@username" or "Group: Foo")
      status     TEXT NOT NULL DEFAULT 'running', -- running | done | error
      scanned    INTEGER NOT NULL DEFAULT 0,
      flagged    INTEGER NOT NULL DEFAULT 0,
      ai         BOOLEAN NOT NULL DEFAULT false,  -- whether AI was used (vs heuristic-only)
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS moderation_scans_idx ON moderation_scans(created_at DESC);`);
  await query(`
    CREATE TABLE IF NOT EXISTS moderation_flags (
      id         SERIAL PRIMARY KEY,
      scan_id    INTEGER REFERENCES moderation_scans(id) ON DELETE CASCADE,
      kind       TEXT NOT NULL,               -- post | group_message | listing | showcase | review | ad | profile
      target_id  INTEGER,                     -- id of the flagged item
      owner_id   INTEGER REFERENCES users(id) ON DELETE CASCADE, -- the responsible account
      group_id   INTEGER,                     -- set when the content is inside a group
      category   TEXT,                        -- harassment | hate | violence | sexual | scam | spam | illegal | other
      severity   TEXT,                        -- low | medium | high
      reason     TEXT,
      excerpt    TEXT,
      status     TEXT NOT NULL DEFAULT 'open',-- open | actioned | dismissed
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS moderation_flags_status_idx ON moderation_flags(status, severity, created_at DESC);`);
  await query(`CREATE INDEX IF NOT EXISTS moderation_flags_scan_idx ON moderation_flags(scan_id);`);
  await query(`CREATE INDEX IF NOT EXISTS moderation_flags_owner_idx ON moderation_flags(owner_id);`);

  // Platform activity feed — the superadmin "everything that's happening" firehose:
  // BOTH staff actions (mirrored from admin_audit) AND member/system events (a new
  // signup, a self-deletion, a refund requested, a report/dispute/appeal filed, a
  // payment). Append-only; distinct from admin_audit, which stays the clean staff-only
  // compliance record. `category` groups the feed (account|money|moderation|content|
  // system|staff); actor = who did it (member/staff/null for system).
  await query(`
    CREATE TABLE IF NOT EXISTS platform_events (
      id           SERIAL PRIMARY KEY,
      category     TEXT NOT NULL,
      action       TEXT NOT NULL,
      actor_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_name   TEXT,
      subject_type TEXT,
      subject_id   TEXT,
      subject_name TEXT,
      meta         JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS platform_events_created_idx ON platform_events(created_at DESC);`);
  await query(`CREATE INDEX IF NOT EXISTS platform_events_cat_idx ON platform_events(category, created_at DESC);`);

  // Impersonation ("view as user") sessions — a support agent temporarily views a
  // member's account to reproduce an issue. Every session is recorded (who, whom, why,
  // when, until) so the access is fully auditable; the token itself is short-lived.
  await query(`
    CREATE TABLE IF NOT EXISTS impersonation_sessions (
      id          SERIAL PRIMARY KEY,
      admin_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      admin_name  TEXT,
      target_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
      reason      TEXT,
      ip          TEXT,
      started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at  TIMESTAMPTZ,
      ended_at    TIMESTAMPTZ
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS impersonation_started_idx ON impersonation_sessions(started_at DESC);`);

  // Refund requests — the help-center "I paid for X by mistake / it went wrong" flow.
  // A member files against a specific payment they made (ad/boost/promote/pro/order/tip);
  // staff with the `refunds` scope review and approve (money reversed) or decline.
  // `amount_cents` is snapshotted at request time for context; staff confirm the final
  // refunded amount on approval.
  await query(`
    CREATE TABLE IF NOT EXISTS refund_requests (
      id           SERIAL PRIMARY KEY,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind         TEXT NOT NULL,          -- ad | boost | promote | pro | order | tip
      ref_id       TEXT,                   -- the campaign/job/post/order/tip id it's about
      amount_cents INTEGER NOT NULL DEFAULT 0,
      reason       TEXT,
      status       TEXT NOT NULL DEFAULT 'open',  -- open | approved | declined
      resolution_note TEXT,
      refunded_cents  INTEGER,             -- what was actually refunded (on approve)
      resolved_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
      resolved_at  TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS refund_requests_status_idx ON refund_requests(status, created_at DESC);`);
  await query(`CREATE INDEX IF NOT EXISTS refund_requests_user_idx ON refund_requests(user_id, created_at DESC);`);
  // Prevent duplicate OPEN requests against the same payment.
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS refund_requests_open_idx ON refund_requests(user_id, kind, ref_id) WHERE status = 'open';`);

  // Appeals — a suspended/banned member contests the decision. They can't log in, so
  // the appeal is filed from the sign-in screen by re-proving the password. Staff
  // grant (reinstate) or deny with a note. One open appeal per member.
  await query(`
    CREATE TABLE IF NOT EXISTS appeals (
      id           SERIAL PRIMARY KEY,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status_kind  TEXT,                   -- the enforcement being appealed: suspended | banned
      message      TEXT,                   -- the member's statement
      state        TEXT NOT NULL DEFAULT 'open',  -- open | granted | denied
      review_note  TEXT,
      reviewed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
      resolved_at  TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS appeals_state_idx ON appeals(state, created_at DESC);`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS appeals_open_idx ON appeals(user_id) WHERE state = 'open';`);

  // GDPR/CCPA data-subject requests — a tracked record that a member asked for a copy
  // of their data (`export`) or account erasure (`delete`), with the legal deadline
  // (`due_at`) so staff can resolve it in time and prove it was handled. Self-serve
  // export/delete already exist; this is the compliance PAPER TRAIL on top.
  await query(`
    CREATE TABLE IF NOT EXISTS data_requests (
      id           SERIAL PRIMARY KEY,
      user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      email        TEXT,                   -- kept so the record survives a delete
      kind         TEXT NOT NULL,          -- export | delete
      note         TEXT,
      state        TEXT NOT NULL DEFAULT 'open',  -- open | completed | rejected
      resolution_note TEXT,
      due_at       TIMESTAMPTZ,            -- legal deadline (created + 30 days)
      handled_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      resolved_at  TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS data_requests_state_idx ON data_requests(state, due_at);`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS data_requests_open_idx ON data_requests(user_id, kind) WHERE state = 'open';`);

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

  // Education — a user's schools/degrees (LinkedIn-style), same timeline shape as
  // experiences. end_year NULL = "expected"/ongoing.
  await query(`
    CREATE TABLE IF NOT EXISTS education (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      school     TEXT NOT NULL,
      degree     TEXT,
      field      TEXT,
      start_year INTEGER,
      end_year   INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS education_user_idx ON education(user_id);`);

  // Licenses & certifications — name + issuer + optional credential id/url and
  // issue/expiry years.
  await query(`
    CREATE TABLE IF NOT EXISTS certifications (
      id            SERIAL PRIMARY KEY,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      issuer        TEXT,
      issue_year    INTEGER,
      expire_year   INTEGER,
      credential_id TEXT,
      url           TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS certifications_user_idx ON certifications(user_id);`);

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
  // Services / local directory: a first-class "service I offer" (party planner,
  // magician, agent, plumber…). Category is open-ended (not a fixed enum) and
  // `area` is the location served, so discovery is category + area driven — the
  // model real services platforms (Thumbtack/Bark/Angi) use.
  await query(`
    CREATE TABLE IF NOT EXISTS services (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      category    TEXT,
      area        TEXT,
      rate        TEXT,          -- free text: "from $200", "$50/hr", "Free quote"
      description TEXT,
      image       TEXT,
      active      BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS services_user_idx ON services(user_id);`);
  await query(`CREATE INDEX IF NOT EXISTS services_active_idx ON services(active, created_at DESC);`);
  // Same universal details layer on services (amenities + key-value specs).
  await query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS amenities TEXT[] NOT NULL DEFAULT '{}';`);
  await query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS specs JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  // Rental bookings — date-range reservations against a rental product.
  await query(`
    CREATE TABLE IF NOT EXISTS rental_bookings (
      id          SERIAL PRIMARY KEY,
      product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      guest_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      host_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      start_date  DATE NOT NULL,
      end_date    DATE NOT NULL,
      units       INTEGER NOT NULL DEFAULT 1,
      total_cents INTEGER NOT NULL DEFAULT 0,
      status      TEXT NOT NULL DEFAULT 'requested',
      note        TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS rental_bookings_guest_idx ON rental_bookings(guest_id, created_at DESC);`);
  await query(`CREATE INDEX IF NOT EXISTS rental_bookings_host_idx ON rental_bookings(host_id, created_at DESC);`);
  await query(`CREATE INDEX IF NOT EXISTS rental_bookings_product_idx ON rental_bookings(product_id, status);`);
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

  // Newsletters (LinkedIn-style): a creator runs a publication; people subscribe;
  // each issue is an article that notifies subscribers.
  await query(`
    CREATE TABLE IF NOT EXISTS newsletters (
      id          SERIAL PRIMARY KEY,
      owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      cover       TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS newsletters_owner_idx ON newsletters(owner_id);`);
  await query(`
    CREATE TABLE IF NOT EXISTS newsletter_subs (
      newsletter_id INTEGER NOT NULL REFERENCES newsletters(id) ON DELETE CASCADE,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (newsletter_id, user_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS newsletter_subs_user_idx ON newsletter_subs(user_id);`);
  await query(`
    CREATE TABLE IF NOT EXISTS newsletter_issues (
      id            SERIAL PRIMARY KEY,
      newsletter_id INTEGER NOT NULL REFERENCES newsletters(id) ON DELETE CASCADE,
      title         TEXT NOT NULL,
      body          TEXT NOT NULL DEFAULT '',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS newsletter_issues_nl_idx ON newsletter_issues(newsletter_id, created_at DESC);`);

  // Business reviews & ratings (Google/Trustpilot-style): one star review per
  // (reviewer, business); the business can post a single response.
  await query(`
    CREATE TABLE IF NOT EXISTS business_reviews (
      id          SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reviewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating      INTEGER NOT NULL,
      body        TEXT NOT NULL DEFAULT '',
      response    TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (business_id, reviewer_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS business_reviews_biz_idx ON business_reviews(business_id, created_at DESC);`);

  // Appointments / booking: a business lists bookable services; a customer
  // requests a slot, which the business confirms or declines.
  await query(`
    CREATE TABLE IF NOT EXISTS business_services (
      id           SERIAL PRIMARY KEY,
      business_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      duration_min INTEGER NOT NULL DEFAULT 30,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS business_services_biz_idx ON business_services(business_id);`);
  await query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id          SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      service     TEXT NOT NULL,
      when_at     TIMESTAMPTZ NOT NULL,
      note        TEXT,
      status      TEXT NOT NULL DEFAULT 'requested',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS appointments_biz_idx ON appointments(business_id, when_at);`);
  await query(`CREATE INDEX IF NOT EXISTS appointments_cust_idx ON appointments(customer_id, when_at);`);
  // Booking deposits (held in escrow): a service can require a refundable deposit; the
  // appointment snapshots the amount + its escrow state (none/held/released/refunded).
  await query(`ALTER TABLE business_services ADD COLUMN IF NOT EXISTS deposit_cents INTEGER NOT NULL DEFAULT 0;`);
  await query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS deposit_cents INTEGER NOT NULL DEFAULT 0;`);
  await query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS deposit_status TEXT NOT NULL DEFAULT 'none';`);

  // Monetization: tips, paid newsletters, ticketed events.
  await query(`
    CREATE TABLE IF NOT EXISTS tips (
      id           SERIAL PRIMARY KEY,
      from_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount_cents INTEGER NOT NULL,
      message      TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS tips_to_idx ON tips(to_id, created_at DESC);`);

  // Wallet — peer-to-peer money. Every account has a balance (denormalized on
  // users) plus an append-only ledger (wallet_tx) for history. A "send" is an
  // atomic transfer (debit sender, credit recipient); a "topup" adds funds from a
  // card (Stripe) or a demo grant. balance_after snapshots the running balance so
  // history renders without recomputing.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS balance_cents INTEGER NOT NULL DEFAULT 0;`);
  // Defense-in-depth: a wallet balance must never go negative. The application
  // helpers (walletTransfer/walletDebit) already guard with FOR UPDATE + an
  // insufficient-funds check, but this constraint fails the transaction closed if
  // any unforeseen path would drive a balance below zero — the money invariant is
  // enforced by the database as the last line of defence (no money can be created).
  // NOT VALID: enforced on every new write, without scanning existing rows on boot.
  await query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_balance_nonneg') THEN
      ALTER TABLE users ADD CONSTRAINT users_balance_nonneg CHECK (balance_cents >= 0) NOT VALID;
    END IF;
  END $$;`);
  // Demo/showcase accounts (admin "demo mode"). Tagged so the whole set can be
  // removed in one shot; deleting these users cascades to all their content.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;`);
  await query(`CREATE INDEX IF NOT EXISTS users_demo_idx ON users(is_demo) WHERE is_demo = true;`);
  await query(`
    CREATE TABLE IF NOT EXISTS wallet_tx (
      id            SERIAL PRIMARY KEY,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- whose ledger this row is
      peer_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,           -- the other party (null for top-ups)
      kind          TEXT NOT NULL,           -- 'send' | 'receive' | 'topup'
      delta_cents   INTEGER NOT NULL,        -- signed: +credit, -debit
      balance_after INTEGER NOT NULL,        -- running balance after this row
      note          TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS wallet_tx_user_idx ON wallet_tx(user_id, created_at DESC);`);
  // Savings pots / goals: wallet sub-balances. Money moved into a pot leaves the
  // spendable balance (held in the pot) and can be moved back any time.
  await query(`
    CREATE TABLE IF NOT EXISTS wallet_pots (
      id            SERIAL PRIMARY KEY,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      target_cents  INTEGER,                 -- optional goal; null = no target
      balance_cents INTEGER NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS wallet_pots_user_idx ON wallet_pots(user_id, created_at);`);
  // Group fundraising / money pools: a shareable goal anyone can chip in toward
  // (distinct from a split, which assigns fixed shares). Contributions move from the
  // contributor's wallet to the creator's via walletTransfer.
  await query(`
    CREATE TABLE IF NOT EXISTS pools (
      id           SERIAL PRIMARY KEY,
      creator_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title        TEXT NOT NULL,
      description  TEXT,
      goal_cents   INTEGER NOT NULL,
      raised_cents INTEGER NOT NULL DEFAULT 0,
      closed       BOOLEAN NOT NULL DEFAULT false,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS pool_contributions (
      id           SERIAL PRIMARY KEY,
      pool_id      INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount_cents INTEGER NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS pool_contributions_pool_idx ON pool_contributions(pool_id, created_at);`);
  await query(`CREATE INDEX IF NOT EXISTS pool_contributions_user_idx ON pool_contributions(user_id);`);
  // Team / multi-seat business accounts: a business invites other accounts as team
  // members with a role + granular permissions (post jobs, answer Q&A, fulfill orders,
  // reply to customers/reviews). The owner is always implicit full-admin (not a row).
  await query(`
    CREATE TABLE IF NOT EXISTS business_team (
      id          SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      member_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role        TEXT NOT NULL DEFAULT 'staff',     -- admin | manager | staff
      permissions JSONB NOT NULL DEFAULT '{}',       -- { jobs, qa, orders, reviews }
      status      TEXT NOT NULL DEFAULT 'invited',   -- invited | active
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (business_id, member_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS business_team_business_idx ON business_team(business_id);`);
  await query(`CREATE INDEX IF NOT EXISTS business_team_member_idx ON business_team(member_id, status);`);
  // Cash-out: a Stripe Connect (Express) account id per user — earned once they
  // onboard for payouts. Null until they set up a bank. `connect_payouts_enabled`
  // is flipped by the `account.updated` webhook the moment onboarding completes.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_connect_id TEXT;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS connect_payouts_enabled BOOLEAN NOT NULL DEFAULT false;`);
  // Stripe webhook idempotency: Stripe delivers events at-least-once, so a money
  // path could fire twice for one payment. The handler claims an event id here
  // (INSERT … ON CONFLICT DO NOTHING) before processing and only keeps the claim
  // when processing succeeds — so duplicates are skipped but a failed event still
  // gets retried.
  await query(`
    CREATE TABLE IF NOT EXISTS processed_stripe_events (
      event_id   TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // Client-side idempotency for instant money moves (send / top-up / cash-out): the
  // app sends a clientId per action; the server claims it before moving money and
  // caches the response, so a double-tap or network retry can't create a second
  // transaction — it replays the first result instead.
  await query(`
    CREATE TABLE IF NOT EXISTS wallet_idempotency (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id  TEXT NOT NULL,
      kind       TEXT NOT NULL,
      result     JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, client_id)
    );
  `);
  // Scope the idempotency key by `kind` too, so the same clientId reused across two
  // different actions (send vs topup vs cashout) can't collide and replay the wrong
  // cached result. Idempotent migration: only rebuild the PK if `kind` isn't in it.
  await query(`DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = 'wallet_idempotency'::regclass AND i.indisprimary AND a.attname = 'kind'
      ) THEN
        ALTER TABLE wallet_idempotency DROP CONSTRAINT IF EXISTS wallet_idempotency_pkey;
        ALTER TABLE wallet_idempotency ADD PRIMARY KEY (user_id, kind, client_id);
      END IF;
    END $$;`);

  await query(`ALTER TABLE newsletters ADD COLUMN IF NOT EXISTS price_cents INTEGER NOT NULL DEFAULT 0;`);
  await query(`ALTER TABLE newsletter_subs ADD COLUMN IF NOT EXISTS paid BOOLEAN NOT NULL DEFAULT false;`);
  await query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS price_cents INTEGER NOT NULL DEFAULT 0;`);
  // Capacity / seat cap (null = unlimited): caps "going" RSVPs so fitness classes,
  // workshops and limited-seat dinners can sell out. "Interested" stays unlimited.
  await query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS capacity INTEGER;`);
  await query(`ALTER TABLE event_rsvps ADD COLUMN IF NOT EXISTS paid BOOLEAN NOT NULL DEFAULT false;`);

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

  // Showcase / portfolio: a flexible "show off anything" surface — your WORK (no
  // product needed: a project, a job you did, a case study), a NEW PRODUCT you want
  // to spotlight (optionally linked to a marketplace listing so people can buy), or
  // anything random. Each item has a title, description, an image gallery, an optional
  // external link + optional product link. Others can like (appreciate) and comment.
  await query(`
    CREATE TABLE IF NOT EXISTS showcases (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      description TEXT,
      images      TEXT[],
      link        TEXT,
      product_id  INTEGER REFERENCES products(id) ON DELETE SET NULL,
      category    TEXT,
      position    INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS showcases_user_idx ON showcases(user_id, position, created_at DESC);`);
  await query(`
    CREATE TABLE IF NOT EXISTS showcase_likes (
      showcase_id INTEGER NOT NULL REFERENCES showcases(id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (showcase_id, user_id)
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS showcase_comments (
      id          SERIAL PRIMARY KEY,
      showcase_id INTEGER NOT NULL REFERENCES showcases(id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body        TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS showcase_comments_idx ON showcase_comments(showcase_id, created_at);`);

  // Courses / LMS: a creator publishes a course with lessons (grouped into optional
  // module "sections"); learners enroll (free instant, or paid from wallet balance)
  // and track per-lesson progress. Lesson content is gated to enrolled learners + the
  // creator.
  await query(`
    CREATE TABLE IF NOT EXISTS courses (
      id          SERIAL PRIMARY KEY,
      creator_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      description TEXT,
      cover       TEXT,
      price_cents INTEGER NOT NULL DEFAULT 0,
      published   BOOLEAN NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS courses_creator_idx ON courses(creator_id, created_at DESC);`);
  await query(`
    CREATE TABLE IF NOT EXISTS course_lessons (
      id         SERIAL PRIMARY KEY,
      course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      section    TEXT,
      title      TEXT NOT NULL,
      content    TEXT,
      video_url  TEXT,
      position   INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS course_lessons_idx ON course_lessons(course_id, position, id);`);
  await query(`
    CREATE TABLE IF NOT EXISTS course_enrollments (
      id         SERIAL PRIMARY KEY,
      course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (course_id, user_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS course_enrollments_user_idx ON course_enrollments(user_id, created_at DESC);`);
  await query(`
    CREATE TABLE IF NOT EXISTS lesson_progress (
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      lesson_id    INTEGER NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
      course_id    INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, lesson_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS lesson_progress_course_idx ON lesson_progress(course_id, user_id);`);

  // Business hours (Google-Business style): a 7-element JSONB array, index 0=Monday …
  // 6=Sunday, each { closed: bool, open: 'HH:MM', close: 'HH:MM' }. NULL = not set.
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS business_hours JSONB;`);
  // Auto-messages (WhatsApp-Business style): a business can auto-send a one-time
  // "greeting" to a new/long-absent customer, and/or an "away" reply while they
  // can't respond personally. `away_schedule` = 'always' (whenever away is on) or
  // 'outside_hours' (only when the business is currently closed per business_hours,
  // evaluated server-side on the server's wall clock, like the booking slots).
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS greeting_enabled BOOLEAN NOT NULL DEFAULT false;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS greeting_message TEXT;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS away_enabled BOOLEAN NOT NULL DEFAULT false;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS away_message TEXT;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS away_schedule TEXT NOT NULL DEFAULT 'always';`);
  // Business profiles pick ONE primary call-to-action pill shown to visitors on
  // their profile: 'book' (open the booking sheet), 'order' (open the storefront)
  // or 'message' (start a DM). NULL = no explicit CTA (a personal account, or a
  // business that hasn't chosen one).
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_cta TEXT;`);
  // One row per (business, peer, kind) — tracks when we last auto-replied so a
  // greeting doesn't repeat on every message and an away reply doesn't spam a
  // fast back-and-forth. Updated (not appended) each time we send one.
  await query(`
    CREATE TABLE IF NOT EXISTS auto_reply_log (
      business_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      peer_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL,
      sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (business_id, peer_id, kind)
    );
  `);
  // Cart recovery (abandoned-cart nudge via Beam). A business sends ONE polite Beam
  // message a configurable delay after a signed-in shopper abandons a cart. Strict
  // anti-spam: one nudge per exact abandoned cart EVER (the unique cart_sig), a hard
  // cap of ≤1 recovery per (shopper, business) per week (sent_at window), never if
  // muted (`cart_recovery_mutes`) / blocked / opted-out (`users.cart_reminders_off`),
  // respects DND/quiet-hours, and never for a sold-out cart. `recovered_at` is stamped
  // when the shopper then pays that seller (dashboard "carts recovered").
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS cart_recovery_enabled BOOLEAN NOT NULL DEFAULT true;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS cart_recovery_delay_hours INTEGER NOT NULL DEFAULT 1;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS cart_reminders_off BOOLEAN NOT NULL DEFAULT false;`);
  await query(`
    CREATE TABLE IF NOT EXISTS cart_recovery_log (
      id           SERIAL PRIMARY KEY,
      business_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      customer_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cart_sig     TEXT NOT NULL,
      sent_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      recovered_at TIMESTAMPTZ
    );
  `);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS cart_recovery_sig_idx ON cart_recovery_log(business_id, customer_id, cart_sig);`);
  await query(`CREATE INDEX IF NOT EXISTS cart_recovery_recent_idx ON cart_recovery_log(business_id, customer_id, sent_at DESC);`);
  await query(`
    CREATE TABLE IF NOT EXISTS cart_recovery_mutes (
      business_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (business_id, customer_id)
    );
  `);
  // Business Q&A (Google-Business style): anyone can ask a public question on a business
  // profile; anyone can answer (the owner's answer is highlighted). Owner can moderate.
  await query(`
    CREATE TABLE IF NOT EXISTS business_questions (
      id          SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      asker_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body        TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS business_questions_idx ON business_questions(business_id, created_at DESC);`);
  await query(`
    CREATE TABLE IF NOT EXISTS business_answers (
      id          SERIAL PRIMARY KEY,
      question_id INTEGER NOT NULL REFERENCES business_questions(id) ON DELETE CASCADE,
      answerer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body        TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS business_answers_idx ON business_answers(question_id, created_at);`);
  // Product Q&A (Amazon-style): anyone can ask a public question on a product; anyone
  // can answer (the seller's answer is highlighted). Asker/seller can moderate.
  await query(`
    CREATE TABLE IF NOT EXISTS product_questions (
      id         SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      asker_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS product_questions_idx ON product_questions(product_id, created_at DESC);`);
  await query(`
    CREATE TABLE IF NOT EXISTS product_answers (
      id          SERIAL PRIMARY KEY,
      question_id INTEGER NOT NULL REFERENCES product_questions(id) ON DELETE CASCADE,
      answerer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body        TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS product_answers_idx ON product_answers(question_id, created_at);`);

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

  // Broadcast lists (WhatsApp-style): a saved set of recipients; sending fans the
  // message out as individual 1:1 DMs (each person replies privately).
  await query(`
    CREATE TABLE IF NOT EXISTS broadcast_lists (
      id         SERIAL PRIMARY KEY,
      owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS broadcast_lists_owner_idx ON broadcast_lists(owner_id);`);
  await query(`
    CREATE TABLE IF NOT EXISTS broadcast_list_members (
      list_id   INTEGER NOT NULL REFERENCES broadcast_lists(id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (list_id, member_id)
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
  // Per-member role: 'member' | 'admin'. The group creator (at_groups.created_by)
  // is always an implicit super-admin (can't be demoted/removed); additional
  // members can be promoted to 'admin' to co-manage the group (WhatsApp-style).
  await query(`ALTER TABLE at_group_members ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member';`);

  // Live location sharing (WhatsApp-style): a sharer streams their position to a
  // DM peer for a bounded window. The row holds the latest coords; it's "live"
  // while `NOT ended AND expires_at > now()`. A meta.t='livelocation' chat card
  // references the row by id and updates in place from `liveloc` SSE events.
  await query(`
    CREATE TABLE IF NOT EXISTS live_locations (
      id         SERIAL PRIMARY KEY,
      sharer_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      peer_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      lat        DOUBLE PRECISION,
      lng        DOUBLE PRECISION,
      expires_at TIMESTAMPTZ NOT NULL,
      ended      BOOLEAN NOT NULL DEFAULT false,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS live_locations_sharer_idx ON live_locations(sharer_id, created_at DESC);`);

  // Custom image stickers (WhatsApp-style): a member's personal collection of
  // uploaded sticker images (transparent PNG/WebP work best). Sending one drops a
  // meta.t='sticker' card into the chat that renders borderless.
  await query(`
    CREATE TABLE IF NOT EXISTS stickers (
      id         SERIAL PRIMARY KEY,
      owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      image      TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS stickers_owner_idx ON stickers(owner_id, created_at DESC);`);

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
  await query(`ALTER TABLE at_group_messages ADD COLUMN IF NOT EXISTS transcript TEXT;`);
  await query(`ALTER TABLE at_group_messages ADD COLUMN IF NOT EXISTS images TEXT[];`); // multi-image messages
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
  // Per-message actions parity with DMs: reply, reactions, delete (for me / everyone),
  // hide (per-user), and an edited marker. Same shapes as at_messages.
  await query(`ALTER TABLE at_group_messages ADD COLUMN IF NOT EXISTS reply_to INTEGER;`);
  await query(`ALTER TABLE at_group_messages ADD COLUMN IF NOT EXISTS reactions JSONB NOT NULL DEFAULT '{}';`);
  await query(`ALTER TABLE at_group_messages ADD COLUMN IF NOT EXISTS deleted_for INTEGER[] NOT NULL DEFAULT '{}';`);
  await query(`ALTER TABLE at_group_messages ADD COLUMN IF NOT EXISTS deleted_all BOOLEAN NOT NULL DEFAULT false;`);
  await query(`ALTER TABLE at_group_messages ADD COLUMN IF NOT EXISTS hidden_for INTEGER[] NOT NULL DEFAULT '{}';`);
  await query(`ALTER TABLE at_group_messages ADD COLUMN IF NOT EXISTS edited BOOLEAN NOT NULL DEFAULT false;`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS at_group_messages_gclient_idx ON at_group_messages(group_id, sender_id, client_id);`);
  // Group identity: a @username (the creator becomes admin) + a display avatar.
  // `name` stays the display name; `username` is unique and grants admin (created_by).
  await query(`ALTER TABLE at_groups ADD COLUMN IF NOT EXISTS username TEXT;`);
  await query(`ALTER TABLE at_groups ADD COLUMN IF NOT EXISTS avatar TEXT;`);
  // Broadcast / "channel" mode: only the admin (created_by) can post; everyone
  // else reads (WhatsApp-Channel style).
  await query(`ALTER TABLE at_groups ADD COLUMN IF NOT EXISTS broadcast BOOLEAN NOT NULL DEFAULT false;`);
  // Optional group/channel description shown on the group-info screen.
  await query(`ALTER TABLE at_groups ADD COLUMN IF NOT EXISTS description TEXT;`);
  // Group invite link: a random join code; anyone with it can join (WhatsApp-style).
  await query(`ALTER TABLE at_groups ADD COLUMN IF NOT EXISTS invite_code TEXT;`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS at_groups_invite_idx ON at_groups(invite_code) WHERE invite_code IS NOT NULL;`);
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

  // ─── Atwe Ads (sponsored display ads) + company revenue ledger ───
  // A sponsored ad is a display creative (image/video + headline + CTA) that links
  // OUT to the advertiser's site. Advertisers request one → admin reviews → advertiser
  // pays → it goes live in the feed. Distinct from `posts.promoted_until` (which boosts
  // an existing user post); this is a first-class ad unit with its own creative + link.
  await query(`
    CREATE TABLE IF NOT EXISTS ad_campaigns (
      id            SERIAL PRIMARY KEY,
      advertiser_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      sponsor_name  TEXT NOT NULL DEFAULT '',
      title         TEXT NOT NULL DEFAULT '',
      body          TEXT NOT NULL DEFAULT '',
      media         TEXT,
      media_kind    TEXT NOT NULL DEFAULT 'image',
      cta_label     TEXT NOT NULL DEFAULT 'Learn more',
      dest_url      TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'requested',
      days          INTEGER NOT NULL DEFAULT 7,
      amount_cents  INTEGER NOT NULL DEFAULT 0,
      paid          BOOLEAN NOT NULL DEFAULT false,
      impressions   INTEGER NOT NULL DEFAULT 0,
      clicks        INTEGER NOT NULL DEFAULT 0,
      contact_email TEXT,
      review_note   TEXT,
      reviewed_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      starts_at     TIMESTAMPTZ,
      ends_at       TIMESTAMPTZ,
      paid_at       TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS ad_campaigns_status_idx ON ad_campaigns(status, ends_at);`);
  await query(`CREATE INDEX IF NOT EXISTS ad_campaigns_adv_idx ON ad_campaigns(advertiser_id, created_at DESC);`);
  await query(`ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;`); // demo-mode sample ads
  // Per-day impression/click rollup (cheap 14-day trend without an event row per view).
  await query(`
    CREATE TABLE IF NOT EXISTS ad_stats (
      campaign_id INTEGER NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
      day         DATE NOT NULL,
      impressions INTEGER NOT NULL DEFAULT 0,
      clicks      INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (campaign_id, day)
    );
  `);
  // Company revenue ledger — EVERY payment made TO the platform (ads, job boosts,
  // promoted posts, Pro). This is the source of truth behind the admin Revenue
  // dashboard ("how do I see the money"). Peer-to-peer money (tips, orders, wallet
  // sends) is NOT company revenue and never lands here.
  await query(`
    CREATE TABLE IF NOT EXISTS company_revenue (
      id           SERIAL PRIMARY KEY,
      source       TEXT NOT NULL,
      ref_id       TEXT,
      payer_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      payer_name   TEXT,
      amount_cents INTEGER NOT NULL,
      note         TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS company_revenue_created_idx ON company_revenue(created_at DESC);`);
  await query(`CREATE INDEX IF NOT EXISTS company_revenue_source_idx ON company_revenue(source, created_at DESC);`);

  // ─── Sponsored product ads (Amazon Sponsored Products / Etsy Ads-style) ───
  // A seller pays to have a listing win a "Sponsored" slot in marketplace search /
  // category results. Real-time, quality-weighted second-price CPC auction (see
  // server.js) — the seller sets a max bid + a daily budget; the winner is only ever
  // charged the next-best competing bid + a cent (never their own max), same as
  // Amazon Sponsored Products / Google/Etsy Ads. `keywords` null/blank = auto-target
  // (broad match against the product's own name/description/category).
  await query(`
    CREATE TABLE IF NOT EXISTS product_ads (
      id                  SERIAL PRIMARY KEY,
      seller_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id          INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      keywords            TEXT,
      bid_cents           INTEGER NOT NULL,
      daily_budget_cents  INTEGER NOT NULL,
      spent_today_cents   INTEGER NOT NULL DEFAULT 0,
      spend_date          DATE NOT NULL DEFAULT CURRENT_DATE,
      total_spent_cents   INTEGER NOT NULL DEFAULT 0,
      impressions         INTEGER NOT NULL DEFAULT 0,
      clicks              INTEGER NOT NULL DEFAULT 0,
      status              TEXT NOT NULL DEFAULT 'active', -- active | paused | ended
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS product_ads_seller_idx ON product_ads(seller_id);`);
  await query(`CREATE INDEX IF NOT EXISTS product_ads_product_idx ON product_ads(product_id);`);
  await query(`CREATE INDEX IF NOT EXISTS product_ads_active_idx ON product_ads(status) WHERE status = 'active';`);

  // ─── Affiliation badges (X "Verified Organizations" style) ───
  // A small org logo shown right after a member's verified check. Two paths:
  //  (1) a BUSINESS invites a member → member accepts → badge = the business's logo,
  //      tap → the business profile (`affiliations` rows), and
  //  (2) a member UPLOADS a custom badge → admin approves (`aff_uploads`).
  // The resolved ACTIVE badge is denormalized onto the user row for cheap rendering.
  await query(`
    CREATE TABLE IF NOT EXISTS affiliations (
      id          SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      member_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status      TEXT NOT NULL DEFAULT 'invited',
      invited_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      accepted_at TIMESTAMPTZ
    );
  `);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS affiliations_pair_idx ON affiliations(business_id, member_id);`);
  await query(`CREATE INDEX IF NOT EXISTS affiliations_member_idx ON affiliations(member_id, status);`);
  await query(`
    CREATE TABLE IF NOT EXISTS aff_uploads (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      badge       TEXT NOT NULL,
      link        TEXT,
      label       TEXT,
      status      TEXT NOT NULL DEFAULT 'pending',
      review_note TEXT,
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS aff_uploads_status_idx ON aff_uploads(status, created_at DESC);`);
  // Denormalized active badge on the user (single source for rendering).
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS aff_badge_img TEXT;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS aff_badge_kind TEXT;`);   // business | custom
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS aff_business_id INTEGER;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS aff_link TEXT;`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS aff_label TEXT;`);

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
