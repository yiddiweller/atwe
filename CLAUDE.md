# CLAUDE.md

Guidance for AI assistants (and humans) working in this repository.

## What this is

**Atwe AI** — a single-page web chat application: an "intelligent assistant for
business" UI backed by the Anthropic Claude API. An Express server proxies chat
requests to Claude, persists accounts/history to PostgreSQL, and serves a
self-contained, installable PWA frontend.

The product wraps Claude under the brand name **"Atwe"**. User-facing copy never
mentions Claude or Anthropic directly — the system prompt and model labels
present the assistant as "Atwe AI". Keep that branding intact in UI strings.

Alongside the AI assistant, the same app ships **"AtChat"** — a full peer-to-peer
**messaging + social** product (DMs, group chats, broadcast channels, voice/photo/
video/rich messages, audio/video calls, a posts/feed/circles social layer, and a
realtime presence/typing/delivery layer over SSE). It's the larger half of the
codebase. See **"AtChat — messaging & social"** below.

On top of that, the app is also a **business-networking + jobs marketplace**:
accounts can be **personal or business** (chosen at signup), businesses are the
employer surface (no separate "company page" — a business *is* an account), and
the product runs a two-sided **jobs marketplace** (employers post jobs; workers
post "open to work"), a real **connections graph**, **skills/endorsements**, work
**experience**, an **Atwe AI job/worker matchmaker**, **business verification**,
**reporting + an admin queue**, and **paid job boosts**. See **"Business
networking & jobs marketplace"** below.

## Stack & layout

- **Backend:** Node.js + Express (`server.js`), `@anthropic-ai/sdk`
- **Database:** PostgreSQL via `pg` (`db.js`) — accounts/chats core **plus** the
  AtChat messaging/social tables and the networking/jobs tables (see schema below)
- **Auth:** `bcryptjs` (password hashing) + `jsonwebtoken` (JWT) in `auth.js`,
  with email verification + password reset (single-use hashed tokens)
- **Email:** `nodemailer` (`mailer.js`) — SMTP when configured, console fallback otherwise
- **Billing:** `stripe` (`billing.js`) — Stripe Checkout for Pro, with webhook
- **Frontend:** one self-contained file — `public/index.html` (~16k lines: HTML,
  CSS in a single `<style>` block, and vanilla JS in a single `<script>` block —
  the AI chat **and** the whole AtChat messaging/social UI live here).
  No framework, no build step, no bundler.
- **Admin:** `public/admin.html` — standalone dashboard, served at the root of the
  **admin subdomain** (`admin.atwe.com`); has its own sign-in
- **PWA:** `public/manifest.json`, `public/sw.js` (service worker), SVG icons
- **Deploy:** Railway (`railway.json`, NIXPACKS builder)

```
server.js              Express app: composition root + all API routes
db.js                  pg Pool, schema bootstrap (CREATE TABLE IF NOT EXISTS), admin seed
auth.js                bcrypt + JWT + single-use token helpers; auth middleware
mailer.js              nodemailer transport; sendMail() with console fallback
billing.js             Stripe wrapper; checkout sessions + webhook event parsing
package.json           deps: express, @anthropic-ai/sdk, dotenv, pg, bcryptjs,
                       jsonwebtoken, nodemailer, stripe
geoip.js               best-effort IP → "City, Country" for the Devices list +
                       login-alert emails (optional; free no-key HTTPS provider)
push.js                web-push (VAPID) wrapper; isConfigured()/publicKey()/send()
                       — PWA push notifications, optional + degrades like SMTP
finance.js             optional $cashtag market data; quote()/isConfigured()
                       — Yahoo (no-key) default / finnhub, degrades to null
railway.json           Railway deploy config (start cmd, healthcheck)
.env.example           required + optional env vars (grouped by concern)
public/
  index.html           the entire main-app frontend (HTML + CSS + JS inline)
  admin.html           standalone admin dashboard (separate page + own sign-in)
  manifest.json        PWA manifest
  sw.js                service worker (network-first shell, bypasses /api/)
  icon.png             app icon (purpose: any)
  icon-maskable.png    app icon (purpose: maskable)
```

### Graceful degradation (important pattern)

Every external dependency is **optional and degrades cleanly** — the server
always boots, and missing config produces clear behavior instead of a crash:

- **No `DATABASE_URL`** → health + guest chat work; DB routes return a clear error.
- **No SMTP** → verification/reset emails (including the action link) are logged to
  the server console; `mailer.isConfigured()` is false.
- **No Stripe** → "Upgrade to Pro" falls back to the demo instant-upgrade;
  `/api/billing/*` returns `503 Billing not configured`.
- **No geo-IP** (lookup fails/disabled/private IP) → the Devices list shows the
  raw IP instead of a city, and the login-alert email omits the location line.
- **No VAPID keys** (`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`) → `push.isConfigured()`
  is false; web push is skipped (notifications still arrive over SSE while a tab is
  open). `GET /api/config` exposes `pushEnabled` + `vapidPublicKey` so the client
  only offers the toggle when push is available.

`GET /api/config` exposes `{ billingEnabled, emailEnabled }` so the frontend can
adapt. When adding a new external integration, follow this pattern.

## Running locally

```bash
npm install
cp .env.example .env      # set ANTHROPIC_API_KEY, DATABASE_URL, JWT_SECRET, ADMIN_EMAIL
npm run dev               # nodemon, auto-restart on change
# or: npm start           # plain `node server.js`
```

Server listens on `PORT` (default **3000**) → http://localhost:3000

You need a reachable PostgreSQL for auth/history/admin. Locally that's any
Postgres instance (e.g. `DATABASE_URL=postgres://user:pass@localhost:5432/atwe`).
The server **boots even without `DATABASE_URL`** — `/api/health` and guest chat
still work — but every DB-backed route returns a clear "Database not configured"
error instead of crashing. Schema is created automatically on boot by
`db.init()`; there are no separate migration files.

There is **no linter and no build step**. "Building" the frontend just means
editing `public/index.html` / `public/admin.html` and reloading the browser. To
verify backend changes, start the server and hit the endpoints (a throwaway local
Postgres works well for end-to-end checks).

There **is** a small, opt-in **automated test suite** for the security-critical
money + auth flows (`test/`, run with `npm test`). It uses only Node built-ins
(`node:test` / `node:assert` / global `fetch`) plus the existing `pg` dep — **no
new dependencies**. `test/helpers.js` spawns the real `server.js` against a test
database (`TEST_DATABASE_URL`, falling back to `DATABASE_URL`), seeds accounts
directly and mints session tokens (via `auth.signToken` + an `auth_sessions` row,
bypassing the rate-limited login endpoint), and drives the live HTTP endpoints;
`test/money-auth.test.js` covers login/token auth, wallet top-up/send zero-sum,
self-send + unknown-recipient guards, **client idempotency** (double-tap
top-up/send credits once), the **velocity cap** (429), the **PPV
claim-before-charge race** (concurrent unlocks charge once), the **offer-checkout
claim race** (two concurrent checkouts create exactly one order), the **escrow
lifecycle** (protected buy holds funds → confirm releases to the seller), the
**split-share claim** (concurrent pays charge a share once), **gift-card
single-use** (a code redeems once), and the **negative-balance DB constraint**. With no database configured the whole suite
**skips cleanly** (never fails), so `npm test` is a no-op in an env without
Postgres. The frontend still has no automated tests — verify UI changes in the
browser.

### Environment variables

- `ANTHROPIC_API_KEY` — **required** for chat
- `DATABASE_URL` — **required** for auth/history/projects/admin (Railway Postgres plugin injects it)
- `JWT_SECRET` — **required in production**; signs auth tokens. Falls back to an
  insecure dev value (with a warning) if unset.
- `ADMIN_EMAIL` — account with this email is auto-granted admin on signup (and
  auto email-verified); any existing matching account is promoted on boot
- `APP_URL` — public base URL, used to build links in emails (default `http://localhost:3000`)
- `ADMIN_HOST` — host that serves the admin dashboard at its root (default `admin.atwe.com`)
- `REQUIRE_EMAIL_VERIFICATION` — `true` blocks sign-in until verified (default off)
- `DB_SSL` — `true`/`false` to force DB SSL; omit to auto-detect (SSL on for
  remote hosts, off for localhost). **Note:** auto-detect keys off `@host`, so
  socket-style connection strings need an explicit `DB_SSL=false`.
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` — optional;
  enable real email sending (otherwise emails are logged to the console)
- `STRIPE_SECRET_KEY` / `STRIPE_PRICE_ID` / `STRIPE_WEBHOOK_SECRET` — optional;
  enable real Pro billing via Stripe Checkout
- `STRIPE_BOOST_PRICE_ID` — optional; the one-time price for a **job boost**
  (Stripe Checkout in `mode: 'payment'`). Without it, boosts fall back to the
  demo instant-feature. `billing.isBoostConfigured()` gates the real flow.
- `STRIPE_PROMOTE_PRICE_ID` — optional; the one-time price for a **promoted post**
  (Stripe Checkout, `mode: 'payment'`). Without it, promotion falls back to the
  demo instant-promote. `billing.isPromoteConfigured()` gates the real flow.
- `SCHEDULE_FLUSH_MS` — optional; how often the scheduled-message flusher runs
  (default 20000ms).
- `PORT` — optional, defaults to `3000`

`.env` is gitignored. Never commit real secrets. `.env.example` groups these by
concern (Core / Database / Auth / Admin subdomain / Email / Billing).

## Database schema (`db.js`)

- **`users`** — `id` (serial), `name`, `email` (unique), `password_hash`,
  `plan` (`free`/`pro`, default `free`), `is_admin` (bool), `created_at`
- **`projects`** — `id` (TEXT, client-generated), `user_id` (FK → users, cascade),
  `title`, `created_at`
- **`chats`** — `id` (TEXT, client-generated), `user_id` (FK → users, cascade),
  `project_id` (FK → projects, set null), `title`, `messages` (**JSONB**, the
  full conversation array), `created_at`, `updated_at`
- **`auth_tokens`** — `token_hash` (SHA-256 of the raw token), `user_id`
  (FK → users, cascade), `type` (`verify`/`reset`), `expires_at`. Single-use:
  consumed via `DELETE ... RETURNING`. Raw tokens only ever live in emailed links.
- **`users` extra columns:** `email_verified` (bool), `stripe_customer_id` (text),
  `username`, profile fields, `verified` (badge), `is_admin`, `last_login_at`, etc.
  Networking adds: `account_type` (`personal`/`business`, default `personal`),
  `business_verify_status` (`none`/`pending`/`verified`), `headline`,
  `dm_connections_only` (opt-in connection-gated messaging, off by default),
  `chat_mute_until` (JSONB map of muted thread → expiry). Privacy adds:
  `read_receipts` (reciprocal "seen" ticks, default on) and
  `private_profile_views` (anonymous browsing — your visits aren't recorded).
- **`auth_sessions`** — one row per logged-in device (`token_hash`, `user_agent`,
  `ip`, `location`, `last_seen`); the revocable session store behind requireAuth.

> The four tables above are the AI-chat/account core. **AtChat adds many more**
> (messaging, social, calls) — `at_messages`, `at_groups`, `at_group_members`,
> `at_group_messages`, `at_cleared`, `chat_requests`, `contact_allow`, `blocks`,
> `posts`, `post_likes`, `post_circles`, `post_feeds`, `circles`, `circle_members`,
> `feeds`, `feed_members`, `follows`, `notifications`, … — all bootstrapped the same
> idempotent way in `db.init()`. See the **AtChat** section for how they relate.
>
> **Networking / jobs adds more still** — `jobs`, `job_applications`, `saved_jobs`,
> `worker_listings`, `saved_candidates`, `saved_searches`, `experiences`,
> `user_skills`, `skill_endorsements`, `connections`, `profile_views`, `reports`.
> See the **Business networking & jobs marketplace** section. (`notifications`
> also carries a `job_id` FK so job/application notifs deep-link to the job.)

`messages` is stored as JSONB — the whole conversation lives on the chat row;
there is no separate messages table. Deleting a user cascades to their projects,
chats, and tokens. Schema changes are applied idempotently in `db.init()` via
`CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — there
are no separate migration files. **Forward-reference tolerant:** `init()` runs the
whole schema once in a "bootstrapping" mode where a statement that fails because it
references a table created *later* in the file is recorded and **replayed afterwards**
(retried until they all apply). So statement order in `db.init()` doesn't matter and a
**brand-new database bootstraps in full** — you can `ALTER`/index a table before its
`CREATE TABLE` appears without breaking a fresh deploy.

## API surface (`server.js`)

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| GET | `/api/health` | — | Liveness (Railway healthcheck). Returns `{ status, db, timestamp }`. |
| GET | `/api/config` | — | Feature flags: `{ billingEnabled, emailEnabled }`. |
| GET | `/api/test` | — | Smoke-tests the Anthropic key with a tiny Haiku call. |
| POST | `/api/auth/signup` | — | Create account (sends verification email). Returns `{ token, user }`. |
| POST | `/api/auth/login` | — | Returns `{ token, user }`. |
| GET | `/api/auth/me` | user | Refresh the client's view of the account. |
| POST | `/api/auth/verify` | — | Confirm email from the emailed token. |
| POST | `/api/auth/resend-verification` | user | Re-send the verification email. |
| POST | `/api/auth/forgot` | — | Start password reset (always 200; no enumeration). |
| POST | `/api/auth/reset` | — | Set a new password using the emailed token. |
| GET | `/api/projects` | user | List the user's projects. |
| PUT | `/api/projects/:id` | user | Upsert a project (create/rename, idempotent). |
| DELETE | `/api/projects/:id` | user | Delete a project. |
| GET | `/api/chats` | user | List the user's chats (newest first). |
| PUT | `/api/chats/:id` | user | Upsert a chat (title + messages + projectId). |
| DELETE | `/api/chats/:id` | user | Delete one chat. |
| DELETE | `/api/chats` | user | Delete all the user's chats. |
| GET | `/api/account/export` | user | "Download your data": owner-scoped JSON bundle (no secrets). |
| PUT | `/api/plan` | user | Set own plan (`free`/`pro`) — authoritative. |
| PUT | `/api/privacy` | user | Toggle `readReceipts` / `privateProfileViews`. |
| POST | `/api/billing/checkout` | user | Create a Stripe Checkout session; returns `{ url }`. |
| POST | `/api/billing/webhook` | Stripe sig | Stripe events → set/clear `pro`. Raw body. |
| GET | `/api/admin/users` | admin | List all users with chat counts. |
| PATCH | `/api/admin/users/:id` | admin | Change a user's `plan` / `is_admin`. |
| DELETE | `/api/admin/users/:id` | admin | Delete a user (cascades). |
| POST | `/api/chat` | optional | Calls Claude, returns `{ content, usage }`. |

The above is the AI-chat/account core. **AtChat** routes live under `/api/atchat/*`,
`/api/social/*`, `/api/feeds/*`, `/api/circles/*`, `/api/rt/*` (see that section).
**Networking / jobs** routes (see the networking section) cover, in brief:

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| GET/POST | `/api/jobs` | user | List/search jobs (filters: `mine`, `applied`, `saved`); post a job (free-business cap). |
| GET/PATCH/DELETE | `/api/jobs/:id` | user | Job detail / edit / delete (owner). |
| POST/DELETE | `/api/jobs/:id/apply` | user | Apply / withdraw. |
| GET | `/api/jobs/:id/applicants` | user (owner) | Applicant list (hiring pipeline). |
| PATCH | `/api/jobs/:id/applicants/:uid` | user (owner) | Set application status; notifies the candidate. |
| POST | `/api/jobs/:id/feature` | user (owner) | Boost a job (demo or Stripe-paid → `featured_until`). |
| POST/DELETE | `/api/jobs/:id/save` | user | Save / unsave a job. |
| GET/PUT/DELETE | `/api/worker-listing` | user | Get/post/remove own "open to work" listing. |
| GET | `/api/candidates` | user | Browse workers; `POST/DELETE /api/candidates/:id` saves them. |
| GET/POST/DELETE | `/api/saved-searches` | user | Job alerts. |
| GET/POST/PATCH/DELETE | `/api/experiences` | user | Work experience CRUD. |
| GET/POST/DELETE | `/api/skills`, `/api/skills/:id/endorse` | user | Skills + endorsements. |
| GET/POST | `/api/connections` (+ `/requests`, `/:id/accept`) | user | Connection graph. |
| POST | `/api/profile-view/:id`, GET `/api/profile-views` | user | Record + list profile views. |
| GET | `/api/connections/suggestions` | user | People you may know. |
| POST | `/api/ai/jobmatch` | user | Atwe AI job/worker matchmaker (retrieval + AI ranking). |
| POST | `/api/business/verify` | user (business) | Request business verification. |
| POST | `/api/reports` | user | Flag a job / listing / user / post. |
| GET/PATCH | `/api/admin/reports`, `/api/admin/reports/:id` | admin | Moderation queue. |
| PATCH | `/api/admin/users/:id` `{businessVerifyStatus}` | admin | Approve/deny business verification (folded into the admin user PATCH; admin.html `setBizVerify`). |

**Body-parser ordering:** `/api/billing/webhook` is mounted with
`express.raw()` **before** `app.use(express.json())` — Stripe signature
verification needs the unparsed body. Don't move it below the JSON parser.

**Admin subdomain:** a host-check middleware (before `express.static`) serves
`admin.html` for `/` when `req.hostname === ADMIN_HOST`. `app.set('trust proxy')`
is on so `req.hostname`/`req.protocol` reflect Railway's forwarded host.

Conventions in the route layer:
- **Auth middleware** (`auth.js`): `requireAuth` (401 if no/invalid token),
  `requireAdmin` (403 if not admin), `optionalAuth` (sets `req.user` if a valid
  token is present but never blocks — used by `/api/chat` so guests still work).
- **Tokens** are JWTs carrying `{ id, email, is_admin }`, sent as
  `Authorization: Bearer <token>`, 30-day expiry.
- **Upserts** use `INSERT ... ON CONFLICT (id) DO UPDATE ... WHERE table.user_id = $n`,
  so a row can only be updated by its owner (PUT is idempotent create-or-update).
- **Admin guards:** an admin can't revoke their own admin flag or delete their own
  account via the admin routes (avoids self-lockout).

`/api/chat` details:
- `messages` is the Anthropic-format conversation array (`{ role, content }`);
  `content` may be a string or a content-block array (text + base64 image).
- **Plan is authoritative for signed-in users** — the server looks up the user's
  plan from the DB and ignores the client-sent value. Guests (no token) fall back
  to the client-sent `plan`. Plan only controls `max_tokens` (`pro` → 4096, else
  1500); it is **not** an authorization boundary.
- Model is hardcoded to **`claude-sonnet-4-6`** with a fixed Atwe system prompt.
  `/api/test` uses `claude-haiku-4-5-20251001`.

Static files are served from `public/` via `express.static`. JSON body limit is
`4mb` to accommodate base64 image uploads.

## Frontend architecture (`public/index.html`)

Everything lives in one file, organized by banner comments
(`STATE`, `STORAGE`, `API + SERVER SYNC`, `AUTH`, `DOM HELPERS`, etc.). Key pieces:

- **`S`** — the single global state object: `{ user, plan, chats, projects,
  activeId, loading, recording, model, token, guest, _activeProject }`.
- **Two persistence modes:**
  - **Signed-in accounts** (a JWT in `localStorage.atwe_token`): source of truth
    is the **server**. On boot/login the app calls `/api/auth/me` + loads chats
    and projects from the API into `S`.
  - **Guests** (no token): **local-only**, stored in `localStorage` (`atwe_user`,
    `atwe_chats`, `atwe_projects`, `atwe_plan`) via `Store`. Nothing is sent to
    the DB. Guest mode is intentionally preserved.
- **`API`** — tiny fetch wrapper that attaches the bearer token and throws on
  non-2xx. **`Sync`** — write-through helpers (`saveChat`, `deleteChat`,
  `clearChats`, `saveProject`, `deleteProject`, `setPlan`) that are **no-ops in
  guest mode** and fire-and-forget for accounts. Mutations call `Store.save()`
  (local cache) **and** the matching `Sync.*` method.
- **Auth is real:** `doLogin`/`doSignup` POST to `/api/auth/*`; `onAuthSuccess`
  stores the token and hydrates `S` from the server; `logout()` clears the token
  and local cache.
- **`MODELS`** — display labels ("Atwe Standard"/"Atwe Advanced"); both currently
  map to the same underlying id — the model selector is cosmetic.
- **Chat flow** (`sendMessage`): builds an Anthropic-format message (optionally
  with a base64 image block), POSTs to `/api/chat` (with the bearer token, 30s
  `AbortController` timeout), renders the reply with a typewriter effect, then
  upserts the chat via `Sync.saveChat`. Only message **text** is persisted —
  images are sent to the model but not stored.
- **Markdown** is rendered by a small hand-rolled `renderMarkdown`/`escHtml`
  (bold, code, lists, headers) — no markdown library.
- **Voice input** uses the browser `SpeechRecognition` API; **images** via a file
  input read as base64 data URLs.
- Error handling in `sendMessage` maps HTTP statuses (401/403, 429, 5xx) and
  network failures to friendly, brand-safe messages.

### Settings UI — iOS-style hub → sub-pages (`.iset-*`)

`#settingsOverlay` is a full-screen **iOS-Settings-style** surface (not a flat
list): a sticky header (back arrow + title only — no trailing "Done" button;
`setBack()` already closes the whole overlay when it's called at the hub page),
an account card, and grouped
rounded cards of rows with **plain icon glyphs (no tile background at all)** +
chevrons (`.iset-group`/`.iset-row`/`.iset-ic`) — each row's own hairline is a
full-width `border-bottom` in the exact PAGE-background colour (`var(--bg)`,
not a grey tint), so it reads as a clean cut rather than a visible divider
line, and every group is framed by a matching line at both the top
(`.iset-group`'s own `border-top`) and the bottom (the last row's own
`border-bottom`), not just between rows. The **"Search settings"** bar
(`.iset-search`) is a **floating frosted pill fixed to the bottom of the
screen** — same positioning/material as `.bottom-nav` (same gutter insets,
same blur) — rather than an inline bar at the top of the list; the card's own
bottom padding is generous enough that the last row of any page never sits
under it. The hub follows X's
information architecture and slides into sub-pages (`.iset-body[data-page]`) with
a **GPU-composited iOS push/pop** (`isetSlide`/`isetSlideBack`, `will-change:
transform,opacity` + `translate3d` so it's buttery on Chrome/Blink, not just
Safari; `body.reduce-motion` disables it):
**Your account · Privacy & safety · Security & access · Notifications · Premium
& verification · Display & accessibility · Atwe Assistant · Your data & storage
· About · Admin**. Navigation is `setNav(page)`/`setBack()`; `setSearchInput`
filters a static `SET_SEARCH_INDEX` and jumps to a setting's page.
`openSettings()` populates everything and resets to the hub; account-only rows,
the admin group and Sign out are gated by `isAccount()`/`is_admin`. Boolean rows
(read receipts, private views, push, **Larger text** / **Reduce motion**) are
`.ios-switch`es driven by `syncPrivacyRows`/`syncPushRow`; 2FA/plan show a value
chip (`syncTwoFaRow`). **Appearance** is a 4-up **card-swatch theme picker**
(`#themePicker`, `.theme-card`/`.theme-swatch`/`.theme-mock`) on Display &
accessibility — see **Theming** below. The
**Notifications** page also has **per-category notification preferences** — a
toggle per muteable category (`users.notif_prefs` JSONB; categories defined by
`NOTIF_CATEGORIES` server-side, e.g. likes/replies/follows/posts/connections/
endorsements/events/newsletters). `notify()` consults the recipient's prefs and
**skips both the DB row and the push** for a muted category (money / messages /
requests / job notifications are never muteable). `GET/PUT
/api/notification-prefs` (PUT merges a partial `{prefs:{key:bool}}`);
`acLoadNotifPrefs`/`toggleNotifPref` render + persist the switches (loaded when
the Notifications page opens). The page also has **X-style "muted notifications"
quality filters** (`users.notif_filters`, `NOTIF_FILTERS`: people you don't
follow / who don't follow you / new accounts / no profile photo / unconfirmed
email) — `notify()` drops a muteable social notification when the **actor**
matches an enabled filter, but **never for people you follow**. `GET/PUT
/api/notification-filters`; `toggleNotifFilter` persists them. The Notifications
page also has **Quiet hours / Do Not Disturb** (`users.dnd_enabled` +
`dnd_start_min`/`dnd_end_min` = minutes since local midnight + `dnd_tz_offset` =
the device's UTC offset captured client-side). While enabled and inside the window
(`userInDnd`, overnight windows wrap, half-open at the end), **`sendPushForNotif`
suppresses the push alert** — the notification row is still created so it shows
in-app; only the banner/sound is muted. It rides on `GET/PUT /api/account-privacy`
(`dndEnabled`/`dndStartMin`/`dndEndMin`/`dndTzOffset`); client
`acLoadDnd`/`acDndToggle`/`acDndSave` (a switch + two `<input type=time>`), the
offset re-captured on every save so it tracks the device's real clock. Display
prefs persist per-device (`applyDisplayPrefs`, `body.big-text`/`body.reduce-motion`).

**Theming (Black · Light · System).** The app has a CSS-variable theme
system: components reference variables only (never hardcoded colours); each theme
just sets the variable VALUES. **Black** (default, X "Lights out") is the `:root`
palette (true-black bg, near-white `#e7e9ea` text). **Light** (`body.light`,
X.com style) is white with hairline `#eff3f4` dividers (not gray panels). The user
preference lives in `localStorage.atwe_theme` (legacy `'dark'`/`'dim'` → `'black'`
— the old grey **Dim** theme was fully removed, and any device still on it
migrates to Black via `normThemePref`).
`setTheme(pref)` saves it and applies; `getThemePref()` reads it; **`'system'`**
follows the device (`prefers-color-scheme`) and `resolveTheme()` maps it to
**Black (OS dark) or Light (OS light)**; a `matchMedia` `change`
listener re-applies live. `applyThemeClasses()` toggles `body.light`
**and updates the `<meta name=theme-color>`** (`THEME_META`). The picker is the
3-card `#themePicker` — **Black · Light · System** (`syncThemeButtons` lights the
chosen card, by preference so System stays lit); `applyTheme()` runs on boot. Add
a new theme by adding a `body.<name>` variable block + a `.theme-swatch.sw-<name>`
preview + a card (`THEME_PREFS`/`THEME_META`).

**Custom accent colour (free, WhatsApp-Plus-style).** Because the whole app
references `--accent` (+ derived `--accent-dim`/`-mid`/`-glow`/`-hover`/`-light`/
`-tint`) and nothing hardcodes blue, recolouring is just overriding those
variables. The **Accent colour** picker on Display & accessibility (`#accentPicker`,
`acRenderAccentPicker`) offers a **Default** reset, 12 preset swatches
(`ACCENT_PRESETS`), and a native **custom colour** input. `setAccent(hex)` persists
per-device (`localStorage.atwe_accent`) and `applyAccent(hex)` writes the derived
vars **inline on `document.body`** (inline beats the `body.light` theme rule, so a
custom accent wins in every theme; clearing removes the props → falls back to the
theme's own blue). The derived shades are computed from the hex (`_shade` lighten/
darken, alpha tints) and `--accent-tint` (text on a solid accent fill) is chosen for
contrast by luminance (`_accentTint`: near-black on a light accent, white otherwise).
`applyTheme()` calls `applyAccent(getAccent())` on boot; theme switches leave the
inline accent intact.

Every **leaf** the settings open — Blocked, Muted accounts, Muted words, 2FA,
Devices & sessions, Delete account, Contact privacy ("Who can contact you"),
Creator subscriptions, **Change email** — is a matching **full-screen `.set-fs`
sheet** (`.set-sheet` + the same `.iset-head`, `z-index:1100` so it layers above
the open settings overlay), so the whole settings tree is one visual system.
**Change email** (`POST /api/auth/change-email`, password-gated) swaps the email,
marks it unverified and sends a fresh verification link (`openChangeEmail`/
`submitChangeEmail`; Google-only accounts are routed to set a password first).

**Account-privacy / visibility parity** (X / WhatsApp / LinkedIn) — `users`
columns + `GET/PUT /api/account-privacy` (`acLoadAccountPrivacy`):
`presence_visibility` (who sees you online / last seen — `everyone`/`connections`/
`nobody`; gates `broadcastPresence`/`presenceVisibleTo` on the SSE stream + the
`/api/atchat/presence` poll). **WhatsApp-style reciprocity:** setting it to `nobody`
also hides *everyone else's* last seen/online **from you** — enforced server-side
(both `presenceVisibleTo` and the presence poll skip all others when the viewer's own
value is `nobody`) and gated client-side (`acPresenceHidden()` suppresses the online
dot, the "Active now / Last seen …" subline, and the blue "live" name, and ignores
live `presence` events). `presenceVisibility` rides on `publicUser` (`/api/auth/me`)
so `S.user` knows it at boot. Toggle: a **"Last seen & online"** row in the chat-list
⋯ tools menu (`#chatMenuLastSeen`, `acToggleLastSeen` → `everyone`⇄`nobody`, ✓ = shown)
mirrors the granular 3-way picker on Privacy & safety (`apPresence`); both go through
`setAccPriv('presenceVisibility', …)`, which syncs `S.user` + `acOnPresenceVisChanged`
(re-render + re-poll so hidden→shown refetches what the server withheld).
`connections_visible` (hide your
connections list — gates `/api/social/connections/:username`), `who_can_request`
(everyone/network/nobody — gates `POST /api/connections/:id`),
`who_can_add_groups` (everyone/connections/nobody — gates the group-members
route), `share_profile_updates` (notify connections with a `profile_update`
notif when your headline changes), `personalized` (opt out of the For-You boost
terms), and `silence_unknown_callers` (WhatsApp-style — an incoming 1:1 call
from someone you don't already **know** is silently declined instead of ringing).
"Know" = `isKnownCaller(calleeId, callerId)`: a saved contact (`contacts`), an
accepted connection (either direction), someone you follow, or someone you have
prior DM history with (fails **open** on a DB error so a glitch never drops a
real call). Enforced only on the initial `offer` in `POST /api/rt/call`: when the
callee has it on and the caller is unknown, the route returns `{ok:true,
silenced:true}` and skips **both** the live `rtPush` ring and the bell `notify` —
the caller's UI still shows "calling…" and times out, and its normal call-log
post lands a **Missed call** card in the thread, so the callee keeps a record
without the interruption. Toggle = a switch in the **"Who can contact you"** group
on Privacy & safety (`#apSilenceUnknown`, rides on `GET/PUT /api/account-privacy`
as `silenceUnknownCallers`). Surfaced as a **Connections & visibility** +
**Activity & personalization** group on Privacy & safety (switches + `.iset-select`
pickers). **Connected
accounts** (`GET /api/account/connected`, `oauth_provider`), **Hibernate**
(`POST /api/account/deactivate`, password-gated + rate-limited, reversible —
login reactivates). A deactivated account is hidden everywhere a person is
discoverable or reachable: profile 404s, and `NOT deactivated` is filtered from
the feed (both scopes + promoted), all/people/businesses search, mention-search,
both suggestion endpoints, the business directory + `/api/local`, the follows
list, the stories tray, services/marketplace/candidates, group-add, and
`canContact` (DMs). Presence (online/last-seen) reports false for them too.
Events and the live-call roster intentionally persist. And a device
**App lock** (`atwe_applock` SHA-256 passcode, `'atwe:' + code`) covering the app on
boot/resume lives on Security / Your account — **plus optional per-section locks**
(**Lock Wallet**, **Lock Storefront**) two rows below it: `sectionLocked(key)` /
`getLockedSections()`/`setLockedSections()` persist which sections
(`localStorage.atwe_locked_sections`) additionally demand the passcode **every time
that section is opened**, not just on boot/resume. `requireSectionUnlock(key,
onUnlocked)` is the gate wrapper — a no-op straight-through call when that section
isn't locked, else it shows the passcode pad (cancelable) and only invokes the
callback on a correct entry; `acOpenWallet()`, `acOpenSell()`, and
`acOpenStoreManage()` (which itself calls the now-already-gated `acOpenWallet()` for
its own "Wallet & payouts" row, so it's never double-prompted) are wrapped this way.
Toggling a section lock on **auto-prompts to create a passcode first** if App Lock
isn't set up yet (`alSetupPasscode()`, Promise-based); turning App Lock fully off
leaves the section-lock *preferences* dormant-but-saved (re-enabling App Lock later
restores them) rather than clearing them.

**The passcode pad itself** (`#appLockView`, shared by boot-lock / section-gate /
create+confirm) is a native-passcode UI, deliberately mirroring the admin dashboard's
device-lock pad (see below) for one consistent design language app-wide, iOS/
Robinhood-style: the **Atwe logo** up top (`.al-mark`, `<img src="/logo-mark.png">`),
a single-line title — **"Enter Passcode"** for the unlock screen (no subtitle;
`alPinCopy()` returns `['Enter Passcode', '']` and `#alSub:empty{display:none}`
collapses the empty line), "Create a passcode"/"Confirm your passcode" + a sub-line
for the create+confirm flow — then 4 small round dots that fill white as you type
(not boxes), then the keypad: 1-9 as plain numerals with **no resting outline** (a
background highlight only appears on hover/press), sized as a **fixed-size true
circle** (`.al-key`, 74×74px — a fixed width+height is what keeps the press-highlight
a real circle instead of an oval smear, which happens when a key's width≠height under
`border-radius:50%`), spread across a wider `max-width:320px` grid so the columns read
as evenly spaced (not cramped) — then a last row of **"⋯" / 0 / a plain line-arrow
backspace** (not a boxed delete glyph). Correct code: no color change, just a brief
pause before advancing (a plain, no-fanfare unlock like a real phone passcode). Wrong
code: dots flash red + shake (iPhone-style, `alShake`/`.shake`/`@keyframes alShake`),
then clear and retry.

**The "⋯" key (`#alMoreBtn`, left of 0) opens a small menu instead of permanent
Cancel/Forgot buttons** (`alOpenMoreMenu`/`alCloseMoreMenu`, reusing the app's
existing `.ai-menu-scrim`/`.ai-menu-pop`/`.aimp-item` Apple-style popover material,
anchored above the key via `_acAnchorPopover` since it sits near the bottom of the
screen) — its rows depend on context, stored on `_alPin.cancelable` (set from
`opts.cancelable` in `alShowPin`): a **"Cancel"** row when `cancelable` (a
section-lock gate, or the create/confirm flow — always cancelable), and a **"Forgot
passcode? Sign out"** row whenever `mode==='unlock'` (nothing to forget while
creating one) — the **whole-app boot lock is never cancelable** (only Sign-out
applies there; removing that escape hatch would risk a genuine account lockout, since
Settings itself is unreachable while the boot overlay covers the app), while a
**per-section gate is cancelable** and — being an unlock too — offers *both* rows.
At least one row always applies, so the "⋯" key itself is always shown (no more
`visibility:hidden` juggling of a Cancel button — an earlier version hid it that way
specifically because `display:none` on a grid item collapses its column, shifting 0
and the backspace arrow out of alignment with the digit columns above; the "⋯" key,
being permanent, sidesteps the whole issue). `alShowPin(mode, opts)` is the shared
entry point (`mode: 'unlock'|'set'`, `opts.cancelable`, `opts.onSuccess`/`onCancel`)
driving one shared `_alPin` state machine (`alPinKeyTap`/`alPinBackspace`/
`alPinSubmit`/`alPinCancel`) — a hidden off-screen `<input>` (`#alHiddenInput`)
mirrors the same buffer so a physical keyboard works too. **Passcodes are a fixed 4
digits.** A regression to guard: every `alShowPin()` call must reset `_alPin.buf` (it
does, both directly and via `alPinClear()` on each create→confirm stage transition) —
a stale buffer from a prior stage silently swallows every keypad tap on the next stage
since `alPinKeyTap`'s `buf.length>=4` guard blocks new digits, while the
freshly-rendered dots *look* empty (same failure mode the admin PIN pad had — see
below).

### Profile — X-style tabbed page

> **The "Me" hub** (`acGoProfileHub` → `#acMeScreen`/`#acMeBody`, the bottom-nav
> Profile tab) has **no top bar** — `acMeScreen` is in `AC_OWN_HEADER` so `acShow`
> hides the topbar (and `acGoProfileHub` runs `syncTopbar` *before* `acShow` so the
> "always show the bar" reset doesn't win); `#acMeBody` gets a safe-area top inset.
> It leads with a premium **account hero** (`.me-hero`, subtle gradient card →
> `acGoProfile`, avatar/name/verified/@handle + a "View profile" affordance), then
> grouped rows (`.me-group`/`.me-row`) with **plain icon glyphs — no tile
> background** (`.me-ic`; the `color` param on `item(lbl, ic, onclick, color,
> danger)` is accepted for back-compat but no longer applied to anything, every
> row is just the glyph in `var(--t1)`, `var(--red)` for `.danger` rows) under
> category labels, all gutter-aligned. **The hub is the blueprint's "everything
> yours" home — ~35 personal surfaces migrated out of Engine, grouped:** an account
> group (Edit profile · Upgrade/Manage plan · Get verified), then **Money** (Wallet ·
> Send money · Money requests · Invoices · Quotes · Split a bill · Money pools ·
> Scheduled payments · Payment links · Gift cards · Atwe Card · Rewards · Invite
> friends · Get a handle · Help & refunds), **Selling & business** (Business dashboard ·
> My listings · Manage store [biz] · Sales & analytics · Business analytics [biz] ·
> Advertise · Ads Manager · Affiliate program · Team · Affiliation), **Work & network**
> (My network · Post a job · Jobs I posted · My applications · Saved jobs · Job alerts ·
> Saved candidates · Resumes · Open to work), **Library** (Collections · Orders · Cart ·
> Bookings · Saved items · Subscriptions · My courses · Newsletters · Showcase ·
> Addresses), **Planning** (Calendar · Appointments · Events), **Tools** (Do it for me ·
> QR code), and **App** (Settings · Notifications · Devices · Help · Admin · Log out).
> `_ME_IC` carries the glyph set; biz-only rows are gated by `acIsBiz(u)`. Same
> full-width,
> page-bg-coloured hairline treatment as `.iset-row` (see the Settings UI section
> above) — every row's own `border-bottom` plus the group's `border-top` frame
> the whole card top-and-bottom, not just between rows.

`acRenderProfile(d, mine)` renders an X-style profile: banner, a large
overlapping avatar, action buttons, name/handle/headline/bio, a meta row.
> **Both profile action rows are deliberately minimal — Follow + ⋯ (others),
> Edit profile + ⋯ (own).** Everything else lives in the **⋯ menu**. *Others'*
> menu (`acOpenUserActions` → `#postActions`): Connect via `acConnTap`,
> notify-about-posts, view-their-feed, **Search their posts**, send money, message,
> add-to-contact, tip/invoice, mute/block/report — `paConnectBtn`/`paNotifyBtn`/
> `paFeedBtn` are shown by `acOpenUserActions` from live state (`AC._connState`,
> `AC._followingIds` — notify + feed are follower-gated). *Own* menu
> (`acOwnProfileMenu` → `#ownProfileActions`): View your feed · **Search your
> posts** · Profile QR code · Share profile. **Both menu headers lead with the
> account avatar** next to the display name + @handle (`#paAvatar`/`#opaAvatar`,
> filled via `acAvatarHtml(…, acIsBiz)`; `.as-head` is a flex row). **Profile-scoped
> post search** (`acSearchUserPosts(username)`) opens Search → Posts scope prefilled
> with the `from:<username>` operator (`acGoSearch`/`acSetSearchScope('posts')`/
> `acDoSearch`), so any post/flow from that profile is searchable. The meta row
> continues below
(location · website · **"Joined <Month Year>"** from `user.joinedAt`), stats, and
(own profile) the views + strength meters. Below the header is a **sticky tab
bar** (`.ac-prof-tabs`/`.ac-ptab`, `acProfTab(name)`): **Posts · Replies · About
· [Business] · Media**. Posts = pinned + timeline; Replies = the user's public
replies (`d.replies`, served from `/api/social/profile`); Media = posts with
photos/video; About gathers the professional sections (categories, subscriptions,
featured, experience, education, certifications, skills, recommendations);
Business (business accounts) = `acBizSections` (reviews, shop, bookings, jobs,
people — `#acShopBox` is lazy-filled by `acLoadShop`). Editing uses the
X-style **`#profileOverlay`** editor (`.pf-card`: banner+avatar cameras, boxed
floating-label fields, AI "Improve" on headline/bio) via `openProfileEdit`/
`saveProfile`.

## Admin dashboard (`public/admin.html`)

A **separate self-contained page** served at the **root of `admin.atwe.com`**
(and also at `/admin.html` on the main domain). Reachable from the main app via
Settings → Admin → Open when the signed-in user `is_admin`.

Because the admin subdomain is a **distinct origin**, it does **not** share the
main app's `localStorage` — so the dashboard has **its own sign-in** that calls
`/api/auth/login`, checks `is_admin`, and stores its own token. It then calls the
`/api/admin/*` endpoints and renders a user table with stat cards. Controls:
toggle plan (free/pro), toggle admin, delete user. Server-side guards still apply
(you can't revoke/delete yourself). A fresh visit (no token) shows a **branded gate**
(`showGate` — the Atwe mark + "Not open to everyone.", no hint that it's tappable);
tapping the mark reveals the sign-in form (`showLogin`). Explicit errors
(expired/non-admin) skip the gate and show the sign-in form with the message. A small
red **Log out** action sits in the sidebar footer (`.side-logout` → `doLogout`, clears
the token and returns to the gate). An optional **admin device lock** (4-digit PIN,
**native-passcode style**, Robinhood/iOS-Passcode-inspired) can be set from the
footer's **Device lock** button (`openAdminLock` → set/reset/remove — **Reset PIN**
skips straight to "Create a PIN", no need to know the old one, since being inside the
dashboard already proves who you are). The pad (`renderPin()` → `.pinpad`): the
**Atwe logo mark** up top (`.pin-mark`, `<img src="/logo-mark.png">`), a single-line
title — just **"Admin Passcode"** for the unlock screen (no subtitle; `_pinCopy()`
returns `['Admin Passcode', '']` and `.pin-sub:empty{display:none}` collapses the
empty line so there's no dead gap), "Create a PIN"/"Confirm your PIN" + a sub-line for
the create+confirm flow — then 4 small round `.pin-dot`s that fill solid white as you
type (not boxes), then the keypad (`.pin-keys`, `max-width:320px` so the columns read
evenly spaced rather than cramped, 1-9 with **no resting outline** — a background
highlight only appears on hover/press — then **"⋯" / 0 / a plain line-arrow
backspace** sharing the last row so it reads as one even 3-column grid). Each
`.pin-key` is a **fixed-size true circle** (74×74px, centered in its grid cell — the
fixed width+height is what keeps the press-highlight circular rather than an oval
smear) — a wrong code flashes the dots red and shakes the row (iPhone-style), a
correct one has **no color change**, no green flash. The **"⋯" key** (`#pinMoreBtn`,
`pinOpenMoreMenu`/`pinCloseMoreMenu`) opens a small self-contained popover
(`.pin-more-pop`/`.pmp-item` — admin.html has no shared frosted-menu system like the
main app's, so this is a lightweight bespoke frosted card in the same spirit)
containing a single **"Cancel"** row — admin deliberately has **no "forgot PIN"
escape hatch** (unlike the main app's passcode pad, which offers a "Forgot passcode?
Sign out" row too — see above): a staffer should know the PIN they just set, and this
is a low-stakes convenience lock, not account recovery. A physical keyboard still
works via an off-screen `#pinHiddenInput` kept in sync with the same buffer the
on-screen keys write to. **The whole card is a centered flex column**
(`.pinpad{display:flex;flex-direction:column;align-items:center}`) so it sits
mid-screen with even space above and below — a past bug had the title/dots/keypad
pinned near the bottom of the screen with a huge blank gap above: the markup had an
inline `<svg>` with no `width`/`height` set and no CSS class covering it, so it
rendered at the browser's ~300×150 default intrinsic size (invisible against the
black background, but still occupying real layout height) and shoved everything else
down; replacing it with the sized `<img class="pin-mark">` fixed both the visual bug
and, as a side effect, restored the existing `body:not(.authed) .main{justify-content:
center}` centering (which was already correct — it just had ~300px of invisible
content to center around). **Signed-out screens (gate/login/PIN) are centered in the
full viewport** (`body:not(.authed) .main`), not just horizontally. When a lock is
set, **every `load()` call with a saved token is gated on it first**
(`hasAdminLock() && !_adminSessionUnlocked`) — a device that's already signed in
(reopening the tab, a fresh boot) shows the PIN pad before the dashboard, not after;
entering the correct code sets `_adminSessionUnlocked` and re-runs `load()`, landing
straight in the dashboard (a fresh email+password sign-in also sets the flag, so it
isn't asked twice back-to-back). `renderPin()` resets the entry buffer on every draw —
advancing from "create" to "confirm" must start empty, or the confirm step silently
ignores every tap (the dots look empty from the fresh render but the old 4-digit
buffer is still full). **`gateTap()` gates the PIN pad on BOTH a saved session token
AND a lock hash** (`if (token && hasAdminLock()) showPin('unlock'); else
showLogin();`) — checking `hasAdminLock()` alone was a real lockout bug: a device
with no saved token (never actually logged in) but somehow carrying a lock hash would
be routed to a PIN prompt with no correct code to enter, and Cancel just returns to
this same gate — tapping the mark again re-runs the same faulty check, an
inescapable loop. The PIN is a convenience shortcut back in for an **already
sessioned** device, never a substitute for the first real login; no token always
means straight to sign-in, regardless of what the lock hash says. The gate
deliberately gives **no hint** that tapping the mark opens sign-in (admin-only
secret). It's device-local (`localStorage.atwe_admin_lock`, a SHA-256 hash via
`sha256Hex`) — a convenience/obscurity lock, **not** a server auth boundary (real
security stays the email+password sign-in + `adminAccess` check).

**Layout — fixed left sidebar (`.shell` = `.sidebar` + `.main`).** Navigation is a
**vertical left sidebar** (not a horizontal top tab strip): a compact brand
(logo mark + `logo-word` wordmark + a role badge) pinned at the top, a scrollable
`nav#tabs` of grouped items in the middle (only the nav scrolls — brand + footer
stay put), and a footer ("Signed in as <role>" + Back-to-app) pinned at the bottom.
Items are grouped under uppercase `.nav-label`s — **Overview · Money** (Revenue,
Finance, Ads, Affiliations, Refunds) **· People** (Users, Staff, Usernames) **·
Trust & safety** (Reports, Investigate, Disputes, Appeals, Support, Data requests)
**· Content** (Posts, Circles, Feed) **· Insights** (Activity, Traffic, Growth,
Audit log) **· System** (Site). The `.main` column has a slim header (`#viewTitle`,
set per view from `NAV_TITLES`) above `#stats` + `#content`. The active `.tab` gets
an accent left-bar; `switchTab`/`renderView` route views as before. `applyTabPerms`
hides tabs the staffer can't see **and any group label whose tabs are all hidden**,
so a scoped staffer's sidebar collapses to just their sections. Signed-out
(login / 2FA gate) collapses the shell to a centered card (`body:not(.authed)`).
On mobile (≤900px) the sidebar is **off-canvas** — a hamburger (`.nav-toggle`) +
scrim toggle `body.nav-open` to slide it in.

### Account enforcement — suspend / ban / reinstate

Distinct from self-service `deactivated` hibernation and from a hard `delete`: an
admin can **suspend** (temporary), **ban** (permanent) or **reinstate** an account.
`users.status` (`active`/`suspended`/`banned`) + `status_reason` + `suspended_until`
+ `status_by`/`status_at`. `POST /api/admin/users/:id/status {status, reason, days}`
sets it, **revokes all sessions + `rtKickUser`** (instant lockout), and audit-logs it;
you can't suspend/ban yourself or an admin (remove admin first). Login enforces it via
`accountStatusBlock(row)` (returns a login-blocking message → `403 {accountBlocked}`);
an expired suspension **auto-lifts** lazily (`clearExpiredSuspension`). The account +
its content stay — use Delete to remove content. Admin UI: a status pill in the user
list + Suspend/Ban/Reinstate controls in the user detail (`setUserStatus`).

### Background-job health (admin **Site** tab)

Visibility into the scheduled flushers (escrow auto-release, Subscribe & Save,
standing payments, scheduled messages, re-engagement push, stale-order sweep) so a
stuck one can't silently strand money. A small in-memory `jobHealth` registry:
`registerJob(name, label, intervalMs)` declares each, and **`trackJob(name, fn)`**
wraps the flusher at its `setInterval` site to record `lastRunAt`/`lastMs`/`lastOk`/
`lastError`/`runs`/`errors` (and `lastProcessed` if the fn returns a number) — purely
observational, never changing the job. `GET /api/admin/jobs` (superadmin) computes a
`status` per job: `pending` (not yet fired — normal for long-interval jobs), `ok`,
`stale` (no run within ~2.5× its interval), or `error` (last run threw). Admin UI: a
**Background jobs · system health** panel at the top of the Site tab (`renderSite`,
green/amber/red/grey `.jdot` + a status pill + "ran 2m ago · every 60s").

### Feature flags / kill switches (admin **Site** tab)

Turn a feature off platform-wide **without a deploy** (abuse, a misbehaving integration,
or pausing new signups). `FEATURE_FLAGS` (curated list: `signups`/`posting`/`stories`/
`marketplace`/`wallet`/`ai`) stored in `app_settings` (`feature_flags`), cached in
`_featureFlags` (loaded on boot like `_demoMode`/`_rankingWeights`), exposed on
`/api/config.features` so the client hides disabled UI, and enforced server-side by the
**`requireFeature(key)`** middleware (503 `{featureOff}`) — wired into the signup,
create-post, story-create, order-buy/checkout, wallet topup/send, and `/api/chat` +
`/api/ai/write` routes (every flag key is actually gated — none are dead). Every flag
**defaults ON**; a flag is only off when explicitly set false. Superadmin routes
`GET/PUT /api/admin/feature-flags` (audit-logged `feature.flags`, swaps the cache so the
next request sees it). Admin UI: a **Feature switches** panel on the Site tab
(`renderSite`, `toggleFlag`) — a labelled on/off switch per feature.

### Wallet freeze / fraud hold

Money-only lock (distinct from suspend/ban, which lock the whole account): freeze a
suspicious/compromised wallet so **outgoing** money is blocked while a case is looked
at — incoming still lands. `users.wallet_frozen` + `wallet_frozen_reason`. Enforced at
the single choke point **`walletVelocityCheck`** (returns `{ok:false,frozen}` → every
velocity-gated outflow: send/order/tip/paylink/split/pool/rental/handle/gift-card
purchase/PPV unlock/shipping label purchase/ad campaign pay) **plus** an explicit
check in the cash-out route (which bypasses velocity) and a re-check on every run of
the two recurring drivers (`flushScheduledPayments`, `flushProductSubs`) so a wallet
frozen after a standing payment or Subscribe & Save subscription was set up actually
stops it, not just new ones. `walletVelocityError`
renders the "wallet is on hold" message; `publicUser.walletFrozen` lets the client show
it. `POST /api/admin/users/:id/wallet-freeze {frozen, reason}` (gated by the `users`
scope, audit-logged `wallet.freeze`/`wallet.unfreeze`, notifies the member). Admin UI:
a "Freeze/Unfreeze wallet" button + a "wallet frozen" pill in the user detail.

### Staff 2FA requirement (opt-in)

`REQUIRE_ADMIN_2FA=true` (env, default off) makes every staff/admin account need 2FA
to use the dashboard — accounts move money + read DMs, so they should be
phishing-resistant. Enforced in **`auth.requireAdmin` + `auth.requirePerm`** (both now
also select `totp_enabled`; a staffer without it gets `403 {needs2fa:true}`).
`/api/config.requireAdmin2fa` tells the client the policy; `admin.html`'s `load()` shows
a full-screen **`show2faGate()`** (enable 2FA in the app → Settings → Security, then
reload) instead of the dashboard. Can't lock out an owner — enabling 2FA happens in the
normal app, not the dashboard, so a blocked admin always self-recovers.

### GDPR / CCPA data-subject requests (admin **Data requests** tab)

A tracked compliance record that a member asked for a **data export** or **account
deletion**, with the legal deadline (`due_at` = filed + 30d) so staff resolve it in
time and can prove it. `data_requests` (user_id, email kept for post-delete, kind
export|delete, state open|completed|rejected, due_at, handled_by, resolved_at; one open
per (user, kind)). The actual export/delete uses the existing self-serve tools
(`/api/account/export`, `/api/account/deactivate`) + admin delete — this is the paper
trail on top. Member: `POST/GET /api/data-requests`. Staff (`users` scope): `GET
/api/admin/data-requests?state=` (with `daysLeft`/`overdue`), `POST /api/admin/data-
requests` (log one that arrived out-of-band by @username/email), `POST …/:id/resolve
{action:complete|reject, note}` (audit-logged `data_request.log`/`.complete`/`.reject`).
Admin UI: a **Data requests** tab (`renderDataReqView`) — log form + Open/Completed/
Rejected queue with a days-left/overdue pill.

### Appeals (contest a suspension / ban)

A locked-out member can't sign in, so appeals are filed from the **sign-in screen**:
`POST /api/auth/appeal {identifier, password, message}` (public, rate-limited)
**re-proves the password** (like login) and only accepts an appeal for an actually
`suspended`/`banned` account; one open appeal per member (`appeals` table, partial
unique index on `state='open'`). Client: when login returns `403 {accountBlocked}`,
`doLogin` reveals an **"Appeal this decision"** form (`openAppeal`/`submitAppeal`,
reusing the just-entered creds in `_appealCreds`). Staff work the **Appeals** tab
(gated by the `users` scope): `GET /api/admin/appeals?state=` + `POST
/api/admin/appeals/:id/resolve {action:grant|deny, note}` — **grant** reinstates the
account (mirrors the status route's `active` path) and notifies (`appeal_granted`),
**deny** keeps the status + note (`appeal_denied`); claim-first `state='resolving'`
guard so two staff can't double-resolve; audit-logged `appeal.grant`/`appeal.deny`.

### "View as user" — logged support impersonation

A support agent (`users` scope) can temporarily VIEW a member's account to reproduce an
issue — safe, time-boxed, fully logged. `POST /api/admin/users/:id/impersonate {reason}`
records an `impersonation_sessions` row (admin, target, reason, ip, 45-min expiry),
mints a **short-lived token** (`auth.signImpersonation` — 45m, `is_admin:false`, an
`imp:{by,sid}` claim) via a real revocable `auth_sessions` row, and returns the app URL
(`APP_URL/?imp=<token>`). Can't impersonate yourself or another admin. The app boot
detects `?imp=`, adopts the token, and shows a **persistent amber banner** (`_impInit`,
`exitImpersonation`) so it's never invisible. **Irreversible actions are blocked** while
`req.user.imp` is set — the **`blockImpersonation`** middleware 403s wallet send/topup/
cashout, change-email, account delete, 2FA-disable, and essentially every other
wallet-spending or money-settling route (gift cards — including redeem/claim/move-
to-wallet, tips, splits, pools, scheduled payments, PPV unlock, rentals, course
enrollment, cart/buy-now/bundle checkout, shipping labels, offers, invoices,
newsletter/creator subscriptions, event tickets, appointment request **and
settlement** (confirm/decline/cancel — a deposit can be released or refunded here),
sponsored-listing campaign create/edit, ad/post-boost payments, handle claims,
order-return approve/decline, and escrow release (`/api/orders/:id/confirm`)) —
password changes already require the emailed reset flow, which impersonation can't
reach. Every session is audit-logged
(`user.impersonate`) + in the Activity feed; `GET /api/admin/impersonations` lists them.
Admin UI: a "View as user…" button in the user detail (reason-prompted, opens a new tab).

### Platform Activity feed (admin **Activity** tab)

The superadmin "everything that happened" firehose — one live page showing BOTH staff
actions AND member/system events. `platform_events` (append-only: category, action,
actor, subject, meta, created_at) with a fire-and-forget **`logEvent(category, action,
opts)`** helper. `adminAudit` mirrors every staff action into it (category `staff`), and
`logEvent` is wired into the member/system events not otherwise captured: `account.signup`,
`account.deactivate`, `appeal.filed`, `report.filed`, `dispute.opened`, `refund.requested`,
`data_request.filed`, and `payment` (from `recordCompanyRevenue`). `GET
/api/admin/activity?category=&since=&limit=` (superadmin) — filter by category, `since=<id>`
returns only newer rows for **live polling**. Client (`admin.html` `renderActivityView`):
category filter pills + a live-pulsing feed that polls every 12s, prepends new rows with a
flash, and renders each event as a human sentence (`actLabel`) with a category icon/colour
(money/account/moderation/compliance/staff/content/system). Distinct from the **Audit log**
tab, which stays the clean staff-only compliance record.

### Admin audit log (accountability)

Every mutating admin action is recorded append-only in **`admin_audit`** (actor_id,
actor_name, action, target_type, target_id, meta JSONB, ip, created_at) via the
fire-and-forget **`adminAudit(req, action, targetType, targetId, meta)`** helper —
wired into user update/delete/status, dispute resolve, report actions, ad review,
affiliation review/revoke, post delete, broadcast, demo toggle, ranking-weights,
site lock and handle assign. `GET /api/admin/audit?actor=&action=&targetType=&
targetId=&limit=&offset=` is paginated + filterable. Admin **Audit log** tab
(`renderAuditView`) lists who/what/when/target/meta/IP with an action filter. Never
updated or deleted by the app (compliance/forensics; the #1 back-office accountability
tool).

### Investigation tools — admin **Investigate** tab + bulk moderation

Two moderation/legal-lookup tools, both gated by **`requirePerm('moderation')`**:
- **Platform-wide content search** (`GET /api/admin/search-content?q=&type=all|users|
  posts|listings`): an injection-safe ILIKE sweep (wildcards escaped) across **users**
  (name/@username/email, showing status), **posts** (body text + author), and
  **listings** (product name + seller, joined via `products.business_id`). Returns a
  flat `results[]` of `{kind,id,label,sub,username}` (≤15 per kind, newest-first);
  a query under 2 chars returns empty. Client: an **Investigate** tab
  (`renderInvestigateView`/`invSearch`/`invSetType`, `INV_TYPES` filter pills) with a
  live search box → `.inv-row` results (user rows deep-link via `openUser`).
- **Bulk report actions** (`PATCH /api/admin/reports {ids[],status,removeTarget}`):
  resolve/dismiss up to 200 reports at once, optionally deleting the reported items
  (job/worker/post). Only flips reports still `open`; audit-logged `report.bulk_<status>`.
  Client: multi-select on the Reports/Support view (`REP_SEL` set, per-row checkboxes,
  Select-all, `bulkReports(status,removeTarget)` → the bulk bar).

### Staff roles & scoped access (RBAC) — admin **Staff** tab

Least-privilege staff access so a 100-person team doesn't all get the full dashboard.
`users.admin_perms` (JSONB array of scopes) + `users.admin_role` (preset label);
`is_admin` = **superadmin** (sees everything). Scopes: `ADMIN_SCOPES = users · revenue ·
growth · ads · moderation · support · refunds · handles`. New middleware
**`auth.requirePerm(scope)`** (superadmin passes; else the account must carry the scope)
gates every scoped `/api/admin/*` route (swapped in for `requireAdmin` per functional
area); superadmin-only routes (site, demo, ranking-weights, feed-signals, audit, stats,
broadcast, **staff management**) keep `requireAdmin`. `publicUser` exposes `adminAccess`
(gates the dashboard sign-in), `adminPerms` (`'all'` for superadmin, else the array) and
`adminRole`. Routes (superadmin-only): `GET /api/admin/staff` (everyone with access +
the scope list), `POST /api/admin/staff {username|email|userId, role, perms[]}` (grant/
update, validated against `ADMIN_SCOPES`, audit-logged), `DELETE /api/admin/staff/:id`
(revoke — can't touch a superadmin). Client (`admin.html`): a **Staff** tab
(`renderStaffView`) with an add-form (preset role buttons `STAFF_PRESETS` + per-scope
checkboxes) and a current-staff list with Revoke; on sign-in `load()` reads `/api/auth/me`
into `ME`, `applyTabPerms()` **hides the tabs the staffer can't see** (`TAB_PERM` map +
`canSee`), lands them on their first permitted tab, and the header pill shows their role.
Server-enforced (not just hidden tabs): a scoped staffer 403s on any route outside their
scopes. The "Email everyone" broadcast in Support is superadmin-gated client-side too.

### Finance oversight (admin **Finance** tab)

`GET /api/admin/finance` → the "money is safe + reconciled" screen: **total custodial
float** (Σ user balances + Σ pots + net escrow held, computed from the `wallet_tx`
ledger's `escrow_hold` minus `escrow_release`/`escrow_refund`), wallet throughput
(24h/7d/30d outflow + ledger count), cash-outs to bank, Connect payouts-enabled/
connected counts, refunds issued, open disputes / escrow / pending orders, the recent
ledger feed, and largest balances. `renderFinanceView`/`renderFinance`, auto-refresh 30s.

### Refunds & help center (admin **Refunds** tab)

The "I paid for X by mistake / it went wrong" flow. A member files a refund request
against a **specific payment they made** — validated server-side so they can't request
one on someone else's payment or invent an amount: platform charges (`ad`/`boost`/
`promote`/`pro`) resolve via the **`company_revenue`** ledger (payer + amount), `order`
via `orders.total_cents` (buyer), `tip` via `tips` (sender). `refund_requests`
(user_id, kind, ref_id, amount_cents, reason, status open|approved|declined,
refunded_cents, resolved_by/at) with a partial unique index blocking duplicate **open**
requests per payment. Routes: `POST /api/refunds {kind, refId, reason}` (member files,
`refundVerifyPayment` gates), `GET /api/refunds` (mine + status), `GET /api/refunds/
eligible` (recent refundable payments to populate the picker). **Every refund is
staff-reviewed** — `GET /api/admin/refunds` + `POST /api/admin/refunds/:id/resolve
{action, amountCents?, note}` are gated by **`requirePerm('refunds')`**. Approve →
`executeRefund`: **claim-first** (`UPDATE … status='resolving' WHERE status='open'
RETURNING` so two staff can't double-refund). The money moves from wherever it
actually came from, never manufactured: an `order`/`tip` refund is a peer-to-peer
reversal — `walletTransfer` pulls it back out of the seller's/recipient's balance
(falling back to a bare `walletCreditStandalone` credit only if they can't cover it,
same as the seller-driven Return/RMA path — the requester is still always made
whole), and an order also flips to `refunded`. A platform-charge refund (`ad`/`boost`/
`promote`/`pro`) is a plain `walletCreditStandalone` credit + a **negative
`company_revenue` row** to net the Revenue dashboard (a `tip` refund does NOT touch
`company_revenue` — tips were never company revenue to begin with). Never refunds
more than paid; audit-logged + `refund_approved`/`refund_declined` notif.
**Peer-to-peer wrong sends are NOT auto-clawed** (money is in
the recipient's balance, may be spent — the Venmo/Cash App model): `POST /api/wallet/
return-request {txId}` just notifies the recipient (`return_request`) to send it back.
Client: a **"Help & refunds"** Discover tile → `#refundView` (`acOpenRefunds`: recent
payments each with "Request refund" `acRefundFile`, + your requests with status); admin
**Refunds** tab (`renderRefundsView`, Open/Approved/Declined, Approve·refund / Decline).

### Growth analytics (admin **Growth** tab)

`GET /api/admin/growth` → signups (today/7d/30d/total + a 30-day zero-filled trend via
`generate_series`), **DAU/WAU/MAU** (distinct `auth_sessions.user_id` by `last_seen`
window — real activity, not just logins), **stickiness** (DAU/MAU %), and account
breakdown (businesses / verified / suspended / banned). `renderGrowthView`/
`renderGrowth`, auto-refresh 30s. (Distinct from the visitor-based **Traffic** tab.)

### Reserved usernames (premium-handle inventory)

`reserved_usernames` (username PK, note, created_by) is a lock list: `usernameReserved()`
gates **every** signup + username-change path, so a locked name can't be registered or
switched to (anyone already holding a name keeps it). The admin **Usernames** view
manages it at scale:
- **Seed tiers** (`POST /api/admin/username-locks/seed {curated,len1,len2,len3,len4}`) —
  `reserved-seed.js` builds the list: **curated** (~446 brands/public-figures/generic
  high-value words) and/or **every 1–4-char combo** over `[a-z0-9]` (len1=36 … len4≈1.68M).
  Inserts in 5k chunks via `bulkLockUsernames` (multi-row `INSERT … ON CONFLICT DO
  NOTHING`, returns newly-added count). The client warns before the huge len3/len4 tiers.
- **Bulk paste** (`POST …/bulk {usernames, note}`) — a pasted list (newline/comma), ≤50k/call.
- **Assign / grant** (`POST …/:username/:assign` → `{toUsername|toId}`) — the "give it to
  the legitimate owner" flow: atomically sets that account's `username` to the reserved
  name (freeing their old handle) and drops the reservation; 409 if the name is already
  held. This is how you hand a locked premium handle to a partner/verified owner.
- **Self-serve paid claim** (`reserved_usernames.price_cents`): when an admin sets a
  price (single-add price field, seed/bulk default, or per-row **Sell**/**Price** →
  `PATCH /api/admin/username-locks/:username {priceCents}`), that handle becomes a
  **wallet-funded self-serve buy** for any member. `GET /api/handles/:username` reports
  `{claimable, priceCents}` (reserved + priced + not currently held); `POST
  /api/handles/claim {username, priceCents?, clientId}` runs `claimHandleFromBalance` —
  ONE transaction that locks the buyer, re-checks affordability + still-on-sale +
  not-held, debits the wallet (`walletCredit` kind `handle`), sets the buyer's
  `username`, and drops the reservation — so a crash/race can never charge without
  assigning (or vice-versa), and `walletClaimIdem` makes a double-tap safe. The route
  also runs `walletVelocityCheck` (a handle buy is wallet outflow, so it counts toward
  the daily/weekly caps like send/tip/order), and a same-name unique-violation surfaces
  as a clean 409 `{taken}`. Balance-only (top up via Stripe first), consistent with
  splits/gift-cards/pools/escrow — no Stripe double-pay race. Client: a **"Get a handle"** Discover tile → `#claimHandleView`
  (`acOpenClaimHandle`/`acClaimHandleCheck` live price lookup + `acDoClaimHandle`,
  balance-gated; falls through to the wallet top-up when short). Covered by the money
  test suite (claim+switch, not-for-sale rejected, concurrent-race one-winner).
- **List** (`GET …/username-locks?q=&limit=&offset=`) is paginated + searchable (the table
  can hold millions), ordered shortest-first, with a `taken` flag + `grandTotal`. Single
  add/delete (`POST`/`DELETE /api/admin/username-locks[/:username]`) unchanged.

### Traffic analytics (admin **Traffic** tab)

Site-wide visitor analytics. A fire-and-forget middleware (mounted before the
site-lock, after the admin-host check) logs **app page-views only** — GET
navigations whose `Accept` includes `text/html` and whose path has no file
extension, excluding `/api/*`, `/admin.html`, the admin host, and **link-preview
crawlers** (`isLinkCrawler`, so bots fetching OG cards don't inflate visitors) — into
`page_views (created_at, ip, visitor, path)`. `visitor` is a stable
`sha256(ip+user-agent)` slice so unique visitors are counted without extra PII.
Location is resolved **once per ip** into an `ip_geo (ip, country, city, place)`
cache — `ensureGeo(ip)` (deduped via in-memory `_geoInflight`/`_geoknown` sets,
best-effort `geoip.lookup`, caches even a null so a failed/private ip isn't
re-hit) — and JOINed at query time so a later resolution backfills all of that
ip's past views. A daily unref'd sweep prunes rows older than 400 days.
`GET /api/admin/analytics?range=today|week|year` returns `{ totals, previous
(prior period for the % change), live (unique visitors in the last 5 min),
allTime, trend (zero-filled hourly/daily/monthly buckets via generate_series),
countries, cities, geoEnabled }` — all interval/bucket/series values come from a
fixed whitelist keyed by `range`, so nothing from the request touches SQL. Client
(`renderTrafficView`/`loadTraffic`/`renderTraffic`, `admin.html`): Today · 7 days
· 1 year range pills, a live "online now" pulse, three stat cards (views / unique
visitors / all-time, each with a vs-previous delta), a CSS bar-chart trend, and
top-countries (with proportion bars) + top-cities lists; auto-refreshes every 30s
while the tab is open.

## QR connect (device-link login + profile QR)

Two QR features (deps: `qrcode` server-side generation, vendored `public/jsqr.js`
client-side scanning; `<script src="/jsqr.js" defer>` exposes `window.jsQR`):
- **Device-link login (WhatsApp-style "Link a device")** — a credential transfer, so
  treated carefully. `device_link_codes` (only the **hashed** code, `status`
  pending|approved|consumed, `approver_id`, the minted `token`, `expires_at`). Flow:
  the logged-out device `POST /api/auth/link/start` (rate-limited, no auth) → a random
  single-use code (`auth.makeToken`, hashed, **~90s** TTL) + a QR (encoding
  `atwe-link:<code>`); it polls `GET /api/auth/link/status?code=` every 2s. A logged-in
  device opens **Settings → Security & access → Link a device** → the camera scanner
  (jsQR, in `link` mode with a clear **security warning**), reads the code, shows a
  **confirmation sheet**, then `POST /api/auth/link/approve {code}` (requireAuth,
  rate-limited): it **atomically claims** the pending+unexpired code, `issueSession`s a
  real JWT/`auth_sessions` row for the approver (so the new device shows in **Devices &
  sessions** and is fully revocable), stores the token on the row, and fires the
  existing **sign-in alert** (`sendLoginAlertEmail`) + a `login` notif. The status poll
  then returns `{token, user}` **exactly once** (marks `consumed`), and the new device
  `onAuthSuccess`es like a normal login. **Note:** `auth.signToken` now adds a random
  `jti` so every issued token is unique → one device = one distinct session (two
  same-second logins no longer collide on `token_hash`). Client: `acOpenQrLogin`
  (logged-out, login screen "Log in with QR code"), `acOpenLinkScan`/`acConfirmLinkDevice`
  (logged-in), `#qrLoginView` / `#qrScanView`.
- **Profile QR** — `GET /api/me/qr` returns a QR (data URL) encoding the member's
  `?u=<username>` deep link; a **QR code** Discover tile (`acOpenMyQR`) shows it + a
  scanner (profile mode) that opens a scanned profile. `acOpenQrScan(mode)` drives both
  scanners; `acHandleScannedQr` dispatches by mode (rejects the wrong code type).

## Voice-note transcription (optional STT — `stt.js`)

On-demand transcription of a voice note, via an optional speech-to-text provider
(graceful degradation like the other integration modules). `stt.isConfigured()` is
true when `STT_API_URL` + `STT_API_KEY` are set; `stt.transcribe(dataUrl)` posts the
audio (decoded from the stored `at_messages.media` / `at_group_messages.media` data
URL) as multipart to an **OpenAI-Whisper-compatible** endpoint (`file` + `model`,
optional `STT_MODEL`/`STT_LANGUAGE`) and returns `{text}`. (The Anthropic text API
can't transcribe audio, so this is a separate provider.) `POST /api/atchat/transcribe
{kind:'dm'|'group', id}` (requireAuth, rate-limited) loads the message **only if the
caller can see it** (DM sender/recipient, or group member), checks `media_kind='audio'`,
and returns the transcript — `503` when STT isn't configured. `/api/config` exposes
`transcriptionEnabled`. Client: a **Transcribe** row in the message ⋯ menu
(`#mmTranscribeItem`, shown only for an audio message when transcription is enabled →
`mmAction('transcribe')` → `acMsgTranscribe`, which shows the transcript in the Atwe AI
result card). Degrades cleanly: with no provider, voice notes still send/play and the
row is hidden.

## Auth flows, email & billing (frontend)

- **Email verification:** signup triggers a verification email (or console log).
  The link is `/?verify=<token>`; `handleUrlParams()` on boot POSTs it to
  `/api/auth/verify`. Settings shows a "Resend" action while unverified. Sign-in
  is **not** blocked by verification unless `REQUIRE_EMAIL_VERIFICATION=true`.
- **Password reset:** "Forgot password?" on the login modal POSTs to
  `/api/auth/forgot`. The emailed link is `/?reset=<token>`; boot detects it and
  shows the reset overlay, which POSTs to `/api/auth/reset`.
- **Two-factor (TOTP):** authenticator-app 2FA implemented in `auth.js` with Node
  `crypto` (no extra dep) — `generateTotpSecret`/`totpUri`/`verifyTotp` (RFC 6238,
  6-digit, ±1 step window). `users.totp_secret` + `totp_enabled`. Routes: `POST
  /api/auth/2fa/setup` (returns secret + `otpauth://` URI), `…/2fa/enable {code}`,
  `…/2fa/disable {password,code}`. **Login is challenge-gated:** when `totp_enabled`,
  `/api/auth/login` without a valid `code` returns `401 {twoFactorRequired:true}`
  (no token); the client (`doLogin`) reveals a code field and re-submits. `API.req`
  attaches `err.status`/`err.body` so the challenge is detectable. `publicUser`
  exposes `twoFactorEnabled`. Settings → Session manages it (`open2FA`/`enable2FA`/
  `disable2FA`, `#twoFaView`). **Recovery codes:** enabling 2FA issues 10 single-use
  backup codes (`auth.generateRecoveryCodes`; only SHA-256 hashes stored in
  `users.totp_recovery`, plaintext shown once). The login challenge accepts a
  recovery code as an alternative to the TOTP code and **consumes it**
  (`array_remove`); `POST /api/auth/2fa/recovery {code}` regenerates the set
  (invalidating the old one). Disable clears them. Client: codes shown/copied/
  downloaded on enable + a "Regenerate recovery codes" action (`acShowRecoveryCodes`).
- **Billing:** boot calls `/api/config`. `upgradeToPro()` redirects signed-in
  users to Stripe Checkout when `billingEnabled`; otherwise (or for guests) it
  does the demo instant-upgrade. Checkout returns to `/?checkout=success|cancel`;
  the webhook is what actually flips the plan to `pro` server-side.

## PWA / service worker

`sw.js` is **network-first for page navigations** — it fetches the app shell from a
unique per-load path (`/__shell/<timestamp>`, `cache:'reload'`) so no CDN/edge cache
can ever serve a stale page, and only falls back to the cached shell when offline.
Other static assets (`/manifest.json`, icons) are **cache-first, refreshed in the
background**. It **explicitly bypasses `/api/`** requests so chat and data calls
always hit the network. The cache is versioned via the `CACHE` constant
(`atwe-v<n>`, currently in the `900`s).

> When you change cached assets in a way that must invalidate old clients, bump
> the `CACHE` version string in `sw.js` (e.g. `atwe-v904` → `atwe-v905`). The
> `activate` handler deletes any cache whose key doesn't match. `admin.html`
> isn't pre-cached, but the network-first navigation fallback still serves it.

**Installed-PWA safe areas (iOS standalone).** The app runs `black-translucent`
+ `viewport-fit=cover` so content is **fullscreen top-to-bottom** (feed/media can
extend under the notch). The app shell (`.app`) is pinned with **`position:fixed;
inset:0`** (not `height:100dvh`) so it truly fills the visual viewport edge-to-edge —
including under the home indicator — with no bottom gap (dvh can fall short in iOS
standalone). The chrome respects the safe-area insets:
- The **top bar** pads its top by `env(safe-area-inset-top)` so it always clears
  the status-bar clock/battery (a small `+2px` extra — kept tight so the tabs sit
  close under the status bar, iOS-style, not floating low).
- A **persistent status-bar backdrop** (`#statusScrim`) keeps the iOS clock/battery
  legible. It's a **solid `var(--bg)` fill (no blur)** so the status strip reads as clean
  flat colour — **full black** on the dark themes (content scrolling under it is fully
  hidden, no colour bleed behind the clock). Because `black-translucent` makes the clock
  **always white**, Light theme (`body.light #statusScrim`) overlays a **dark vignette**
  gradient instead so the white clock stays legible on the white bg. Always on, and a
  **direct `<body>` child** (NOT inside `.app`, whose `z-index:1` would trap it below
  overlays) with a very high z-index, so it sits above app content *and* overlays/sheets
  (their headers get it too) — but below the demo/offline banners. `pointer-events:none`.
  Hidden in immersive feeds (`body.feeds-immersive`), which draw their own top gradient.
- The **floating bottom-nav pill** is an **evenly-inset** pill: the gap below equals
  the gap on both sides (`--feed-gutter`) so it reads as a symmetric iOS-style bar at
  the bottom — `bottom:max(var(--feed-gutter), env(safe-area-inset-bottom,0px) - 16px)`
  (on iPhone the inset−16 ≈ the gutter, so all three gaps match; `max` keeps a floor
  and nudges up only if a device reports a very large inset). The compose FAB rides
  above it at `nav-bottom + 68px`. Keep these offsets in sync.
- **Finger-tracking scroll choreography** (`_onListScroll`/`_applyBars`/`acSetBarsHidden`
  in the JS, `.bar-anim` in CSS): the bars are driven **directly by the scroll delta**,
  not a binary snap. The top bar retracts via a negative **`margin-top`** (content
  reflows up to fill) and the floating nav + FAB slide down via a **`transform`**, 1:1
  with the finger, accumulating into `_barHide` (clamped `0.._barMax` = the top bar's
  height). They **stay wherever the scroll stops** (a half-scroll leaves them
  half-hidden) and pin fully open at the top (`scrollTop <= 2`). No CSS transition during
  active scroll (so it tracks exactly); `.bar-anim` adds a brief ease only for
  programmatic reveals (`acShow` calls `acRevealBars()` on every navigation). The
  compose **FAB does NOT hide** with the nav — it rides above the nav when shown and, as
  the nav slides away, settles into the **bottom-right corner** (its CSS base is
  `nav-bottom + 68px`, so a 68px downward slide lands it at the nav's resting bottom) and
  STAYS there, still tappable, never fading. Applied via `requestAnimationFrame`.
  **The top bar also fades (`opacity = max(0, 1 - p*2)`, `p` = retraction progress)**
  steeper than the slide itself — without this, a partial scroll left the viewport's
  hard top edge clipping the feed-tab labels (For You/Following/…) mid-letter, which
  read as a jagged, uneven cut rather than a clean line. Fading the whole bar out well
  before it reaches the clip line means it's already invisible by the time the edge
  would chop it.

> **Mobile scroll/paint hygiene:** scroll listeners are registered `{ passive: true }`
> (they never `preventDefault`, so the compositor doesn't wait on them — no scroll
> jank); touch/gesture listeners that DO `preventDefault` (pull-to-refresh, swipe)
> stay non-passive on purpose. Content images in the scroll surfaces (feed post
> media, discover shorts, DM/AI message photos, quoted-post + highlight covers) carry
> `loading="lazy" decoding="async"` so off-screen images aren't fetched/decoded on
> the main thread; focused viewers (story/QR/postshot/composer previews) stay eager,
> and avatars use a CSS `background:url()` (already paint-deferred). Keep this split
> when adding a listener or an image: passive unless you preventDefault; lazy for
> in-list content, eager for the thing the user is looking at.

> **Accessibility baseline:** the app ships global `:focus-visible` outlines
> (`button`/`a`/`[role=button]`/`[tabindex]` → 2px accent ring), a full
> `@media (prefers-reduced-motion: reduce)` reset (all animation/transition durations
> collapsed), 200+ overlays tagged `role="dialog"`, and a visually-hidden `aria-live`
> announcer (`announce(msg, assertive)`) that voices toasts / incoming calls / AI
> replies. When adding UI: an **icon-only** control needs an `aria-label` (or visible
> text); a **placeholder-only** input needs a matching `aria-label` (a placeholder is
> not a reliable accessible name — the primary composer/search inputs `acInput`/
> `msgInput`/`acPostText`/`acSearchInput`/`tbSearchInput` carry one). Route transient
> status through `announce()` so screen-reader users hear it.

**Offline banner:** a slim floating pill (`.offline-banner`, `showOfflineBanner`/
`showBackOnlineBanner`/`syncOnlineBanner`) driven by the browser `online`/`offline`
events (bound alongside `rtResync`). It shows "You're offline" while disconnected
and flips to a green "Back online" for ~2s on reconnect, then fades. Non-blocking
(`pointer-events:none`), never shifts layout. `syncOnlineBanner(true)` reflects the
current state on load. **SPA deep links / 404:** `server.js`'s `app.get('*')`
catch-all serves the app shell for any non-API, non-asset path so a shared/unknown
deep link lands inside the app (the client router opens the right surface or shows
its own not-found state) instead of a raw "Cannot GET".

> **Rich link previews (Open Graph / Twitter cards).** A shared deep link
> (`/<username>` profile, `/group/<x>`, `/circle/<x>`) unfurls with the entity's
> name/description/photo on WhatsApp, iMessage, X, Slack, etc. Crawlers don't run
> JS, so the catch-all detects a **known link-preview bot** (`isLinkCrawler`,
> `_OG_BOTS` UA regex) and serves the app shell with the OG/Twitter meta swapped to
> the entity's details (`ogForPath` looks up the profile/group/circle;
> `renderShellWithOg` regex-replaces the `<title>` + `og:*`/`twitter:*` `content=`
> in the cached `index.html`). **Humans get the unchanged static shell on the fast
> path** (no DB hit — their SPA renders the real page anyway; the file itself keeps
> the generic default card). Only **http(s)** images are used for `og:image` (most
> avatars are stored as data URLs, which crawlers can't fetch — those + missing
> photos fall back to the branded `/icon-384.png`); a profile with an http banner
> uses `summary_large_image`, otherwise `summary`. All values are HTML-escaped
> (`ogEscape`). To add a new previewable entity, extend `ogForPath`.

## AtChat — messaging & social

The bulk of `server.js` and `public/index.html` is **AtChat**, a self-contained
messaging + social product layered on the same accounts/auth/DB. It only works for
**signed-in accounts with a `username`** (guests get the AI chat only). All routes
live under `/api/atchat/*`, `/api/social/*`, `/api/feeds/*`, `/api/circles/*`,
`/api/rt/*`. The frontend lives in one big `AC` state object + `AC.*`/`ac*`
functions, organized by banner comments.

### Surfaces

> **Chat-list top bar (X-style, mirrors the home feed).** `#tbChatTabs` is a
> **word-only** tab row — **All · Chats · Calls · Contacts** (`AC_CHATS_TABS`,
> `acChatsTab`) — styled exactly like the home feed tabs on mobile: roomy `gap:34px`,
> active = bold white, a soft **left-edge fade** under the ≡, a solid bar with a
> **grey hairline** inset to `--feed-gutter`, and the same tab-tap **page-slide**
> (direction computed from the previous tab in `acChatsTab` — tapping a tab is the
> ONLY way to switch now; a whole-pane swipe-to-switch-tabs gesture used to live here
> too but was removed since it fought the row-level swipe-to-delete/unread gesture
> below). **No top-bar icons** — the old Search / Starred / Unread-only
> buttons moved into a **⋯ tools menu after the Contacts tab** (`#acChatMoreBtn`,
> same gap, shown only on All/Chats) that opens the same Apple-style popover as the
> feed AI menu (`acOpenChatMenu` → `#chatMenuPop`, shared positioner
> `_acAnchorPopover`; **Unread only** shows a ✓ when active). The ⋯ ends flush at the
> hairline's right gutter edge, matching the feed.

> **Chat-list rows (deepened to match Home).** `.ac-item` is a generic list-row
> class reused all over the app (search results, connections, business directory,
> pickers, …) — those all keep the plain rounded/boxed treatment. The **Chats
> screen specifically** (`#acListScreen .ac-item`, i.e. the All/Chats/Calls/Contacts
> panes) gets Home's post-card hierarchy instead: full-bleed rows (`border-radius:0`,
> `margin:0 -8px` cancelling the list's own padding), generous `padding:14px
> var(--feed-gutter)` — the exact same gutter Home's post cards use — and an inset
> hairline divider (`::after`, `left/right:var(--feed-gutter)`) instead of no divider
> at all. Desktop **hover** matches Home exactly: a subtle `rgba(...,.025)` tint
> (`@media(hover:hover)`, so touch devices never see it). Unread rows get a bolder
> name (`font-weight:800`) + bolder preview text (already existed) **plus** an
> accent-colored, bolder timestamp (`--accent`, 700) so the "something new here" cue
> doesn't rely on the small numeric badge alone; the badge itself (`.ac-item-unread`)
> was bumped to 20px/800-weight for more presence. Muted/pinned/draft/thread-tag
> chips (`.ac-mute-ic`/`.ac-pin-ic`/`.ac-draft`/`.ac-thread-tag`) are unchanged —
> their own small margins already prevent crowding in the wider layout. **Light-theme
> contrast bug found + fixed in this pass:** a muted group's unread badge
> (`.ac-item-unread.muted`) used `--t4` as its fill — a *pale* icon-tint gray in
> Light theme (meant for small line icons, not a solid badge fill) — behind white
> text, ~2:1 contrast, failing WCAG AA. `body.light .ac-item-unread.muted` now uses
> the darker `--t3` instead (~5:1), keeping the "muted, not urgent" look but legible.

> **Row swipe-to-reveal actions (Apple Messages-style).** A plain tap on a row
> shows **no custom visual at all**, just its normal `onclick` opening the chat —
> every native touch-feedback path is deliberately neutralized inside
> `#acListScreen`: `-webkit-tap-highlight-color:transparent` (set both globally on
> `html,body` and per-component), `#acListScreen .ac-item:active{background:none}`,
> and **`#acListScreen .ac-item:hover{background:none}`**. That last one matters
> more than it looks: the base (unscoped) `.ac-item:hover{background:rgba(255,255,
> 255,.05)}` a few lines up has NO `@media(hover:hover)` guard (unlike the OTHER
> hover rule further below, which does), so it isn't just a desktop-mouse
> affordance — both iOS Safari and Chrome commonly latch a synthetic `:hover`
> match onto the last-touched element after release (there's no pointer to move
> away and clear it), painting a flat, non-rounded gray box across the whole row.
> This was the actual, cross-browser cause of "a dark gray box shows up every time
> I let go" / "a darker gray behind the pill during a swipe" — a previous pass
> misdiagnosed it as the WebKit-only tap-highlight quirk (real, and still worth
> the root-level reset above, but not what was actually causing this) since it
> hadn't yet been confirmed to reproduce on Chrome too, which ruled that out.
> Verified via Playwright's real `:hover` (`page.hover()`, not a synthetic class
> toggle) that the row's computed background stays fully transparent even while
> `:hover` genuinely matches. The touch feedback you actually see is
> fully custom, driven by `acBindRowSwipeActions` (bound once on `#acListScreen`,
> delegated so it covers the Chats/Calls/Contacts panes + message-search results
> uniformly) — **two** distinct triggers, both JS-driven, never CSS `:active`/
> `:hover`: `.swipe-l`/`.swipe-r` for an actual left/right drag, and **`.tap-press`**
> for a plain tap-to-open. `.tap-press` is added the instant a touch lands (real
> button-press feedback, not a delayed flash) and removed the instant that same
> touch is reclassified as a scroll or a swipe — so a scroll-and-release never
> shows it, only a touch that stays put the whole gesture does (a tiny sub-
> `ROW_DRAG_TOL` jitter doesn't cancel it; real movement past the tolerance does,
> immediately). This is deliberately different from an **earlier, removed**
> version that painted the same gray pill on any still, held touch after ~90ms of
> stillness, *regardless of what the touch was for*: that meant an incidental
> still-for-a-moment touch — a resting thumb while scrolling with ANOTHER finger,
> or any brief touch with no intent to tap — flashed gray even though nothing was
> actually happening, which is exactly what was reported as unwanted ("touch by
> mistake... I don't want that"). The current `.tap-press` doesn't have that
> problem: a genuine second simultaneous touch is a different code path entirely
> (`e.touches.length !== 1` bails out of the whole handler, so a resting second
> finger never gets classified as anything), and a single touch that DOES move —
> whether that's a real scroll or a swipe — sheds `.tap-press` the moment it's
> classified as such, before the pill is even visible for more than a frame or two.
> A row's real content lives in a
> `.ac-item-inner` wrapper (added so `acRenderCalls`/`acRenderContacts`/
> `acRunMsgSearch`, all shared with screens outside `#acListScreen`, keep rendering
> correctly there too via a base, unscoped `.ac-item-inner` rule) — the outer
> `.ac-item` is just a `position:relative;overflow:hidden` shell that hosts the
> swipe bubble.
> - **Tap-press:** a plain tap-to-open on ANY row here (swipeable or not — call-log
>   and contact rows get it too) shows the same `::before` pill the instant the
>   touch lands, via `.tap-press` (`#acListScreen .ac-item.tap-press
>   .ac-item-inner::before{opacity:1}`, same divider-hiding treatment as
>   `.swipe-l`/`.swipe-r`). Cleared the instant the touch is reclassified as a
>   scroll or a swipe (`clearTapPress`, called from the same `touchmove` branch
>   that flips `phase` away from `'pending'`), and cleared again ~220ms after a
>   genuine release (`touchend`) as a belt-and-suspenders cleanup in case the
>   row's own `onclick` doesn't navigate away in the meantime. A resting second
>   finger (real multi-touch) never engages it at all — `touchstart` bails out
>   whenever `e.touches.length !== 1`.
> - **Swipe:** movement past `ROW_DRAG_TOL`=8px that's clearly horizontal
>   (`|dx| > |dy|×1.3`) — and only on a row with `data-uid`/`data-gid` (a DM or
>   group; call-log/contact rows are untouched by any of this) — adds `.swipe-l`/
>   `.swipe-r` and reveals a growing action bubble: **red delete/leave** from the
>   right on a left-drag, **blue mark-unread/read** from the left on a right-drag
>   (`acRowSwipeEnsureBubble`, reusing the `_CRA_IC.trash`/`.read`/`.unread` icons +
>   the real `acChatDelete`/`acChatLeave`/`acChatMarkRead`/`acChatMarkUnread`
>   functions — same ones the long-press menu already used, so both entry points
>   share one code path). `.swipe-l`/`.swipe-r` paint an inset, rounded pill in the
>   *exact* divider color (`var(--b2)`, same value the hairline itself uses) — the
>   row's own divider disappears under the pill (`.swipe-l::after{opacity:0}` etc.)
>   and so does the divider directly above it (the previous row's own bottom line),
>   via `:has()`, so the row reads as one solid rounded button for as long as it's
>   being dragged or resting open. **The pill is a `::before` on `.ac-item-inner`
>   (the sliding content wrapper), NOT the outer, non-translating `.ac-item`** — a
>   pseudo-element always follows its own element's transform, so it moves as one
>   unit with the text/avatar. An earlier version put it on the outer `.ac-item`
>   instead: since that element never moves, the pill stayed visually fixed in
>   place while the content slid out from under it during a swipe — backwards from
>   a real swipe-to-reveal, where the row (pill included) is what recedes — and it
>   also meant the "gray box" had no genuine edge of its own (just an arbitrary
>   point along one giant static rectangle), which is why it could never show a
>   real gap next to the action bubble. Moving it onto `.ac-item-inner` fixes both:
>   the pill now visibly slides with the row, and it has a real, independently-
>   rounded receding edge. A plain vertical scroll never adds either class, so it
>   never shows anything. **The pill's own inset is 4px (`ROW_PILL_INSET`), narrower
>   than the bubble's 8px inset (`ROW_BUBBLE_INSET`)**, so the avatar ends up
>   equidistant from the pill's edge on every side — it sits `--feed-gutter` (18px
>   on mobile) from the row's true left edge and 14px from `.ac-item-inner`'s own
>   top/bottom (its padding), so a 4px pill inset leaves the same ~14px gap on the
>   left too (an 8px inset, matching the bubble, left a visibly smaller ~10px gap
>   on that one side only, which read as the avatar sitting off-center inside the
>   pill). `ROW_SWIPE_SUB` (`= ROW_BUBBLE_INSET − ROW_PILL_INSET + ROW_SWIPE_GAP`)
>   is what the bubble-width formula actually subtracts from the drag distance, so
>   the pill↔bubble gap and the bubble↔screen-edge gap both still land on exactly
>   `ROW_SWIPE_GAP` (8px) despite the two insets no longer matching each other.
>   **The pill fades in/out (opacity, `.2s var(--ease)`) rather than snapping in
>   instantly** — an iMessage-style touch: the pseudo-element's box+background
>   exist UNCONDITIONALLY now (`opacity:0` at rest), with `.swipe-l`/`.swipe-r`
>   only toggling `opacity:1`, specifically so the fade is transitionable at all —
>   toggling the `content` property itself on/off via a class selector can't be
>   animated, since the box doesn't exist yet in the "before" state for the
>   browser to transition FROM. The divider-hide (`.ac-item::after{opacity:0}`)
>   picked up the same `.2s` transition so it fades in sync rather than snapping
>   instantly while the pill eases in around it.
>   - **Bubble sizing (constant gap, uncapped, rounder corners):** the bubble's
>     width is recomputed every touchmove tick as `max(0, |drag| − ROW_SWIPE_SUB)` —
>     a constant gap from the pill's own receding edge at every frame, matching the
>     reference mockups: two clearly distinct rounded shapes with real breathing
>     room between them, never flush/fused together (the earlier static-pill
>     version could only ever show an arbitrary flat edge there, not a real gap —
>     see above). Both the pill and the bubble use a **20px** radius (bumped up
>     from 14px for a more pronounced, "squircle" rounding). Width is **not
>     capped** at a fixed max; it keeps growing the further you drag (see commit,
>     below). Its icon only fades + scales in (`.show-ic`, a `.16s` opacity +
>     `transform:scale()` transition) once that live width clears `ROW_ICON_MIN`
>     (40px) — a small-to-full "pop" once there's room for it with a little padding
>     around it, not an instant full-size render crammed into a near-zero bubble.
>   - **Resting-open vs. commit:** releasing past `ROW_SWIPE_OPEN_THRESH` (45% of
>     `ROW_SWIPE_MAX`=74px) but short of a full commit snaps to a fixed resting-open
>     width (`ROW_SWIPE_MAX`) — tap the bubble to confirm the action, or tap the row
>     itself to close it; releasing short of the open threshold springs back closed.
>     Dragging **past `ROW_SWIPE_COMMIT_FRAC`** (58%) of the row's own width — a real
>     "long swipe" — **arms** it: a one-time haptic tick (`navigator.vibrate`) plus a
>     brightness bump on the bubble (`.armed`), and from that point on **releasing
>     anywhere fires the action immediately**, no tap on the bubble needed, exactly
>     like a full swipe-to-delete/archive in iMessage/Mail/Gmail — the drag itself IS
>     the confirmation. Armed is **sticky** for the rest of that gesture (easing back
>     before release still commits, matching the reference apps' "point of no
>     return"). `acRowSwipeCommit` slides the row the rest of the way off and
>     collapses it (`max-height`/`opacity`) while firing the action — for
>     delete/leave specifically, it calls `acChatDelete`/`acChatLeave` with a
>     `skipConfirm=true` second argument that bypasses their normal `appConfirm`
>     dialog (every other caller — the long-press menu, a tap on the resting-open
>     bubble — still gets the confirm); mark-read/unread never had a confirm dialog
>     to begin with. `commitDist` (like `dragBase`) is captured once per gesture as
>     `max(ROW_SWIPE_COMMIT_MIN, rowWidth × ROW_SWIPE_COMMIT_FRAC)` so a narrow row
>     still gets a meaningfully-far commit point, not one indistinguishable from the
>     open threshold.
>   - Only one row is ever open at a time (`AC._openSwipeRow`). The snap animation
>     uses the app's own `var(--ease)` for both the row's transform and the bubble's
>     width (`ROW_SNAP_EASE`/`ROW_SNAP_EASE_BUBBLE`) so they never visibly drift apart
>     mid-snap. `dragBase` (the drag's starting offset) is captured ONCE when a
>     gesture enters swipe/open phase, not re-derived from the row's own
>     `swipe-l`/`swipe-r` class each tick — that class is also being *set* by this
>     same handler, so re-deriving from it mid-gesture silently jumped the base the
>     instant the class first appeared (a real bug caught during testing). Touching
>     an already-`'open'` row and dragging it further ALSO requires the same
>     horizontal-vs-vertical check the fresh-touch `'pending'` path uses before
>     committing to `'swipe'` — an earlier version skipped that check for the
>     resume-from-open case, so scrolling vertically past an already-open row could
>     get hijacked into a swipe the instant the touch moved 2px in any direction,
>     yanking its transform around instead of just scrolling by; a vertical drag on
>     an open row now correctly falls through to `'scroll'` and leaves it untouched.

- **Multiple conversations with the same person** (email style): an extra
  conversation is a `dm_threads` row (pair normalized `a<b`, optional title); its
  messages carry that `at_messages.thread_id`. **`thread_id IS NULL` = the original
  main chat**, so all existing behavior is unchanged and extra threads are purely
  additive. `GET/POST /api/atchat/threads/:peerId` (list with per-thread last
  message + unread / create), and the read (`GET /api/atchat/with/:id?thread=`),
  send (`{threadId}`) and `…/read?thread=` are all thread-scoped (opening one
  conversation never clears another's unread). The chat list is **one row per
  conversation thread** (email-style, not one grouped row): `/api/atchat/conversations`
  returns a row per `(peer, thread_id)` — the main chat + each extra thread — each with
  its own thread-scoped last message + unread (`thread_title` on the row; extra threads
  render an `.ac-thread-tag` chip next to the name). Tapping a row opens that thread
  directly (`acDmRowTap` → `acOpenChat(peer, threadId)`, no picker); the open-chat header
  ⋯ menu has **"See all conversations"** (`acHeadAct('threads')` → `acOpenThreadPicker`)
  to jump between a person's threads or start a new one, and picking someone in New Chat
  who you already have history with asks **Continue vs Start a new chat**
  (`acComposePickPerson` → `#threadChoice`). `resolveDmThread` validates a thread
  belongs to the pair. **Export chat** (`acHeadAct('export')` → `acExportChat`, in
  both the DM and group ⋯ menus, WhatsApp-style) builds a readable `.txt` transcript
  from the already-loaded thread (`[date, time] Sender: message` lines; media/rich
  cards noted via `acMetaLabel`; deleted/pending bubbles skipped) and downloads it
  (or shares via the native sheet on mobile). **Unread never lingers:** the conversations + threads + bottom-nav
  unread queries are all thread-scoped and skip messages that have **expired**
  (disappearing) or the reader **deleted-for-me** (`expires_at`/`deleted_for` filters),
  so a read chat's badge clears and an expired/deleted-unread message can't leave a
  phantom green dot. Chat-list rows no longer flip the name to `@username` on tap
  (that toggle was removed so tapping anywhere on a row reliably opens the chat);
  the open-chat header name still toggles the subline (`acHeadName`). **Tapping the
  open-chat header avatar opens the CONTACT page** (`acHeadAvatar` → `acOpenContact`,
  the iMessage/WhatsApp-style `acContactDetailScreen`), NOT the full social profile.
  **Tapping a chat-list row's avatar** opens it too (`acOpenContactFromRow`; the rest
  of the row still opens the chat). A clean **centered** card with three views
  (`AC._contactView`): **quick** (`acOpenContact`, from a chat/row avatar) = header +
  three round icon buttons (Message/Call/Video, `.ac-cd-iconrow`/`.ac-cd-icbtn`) + a
  matched-width action stack (`.ac-cd-stack`, `width:fit-content` = the icons'
  combined width): not-saved → "Add to contacts"; saved → "View contact profile" +
  "Remove from contacts" (`.ac-cd-actbtn`, red `.danger`). **info**
  (`acShowContactInfo`, opened DIRECTLY from the Contacts list, or via "View contact
  profile") = header + icons + a **read-only list of saved details** (`.ac-cd-info`,
  filled fields only) + **"Edit contact"** + "Remove from contacts"; email/phone/website
  **auto-fill from the person's public profile** (`profileEmail`/`profilePhone`/
  `profileWebsite` from `GET /api/contacts`) when you haven't saved your own value.
  **edit** (`acEditContact`) = the **X-style** boxed floating-label form (reuses
  `.pf-field`/`.pf-flabel`/`.pf-finput`, `id="cf-<key>"`) + a top-bar **Save**
  (`acSaveContact` → back to info). Header tap → the full social profile
  (`acGoProfile`). The top bar is minimal — All/Chats/Calls tabs, AI button and the
  name label hidden and `tb-chat`/`tb-home` stripped for a plain borderless bar
  (`.tb-plain`, no hairline), leaving just the **chevron** back (`#tbBack`). Back:
  edit→info; info→quick (`AC._contactInfoFromQuick`) else the list/contacts;
  `AC._contactBackChat`/`AC._contactFromRow` route the quick view's back to the
  conversation, chat list, or Contacts. `acOpenContact(id, fallback)` works for a
  peer who isn't a saved contact yet. **Contacts-list header:** the search box sits
  in a `.ac-searchbar-row` flex (search `flex:1`) with a **⋯ button on its right**
  (`.ac-contacts-more`, `#acContactsMoreBtn`/`…2`) styled/sized exactly like the
  chat-tab ⋯ (`.tb-aidots`, 20px, `fill:var(--t2)`). It opens the same Apple-style
  popover (`#contactsMorePop`, `acOpenContactsMenu`/`_acAnchorPopover`) whose **Select**
  item enters multi-select mode — replacing the old inline "Select" text button. The
  ⋯ button IS the scope's `selBtn` (`cScope()`), so `acToggleContactSelect` hides it
  while the `.ac-select-bar` (All / Delete / Cancel) shows, then restores it on exit.
  The head has **no bottom divider** and **no on-screen counts row** — the contact
  counts moved into the ⋯ menu, which `acOpenContactsMenu` builds fresh each open from
  `AC._contactCounts`: **"N contacts"** (→ `acGoContacts`, your list), **"N people have
  you"** (→ `acOpenReverseContacts`, a full-screen `#reverseContactsView` list of
  everyone who saved YOU — `GET /api/contacts/reverse`; tap a row → their profile), and
  **Select**. **No pull-to-refresh
  on the Contacts tab** (`ptrActiveList` returns null when `AC._chatsTab==='contacts'`;
  it also targets the *visible* pane in a multi-pane screen). The chats list never
  flashes "No chats yet" before its first fetch: the plain-view empty state waits on
  `AC._chatsEverLoaded` (set once `acLoadChats` completes) and shows the shimmer
  skeleton until then.
- **Live location** (WhatsApp-style, DM-only): a sharer streams their position to
  a DM peer for a bounded window (15 min / 1 hr / 8 hr). `live_locations` row holds
  the latest coords; it's "live" while `NOT ended AND expires_at > now()`. Starting
  drops a **`meta.t='livelocation'`** card into the thread carrying `{liveId}`; the
  position then updates **in place** via lightweight **`liveloc` SSE** events (no
  new message per move). Routes (all DM-scoped, `dmAllowed`-gated): `POST
  /api/atchat/live-location {to,seconds,lat,lng}` (start — duration whitelisted to
  `LIVE_LOC_SECONDS`), `…/:id/update {lat,lng}` (**sharer-only**, fans `liveloc` to
  both sides), `…/:id/stop` (sharer ends early), `GET …/:id` (sharer or peer only →
  current lat/lng/expiresAt/ended/active). Client: the composer's **Location** tile
  opens a chooser (`acLocationSheet`) — "Send current location" (the existing static
  `meta.t='location'` pin) or, in a 1:1, "Share live · 15m/1h/8h" (`acStartLiveLocation`
  → `navigator.geolocation.watchPosition`, throttled ≤1/8s + a 20s heartbeat, auto-stops
  at expiry). The card (`acRenderLiveLocCard`) shows a pulsing pin, "🟢 Live location",
  a live countdown, Open-in-Maps (latest coords), and — for the sharer only — **Stop
  sharing**; `acOnLiveLoc` applies `liveloc` SSE updates, a 30s ticker flips it to
  "ended" on expiry, and `AC._liveShares` tracks the watch handles.
- **DMs** (`at_messages`): 1:1 chat. Text, photo, video/file, voice notes, rich
  "meta" cards (poll / event / location / **live location** / contact), replies, forwards, reactions,
  edits, per-message delete (for me / for everyone), **star** (personal bookmark;
  `starred_by INTEGER[]` on both `at_messages` and `at_group_messages`, so DM *and*
  group messages can be starred — `POST …/message/:id/star` and
  `…/groups/:id/messages/:mid/star`), an aggregate **Starred messages** view
  (`GET /api/atchat/starred` returns every starred DM + group message newest-first
  with peer/group context, excluding deleted/expired; surfaced via a ⭐ topbar
  button on the chats list, tap an item to jump to it in-thread), **message-content
  search** (`GET /api/atchat/messages/search?q=` searches the *text* of your own DM
  + group messages — mirrors the read-route visibility filters, so deleted-for-
  everyone / deleted-for-me / cleared-history / expired / non-member messages are
  never matched; optional `?peer=`/`?group=` scopes it to one conversation;
  injection-safe ILIKE with escaped wildcards). The chat-list search box runs it
  debounced alongside the name filter — matching chats up top, a **"Messages"**
  section of content hits below (`acRunMsgSearch`/`acRenderMsgResults`/
  `acHighlightMatch` centers + highlights the match), tap a hit to open the thread
  and flash the message (`acJumpToMsgResult` → `acOpenChat`/`acOpenGroup` +
  `acJumpToPinned`); the whole screen scrolls as one list while searching
  (`#acListScreen.msgsearch`). **In-chat search** (WhatsApp-style, *within* the open
  conversation): the thread header ⋯ menu → "Search in chat" opens a search bar
  (`#acSearchBar`, `acThreadSearchOpen`) that filters the already-loaded
  `AC.messages` client-side (the read routes load full history) — case-insensitive,
  skipping deleted/hidden bubbles — and steps match→match newest-first with a
  highlighted bubble + an `n/m` counter (`acThreadSearchInput`/`acThreadSearchNav`/
  `_acSearchShow`; Enter / Shift+Enter navigate, Esc closes). Reset on
  open/leave (`acOpenChat`/`acOpenGroup`/`acBackToList`). Hide/reveal, **pin**
  (`pinned_at` on `at_messages`/`at_group_messages`; pin/unpin + a `…/pins`
  endpoint for DM + group; shown in a thread pin banner, refreshed by an SSE
  `pin` event), and **disappearing messages** (per-conversation auto-delete
  timer: Off / 24h / 7d / 90d). DM timer lives in `dm_disappearing (a,b,seconds)`
  (pair normalized `a<b`); group timer is `at_groups.disappearing`. A new message
  stamps `expires_at` (`now() + interval` only when the timer is on; the second
  count is server-validated against `DISAPPEAR_OPTS`, never interpolated raw), and
  every thread-read query filters `expires_at IS NULL OR expires_at > now()` so
  expired messages vanish. `GET/PUT /api/atchat/with/:id/disappearing` (DM) and
  `…/groups/:id/disappearing` (group) get/set it; a change fans out a `disappearing`
  SSE event to the other side(s), and the thread payload exposes `disappearing`.
  Set from the header ⋯ menu → a picker. **Scheduled messages** (send later):
  a text message queued in `scheduled_messages` (DM or group) with a `send_at`;
  a server **flusher** (`flushScheduledMessages`, interval `SCHEDULE_FLUSH_MS`,
  default 20s) delivers due rows into `at_messages`/`at_group_messages` (mirroring
  the send routes — disappearing-timer aware, SSE `msg` to recipients *and* the
  sender's own devices) then drops them, re-checking permission/membership at send
  time. `POST /api/atchat/schedule {kind,to,body,sendAt}`, `GET …/scheduled`
  (mine, optionally `?kind=&to=` scoped), `DELETE …/scheduled/:id` (sender). Set
  from the composer + (`acScheduleMsgOpen`) and managed from the header ⋯ menu →
  Scheduled messages (`acOpenScheduled`). **Broadcast lists** (WhatsApp-style):
  a saved recipient set (`broadcast_lists` + `broadcast_list_members`) where
  sending fans the message out as **individual 1:1 DMs** (each replies privately).
  `GET/POST/PATCH/DELETE /api/atchat/broadcasts[/:id]`, `POST
  /api/atchat/broadcasts/:id/send {body,images}` (owner-only; uses the shared
  `deliverDM` helper, permission-aware per recipient, ≤256 members). UI: the
  new-chat sheet "Broadcast list" → manager (`#bcastList`) + contact-pick create
  (`#bcastCreate`) + compose (`#bcastView`, `acOpenBroadcasts`/`acSendBroadcast`).
  **Message
  yourself** (self-chat) is supported and behaves like WhatsApp (no presence/typing/
  unread on yourself). **Multi-image messages** (`at_messages.images`/
  `at_group_messages.images TEXT[]`, ≤4 via `cleanImages`; `image` stays the
  first): the composer photo picker is `multiple` (`AC.imgs`), DM/group send +
  read carry an `images` array, and `acMsgMedia` renders a swipe carousel
  (`.msg-imgcar` + dots) for 2+. **Chat labels / folders** (WhatsApp Business-style):
  `chat_labels` (name, color) + `chat_label_items` ((label, kind dm|group,
  target_id)) let a user tag DMs/groups and filter the list. `GET/POST/PATCH/
  DELETE /api/atchat/labels[/:id]`, `POST /api/atchat/labels/:id/assign
  {kind,targetId,on}`; the labels GET returns each label's `items` + `count` so
  the client filters locally. UI: a filter chip row above the chat list
  (`#acLabelBar`, `acRenderLabelBar`/`acLabelFilter`), a manager (`#labelManage`)
  and a per-chat assign sheet (`#labelAssign`, from the thread ⋯ menu → Label
  chat). DM permission is gated by contact-privacy + chat requests.
  **Chat wallpaper / theme** (`users.chat_themes` JSONB, `{threadKey: presetId}`):
  a per-conversation background chosen from `_CHAT_THEMES` presets (gradients +
  solids). `POST /api/atchat/theme {key,theme}` sets/clears it (returned in
  `/api/atchat/prefs` as `themes`); `acApplyWallpaper` paints the open thread's
  `#acThread` background, picker from the header ⋯ menu → Wallpaper
  (`acOpenWallpaper`/`#wallpaperView`).
  **Stickers & GIFs** (composer attach → "Sticker / GIF", `#stickerView` — three
  tabs: **Emoji · My stickers · GIFs**): an **emoji** sticker is a big emoji sent
  as a normal text message (`_STICKERS`, renders via `acEmojiOnly`). A **custom
  image sticker** is a real WhatsApp-style sticker — a member's uploaded image
  (`stickers` table, owner-scoped, cap `STICKER_CAP`=100; a picked image is
  downscaled to a 320px **PNG** client-side via `_stickerDownscale` so transparency
  survives — `downscaleImage` emits JPEG and would flatten the alpha). Routes:
  `GET/POST/DELETE /api/stickers` (add validates via `cleanImage`), and `POST
  /api/atchat/sticker {to|groupId, stickerId, clientId}` sends one into a DM or
  group as a **server-built `meta.t='sticker'` card** (image pulled from the sender's
  own `stickers` row — never trusted from the client, bypassing `cleanMeta`),
  idempotent on `client_id`, membership/`dmAllowed`-gated, channel-admin-gated. It
  renders **borderless** (`.msg-bubble.meta-sticker` strips the bubble chrome;
  `.msg-sticker` is a 132px contained image) like a real sticker. Client:
  `acLoadMyStickers`/`acRenderMyStickers`/`acAddStickerFile`/`acSendMySticker`, sent
  through the optimistic `acSendOne` path (which routes `_payload.sticker` to the
  sticker endpoint). A **GIF** is sent by its remote URL
  (`gifUrl` on the DM/group send routes, validated against `cleanGifUrl`'s allowed
  Tenor/Giphy CDN hosts; stored as the message `image`). GIF **search** proxies
  Tenor via `GET /api/gif/search?q=` (env-gated `TENOR_API_KEY`; `gifEnabled` in
  `/api/config`) — degrades to "not set up" when no key. `acSendSticker`/`acSendGif`.
  **View-once media** (`at_messages.view_once` + `viewed_by INT[]`): a 1:1 photo/
  video the recipient can open **once**. The bytes are **never shipped in the thread/
  live payload** — the bubble is a "tap to view once" placeholder; `POST
  /api/atchat/message/:id/view` returns the bytes a single time (recipient-only,
  410 on a second open, fires a `viewonce` SSE to the sender) and marks them in
  `viewed_by`. Sender + already-opened see a static "view once" / "Opened" chip.
  Client: a "1" toggle on the attach preview (`acViewOnceChip`/`AC._viewOnce`),
  send adds `viewOnce:true`, `acOpenViewOnce` opens it (image viewer /
  `#viewOnceVideo`).
  **Locked / hidden chats** (passcode): `users.chat_locked` (array of thread keys
  `d<id>`/`g<id>`) + bcrypt `users.chat_lock_pin`. `POST /api/atchat/lock/pin`
  (set/change, `current` required to change), `…/lock/unlock` (verify → returns the
  locked list), `…/lock/thread {key,lock}`. Locked threads are hidden from the chat
  list until the passcode is entered this session (`AC._lockedRevealed`); a "Locked
  chats" entry reveals them (`acEnterLocked`/`#chatLockView`). `GET /api/atchat/prefs`
  now also returns `locked` + `hasLockPin`.
- **Groups & channels** (`at_groups`, `at_group_members`, `at_group_messages`): group
  chat; a `broadcast` group is a **channel** (admin-post-only). Group read state is a
  per-member `last_read_at` (not per-message). **Per-message actions reach full DM
  parity**: `at_group_messages` carries `reply_to`, `reactions` JSONB, `deleted_for`
  INTEGER[], `deleted_all`, `hidden_for` INTEGER[], `edited`; group routes mirror the
  DM ones — reply (send with `replyTo`, validated to a non-deleted message in the same
  group), `POST …/groups/:id/messages/:mid/edit` (sender-only, text-only), `…/react`
  (one emoji per member, toggle/clear), `…/hide` (per-user), `DELETE …/groups/:id/
  messages/:mid?scope=me|everyone` (everyone = sender-only tombstone) — all
  membership-gated, fanning `dm_edited`/`dm_reaction`/`dm_deleted` SSE with a
  `{groupId,…}` payload to the other members. The client shares one code path with DMs
  via `acMsgApi(id)` (DM vs group URL base) so reply / edit / delete-for-everyone /
  hide / multi-select / react all work in a group; `rtOnDmEdited/Reaction/Deleted`
  branch on `d.groupId`. **Multi-admin + member management (WhatsApp-style):**
  `at_group_members.role` (`member`|`admin`); the creator (`at_groups.created_by`)
  is an implicit super-admin that can never be demoted/removed. **`isGroupAdmin(gid,
  uid)`** (creator OR `role='admin'`) now gates every admin-only group action —
  edit info, invite-link manage, channel posting/add-members, approve-join-request
  — broadened from the old creator-only checks, so any admin can co-manage.
  `POST /api/atchat/groups/:id/members/:uid/role {admin}` promotes/dismisses an
  admin; `DELETE …/members/:uid` **removes (kicks)** a member (admin-only; the
  creator can't be removed, and you can't kick yourself — use `…/members/me` to
  leave). A kick fires a `group_removed` notif + a **`group-removed` SSE** →
  `onGroupRemoved` drops the group and bounces the removed member out if they're
  viewing it. The group-info payload exposes `group.iAmAdmin` + per-member
  `isOwner`/`isAdmin`; client shows **Admin** badges and, for admins, a member-tap
  **action sheet** (`#gmemActions`, `acGroupMemberActions`: View profile / Make
  group admin / Dismiss as admin / Remove) — everyone else taps straight to the
  profile. Notif verbs `group_removed`/`group_admin_added`/`group_admin_removed`.
  **Invite links** (`at_groups.invite_code`,
  unique): admin-only `GET/POST/DELETE /api/atchat/groups/:id/invite` (create / rotate /
  revoke), and anyone-with-the-link `GET /api/atchat/invite/:code` (preview) +
  `POST …/invite/:code/join`. Client: "Invite via link" in group info
  (`acOpenGroupInvite`), and a `?joingroup=<code>` deep link opens a join sheet
  (`acOpenJoinInvite`). Group "Cloud" = a shared per-group
  drive (`group_cloud`, a folder tree). Each row has a `kind`: `folder`, `file`,
  collaborative `sheet`, `checklist` (assignable task list w/ progress + AI/industry
  templates via `POST …/cloud/ai-checklist`), `note` (shared doc), `form` (reusable
  fields + dated entries — incident reports, temperature logs, inspections), or
  `schedule` (shifts/rota), `roster` (team directory + key info/codes) or
  `expenses` (shared spend log w/ running total). Checklist items can be **assigned**
  to a group member (`POST …/notify-task` fires a `task_assigned` notification), and
  forms/expenses **export to CSV** client-side. New "tools" are just new kinds
  (content in the `data` JSON, realtime `cloud` push, last-write-wins save). The
  folder-list query returns a cheap per-tool summary (checklist `done/total`, form
  `entries`, schedule `shifts`, roster `people`, expenses `count`+`total`) via a
  `CASE` that never ships file blobs. Two AI helpers build checklists:
  `POST …/cloud/ai-checklist` (from a prompt) and `…/cloud/chat-checklist`
  (extracts tasks from the group's recent messages).
- **Communities** (WhatsApp/X-style umbrella): a `communities` row groups several
  sub-groups + an auto-created **broadcast announcement channel**
  (`announce_group_id` → an `at_groups` row with `broadcast=true`). `community_members`
  (role admin/member) + `community_groups` (links sub-`at_groups`). Creating a
  community spins up its announcement channel (creator = admin + announce member);
  **joining a community also joins the announcement channel**; sub-groups are normal
  groups a member can join (`…/groups/:gid/join`). Routes: `POST/GET /api/communities`
  (`scope=mine|discover`), `GET /api/communities/:id` (sub-groups + announce + flags),
  `POST/DELETE /api/communities/:id/join`, `POST /api/communities/:id/groups`
  (admin creates a sub-group), `DELETE …/groups/:gid` (admin unlinks). Surfaced from
  the search Discover actions ("Communities", `acOpenCommunities` → `#commList`/
  `#commView`); the owner can't leave their own community.
- **Calls:** 1:1 audio/video and group calls + "live" broadcasts over WebRTC, signalled
  through the SSE stream. ICE servers come from `GET /api/rt/ice-servers` (Google STUN +
  Cloudflare/static/free-relay TURN); the client **re-fetches them on a 5-min TTL**
  (`callIceServers`) because TURN credentials expire — a session-long cache would hand
  out dead relay creds and calls would stop connecting after ~an hour. **Reliable calls
  across mobile/symmetric-NAT networks require a real TURN server** — set
  `CLOUDFLARE_TURN_KEY_ID`/`CLOUDFLARE_TURN_API_TOKEN` (or `TURN_URL`/`TURN_USERNAME`/
  `TURN_CREDENTIAL`); the free `openrelay` fallback is best-effort and often unreliable.
  **Remote media must be explicitly played** — `callAttachRemote()` sets the remote
  `<video id=callRemoteVid>` `srcObject` AND calls `.play()` (unmuted); iOS Safari won't
  autoplay an audio-bearing remote stream, so without the explicit play a call can
  connect yet stay **silent/black**. It's called from `pc.ontrack`, the `connected`
  connection-state, and `callShowUI('connected')` (belt-and-suspenders). And because
  the remote track arrives *outside* a user gesture (especially on the caller's side,
  which taps well before the callee answers), `callPrimeRemote()` calls `.play()` on the
  empty remote `<video>` **during the call/answer tap** to unlock it, so the later
  programmatic play is permitted by iOS.
  **Non-trickle ICE (survives the iOS "offline" flap)** — the single biggest reliability
  fix: iOS Safari falsely fires an `offline` event the instant a WebRTC call starts,
  which tears down the SSE stream mid-call. The offer/answer already went through (so it
  rings + answers), but **trickle ICE candidates sent over SSE afterward are LOST**,
  leaving a "connected" call with no media (silent/black). So before sending an
  offer/answer, `callWaitIceGathering(pc)` waits for `iceGatheringState==='complete'`
  (capped ~2.8s) and we send the **full `pc.localDescription`** — every candidate bundled
  into the SDP — so a mid-call SSE drop can't lose them. Applied to all four send sites
  (`startCall`, `callAccept`, `callTryRestart`, `callOnRenegotiate`); trickle still fires
  as a late-relay fallback. And `syncOnlineBanner` **suppresses the offline/back-online
  banner while a call is active** — and for a ~2s `_postCallNetGrace` window after it
  ends (so iOS's stray post-call `online` doesn't flash "Back online"), after which it
  re-syncs to the TRUE state via `syncOnlineBanner(true)` (shows the offline banner only
  if genuinely still offline, never a spurious back-online). The iOS signal is a false
  positive; `rtResync` still runs on `online` to restore the SSE. Verified: a two-peer call reaches
  `connectionState:'connected'` with the remote track present.
  **Call-log cards in the DM thread (WhatsApp-style):** when a 1:1 call ends, the client
  `callLog()` posts to `POST /api/calls`; that route, **only for the caller's log**
  (`direction==='out'`, so exactly one message per call even though both sides post),
  drops a shared `meta.t='call'` card into the DM thread via `pushMetaCard` (fields
  `{kind:'audio'|'video', durationSec}`). Each viewer derives the outcome from the
  duration + who sent it: `durationSec>0` = answered (both see "Voice/Video call" +
  `acCallDur`), `0` = not connected (caller sees "No answer", callee sees a **red
  "Missed …call"**). Rendered by the `acMetaCard` `call` branch (`.mc-call`, incoming/
  outgoing arrow, tap → `startCall(kind, AC.peer)` to call back); chat-list preview
  `acMetaLabel('call')` = "📞 Call". So calling someone you've never messaged also
  creates the conversation thread with the call log in it.
  **Call links (WhatsApp-style shareable call links):** a host mints a link
  (`call_links` row: unique `code`, `host_id`, `title`, `media`, `active`) that
  **anyone signed-in can tap to join an ad-hoc group call — no prior connection or
  group membership needed**. The link row persists until revoked; the actual call
  **room is ephemeral + in-memory** (`callLinkRooms` Map, `code → Map<userId>`,
  capped at `GROUP_CALL_MAX`=8) and **reuses the entire group-call mesh/UI**
  unchanged — the client generalizes `GROUPCALL` with a `.link` field, and only
  the join/signal/leave endpoints branch (`gcSignal`/`gcLeave`/`gcEnterLink`).
  **Room membership itself is the signaling authorization boundary** (`POST
  /api/rt/call-link/signal` requires both ends currently in the in-memory room —
  no group check). Routes: `POST/GET/DELETE /api/call-links[/:code]` (create /
  my-links / revoke — host-only; revoke fans a `call-link` `{kind:'ended'}` SSE that
  tears down any live room), `GET /api/call-links/:code` (preview: host + title +
  live count), `POST /api/rt/call-link/{join,signal,leave}`. Mesh signals ride a
  new `call-link` SSE event → `callLinkOnSignal` → the shared `gcApplyMeshSignal`
  (extracted so group + link paths share one code path). Client: a **"Create call
  link"** row atop the **Calls tab** (`acCallLinkRow`/`acOpenCallLinks` →
  `#callLinksView`: Copy/Share/Start-video/Start-voice/Reset), and a `?call=<code>`
  deep link opens a join sheet (`acOpenCallLinkJoin` → `#callLinkJoinView`, preview
  + Join → `gcEnterLink`). Free for everyone.
- **Stories / Status** (ephemeral 24h updates): photo, **video (with its own
  audio)**, or text-on-gradient statuses (`stories` table, `kind` ∈
  `image`/`video`/`text` via `STORY_KINDS`, `media` TEXT data URL; `expires_at =
  now()+24h`; reads always filter `expires_at > now()` + a 10-min sweep deletes
  expired). A **video** story is the creator's own clip (no music library/licensing)
  validated through `cleanMedia` (must be `kind==='video'`) and capped at ~3.5MB
  (`STORY_VIDEO_MAX_CHARS`, matching the feed/reels ceiling — oversized/non-video
  rejected with a clear message); everything else (24h expiry, audience, fanout,
  view/seen, reply, delete, highlights) is identical to a photo story — video is just
  a new media kind on the same row. Shown to your **followers** (audience =
  people who follow you; blocks-aware both ways). `POST /api/stories {kind,media,
  caption,bg}`, `GET /api/stories` (the **tray** — people you follow + you who have
  an active story, grouped, unseen-first, with `hasUnseen`), `GET /api/stories/:userId`
  (a user's items, follow-gated, with per-item `seen`), `POST /api/stories/:id/view`
  (mark seen; `story_views`, own views don't count), `GET /api/stories/:id/viewers`
  (author-only seen-by), `DELETE /api/stories/:id`. A new story fans out a `story`
  SSE to followers. Client: a **story tray** that rides on top of the **Feeds tab**
  (`#acFeedStories`, overlaid on the immersive shorts so stories + shorts live
  together; `.js-story-tray` populated by `acRenderStoryTray`/`acLoadStoryTray`),
  gradient ring = unseen, grey = seen, “Your story” + to add — a full-screen
  **viewer** that auto-advances across the tray with progress bars + tap-nav
  (`acOpenStory`/`acStoryShow`/`acStoryNext`/`acStoryPrev`). A **video** item renders
  `<video class="story-vid" autoplay playsinline>` **unmuted** (it's tap-opened, so
  sound is allowed; a `.story-sound` speaker button toggles `_storyMuted`, with a
  muted-autoplay fallback if the browser blocks unmuted play). Its progress bar +
  auto-advance are driven by the clip's **real duration** (`loadedmetadata` → bar
  timing; advance on the `ended` event, with a safety timer) — falling back to
  `STORY_DUR` when duration is unavailable; press-and-hold (`acStoryPause`/
  `acStoryResume`) pauses/resumes the `<video>` too. The **composer** (`#storyCompose`)
  photo picker accepts `image/*,video/*` (`acStoryPickImg` detects a video, enforces
  the ~3.5MB cap, previews it, posts `kind:'video'`), keeping the Followers/Close-
  friends audience toggle; an author **seen-by** list (`#storyViewers`).
  **Story replies + quick reactions** (IG/WhatsApp-status style): on someone else's
  story the viewer footer is a reply bar — a row of quick-react emojis
  (`STORY_REACTS`/`STORY_QUICK_REACTS`, server-validated) + a "Reply to <name>…"
  input (focusing it freezes the story; `acStoryReplyFocus`/`acStorySendReply`/
  `acStoryReact`). `POST /api/stories/:id/reply {body|emoji}` (follow-gated, blocks-
  aware, not-your-own, dmAllowed) drops a server-built **`meta.t='storyreply'`** DM
  card to the author carrying a tiny story snapshot (kind/media/caption/bg, so the
  card renders even after the story expires); a reaction sets `meta.emoji=true`
  (rendered big). `notify` verbs `story_reply`/`story_react`. The DM bubble shows
  the card (thumbnail + "Replied to your story" + the text/emoji) and suppresses the
  duplicate plain body (`acMetaCard` storyreply branch).
  **Close Friends** (private story audience, IG-style): `stories.audience` ∈
  `all`/`close` + a `close_friends (user_id, friend_id)` list. A close-only story is
  shown **only** to people on the author's list — the tray + read queries gate it
  (`audience='all' OR author OR viewer ∈ close_friends`), and the new-story fan-out
  pushes to close friends instead of all followers. `GET /api/close-friends`,
  `POST/DELETE /api/close-friends/:id` (blocks-aware, never notifies the friend).
  Client: a Followers/Close-friends toggle in the composer (`acStoryAud`, sends
  `audience`) + an "Edit list" manager (`#closeFriends`, mention-search add/remove,
  `acOpenCloseFriends`/`acCfAdd`/`acCfRemove`).
  **Story highlights** (permanent collections pinned to a profile): `story_highlights`
  + `story_highlight_items` **snapshot** the story content (kind/media/caption/bg) so a
  highlight survives the 24h expiry. `GET /api/highlights?username=`, `POST
  /api/highlights {storyId, title|highlightId}` (snapshots into a new/existing
  highlight, owner-only, `HIGHLIGHT_CAP`=30), `PATCH /api/highlights/:id` (rename),
  `DELETE /api/highlights/:id` (+ `…/items/:itemId`, auto-drops an emptied highlight).
  Client: an "Add to highlight" bookmark on the own-story viewer footer
  (`acStoryHighlight` → `#highlightAdd`), a horizontal **highlights row** of circles
  on every profile (`#acHighlightsRow`, `acLoadHighlights`), and a viewer that reuses
  the story viewer in `highlight` mode (`acOpenHighlight`, no seen/reply; own gets an
  Edit button → `#highlightManage` rename/delete).
- **Quick replies** (WhatsApp-Business-style canned responses): saved message
  templates (`quick_replies`: optional `shortcut`, title, body; cap
  `QUICK_REPLY_CAP`=50, owner-scoped) you drop into a chat. `GET/POST/PATCH/DELETE
  /api/quick-replies` (shortcut normalized: leading `/` stripped, spaces→`-`,
  lowercased). Client: a **Quick reply** tile in the DM composer's attach menu
  (`acQuickReplyOpen` → `#quickReplies`) — a list (tap a row → `acQrInsert` appends
  the body into `#acInput`) with an inline create/edit form
  (`acQrNew`/`acQrEdit`/`acQrSave`/`acQrDelete`).
- **Go live / Spaces:** tapping "Go Live" opens a picker (`#goLiveSheet`) to start a
  **video broadcast** (one-to-many, existing flow) or an **audio room ("Space")** —
  X-Spaces-style. A Space is a `liveStreams` entry with `mode:'audio'` carrying a
  **stage** (`speakers` Map, host starts on it) and a raised-hand **requests** queue.
  Endpoints: `POST /api/live/start {mode:'audio'}`, `…/raise` (listener requests/
  cancels), `…/invite` (host promotes, ≤10 speakers, host-only), `…/demote` (host
  removes anyone / a speaker steps down; host can't leave own stage), `GET …/stage`
  (snapshot; requests visible to host only). Stage changes fan out a `stage` SSE
  event via `pushStage`; promote/demote send `promoted`/`demoted`. Audio is a WebRTC
  **mesh** reusing `/api/live/signal` — every speaker publishes to every participant;
  the client (`SPACE` state, `spaceSubscribe`/`spaceAddListener`/`spaceSyncSubscriptions`)
  diffs the speaker list on each `stage` event to add/drop peer connections. Group
  go-live can be audio too (members-only). UI: `#spaceOverlay` (`spaceRender`).
- **Social:** posts/replies (`posts`), likes, polls, **reposts** (`post_reposts`)
  and **quote posts** (`posts.quote_id`). **Post editing** (X-style): the author
  can `PATCH /api/social/posts/:id` to change the body within a 1-hour window
  (`POST_EDIT_WINDOW_MS`, author-only, enforced server-side); the edit re-indexes
  hashtags and stamps `posts.edited_at` (→ `editedAt` on `mapPost`), shown as an
  "Edited" label on cards/detail. Own posts get an overflow menu (`acOwnPostMenu`
  → Edit / Delete); editing reuses the composer in a body-only edit mode
  (`acEditPost`/`acSaveEditedPost`).
  **Undo toast** (design blueprint): after a **live** post (not a scheduled one),
  `acSubmitPost` shows a bottom-center **10s "Post shared · Undo"** toast
  (`acUndoToast(msg, actionLabel, onAction, ms=10000)`, `.undo-toast`, one at a
  time, blue text action) — tapping Undo `DELETE`s the just-created post (its id
  comes from the create response `{post}`) and refreshes the surface. Scheduled
  posts keep their own "Scheduled for …" confirmation and aren't undo-toasted.
  **Postshot** (`acPostshot(id)`) — an overflow-menu action (both the own-post
  `#ownPostActions` and the other-post `#postActions` sheets) that renders **just that
  post** to a clean, shareable **PNG** via a **dependency-free Canvas 2D** painter
  (`_renderPostshot`): avatar (app-shaped for businesses), name + verified check, body
  (hashtags/mentions/links in accent), the photo, and the filled engagement row with
  active colours. It reads the current theme's CSS variables, and post images/avatars
  are base64 data URLs so the canvas never taints (remote GIFs/demo images load with
  `crossOrigin`). The top-right shows the **Atwe logo mark** (not the ⋯) with the
  **full date/time** (`acFullTime`) to its left — Postshot-only; regular post cards keep
  the ⋯ + relative time. Result opens in a preview (`#postshotView`) with **Forward**
  (reuses the message forward picker via `AC._fwdFeedShare = {image}` to send it as an
  image DM — `acPostshotForward`), **Share** (native share sheet → save to Photos / other
  apps, shown only when `navigator.canShare` supports files) and **Download**
  (`acPostshotShare`/`acPostshotDownload`; the render is also kept as a base64 data URL in
  `AC._pshDataUrl` for forwarding). A repost re-surfaces the post in
  followers' Following feed (ordered by repost time) with a "Reposted by"
  attribution (`repostedBy` on `mapPost`); quote embeds render flat (no box).
  **Image alt text** (accessibility): `posts.image_alt` — the composer shows an
  "alt text" field when a photo is attached (`#acPostAlt`), the create route stores
  it (only when an image is present), `mapPost` exposes `imageAlt`, and `acPostMedia`
  applies it as the `<img alt>`. A "generate with AI" button
  (`POST /api/ai/alt-text {image}` → Atwe AI vision, haiku, 503 without a key)
  auto-describes the attached photo (`acGenAltText`).
  **Multi-image posts** (`posts.images TEXT[]`, ≤`MAX_IMAGES`=4; the single
  `image` column stays the first for list previews / back-compat): the composer
  accepts several photos (`_acPostImgs`, file input `multiple`), the create-post
  route validates them via `cleanImages`, `mapPost` returns an `images` array
  (falling back to `[image]`), and `acPostMedia` renders an **X-style mosaic grid**
  (`.ac-imggrid.n2/n3/n4`: 2 side-by-side · 3 = one tall + two stacked · 4 = 2×2) in
  one rounded box for 2+ images (tap a cell → `openImageViewer`).
- **Full-screen image viewer** (`#imgViewer`, `openImageViewer(src, originEl, postCtx)`):
  a **bare X top-left** (no circle) + a **⋯ menu top-right** (`acIvMenu` → Forward /
  Share / Download: `acIvForward` reuses the message forward picker via
  `AC._fwdFeedShare={image}`, `acIvShare` uses `navigator.share` files→url→download,
  `acIvDownload` saves the blob). When opened from a **post** image it shows a bottom
  **engagement bar** (`#ivActions`, `acIvRenderActions`: reply → `acOpenPostView`, like
  → `acToggleLike`, view count) — `acPostMedia` passes `p.id` as `postCtx` (also
  auto-detected from the nearest `.ac-post[data-postid]`); message/avatar/banner images
  omit it, so no engagement bar there.
- **Post composer chrome** (`#acPostScreen`, X-style): **no "New post" title + no
  divider** (`#acPostScreen .msg-top{border-bottom:none}` + `.ac-title{display:none}`),
  a **small author avatar left of the input** (`.ac-compose-row` > `#acComposeAv`,
  filled on open in `acOpenPost`/`acEditPost`), toolbar icons unified to the round-cap
  line set (`.msg-attach svg`, 1.8 stroke), and the AI logo shrunk to 20px.
  **Bookmarks** (`post_bookmarks`, private; a Bookmarks feed tab + `bookmarked`
  on `mapPost`) with **folders** (`bookmark_folders` + `post_bookmarks.folder_id`,
  null = unsorted; deleting a folder keeps its bookmarks via `ON DELETE SET
  NULL`): `GET/POST/PATCH/DELETE /api/social/bookmark-folders[/:id]`, the bookmark
  POST takes an optional `folderId` (upserts), `PUT /api/social/bookmarks/:postId/
  folder` moves one, and `GET /api/social/bookmarks?folder=:id|unsorted` filters.
  Client: a folder chip row on the Bookmarks tab (`acBmkFolderBar`/`acBmkFilter`),
  a manager (`#bmkFolderManage`), and a "Save to folder" picker (`#bmkMove`) in
  both post overflow menus. **Entity tokens — `@` / `#` / `$`** (`acLinkifyPost`,
  shared by post bodies AND chat message bubbles): `@handle` → profile
  (`acGoProfile`), `#tag` → hashtag page (`acOpenHashtag`), and **`$CASHTAG`** (a
  stock/crypto ticker, letters-only so a `$5` price is NOT linked) → the cashtag page
  (`acOpenCashtag`). All render as blue `.ac-tag` spans; the `$` replacement uses a
  function replacer so the literal `$` isn't read as a regex replacement pattern.
  **Cashtag page** (`#cashtagView`, `acOpenCashtag`/`acLoadCashtag`/`acRenderCashtag`,
  X-style): symbol + name, big price, coloured % change, a **dependency-free canvas
  area chart** (`acDrawCashChart`, green up / red down) with **1D/1W/1M/1Y/ALL** range
  pills + **Top/Latest** stream tabs, over the in-app stream of posts mentioning the
  ticker. Backed by `GET /api/cashtag/:sym` → `{symbol, quote, financeEnabled, posts}`
  (posts via `body ILIKE '%$SYM%'`, blocks-aware — ALWAYS works). **`finance.js`** is
  the optional market-data module (graceful, like `geoip`/`mailer`): `finance.quote()`
  fetches a live price+series from Yahoo Finance's no-key public endpoint by default
  (or `finnhub` with a key; `FINANCE_PROVIDER=off` disables), and returns `null` on any
  failure so the page degrades to just the post stream. **Inline cashtag card**
  (`acCashCardHtml`, rendered under any post whose body has a `$TICKER` via
  `acFirstCashtag`): an X/Robinhood-style price card (logo · name · symbol · price ·
  coloured % change · mini sparkline) that taps through to the page. It lazy-hydrates
  on scroll (`IntersectionObserver` → `acHydrateCashCard`) from a **cached** `GET
  /api/quote/:sym` (60s server-side `getCachedQuote`, session-cached client-side in
  `AC._quoteCache`), and degrades to a "View chart & posts" affordance when there's no
  price. The ticker icon (`acCashIcon`) is a tinted lettered circle with the real brand
  logo layered on top from a no-key CDN (`_cashLogoUrl`, onerror → the letter). The
  page also has a **"View on market ↗"** external link to the public market page. **Hashtags** (`post_hashtags`,
  indexed on post create via
  `extractHashtags`): `#tags`/`@mentions` are linkified (`acLinkifyPost`); the
  post composer has **@mention autocomplete** (`GET /api/social/mention-search?q=`,
  prefix-ranked, blocks excluded; `acMentionToken`/`acMentionPick` insert the
  handle at the caret).
  `GET /api/social/hashtag/:tag` is a tag page (returns `following`), and `GET
  /api/social/trending` powers a Trending widget on the Search surface. **Follow a
  hashtag** (`hashtag_follows`): `POST/DELETE /api/social/hashtag/:tag/follow` +
  `GET /api/social/followed-hashtags`; the tag page has a Follow toggle
  (`acToggleHashtagFollow`) and Explore shows a "Hashtags you follow" chip row. **Advanced post search**
  (X-style): the posts scope of `GET /api/search` parses operators via
  `parsePostSearch` — `from:user`, `#tag`, `since:`/`until:` (YYYY-MM-DD),
  `has:image|video|media`, `min_likes:N`, `min_reposts:N`, `sort:top|latest` —
  into a parameterized WHERE (injection-safe; an operator-less blank query
  returns nothing rather than the whole feed). The Posts search surface shows a
  tappable operator cheatsheet (`acPostSearchHelp`/`acSearchInsert`). **Post
  views** (`post_views`,
  deduped per-viewer-per-day, author excluded; `views` on `mapPost`, shown compact
  via `acCompact`) recorded on detail-open. **Per-post analytics** (author-only):
  `GET /api/social/posts/:id/analytics` returns impressions, unique viewers,
  likes/reposts/replies/bookmarks, total engagements + engagement-rate %, and a
  14-day views trend; surfaced via "View analytics" in the own-post overflow
  menu (`acOpenPostAnalytics`, sparkline + stat grid, `#postAnalytics`). The
  **For You** feed is engagement-
  ranked with a recency decay (`ln(likes + 2·reposts + replies)·3 − age/8h`);
  **Following** stays chronological. **Home-feed layout** (X-style): the feed scope
  tabs (`#tbFeedTabs`) are **exactly four** — **For You · Following · Circles ·
  Collections** (`AC_FEED_TABS`; "Collections" is the bookmarks scope relabelled —
  order per the design blueprint, Circles before Collections) — a
  horizontally-scrollable row with **no underline**, all tabs the **same size**
  (active = bold white, inactive = muted gray — the active tab never resizes). On **mobile** home the row leads with the **≡ menu**
  (the home avatar is gone; `syncTopbar`/`acShow` show `#sbToggle` on home, the avatar
  only on Search) and the extra top-bar buttons are hidden so the row is just ≡ + the
  4 tabs, with a soft **left-edge fade mask** (tabs dissolve under the ≡ as the row
  scrolls; the right edge stays sharp). The mobile home bar is **solid** (no blur) with
  a **grey hairline** under the tabs and **no darken scrim** (`#acTopScrim` is forced
  off on `#acFeed`) so content clips cleanly beneath it, X-style. **The hairline,
  the feed-tab ⋯, and every post's ⋯ menu all end at the same right edge**
  (`--feed-gutter` inset) — on home the topbar's right padding is set to the gutter
  and `#tbFeedTabs` has `padding-right:0`, so the last tab-row item rests flush at the
  hairline's right edge when the row is scrolled to its end. Switching tabs is
  **tap-only** — a tap triggers a **horizontal page-slide** (`acSetFeed` computes the
  direction from the previous scope → `feedSwipeIn` on `#acFeed`). The finger-swipe-
  to-change-tab gesture was **removed** (`acBindFeedSwipe` is a no-op) because a
  horizontal drag inside the feed — e.g. scrolling the who-to-follow carousel — could
  accidentally flip tabs. The two AI helpers (**Show me what matters** / **Catch me
  up**) live behind a **⋯ button after the Circles tab** (`#acFeedTabAi`, same gap as
  the tabs) that opens a small **Apple-style popover** (`acOpenFeedAiMenu` →
  `#aiMenuPop`, anchored under the dots, frosted/theme-aware; dismissed via
  `#aiMenuScrim`). The full-screen `#aiHub` sheet (`acOpenAiHub`) stays for the Me-hub
  entry point; the old `#tbAiBtn` top-bar button is retired. **`acPostCard` is X-style** —
  header (`.ac-post-top`: avatar + bold name + the shared **`vbadge`** verified check +
  gray @handle + timestamp + ⋯; the name+badge are wrapped in `.ac-post-nameline` so the
  badge hugs the name rather than inheriting the header's 8px gap), content full-width
  below (`.ac-post-body`),
  `acFitPostImg` sizing a wide photo full-width vs. indenting a narrow/portrait one;
  the engagement row (`.ac-post-actions`) is **views(eye)·reply·repost·like·bookmark·
  share** — small (15px) **filled** glyphs matching the nav-bar icon style, muted gray by
  default and colour on active (like → rose, repost → green, bookmark → accent, via
  `fill:currentColor` + the `.on` colour), with counts (`.ac-act-n`; the eye always shows
  the real `views` count, recorded both on post-open *and* via the feed dwell tracker so
  feed reach is accurate), a hairline divider between posts. The post-detail action row
  (`.ac-pf-actions`, `acPostFocusCard`) uses the same filled set a touch larger (17px); **tapping a post's relative
  timestamp** (`.ac-time-click` → `acToggleTime`) swaps "3d" in place for the full
  date/time and back (reset on re-render), and `acTime` switches to an absolute
  month-day-year once a post is older than a week. The inline **who-to-follow** module
  (`acFeedSuggestModule`) is an **X-style horizontal carousel** (`.ac-sg-scroll` of
  `.ac-sgc` banner+avatar cards) with **no top/bottom divider borders**; its heading,
  cards and "Show more" all align to the post gutter (`scroll-padding-left` keeps the
  first card from snapping under the left padding). Stories were removed from the home feed (now on the Feeds tab).
  **In-post links** are blue + tappable (`acLinkifyPost`, http(s)/www only, never
  javascript:); **Translate post** shows only when a post isn't in the reader's
  language (`acDetectLang` vs `navigator.language`). **Discover shorts**:
  `GET /api/feedposts/discover` returns out-of-network short photo/video feed posts
  (blocks/mute-aware); a "Shorts to discover" row on the Search/Discover page
  (`acLoadDiscoverShorts`) opens them in the immersive viewer (`acOpenDiscoverShorts`,
  reusing `#userFeedOverlay`). **Immersive engagement rail** (TikTok / LinkedIn-Video
  style): each card in the immersive feed/shorts viewer (`acFeedCardHtml` →
  `acFeedRailHtml`) has a vertical right-side rail — **like + dislike** vote
  (`feed_post_likes.value` ∈ 1/-1, toggling the same value clears it;
  `POST /api/feedposts/:id/like {value}`; `acFeedVote`), **comment** count →
  comments bottom-sheet, **share** (native share / copy link), **save/bookmark**
  (`feed_post_saves`; `POST /api/feedposts/:id/save`; `acFeedSave`), and **more (…)**
  (`acFeedMore` → Send in a message (reuses the forward picker via `acFeedForwardOpen`/
  `AC._fwdFeedShare`) · Save · Copy link · Follow/Unfollow author (`iFollow` on
  `mapFeedPost`, `acFeedToggleFollow`) · Not interested · Report video / Delete-if-mine;
  `feedpost` is a `REPORT_TYPES` target). **Comments** are flat with their own
  hearts (`feed_post_comments` + `feed_comment_likes`): `GET/POST
  /api/feedposts/:id/comments`, `DELETE …/comments/:cid` (commenter or post owner),
  `POST …/comments/:cid/like {on}`; the bottom-sheet (`#feedComments`,
  `acFeedOpenComments`/`acRenderComments`/`acFeedSendComment`/`acFeedCommentLike`)
  posts/lists/likes/deletes inline and keeps the rail's comment count in sync.
  Counts + my-state ride on `mapFeedPost` (`likes`/`dislikes`/`comments`/`myVote`/
  `saved`); `feedPostVisible` gates engagement (exists, not blocked, discover-open);
  notify verbs `feed_like`/`feed_comment`. **Reply controls** (`posts.reply_scope`:
  `everyone`/`following`/`mentioned`/`verified`) — the composer picks who can reply via
  an X-style **"Who can reply?" bottom sheet** (`#replyScopeSheet`, `acReplyScopeMenu`
  → icon + radio rows: Everyone / Accounts you follow / Only accounts you mention /
  Verified accounts); replies are enforced server-side in the create-post route (via
  `canReplyTo`, `verified` gates on `users.verified`) and the detail route returns
  `canReply` to gate the reply box. **Lists** (`lists` +
  `list_members`, owner-scoped): curated timelines — create/rename/delete, add/
  remove members, `GET /api/social/lists/:id/timeline` shows members' posts;
  reachable from the Me hub + an "Add to list" action on profiles.
  **timeline/feed**, profiles,
  follows; **circles** (`circles`/`circle_members`/`post_circles`) and **feeds**
  (joinable broadcast channels, `feeds`/`feed_members`/`post_feeds`).
  > **Circles are the fixed, company-defined industries only** — nobody creates them
  > (not even a business), and they have **no @username** shown. `POST /api/circles`
  > returns **403** and `GET /api/circles` filters `official = true`; editing an
  > official circle is also 403. You **join** a circle like a community (the Home
  > Circles tab + the Explore "Circles" search list only official circles, member
  > count only — no `circle@handle`). Circle detail shows "Industry circle", no Edit,
  > no create entry points (the old `#acCircleCreateScreen` / `acCircleCreate` /
  > `acCircleEdit` are unreachable). The `username` column + `/circle/:username`
  > deep-link stay dormant for back-compat but are never surfaced.
  `posts.to_main=false` means a post is circle/feed-only — **single-post reads must
  apply the visibility gate** (`GET /api/social/posts/:id` checks
  own-or-public-or-circle-member-or-feed-viewer).
- **Mute** (X-style, feed-only, silent — never blocks/unfollows/notifies):
  **accounts** (`post_mutes`, one-directional) and **keywords** (`muted_keywords`,
  unique per `(user,lower(word))`). Both are filtered out of the For You / Following
  feeds + promoted slots via the shared **`MUTE_FILTER`** SQL fragment (`$1` = viewer;
  drops muted authors + `body ILIKE %word%`, but **never the viewer's own posts**).
  Routes: `POST/DELETE /api/social/mute/:id`, `GET /api/social/muted`;
  `GET/POST/DELETE /api/social/muted-keywords[/:id]`. Profile payload carries
  `isMuted`; client `paMute` (post/user action sheet) + Privacy-settings managers
  (`#mutedOverlay`/`#mutedWordsOverlay`, `acOpenMutedAccounts`/`acOpenMutedWords`).
- **Pin a post to your profile** (`users.pinned_post_id`, FK `ON DELETE SET NULL`):
  `POST/DELETE /api/social/posts/:id/pin` (own top-level posts only). The profile
  payload returns `pinnedPost`, rendered above the timeline with a "Pinned" label
  (de-duped from the list); own-post menu shows Pin/Unpin (`acTogglePinPost`).
- **Thread composer:** `POST /api/social/thread {posts:[{body,images?}], replyScope?}`
  (2–25 segments) inserts a **self-reply chain** — the root is a normal top-level
  post (hits the main feed); the rest are `parent_id`-chained replies (off-feed,
  X-thread style). Client: a thread button adds extra segments to the composer
  (`acThreadAdd`/`acThreadSegments`); `acSubmitPost` routes to `/thread` when
  segments exist in a plain main-feed context.
- **Post drafts** (`post_drafts`, server-saved): `GET/POST/PUT/DELETE
  /api/social/drafts[/:id]`. Composer drafts button (`#draftsView`,
  `acOpenDrafts`/`acSaveCurrentDraft`/`acLoadDraft`); a successful post/thread
  clears the loaded draft (`AC._draftId`).
- **Notifications** (`notifications`): likes/replies/follows/logins, scoped to the owner.
  The **Notifications page** (`#notifOverlay`, `openNotifications`/`notifRow`) is a
  **clean X-style feed**: full-bleed rows (`.notif-row`, gutter-aligned to `--feed-gutter`,
  theme-following `var(--bg)` — light/dim/black), **no divider lines** and **no per-type
  avatar badge** (kept minimal), just the actor's avatar (**app-shaped** for businesses
  via `acAvatarHtml(…, acIsBiz(a))`), a verified check after the name, and a subtle
  **unread dot** (`.notif-dot`). The `/api/notifications` actor payload carries
  `accountType`/`verified` for the biz shape + badge. **Tapping a row navigates to the
  relevant destination** (message → the DM thread with a reply box, like/reply → the post,
  follow/endorse → the profile, job → the job, order/product → the listing, etc. — each
  target screen has its own back arrow), NOT the home tab. The `login` row is a system
  security alert — the **Atwe brand mark** (`.notif-brand-mark`, masked `/logo-mark.png`,
  no actor); tapping it opens an **in-overlay detail page** (`#notifDetail`,
  `acOpenNotifDetail(i)`/`acCloseNotifDetail`/`acRenderNotifDetail`) that slides in over
  the list with its **own back arrow returning to the list** (never into Settings) — a
  hero (Atwe mark + "New sign-in" + full timestamp), a security message and a "Change
  password" action. `openNotifications` stashes the array in `AC._notifs` (the detail
  reads it by index) and resets the detail state on open.

### Realtime (SSE)

- One stream per connection: `GET /api/rt/stream?token=<short-lived stream token>`
  (minted by `GET /api/rt/token`; the 30-day bearer never goes in a URL). The stream
  token carries the issuing session's hash (`sh`) and is re-checked against
  `auth_sessions` on connect, so a logged-out session can't reconnect.
- Server fan-out: `rtClients: userId → Set<res>` (multi-device). `rtPush(userId,…)`
  hits every connection; `rtBroadcast`; `rtKickUser` force-closes a user's streams
  (used on password reset / log-out-everywhere). Presence is derived from open
  connections; "offline" only when the **last** connection closes. The client treats
  each `presence-init` as an **authoritative snapshot** — on an SSE reconnect (iOS
  resume / network blip) anyone still marked online but absent from the fresh set is
  cleared, so a peer who went offline during the gap doesn't keep a stale green dot.
- Events: `msg`, `read`, `read-self` (clear unread on your *other* devices),
  `typing`, `presence`/`presence-init`, `dm_*` (deleted/reaction/edited), `metaupd`,
  `call`/`group-call`/`live`/`cloud`, `notif`.
- **Web Push (PWA, optional):** alongside the in-tab SSE stream, `notify()` also
  fires a **web push** so alerts arrive when the app is closed. `push.js` wraps
  `web-push` with VAPID; `push_subscriptions` stores one row per device
  (`POST /api/push/subscribe` / `…/unsubscribe`). `pushToUser`/`sendPushForNotif`
  fan out to a user's devices and **prune dead subscriptions** (404/410). `sw.js`
  has `push` (showNotification) + `notificationclick` (focus/open) handlers. Client:
  a Settings → Session "Push notifications" toggle (`togglePush`/`syncPushRow`,
  requests permission, subscribes via `pushManager` using `config.vapidPublicKey`).
  Degrades cleanly when VAPID is unset.

### Client conventions (important patterns)

- **Optimistic send + idempotency.** A send shows a temp bubble immediately; its temp
  id is sent as `clientId`. `at_messages`/`at_group_messages` have a `client_id` with a
  unique index (DM: `(sender_id, client_id)`; group: `(group_id, sender_id, client_id)`)
  and the send uses `ON CONFLICT DO NOTHING` + fetch-existing, delivering only when
  newly inserted. So a **retry / double-tap / resync can never duplicate a message**.
  When adding a new send path, include `clientId` (e.g. `acSend`, `acSendMeta`).
- **Last-tab restore.** `appTab(tab)` persists the tab to `localStorage.atwe_last_tab`
  (`_lastTab()` reads it back, validated against the known tab set; `'call'` is
  excluded so a reload never auto-reopens a live call UI). `boot()` uses it — both on
  a normal successful session restore and on the network-hiccup cached-profile
  fallback below — instead of always defaulting to `'home'`. Without this, ANY reload
  (an OS-reclaimed backgrounded PWA tab on iOS, a manual refresh, the SW's
  network-first navigation fetch) dumped the user back on Home regardless of where
  they actually were, which read as "the app randomly refreshes and kicks me back to
  the homepage" even when the session itself was never lost.
- **Resync on resume.** iOS freezes a backgrounded tab and silently kills the SSE
  (it may even report OPEN while dead). `rtResync` (bound to `visibilitychange`/
  `online`/`pageshow`) force-reconnects and `acReloadOpenThread` backfills the open
  thread (SSE has no replay), de-duping against the server's returned `clientId` and
  auto-retrying failed sends.
- **Drafts.** A half-typed message is persisted per conversation in `localStorage`
  (`Drafts`, key `d:<peerId>`/`g:<groupId>`), restored on open, cleared on send, and
  shown as a red "Draft:" label on the chat-list row.
- **Unread divider.** Opening a thread with unread messages shows a "New messages"
  divider before the first unread and scrolls there (DM: first incoming with
  `read_at=null`; group: first other-author message newer than `last_read_at`).
- **Width-hug + cache.** Plain text bubbles shrink to their longest line
  (`_hugBubbleLines`, iMessage-style); the measured width is cached on the message
  object (keyed by text + viewport) so re-renders don't re-measure unchanged bubbles.
- **Devices & sessions.** `auth_sessions` is a real, revocable session store (checked
  in `requireAuth` with a short positive cache). Settings → Devices lists each session
  (UA-derived name, approximate `location` from `geoip.js`, last-seen, current). A
  **password reset revokes all sessions** and closes live streams.

### Security model (AtChat)

- **Blocks** (`blocks`, blocker_id/blocked_id) must be enforced in *both* directions on
  any cross-user action — DMs (`canContact`/`dmAllowed`, fail closed), and social
  follow/reply/like (`blockedEither`, fails closed). Timelines filter blocked authors.
- **Authorization is per-row:** message mutations require `sender_id`/`recipient_id` =
  caller (delete/edit-for-everyone require `sender_id`); group actions require
  membership, admin actions require `created_by`; circle/feed edits require `created_by`.
- Profiles are **public by design** (no "private account") — the privacy boundaries are
  blocks, non-open feeds, and circle-only posts. Profile update uses a fixed column
  whitelist (no `is_admin`/`plan`/`verified` mass-assignment). `plan` is **not** a
  security boundary (only widens `max_tokens`).
- **Chat privacy notice (honest — NOT E2EE).** Atwe is server-mediated, so it is
  **not** end-to-end encrypted (messages are stored server-side so history syncs
  across devices). Every thread renders a small centred `.msg-enc` chip at the top
  (`acChatPrivacyNotice`, prepended in `acRenderThread`) — *"Messages are encrypted
  in transit and private to this chat. Tap to learn more."* — that opens
  `#chatPrivacyView` (`acShowChatPrivacy`), a plain-English explainer which
  **explicitly states "Not end-to-end encrypted"** and describes the real model
  (encrypted in transit via HTTPS, private to the chat, stored securely + never
  sold/ad-targeted, plus block/report · disappearing · view-once · locked chats ·
  privacy settings). Never word this as an E2EE claim.

## Business networking & jobs marketplace

A LinkedIn-meets-jobs-board layered on the same accounts/auth/DB. Like AtChat it's
**signed-in only**. The frontend lives in the same `public/index.html` (`ac*`
functions, banner-comment sections); routes are in `server.js`.

### Account types

- Every account is **`personal`** or **`business`** (`users.account_type`), chosen
  on a **"personal or business?"** step that comes **first** in the signup wizard
  (the real page-by-page `su*` flow) and in the Google/Apple OAuth completion step.
- A **business account *is* the employer surface** — there is no separate
  "company page". Posting "your name" becomes **"company / business name"** for
  business signups; the rest of the wizard is the **exact same design** as personal.
- **Default avatars (no photo) are ONE flat colour for everyone** (`AVA_DEFAULT_TINT`,
  `avatarTint()`) — applied in `acAvatarHtml`/`acAvatarOpenable` as an inline
  `background` (overriding the `.user-avatar` CSS default). An earlier version
  hashed each name into one of several gray shades (Google/Telegram/Slack-style
  per-person tinting) so people were subtly distinguishable at a glance, but the
  shade differences across a list read as inconsistent rather than deliberate, so
  it's a single consistent tone now.
- Business avatars render as an **app-shape rounded square** (`.user-avatar.biz`,
  `border-radius:28%`) via `acAvatarHtml(name, avatar, cls, biz)` — the one visual
  tell that distinguishes a business from a person. The app-shape is applied
  **everywhere a business avatar appears**, including the non-`acAvatarHtml` spots:
  the **signup profile-picture ring** (`.su-photo-ring.biz`, toggled in
  `suPhotoRender` from `SU.accountType`), the **profile editor** avatar
  (`#pfAvatar`, toggled in `openProfileEdit`), and the **profile-loading skeleton**
  (`.skel-ava.biz` via `acSkelProfile(biz)`). The skeleton picks its shape from
  `AC._bizUns` — a username→biz map that `acIsBiz(u)` populates as a side-effect — so
  navigating to a business profile shows an app-shaped placeholder before the data
  loads (own account uses `S.user`; cold deep-links fall back to a circle until known).
- **Dormant company tables:** earlier `company@username` *pages* were removed; the
  business-account model replaced them. If you find leftover `company_*` columns or
  a `company_job` notif type, they're dead — don't build on them.

### Jobs marketplace (two-sided)

- **Employers** post **`jobs`** (title, description, industry, location, remote,
  `salary_min`/`salary_max`/`salary_period`, `hours`, `featured_until`). **Free
  business accounts are capped at `BUSINESS_FREE_JOB_CAP = 3` active posts**; the
  4th returns **402 `{ upgrade: true }}`** — lifting the cap requires Pro.
- **Workers** post a single **"open to work"** `worker_listings` row (PK `user_id`:
  role, location, schedule, rate, remote, about). The Workers board + `/api/candidates`
  let employers browse them.
- **Applications** (`job_applications`, unique `(job_id, user_id)`): apply/withdraw,
  plus a **hiring pipeline** — `status ∈ APPLICANT_STATUSES = ['applied','reviewed',
  'shortlisted','rejected','hired']`. Changing status (away from `applied`) **notifies
  the candidate** (`app_<status>` notif type carrying `job_id`, deep-links to the job).
- **Saved** jobs (`saved_jobs`), **saved candidates** (`saved_candidates`), and **job
  alerts** (`saved_searches`).
- **Advertise / promoted posts (monetization):** `POST /api/social/posts/:id/promote
  {days}` (author-only, top-level main-feed posts — any user, business OR private)
  sets `posts.promoted_until = now()+days`. Days are validated against
  `AD_DAYS = [1,3,7,14,30]` and priced at `AD_PER_DAY_CENTS` ($2/day); with Stripe
  configured it's **variable-price Checkout** (`billing.createPaymentSession`,
  `metadata.type=promote` + `post_id`/`days`; webhook flips `promoted_until`),
  otherwise a demo instant-grant. Active promoted posts (`promoted` on `mapPost`)
  are **hoisted to the top** of others' For You feed (≤2, viewer's own excluded,
  deduped) labeled **"Ad"** (`acPostCard`). Client: "Advertise this post" in the
  own-post menu → a duration picker sheet (`#advertiseSheet`, `acPromotePost` →
  `acRenderAdDays`/`acAdPick`/`acDoAdvertise`). This is the "boost a post" everyday
  ads layer; a full targeting/auction Ads Manager is a deliberate later build.
- **Boosts (monetization):** `POST /api/jobs/:id/feature` sets `featured_until`
  (`JOB_BOOST_DAYS = 30`). With `STRIPE_BOOST_PRICE_ID` set it goes through real
  **Stripe Checkout** (`billing.createBoostSession`, `mode: 'payment'`); the webhook
  branch (`metadata.type === 'boost'`) flips `featured_until`. Featured jobs **sort
  first** everywhere — lists, search, and the AI matchmaker.

### Networking graph & profile

- **Connections** (`connections`): request → accept, mutual (a real bidirectional
  graph). **Mutual-connection hints** on profiles; **people-you-may-know**
  suggestions (`/api/connections/suggestions`).
- **Skills + endorsements** (`user_skills`, `skill_endorsements`), with **skill
  assessments** (LinkedIn-style): a quiz earns a verified-skill badge
  (`user_skills.assessed`). `POST /api/skills/:id/assessment` (owner-only;
  Atwe AI generates 5 MCQs, model `claude-sonnet-4-6`, strict-JSON, brand-safe;
  503 without a key) stores the answer key server-side in `skill_assessments`
  (token, expiry) and returns questions *without* answers; `POST
  /api/skills/:id/assessment/submit {token,answers}` scores against the stored
  key (single-use), and ≥70% sets `assessed=true`. The profile skills payload
  carries `assessed`; client renders a ✓ badge + a "Verify" action on own skills
  and a quiz overlay (`#assessQuiz`, `acStartAssessment`/`acSubmitAssessment`).
  **Work experience**
  (`experiences`, with an optional `company_user_id` FK linking to a business account),
  **profile views** (`profile_views` → viewer list + count).
- **Connection-gated messaging:** opt-in `users.dm_connections_only` (off by default)
  restricts DMs to connections.
- **Featured** (`featured_items`: user_id, `kind` ∈ post/link, post_id FK or
  url/title/description/image, position; cap `FEATURED_CAP`=10): a curated
  highlight row pinned to the top of a profile — your own posts or external
  links. `GET /api/featured?username=`, `POST /api/featured` (own posts only,
  deduped), `DELETE /api/featured/:id` (owner). Profile payload includes
  `featured`; client renders a horizontal card row (`acFeaturedSection`/
  `acFeaturedCard`) with an add sheet (`#featAdd`, link or own-post picker).
- **Recommendations** (`recommendations`: author_id, subject_id, relationship,
  body, `status` ∈ pending/visible; unique per author→subject): a written
  recommendation an author writes about a subject. Starts **pending** (notifies
  the subject via `rec_received`); the subject approves → **visible** on their
  profile, or declines (delete). `POST /api/recommendations` (write/upsert,
  blocks-aware), `GET /api/recommendations?username=` (visible), `…/pending`
  (subject's review queue), `POST /…/:id/show` (subject approves), `DELETE
  /…/:id` (author or subject), `POST /…/request` (ask someone → `rec_request`
  notif). The profile payload includes the visible `recommendations`; client
  surfaces a Recommendations section (`acRecsSection`/`acRecCard`), a write form
  (`#recWrite`), and a review queue (`#pendingRecs`).
- **Education** (`education`: school, degree, field, start/end year — same timeline
  shape as experience, `end_year` NULL = ongoing) and **licenses & certifications**
  (`certifications`: name, issuer, issue/expire year, credential_id, url). Full
  owner-scoped CRUD: `GET/POST/PATCH/DELETE /api/education[/:id]` and
  `…/certifications[/:id]` (per-row `user_id` ownership; year guard 1900–2100; cert
  url auto-`https://`). Both arrays ride on the social-profile payload; client
  renders sections under Experience (`acEducationSection`/`acCertSection`, add/edit
  forms `#eduForm`/`#certForm`).
- **Profile-strength meter** (`GET /api/profile-strength`): a 9-item completeness
  checklist (photo, headline, bio, location, banner, experience, education, 3+
  skills, a certification) → `{score, done, total, items}`. Shown on your own
  profile as a slim progress bar nudging the next missing item (`acLoadProfileStrength`),
  tap → a checklist overlay (`#strengthView`, `acOpenStrength`).
- **My-applications tracker:** `GET /api/jobs?applied=true` already carries each
  job's `applicationStatus` (the hiring-pipeline state); the job **card** now shows
  the live status (Reviewed/Shortlisted/Hired/Rejected) as a colored tag, not a flat
  "Applied", so the Me-hub "My applications" view reads like a status tracker.
  NB: `PUT /api/auth/profile` always writes `username` from the body — the profile
  form must include the current username or it gets cleared.

### AI resumes

Seekers build CVs with **Atwe AI**: a guided form collects who they are + their
history, `POST /api/ai/resume` (enriched with their saved `experiences`/`user_skills`)
returns a structured resume JSON, and it's stored in **`resumes`** (`data` = `{answers,
resume}`, owner-scoped upsert by client id). A "My Resumes" surface (from the search
Discover actions + the jobs-board toolbar) lists them; the preview renders a printable
white CV with **Download (HTML) / Print / Edit / Delete**. Degrades to 503 without a key.

### Professional events (LinkedIn-style)

Anyone with a username (person or business) can host **events** (`events`:
title, description, `starts_at`/`ends_at`, `online` bool, `location` = venue or
join link, `cover`). People RSVP **going** / **interested** (`event_rsvps`,
PK `(event_id, user_id)`); the host auto-RSVPs going. Routes: `GET /api/events`
(`scope=upcoming|attending|mine|past`), `POST /api/events`, `GET/PATCH/DELETE
/api/events/:id` (edit/delete host-only), `POST/DELETE /api/events/:id/rsvp`,
`GET /api/events/:id/attendees` (going first). A new RSVP notifies the host
(`event_rsvp`); editing notifies attendees (`event_update`). Surfaced from the
search Discover actions ("Events") via `acOpenEvents` — list (Upcoming/Attending/
Hosting tabs), create/edit form (`#eventCreate`), and a detail card (`#eventView`,
`acRenderEvent`) with RSVP buttons + an attendee list. NB the events RSVP client
fn is `acEvtRsvp` (the DM meta-card `acEventRsvp(id,choice)` is a different thing).
**Ticketed events (paid):** `events.price_cents` (0 = free) gates **going** —
RSVP `interested` stays free, but `going` on a paid event needs a ticket
(`event_rsvps.paid`). The host going is always free. With Stripe configured the
RSVP route returns `{ url }` (Checkout `mode:payment`, `metadata.type=event_ticket`)
and the webhook flips `paid=true`+RSVP; unconfigured it demo-grants paid. The
event payload exposes `priceCents` + `myPaid`; the going button morphs to
"Get ticket · $X" when unpaid (`#evPrice` input; `acEvtRsvp` handles the `r.url`
redirect; `?ticket=success` confirms on return).

**Event / class capacity (seat cap):** `events.capacity` (null = unlimited) caps
**going** RSVPs for fitness classes, workshops and limited-seat dinners.
`interested` stays unlimited and the host is exempt. The RSVP route gates a *new*
going RSVP (a full event returns `400 {full:true}`) **before** granting/selling a
ticket — an already-going attendee can still toggle off, freeing a seat. It's a soft
cap (not row-locked; a one-seat overflow under a race is acceptable). `mapEvent`
exposes `capacity` + `spotsLeft` + `full` (via the `going` count). Set from a
`#evCapacity` input in the event form (blank = unlimited); the detail shows
"N of M spots left" / a red **Full** and disables the Going button when full
(`acRenderEvent`), and the list card shows "N left" / "Full" (`acLoadEvents`).

### Unified calendar / agenda

A read-only aggregation of the user's dated items in one screen. `GET /api/agenda`
merges upcoming **appointments** (as customer or business, requested/confirmed) and
**events** (hosting or RSVP'd) into one time-sorted `items` list (`{type, id, title,
when, with, …}`). Client: an **Agenda** Discover tile → `#agendaView`
(`acOpenAgenda`) grouped by day; each row deep-links to the appointment
(`acOpenAppointments`) or event (`acOpenEvent`). **ICS export:** `GET
/api/events/:id/ics` returns a `text/calendar` VEVENT (hand-built, no dependency —
`icsEscape`/`icsStamp`); an **"Add to calendar"** button on the event detail
(`acEventIcs`) fetches it with the bearer token and downloads the `.ics`.

### Business hours & Q&A

Two Google-Business-profile staples on business accounts:
- **Hours** (`users.business_hours` JSONB = 7-element Mon..Sun array of
  `{closed}` or `{open:'HH:MM',close:'HH:MM'}`): set in the **profile editor**
  (`#pfHoursSec`, `renderPfHours`/`readPfHours`, biz-only), saved via the
  profile-update whitelist (`normalizeBusinessHours`, server-validated time format),
  exposed on `publicUser` + the social-profile payload. The Business tab renders a
  schedule with a **live "Open now / Closed now"** badge computed from the viewer's
  local clock (`acBizHoursHtml`), today's row bolded.
- **Q&A** (`business_questions` + `business_answers`): anyone can ask a public
  question on a business profile; anyone can answer (the **owner's answer is
  flagged + sorted first**); the asker/owner can delete. `GET/POST
  /api/business/:id/qa`, `POST /api/business/qa/:qid/answer`, `DELETE
  /api/business/qa/:qid` + `…/qa/answer/:aid` (blocks-aware; biz-accounts only;
  notify `qa_question`/`qa_answer`). Client: a Q&A section on the Business tab
  (`acLoadBizQA` → `#acBizQA`, ask box for visitors, per-question answer box).

### Auto-messages (greeting + away)

WhatsApp-Business-style automated DM replies for business accounts — **free on
every business account**, not a paid tier. `users.greeting_enabled`/
`greeting_message`/`away_enabled`/`away_message` (set via the profile-update
whitelist, same pattern as `businessHours`). `auto_reply_log` (one row per
`(business_id, peer_id, kind)`, upserted not appended) drives the cooldowns:
a **greeting** fires once per customer per 14 days on their first DM to the
business; an **away** message fires (only if the greeting didn't) once per
12 hours while `away_enabled`. **Away schedule** (`users.away_schedule`,
`always` | `outside_hours`): `outside_hours` only auto-replies while the business
is currently **closed** per its `business_hours` — evaluated server-side by
**`businessOpenNow(hours)`** (7-element Mon..Sun, server wall-clock, same basis as
the booking-slot generator; handles overnight spans). If open right now it stays
quiet; with no hours set (open === null) it falls through and sends. Triggered from **`maybeAutoReply(businessId,
customerId)`**, called fire-and-forget right after the existing `notify(...,
'message', ...)` in the DM send route — it inserts a normal `at_messages` row
from the business and pushes it live (`rtPush`/`notify`), so it looks like a
real reply, not a system message. Only fires when the recipient is a
`business` account; personal-account recipients never trigger it. Client: a
**business-only** "Auto-messages" item in the chat-list ⋯ tools menu
(`#chatMenuAutoMsg`, gated by `acIsBiz(S.user)` in `acOpenChatMenu`) opens
`#autoMsgView` (a `.job-card-modal` sheet, two `.ios-switch` toggle+message
sections + an `#amAwaySched` "when to send" picker — Always / Outside business
hours) — `acOpenAutoMessages()`/`acSaveAutoMessages()`. **Note:** the
profile-update route requires both `name` and `username` in every PUT
payload (a pre-existing whitelist-route requirement, not new to this
feature) — `acSaveAutoMessages()` must send both. `S.user`'s boot hydration
(both `onAuthSuccess` + token-boot) now carries `greetingEnabled`/
`greetingMessage`/`awayEnabled`/`awayMessage`/`awaySchedule` so the sheet
reflects the saved state after a reload (they were previously omitted).

> **Boot hydration:** `S.user` (set in both `onAuthSuccess` and the token-boot path)
> must include the business fields — `accountType`, `businessVerifyStatus`,
> `headline`, `categories`, `businessHours`, `balanceCents`, etc. — or business-gated
> UI (anything behind `acIsBiz(S.user)`) silently breaks after a page reload.

### Team / multi-seat business accounts

A business account invites other accounts as **team members** with a role
(admin / manager / staff) + granular permissions (`business_team`: business_id,
member_id, role, `permissions` JSONB of `jobs`/`qa`/`orders`/`reviews`, `status`
invited|active). The **owner is always implicit full-admin** (never a row, can't be
removed). Central helper **`canActAs(userId, businessId, perm)`** = true for the
owner, an active `admin` member, or an active member with that permission — and it's
wired into the business actions: order **fulfill/ship/deliver** (`orders`), business
**Q&A answer** (`qa`; a permitted member answers *as the business* — official seller
answer), business **review respond** (`reviews`), and job **applicants list / status
/ bulk-status** (`jobs`). Routes: `GET/POST/PATCH/DELETE /api/business/team[/:memberId]`
(owner/admin invites by username → `invited` row + `team_invite` notif; edit role/
perms; remove), `GET /api/business/memberships` (businesses I'm on), `POST
/api/business/team/:businessId/respond {accept}` (accept/decline → `team_joined`).
Client: a **Team** Discover tile → `#teamView` (My team / Memberships tabs;
`acOpenTeam`/`acLoadTeam`/`acLoadMemberships`), an invite sheet with role + permission
toggles (`#teamInviteView`, admin = all-perms locked). Notif verbs
`team_invite`/`team_joined`.

### Business reviews & ratings

Business accounts get Google/Trustpilot-style **reviews** (`business_reviews`:
one star review per `(business_id, reviewer_id)`, 1–5 + body; the business can
post a single `response`). `POST /api/business/:id/reviews` (upsert, not your own
business, business-accounts-only, blocks-aware; resets any response on edit),
`GET /api/business/:id/reviews` (list + `summary` avg/count + `mine`), `POST
/api/business/reviews/:id/respond` (owner reply → notifies the reviewer), `DELETE
/api/business/reviews/:id` (reviewer). The business profile payload carries a
`reviewSummary`; client shows a star summary on the business profile
(`acBizReviewBar`/`acStars`) and a reviews overlay with a star-picker write form
(`#reviewsView`/`#reviewWrite`, `acOpenReviews`).

### Appointments / booking

Businesses list bookable **services** (`business_services`: name, duration_min)
and take **appointments** (`appointments`: business_id, customer_id, service,
when_at, note, `status` ∈ requested/confirmed/declined/cancelled). `GET/POST/
DELETE /api/business/[:id/]services`, `POST /api/business/:id/appointments`
(request — not your own business, business-accounts-only, blocks-aware; also
fires an `appt_request` notif **and** opens a DM via `deliverDM`), `GET
/api/appointments?scope=mine|incoming`, `PATCH /api/appointments/:id {status}`
(business confirms/declines; either side cancels; notifies the other party).
Client: a "Book" button on business profiles → a service-pick + datetime sheet
(`#bookSheet`, `acBookOpen`); an Appointments surface from the Discover actions
(`#apptView`, `acOpenAppointments`) with My-bookings / Incoming tabs, status
chips, confirm/decline/cancel, and a services manager for the business.

**Open-slot booking (Calendly-style).** `GET /api/business/:id/slots?serviceId=&days=`
generates bookable slots from the business's **profile `business_hours`** (Mon..Sun)
stepped by the service's `duration_min`, over the next N days (≤30), excluding
past/too-soon (`SLOT_LEAD_MS` 1h) and already-taken times (`buildOpenSlots`,
server-tz wall-clock, capped 200; degrades to `{slots:[],reason}` with no hours/
service). Booking a published slot passes **`slot:true`** to `POST
/api/business/:id/appointments`, which collision-checks the exact `when_at`
(409 `{slotTaken}`) and creates the appointment **`confirmed`** directly (the
business pre-approved by publishing availability) — a free-text time stays a
`requested` the business must confirm. Deposits hold the same way. Client: the book
sheet shows **"Available times"** chips grouped by day (`acLoadBookSlots`), one-tap
books via `acBookSlot` (confirm dialog + deposit/balance gate), with a
`<details>` "Prefer a different time? Request one" fallback (`.slot-chip`/`.slot-day`).

### Company analytics dashboard

Business accounts get an **analytics** surface (`GET /api/business/analytics`,
business-only → 403 otherwise) aggregating reach: profile views (total, last-30,
unique-30, + a 14-day zero-filled trend), followers, accepted connections, post
reach (count/impressions/likes/reposts across their posts), and hiring stats
(jobs posted, total applicants, job views). Client: an "Analytics" tile in the
search Discover actions shown only when `acIsBiz(S.user)`; `acOpenBizAnalytics`
renders a sparkline + stat-card grid (`#bizAnalytics`, `acRenderBizAnalytics`).

### Newsletters (LinkedIn-style)

A creator runs a **newsletter** (`newsletters`: title, description, cover);
people **subscribe** (`newsletter_subs`); each **issue** is an article
(`newsletter_issues`) that notifies subscribers (`newsletter_issue` notif).
`GET /api/newsletters` (`scope=discover|subscribed|mine`), `POST /api/newsletters`
(author auto-subscribes), `GET/PATCH/DELETE /api/newsletters/:id` (owner edits),
`POST /api/newsletters/:id/subscribe {subscribe}`, `POST /api/newsletters/:id/
issues` (owner publishes → notifies subscribers), `GET /api/newsletters/issues/:id`
(read). Surfaced from the search Discover actions ("Newsletters", `acOpenNewsletters`)
— a list with Discover/Subscribed/Mine tabs (`#nlList`), a create form
(`#nlCreate`), a detail card with Subscribe / Publish-issue / issue list
(`#nlView`, `acOpenNewsletter`), an issue composer (`#nlIssueCompose`) and a
reader (`#nlIssueView`).
**Paid newsletters:** `newsletters.price_cents` (0 = free) makes a newsletter
paid. A non-owner who isn't a paying subscriber (`newsletter_subs.paid`) sees
`locked:true` and **issue reads return `402 {locked:true}`** — only the owner +
paid subscribers read issues. Subscribing to a paid newsletter goes through
Stripe Checkout (`{ url }`, `metadata.type=newsletter_sub`, webhook sets
`paid=true`) or demo-grants paid when unconfigured. Payload carries `priceCents`,
`paid`, `locked`; the Subscribe button shows the price (`#nlPrice` input;
`acToggleNlSub` handles the `r.url` redirect; `?nlsub=success` on return).

### Creator subscriptions (recurring)

Recurring monthly paid subscription to a creator that unlocks **subscriber-only
posts** (Patreon/X-Premium style). A user sets `users.sub_price_cents` (+ optional
`sub_blurb`) via `PUT /api/creator/settings` (min $1/mo; 0 = off); `GET
/api/creator/settings` returns their price + active-subscriber count + monthly
estimate. `creator_subs (subscriber_id, creator_id, status, period_end,
stripe_subscription_id)` — access lasts while `status='active' AND period_end >
now`. `POST /api/creator/:id/subscribe` goes through **Stripe Checkout
`mode:'subscription'`** (`billing.createRecurringSession`, inline monthly
`price_data`, `metadata.type=creator_sub`) or **demo-grants 30 days** when Stripe is
unconfigured; `DELETE` cancels (access stays until period end). The webhook handles
`checkout.session.completed`(creator_sub) → grant + record the real Stripe
subscription id, and `invoice.paid` → renew, both via the shared `recordCreatorSub`
helper (a `creator_sub` notif fires). **`DELETE` also calls
`billing.cancelSubscription(id, atPeriodEnd:true)`** on the stored subscription id —
without this the route was a pure DB flag flip and Stripe kept billing the
subscriber's card every month even after they "cancelled" in-app.
`customer.subscription.deleted` (fired when a cancel-at-period-end subscription
actually ends, or a subscription is cancelled directly in Stripe) flips the matching
`creator_subs` row to `canceled` by `stripe_subscription_id` (and separately flips a
Pro user's plan by their own subscription id — routing by subscription id rather
than customer id, since one Stripe customer can hold both a Pro subscription and one
or more creator subscriptions).
**Subscriber-only posts:** `posts.subscribers_only` (composer toggle, creators only).
`POSTS_SELECT` computes a `sub_ok` entitlement flag; `mapPost` ships a **locked
placeholder** (no body/media, `locked:true`) to non-entitled viewers. Inaccessible
sub-only posts are **hidden from the For You/Following feeds** (`SUBONLY_FEED_FILTER`)
but shown as **locked teasers on the creator's profile**. Profile payload carries
`subPrice`/`subBlurb`/`isSubscribed`/`subscriberCount`; `publicUser` exposes the
owner's `subPriceCents` (gates the composer toggle). Client: `acCreatorSubCard` on
the profile, `#creatorSubView` settings overlay, `?creatorsub=success` on return.

**Multi-tier subscriptions:** a creator can offer several priced **tiers**
(`creator_tiers`: name, price_cents, blurb, `level` — higher unlocks more, cap
`CREATOR_TIER_CAP`=5; `creator_subs.tier_id` records the chosen one, NULL = a legacy
single-price/orphaned sub treated as level 0). `GET/POST/PATCH/DELETE
/api/creator/tiers` (owner; new tiers get the next `level` above the current max;
`syncLegacySubPrice` mirrors the **cheapest tier** into `users.sub_price_cents` so the
existing "offers subscriptions" gate + composer toggle keep working). Subscribing
passes `{tierId}` — required when the creator has tiers; **re-subscribing to a
different tier switches it** (`recordCreatorSub(…, tierId)` upserts; Stripe metadata
carries `tier_id`, webhook persists it on grant + renewal). **Tier-gated posts:**
`posts.min_tier_level` (0 = any subscriber) — set in the composer's min-tier picker
(shown when a sub-only post's author has ≥2 active tiers); the `sub_ok` flag +
`SUBONLY_FEED_FILTER` now LEFT JOIN `creator_tiers` and require
`COALESCE(ct.level,0) >= p.min_tier_level`, so a too-low tier sees the locked teaser
("Higher-tier subscribers only"). Profile payload adds `subTiers[]` + `myTierId`.
Client: a tier-list subscribe card (`acCreatorSubCard` tiers branch, `acSubscribeTier`
/Switch), a tier manager in `#creatorSubView` (`acLoadCreatorSettings`/
`acRenderCreatorSettings` + inline add/edit form `acTierFormOpen`/`acSaveTier`/
`acDeleteTier`; the single-price fields disable once tiers exist), and the composer
min-tier `<select>` (`acSyncMinTierRow`, lazy-loads `/api/creator/tiers`).

### Courses / LMS

Anyone with a `@username` can **teach a structured course** (Udemy/Teachable-style):
`courses` (creator, title, description, cover, `price_cents` 0=free, `published`) →
`course_lessons` (title, `content` text, `video_url`, `position`, optional **`section`**
that groups lessons into modules) → `course_enrollments` (who's in) → `lesson_progress`
(per-user per-lesson completion). Lesson **content is gated** — only the creator + enrolled
learners get the body/video (non-enrolled see a locked curriculum outline). Routes
(`requireHandle`/blocks-aware): `GET /api/courses?scope=discover|enrolled|teaching` (+
`?creator=username`), `POST /api/courses`, `GET /api/courses/:id` (curriculum + my
enrollment + `progress`), `PATCH/DELETE /api/courses/:id` (creator; `published` toggle),
`POST/PATCH/DELETE /api/courses/:id/lessons[/:lid]` (creator), `POST
/api/courses/:id/enroll` (**free = instant; paid = from wallet balance** →
`walletTransfer` learner→creator, velocity-checked, idempotent, top-up-gated), `POST
/api/courses/:id/lessons/:lid/complete {done}` (enrolled/creator → returns
`doneCount`/`progress`). `mapCourse`/`mapLesson`/`COURSE_SELECT`; notif `course_enroll`.
Client: a **Courses** Discover tile → `#coursesView` (Discover/Learning/Teaching tabs,
`acOpenCourses`/`acCourseCard`), a detail (`#courseView`, `acRenderCourse`: cover, price,
instructor, enroll button / progress bar, curriculum grouped by module with completion
checks), a course create/edit form (`#courseForm`), a lesson editor (`#lessonForm`,
section datalist), and a lesson viewer (`#lessonView`, `acOpenLesson`: video/notes +
prev/next + mark-complete, `acLessonComplete`). Balance-funded (no Stripe webhook),
consistent with pools/splits/handles. Courses also surface **on the creator's profile**
About tab — `acLoadCoursesProfile(username, mine)` → `#acCoursesBox` (`GET
/api/courses?creator=<username>`, `acCourseCard`), so a coach/school lists what they teach
right on their profile, alongside Showcase.

### Showcase / portfolio

A flexible **"show off anything"** surface (Behance/Dribbble-style) for anyone with a
`@username` — **no products required**. A showcase item (`showcases`: title,
description, `images TEXT[]`, optional `link`, optional `product_id`, category) can be
your **work** (a project / job you did), a **new product** you want to spotlight
(attach one of your own listings via `product_id` → the detail deep-links to buy it),
or anything **random**. Others can **like (appreciate)** (`showcase_likes`) and
**comment** (`showcase_comments`, flat; the showcase owner can moderate/delete any
comment on their item). Routes: `GET /api/showcases?username=|scope=discover`,
`GET/POST/PATCH/DELETE /api/showcases[/:id]`, `POST/DELETE /api/showcases/:id/like`,
`GET/POST /api/showcases/:id/comments` + `DELETE /api/showcases/comments/:id`.
`product_id` is only honoured if the listing is the caller's own (validated server-
side). `notify`: `showcase_like` / `showcase_comment`. Client: a **Showcase** section
on every profile's About tab (`acLoadShowcase` → `#acShowcaseBox`, owner gets ＋Add),
a card grid (`acShowcaseCard`) → a detail overlay (`#showcaseView`, `acOpenShowcase`:
image gallery + description + attached-product card + appreciate + comments), an
add/edit composer (`#showcaseForm`, multi-image + link + category + own-product
spotlight), and a **Discover → Showcase** surface (`acOpenShowcaseDiscover` →
`#showcaseDiscover`, popularity-ranked). Distinct from `featured_items` (which only
pins an existing post/link).

### Catalog categories / menu sections (grouped storefront)

A seller can tag each product with a free-text **`products.category`** (≤60 chars,
null = ungrouped) that groups the storefront into sections — restaurant **menus**
(Starters/Mains/Drinks), retail **collections**, etc. Set in the product form via a
"Category / menu section" input (`#prodCategory` + a `#prodCatList` datalist of common
sections); flows through `mapProduct` (`category`), the create/update routes, and the
storefront/my-listings/`LISTING_SELECT` selects. The client groups with a shared
**`acGroupedProductGrid(products, owner)`** — named sections first (first-seen order)
with a `.sf-section-head` header, uncategorized items in an **"Other"** group last;
**falls back to a single flat grid when nothing is categorized**, so it only shows
sections when the seller opts in. Used by both the full storefront (`acOpenStorefront`)
and the Business-tab shop (`acLoadShop`).

### Marketplace / shop (chat-coordinated commerce)

**Anyone with a @username can sell** an item or service (`products`: name,
price_cents, image, `kind` physical|digital|service, active) via
`POST/PATCH/DELETE /api/products` (no longer business-only — only `requireHandle`).
A **business** account additionally gets a **Shop** storefront section on its
profile (`acLoadShop` → `#acShopBox`; `GET /api/businesses/:id/products`, active-only
for non-owners, all for the owner); **personal** accounts sell *without* a
storefront — they manage listings from the **Sell** surface (`acOpenSell` →
`#sellView`, `GET /api/my-listings`). Listings render **post-style** (`acListingCard`
— seller header, photo, title, price, Buy-now + add-to-cart + view-more).

**Surfacing:** listings appear in **main search** (a `shop` scope, plus a "Shop"
block in the default `all` results) and a dedicated **Marketplace** browse surface
(`acOpenMarketplace` → `#marketplaceView`, `GET /api/marketplace?q=&kind=`, blocks-
aware both ways, kind tabs). A "view more" detail (`acOpenListing` → `#listingView`,
`GET /api/listings/:id`, 404 on inactive-for-non-owner) shows the full listing; a
**"Visit store"** link appears only for **business** sellers (deep-links to their
profile). `mapListing` = `mapProduct` + a `seller{id,name,username,avatar,
accountType,verified}` (built from `LISTING_SELECT`, a products⋈users join).

**Buy** two ways: **Buy now** (`POST /api/orders/buy {productId,qty}`) — a one-item
order paid **straight there**; or the **cart** (`cart_items`, grouped by seller —
`GET /api/cart`, `POST /api/cart {productId,qty}` (qty 0 removes; an explicit 0 must
remove, so don't `Number(x) || 1`), `DELETE /api/cart/:productId`) → **Checkout**
`POST /api/orders {sellerId}`. Both turn into an `orders` row + `order_items`
(name/price **snapshotted**), pay via Stripe (`metadata.type=order`) or demo-grant.
`recordOrderPaid` (demo + webhook) drops a 🛍️ order card into the DM thread (DM-
privacy-aware), notifies the seller (`order`), clears the cart for that seller.
Status `pending|paid|fulfilled|cancelled`; `POST /api/orders/:id/fulfill` (seller →
`order_fulfilled` notif, prompts the buyer to review), `…/cancel` (buyer while
pending; seller before fulfilment). Client: listing cards (`acListingCard`), shop
cards (`acProductCard`), cart (`#cartView`), Orders (`#ordersView`, Buyer/Seller) +
detail, order meta-card, Discover Marketplace/Sell/Cart/Orders tiles (cart badge),
`?order=success`.

**Physical-goods store (real shipping + inventory + reviews).** On top of the chat-
coordinated base, the shop is a proper Amazon/Walmart-style store for **physical**
items (digital/service stay address-free):
- **Inventory:** `products.stock` (NULL = unlimited, 0 = sold out). Reserved
  atomically at checkout (`applyStock`, 409 + `outOfStock` on shortfall), restored on
  cancel / failed payment (`restoreStock`). Cards/detail show "Only N left" / "Sold out".
- **Shipping (seller-set, no carrier APIs):** `products.ship_free` + `ship_fee_cents`
  — Free or a flat fee per item; `resolveShipping` sums physical lines into
  `orders.shipping_cents`; `total = subtotal + shipping`. (Etsy/eBay/Depop model.)
- **Address book:** `addresses` (saved ship-to, one default) + `GET/POST/PATCH/DELETE
  /api/addresses` (+ `/:id/default`). Checkout (`#checkoutView`, `acOpenCheckout`) is
  a real sheet: pick a saved address or **add a new one**, see Subtotal/Shipping/Total,
  then pay. The chosen ship-to is **snapshotted** onto the order (`orders.ship_*`),
  immutable history the seller ships against. Reachable from a Discover **Addresses** tile.
- **Fulfillment + tracking:** seller `POST /api/orders/:id/ship {carrier,tracking}`
  (carrier/`tracking`/`shipped_at`, kept ORTHOGONAL to `status` so escrow's money-state
  is untouched) → `order_shipped` notif (+ push, `PUSH_VERBS`/client `verbs` both cover
  it) **+ a best-effort email to the buyer** (`sendOrderShippedEmail`, carrier + tracking
  number, console-fallback like the rest of the app's mail); `…/deliver` (either party →
  `delivered_at`; a normal paid order also becomes `fulfilled`; escrow stays held for
  buyer confirm) → `order_delivered` notif/push **+ an email to whichever party didn't
  mark it** (`sendOrderDeliveredEmail`). Both mail helpers `escapeHtml()` every
  interpolated value (name/carrier/tracking), matching `sendOrderEmails` (the original
  order-confirmation mail, escaped the same way). Order detail shows a **status
  timeline** (Ordered→Paid→Shipped→Delivered), the carrier + a **tracking number linked
  to the carrier's public lookup page** (USPS/UPS/FedEx/DHL — an unrecognized carrier
  stays plain text), the ship-to, and a printable **packing slip** (`acPackingSlip`,
  ship-to + items, opens a print window). The open order view + orders list also
  **live-update off the `order` SSE event** (`rtSource.addEventListener('order', …)`,
  mirroring the `wallet` listener) — a buyer watching an order sees shipped/delivered
  the instant the seller acts, no manual reload.
- **Real shipping labels (optional — Shippo, `shiplabels.js`)** — same graceful-
  degradation pattern as `shiptax.js`/`mailer.js`: with no `SHIPPO_API_KEY`, a seller
  keeps entering carrier + tracking manually (above). Configured, the order view shows
  **"📦 Buy a shipping label"** instead: the seller enters a package weight/dims
  (`#labelSheet`, prefilled with a small-package preset since Atwe doesn't store
  per-product weight/dimensions) → `POST /api/orders/:id/label/rates` gets live
  multi-carrier rates from Shippo (ship-from = the seller's **default saved address**,
  reusing the existing `addresses` table; ship-to = the order's snapshot; 400
  `{needAddress:true}` if the seller has no saved address yet) → the seller picks a
  rate (`.co-rate` rows, the same selectable-rate-list pattern as checkout shipping
  options) → `POST /api/orders/:id/label/buy {rateId}` re-fetches that rate's
  **authoritative** amount from Shippo (never trusts a client-supplied cents figure),
  preliminary-checks the seller's wallet balance covers it (avoids purchasing a real,
  non-refundable-by-us label they can't afford), buys the label, **debits the seller's
  wallet** for the exact charge (`walletDebit`, kind `shipping_label`), and marks the
  order shipped through the same **`markOrderShipped`** helper the manual route uses
  (carrier normalized via `shiplabels.normalizeCarrier` onto the fixed `CARRIERS` list,
  so the same tracking-link lookup works either way) — so notify/push/email/SSE never
  drift between manual and label-purchased shipping. Idempotent: a duplicate
  `clientId` (double-tap/retry) replays the cached first result via
  `walletClaimIdem`/`walletReleaseIdem`/`walletStoreIdem`, checked **before** the
  needs-shipping/already-shipped guards so a genuine retry after a network hiccup
  replays success rather than erroring on "already shipped." If the Shippo purchase
  succeeds but the wallet debit fails afterward (a rare balance race), the order is
  still marked shipped regardless — the physical label is real and non-refundable, so
  losing track of it would be worse than a rare accounting gap (logged via
  `console.error` for manual reconciliation, mirroring the cash-out module's
  ambiguous-error philosophy). The reverse race — the order gets marked shipped by a
  concurrent request (the manual entry route, or a second `business_team` member)
  *before* the label purchase's own `markOrderShipped` write lands — is checked
  explicitly: `markOrderShipped` now reports whether its guarded `UPDATE` actually
  affected a row, and if it didn't, the seller is **not** charged (the label's
  url/cost/tracking would otherwise be lost from the order row with no way to show
  it), a `409` is returned, and it's logged for manual reconciliation instead of
  silently debiting an untracked charge. `orders.label_url`/`label_cost_cents`/
  `label_transaction_id` store the purchase; `labelUrl`/`labelCostCents` on the order
  payload are **seller-only** (an operational document, not shown to the buyer) — the
  buyer still sees carrier/tracking normally. `/api/config.shippingLabelsEnabled` gates
  the client UI. Deferred: label refunds on cancel/return (Shippo supports it; not
  wired up), per-product saved weight/dimensions (entered per-shipment instead).
- **Auto-detect delivered via the Shippo tracking webhook** (optional, on top of the
  label integration above — works even for a MANUALLY-entered carrier/tracking
  number, no label purchase required): register a webhook for the `track_updated`
  event in the Shippo dashboard pointing at `POST /api/webhooks/shippo?secret=
  <SHIPPO_WEBHOOK_SECRET>`. Shippo doesn't sign webhook payloads, so that shared
  secret in the query string is the only authenticity check — without
  `SHIPPO_WEBHOOK_SECRET` configured, the route always 200s (so Shippo doesn't retry)
  but does nothing. On a verified `tracking_status.status === 'DELIVERED'` event, it
  looks up the order by `tracking` number (only one still `shipped_at IS NOT NULL AND
  delivered_at IS NULL`, so a replayed/duplicate event is a safe no-op once already
  delivered) and calls the shared **`markOrderDelivered`** helper — the same function
  the manual `/deliver` route now calls, so notify/push/email/SSE are identical whether
  a human tapped the button or the carrier reported it automatically. The manual
  "Mark delivered" / "I've received it" buttons stay as the fallback for any
  carrier/label this doesn't cover.
- **Per-product reviews (verified buyers only):** `product_reviews` (1–5 ★ + body
  + **`media TEXT[]`** photos/video, unique per product+reviewer); `hasPurchased`
  gates writes (must have a paid/fulfilled/delivered/released order of the item).
  `GET/POST/DELETE /api/products/:id/reviews` (avg + count + `canReview`/`purchased`/
  `mine`; the POST takes a `media` array validated by `cleanReviewMedia` — ≤4
  images/videos, video size-capped like stories/feed). Review media renders in the
  list (`acRevPickMedia`/`acRevRenderThumbs` in the composer; `.rev-media` img/video
  in `acLoadProductReviews`). avg ★ surface on the detail + listing/shop cards. Buyer
  is prompted to "Review your purchase" once received. (Distinct from
  `business_reviews`, which rate the seller.)
- **Local pickup:** a physical listing can offer in-person pickup (`products.pickup`
  + `pickup_location`, set in the product form). At checkout, when the listing offers
  pickup the sheet shows a **Ship / Local pickup** toggle (`acSetFulfillment`); pickup
  skips the ship-to address, charges no shipping, and stamps the order
  `orders.pickup` + `pickup_location` (reusing the order shipping fields —
  `resolveShipping` returns `{pickup}` when `body.pickup` is set and every physical
  item offers it). Threaded through `/api/orders/buy`, `/api/orders` (cart) and the
  offer checkout; the order detail shows a "Local pickup · <location>" block.
- **Two-way reviews:** a **seller rates the buyer** after an order completes
  (`buyer_reviews`, one per order, mirrors `product_reviews`). `POST/GET
  /api/orders/:id/review-buyer` (seller-only; order must be fulfilled/delivered/
  released). The order detail shows a "Rate the buyer" action (`acRateBuyerOpen` →
  `#buyerRateView`); these ratings feed the buyer's `userTrustScore` (ratings-received
  component).
- **Unified trust score:** `userTrustScore(userId)` computes a 0–100 marketplace
  credibility score on read from tenure (account age), completed orders (buyer +
  seller), ratings received (product reviews as seller + business reviews + — once
  two-way reviews land — `buyer_reviews`), and verification; mapped to a tier
  (New/Fair/Good/Great/Excellent via `TRUST_TIERS`). Exposed as `trustScore` on the
  social-profile payload and shown as a shield **`.trust-chip`** on the profile
  (`acTrustChip`).
- **Store completeness:** `products.images TEXT[]` (gallery, ≤`MAX_IMAGES`; `image`
  stays the first) → swipe carousel on the detail + multi-pick in the form; a
  **quantity** stepper on the detail (`acListingQty`, threads `qty` through checkout);
  **"More from this seller"** row (`listing.moreFromSeller`); marketplace **filters +
  sort** (`/api/marketplace?minPrice=&maxPrice=&minRating=&inStock=&sort=new|price_asc|
  price_desc|rating`); a **wishlist** (`saved_products` + `GET/POST/DELETE
  /api/saved-products`, heart on cards/detail, `#savedView` + Discover **Saved** tile);
  a seller **sales dashboard** (`GET /api/shop/analytics` → revenue/orders/units/
  to-ship + top products + 14-day trend; `#shopAnalyticsView`, Discover **Sales** tile);
  **order-confirmation emails** to buyer + seller (`sendOrderEmails`, best-effort,
  console-fallback). A **stale-pending sweep** (`flushStalePending`, every 10 min)
  cancels abandoned Stripe-pending orders >2h old and **restores their reserved stock**.
  Deliberately deferred (note for later): product Q&A, returns/RMA,
  sales tax, live carrier rate/label APIs.
- **Product variants (size/colour):** `products.variants` JSONB array of
  `{id, label, priceCents, stock}` (≤`MAX_VARIANTS`=20; `priceCents` null = use the
  product price, `stock` null = unlimited). `cleanVariants` normalizes + dedupes the
  incoming array (server-assigned ids, preserved on edit so cart/order refs stay valid);
  `mapVariant`/`mapProduct` expose `variants` + `hasVariants` + `priceFromCents` (the
  lowest variant price for "from $X" cards). A cart/order line references a variant
  (`cart_items.variant_id`, `order_items.variant_id`+`variant_label`); `resolveVariant`
  validates the choice (a variant product **requires** one; a plain product rejects one).
  **Variant stock** is decremented under a row lock inside `applyStock`'s transaction
  (read-modify-write on the JSONB, oversell-safe) and restored by `restoreStock`; the
  cart `cart_items_uvp_idx` unique index on `(user, product, COALESCE(variant_id,0))`
  (the old `(user,product)` PK is dropped) lets a buyer hold two sizes of one item.
  Client: a variants editor in the product form (`acVarAdd`/`acVarSync`/`acRenderVariants`,
  label+price+stock rows), a chip **variant picker** on the listing detail
  (`acPickVariant`, gates Buy/Add-to-cart until chosen, re-renders price via
  `acRenderListingBuy`), "from $X" + "Choose options" on cards, and the chosen
  label shown in the cart + order detail.

### Marketplace ranking & sponsored ads (Best Match + CPC auction)

`GET /api/marketplace` (and any future cross-seller browse surface) answers the
same question every real marketplace has to: **who decides what comes first?**
Modeled directly on how Amazon (A9/A10 + Sponsored Products), eBay (Best Match +
Promoted Listings), Etsy (its ranker + Etsy Ads) and TikTok Shop actually rank and
monetize search — two separate, composable layers: an **organic ranking** (no one
pays for this — it's earned) and a **sponsored layer** on top (an auction, clearly
labeled, that a seller pays into).

**Organic ranking — "Best Match" (`sort=best`, the default).** A single weighted
score, computed inline in the `/api/marketplace` `ORDER BY` (no separate ranking
table/service — consistent with the app's "compute on read" style elsewhere, e.g.
`userTrustScore`/`attributeForYou`): **relevance** to the query (`ts_rank_cd` full-
text search over name+description+category; 0 when browsing without a query) +
**quality** (a Bayesian-ish `avg rating × ln(1 + review count)`, so one 5-star
review can't outrank a hundred solid 4-star ones) + **sales velocity** (log-scaled
units sold from `order_items`/`orders` in the last 90 days — a real "people are
buying this" signal, the same one Amazon calls conversion/sales rank) +
a **recency boost** that decays linearly over 14 days (new listings get a fair
shot at visibility, mirroring Etsy's temporary boost for new/renewed listings) +
a small **verified-seller** nudge, with **sold-out** items penalized. The existing
`new`/`price_asc`/`price_desc`/`rating` sorts are unchanged, flat single-column
sorts a shopper can still pick explicitly.

**Sponsored slots — real-time, quality-weighted, second-price CPC auction**
(`product_ads` table; `getSponsoredListings` in server.js). A seller running a
campaign sets a **max cost-per-click** (`bidCents`, 10¢–$5) and a **daily budget**
(`dailyBudgetCents`, $1–$200), optionally scoped to `keywords` (blank = auto-target,
broad-matches any relevant query — same default most ad platforms use for new
advertisers). On every `/api/marketplace` serve, eligible campaigns (active listing,
in stock, budget not exhausted today, seller's wallet can cover the bid, not the
viewer's own listing, blocks-aware) are scored by **adRank = bid × relevance ×
quality** — relevance from a keyword match, quality from `0.7 + 0.3×(rating/5)`
(or a neutral 0.85 for a review-less new seller, so a lack of reviews never locks
someone out of advertising) — and the top `PRODUCT_AD_SLOTS` (2) win a slot, spliced
to the very front of the results and labeled **"Sponsored"** (`acListingCard`),
de-duplicated against the organic list below. Critically, the winner is **never
charged their own max bid** — the generalized second-price formula charges just
enough to beat the next-best competing adRank (`ceil(nextAdRank / (relevance ×
quality)) + 1¢`, capped at their own bid) — the same mechanism behind Amazon
Sponsored Products, Google Ads and Etsy Ads, so bidding your true max never costs
you your true max. The winning price is cached in-memory per ad
(`_productAdAuctionCache`, ~30min) and charged **only on an actual click**
(`POST /api/product-ads/:id/click`, fire-and-forget from the client —
`acPadClick`), via `walletDebit` straight from the seller's wallet balance, recorded
to `company_revenue` (source `product_ad`) like every other paid platform feature.
A charge that would exceed the remaining daily budget, or a seller balance that
can't cover it, **skips the charge and auto-pauses the campaign** (notifies the
seller, `product_ad_paused`) — a campaign can never run its seller into a negative
balance or rack up silent failed charges. The daily-budget check is **claimed
atomically before the wallet debit** — a single `UPDATE product_ads SET
spent_today_cents = spent_today_cents + $bid ... WHERE spent_today_cents + $bid <=
$cap RETURNING id` re-reads and re-writes the live spend total in one statement
(never a JS-held snapshot), so two clicks on the same ad from different viewers
can't both pass a stale pre-check and jointly blow through the paced cap; a claim
that affects 0 rows means the budget ran out, and a subsequent `walletDebit`
failure releases the claim (decrements `clicks`/`spent_today_cents`/
`total_spent_cents` back out) before pausing — mirroring the claim-before-charge
pattern used everywhere else money moves in this app. Impressions are tracked the same
low-ceremony way as the existing Atwe Ads feed unit (`acPadObserve`/`acPadFlush`,
batched via `IntersectionObserver` ≥50% visible, `POST /api/product-ads/impressions`
— an unconditional per-id increment, no server-side dedup, matching `/api/ads/impressions`).

Seller-facing: `POST/GET/PATCH/DELETE /api/product-ads` (create/list-mine/
pause-resume-or-edit/end — "end" flips `status='ended'` rather than deleting the
row, so spend history survives for revenue reconciliation, mirroring how
`ad_campaigns` cancel works). Client: an **"Advertise"** button next to **Edit** on
each of a seller's own listings in Sell/My-listings (`acProductCard` →
`acAdCreateFor`), a **Sponsored ads** row in **Manage store** (`acOpenStoreManage` →
`acOpenProductAds`, `#productAdsView`) listing every campaign with live spend/CTR
and Pause/Resume/End, and a shared create-or-edit sheet (`#productAdForm`,
`acOpenProductAdForm`/`acSaveProductAd`) that either starts from a specific listing
or offers a picker over the seller's own active listings.

**Personalization (Best Match only — the sponsored auction stays viewer-neutral to
keep its already-verified money math simple).** Three per-viewer boosts, gated on
the same `users.personalized` opt-out the For You feed respects: **same-industry
seller** (viewer's `categories` overlap the seller's, `?|`, mirroring the feed's
category boost), **repeat-purchase affinity** (`+2.0` if the viewer has a
completed order with this seller before — Amazon leans on purchase history the
same way), and **already-wishlisted** (`+1.5` if the product is in the viewer's
`saved_products` — a live intent signal). Regression to guard: the boost clauses
are built as an array of already-`+`/`-`-prefixed strings and joined (`personalClauses.join('\n')`), never a bare `'0'` literal concatenated in —
the common case (no categories set, or `personalized=false`) leaves the array
empty, which must produce an empty string, not a dangling term with no operator
before it (an earlier version of this exact bug 500'd `/api/marketplace` for any
viewer with no categories, i.e. most real accounts).

**Suggested bid** (`GET /api/product-ads/suggest?productId=`, owner-only): the
25th/50th/75th-percentile bid among other active campaigns for a similar listing
(same `kind` or catalog `category`) — Amazon-style competitive intel so a seller
isn't bidding blind. Needs ≥3 competing bids to use real percentiles; otherwise a
flat, low-risk default (15¢/25¢/45¢). The create sheet (`acLoadPadSuggestion`)
shows the range and prefills the bid field with the suggestion (only while the
seller hasn't typed one yet).

**Campaign analytics.** `GET /api/product-ads` also returns a 14-day zero-filled
spend/click trend, built entirely from the `company_revenue` rows each click
already writes (`source='product_ad', payer_id=<seller>`) via a
`generate_series`-joined query — no new per-day rollup table, mirroring the same
idiom the admin Growth/Traffic trends use. Rendered as a small bar sparkline in
the Sponsored ads manager (`acProductAdsSummary`, reusing the existing
`.ba-spark`/`.bs-bar` business-analytics component so it reads as the same system
as every other stat view in the app, not a one-off chart) plus a 14-day spend/
clicks stat pair.

**Admin oversight** (`GET /api/admin/product-ads`, `POST /api/admin/product-ads/:id/:action` — action ∈ `pause|resume|end`; both `requirePerm('ads')`, the
same scope as the Atwe Ads review queue). Product ads are **self-serve**, unlike
`ad_campaigns`'s pre-approval queue — a pre-approval gate would kill the instant
auction UX real platforms preserve, so this is **post-hoc moderation**: staff
search/filter every seller's campaigns (by seller/listing name or status) and can
pause/resume/end an abusive one after the fact. Every action is audit-logged
(`adminAudit(req, 'sponsored.'+action, 'product_ad', id, …)`) and notifies the
seller (`product_ad_review` — a distinct notif type from the auto-pause's
`product_ad_paused`, so a seller can tell "my balance ran out" apart from "staff
stepped in"). Client: a **"Sponsored listings"** panel folded into admin.html's
existing **Ads** tab (`renderAdsAdminView` → `loadSponsored`/`renderSponsored`/
`sponRow`/`sponAct`), with status filter pills + a search box, reusing the
`.ad-row`/`.ad-badge` styling from the Atwe Ads review queue.

**Budget pacing.** A daily budget is smoothed across the day rather than
spendable all at once (`PACED_BUDGET_SQL`/`pacedBudgetCapCents`): cumulative
spend today is capped at `LEAST(dailyBudget, CEIL(dailyBudget × (hour+1) / 24))`
— by the last hour of the day the full budget is spendable, but a campaign can't
burn its whole budget in the first few minutes of a traffic spike, the same
"traffic shaping" Google/Amazon Ads do. Enforced in both `getSponsoredListings`'s
serve-time eligibility (SQL) and the click-charge route's final check (JS,
`pacedBudgetCapCents`) — the click-time hour is read from the SAME query as the
row itself (`EXTRACT(HOUR FROM now())`, not a JS-side UTC guess), so pacing can
never disagree between what was served and what gets charged.

**Seller trust/tenure in Best Match.** Two more additive terms in the same
`ORDER BY`: account **tenure** (≤1.0, ramps over a seller's first year) and the
seller's own **completed-order track record across all their listings** (≤1.5,
ramps over ~30 orders — reuses the exact `fulfilled|delivered|released` status
set `userTrustScore` uses for its own "sold" count, so it's the same definition
of "completed," not a new one). Deliberately does NOT re-add rating or
verification — those are already separate terms above this one — so an
established seller's *other* listings get a fair small lift without double-
counting a signal that's already there.

**Bugs found and fixed during this pass** (all three shipped in the same commit
as pacing/trust, not left for later):
- **Sponsored-slot duplication**: two campaigns on the *same* product could both
  win a slot, showing that one listing twice. `getSponsoredListings` now dedupes
  winners by product id while walking the ranked list, but still prices each
  winner against the true next-best adRank in the *full* ranking (not just among
  winners) — skipping a duplicate never distorts what the real winner pays.
- **Personalization 500**: the per-viewer boost clause was built by starting
  from the string `'0'` and conditionally appending `+ (...)` terms — for the
  common case (no categories set, or `personalized=false`), that left a bare
  `0` with no operator joining it to the rest of the expression, and
  `/api/marketplace?sort=best` 500'd for any such viewer (i.e. most real
  accounts). Fixed by building an array of already-signed clauses and joining
  them, so the empty case is an empty string, never a dangling term.
- **Timezone-inconsistent "is it still today" checks**: the click-charge route
  compared a JS `Date` string against the DB's `spend_date` column — if the
  Postgres session timezone isn't UTC, that comparison could disagree with
  `CURRENT_DATE`-based resets elsewhere right at a day boundary, under-counting
  today's spend and letting a campaign slip past its cap. Both the click route
  and `mapProductAd`'s display now ask Postgres directly (`spend_date =
  CURRENT_DATE`) instead of comparing dates computed in two different places.
- **Unbounded in-memory maps**: `_productAdAuctionCache` (an ad that wins a slot
  but is never clicked) and the new click-dedup guard below both grow forever
  without a sweep. Both now have a periodic `setInterval(...).unref()` cleanup,
  the same pattern `_rlBuckets` (rate limiting) already uses.
- **No duplicate-click guard**: unlike every other money-moving route in this
  app, the click-charge route had no protection against a rapid duplicate click
  (a double-fired DOM event, a flaky-network retry) charging twice for one
  click. Added a proportionate (not the full `wallet_idempotency` machinery —
  the stakes here are a few dollars at most, already bid- and budget-capped) 3s
  per-(ad, viewer) cooldown, `_recentClickGuard`.

**One more real gap found on a later pass:** the click-charge route called
`walletDebit` directly, **bypassing `walletVelocityCheck` entirely** — which is
the single choke point that enforces `users.wallet_frozen` (the fraud hold) for
every other outflow in the app. A seller whose wallet an admin froze for
suspected fraud could still have their sponsored campaign silently drain their
balance on every click. Fixed at both points: `getSponsoredListings`'s
eligibility now excludes `wallet_frozen` sellers (so a frozen campaign never
even gets served), and the click route independently re-checks it right before
charging (defense in depth — a click against a cached auction result from
*before* the freeze still gets caught) and treats it exactly like insufficient
balance: no charge, auto-pause, notify. Regression to guard: any future route
that calls `walletDebit`/`walletCredit` directly instead of going through
`walletVelocityCheck` needs its own explicit frozen-wallet check — the freeze
invariant is NOT inherited for free just by moving money.

Also fixed on the same pass: `product_ad_paused`/`product_ad_review` were
missing from the client's notification verb dictionary (fell back to the
generic "interacted with you") and from the `isProduct` deep-link set (tapping
one sent the seller to the *actor's* profile instead of the affected listing).
`product_ad_review` (an actual admin action) now reads like the other
admin-triggered notifs (`wallet_frozen`/`appeal_granted`, which already show
the acting admin). `product_ad_paused` is different — it's a **system** event
triggered by whichever shopper's click happened to run the balance out, not a
social action *by* them — so, like the `login` security-alert row, it's
special-cased to show the Atwe mark instead of attributing "paused your
listing" to a random buyer, and taps straight through to the listing.

### Re-engagement push ("what you missed")

A background flusher (`flushReengagement`, every 6h, `.unref()`) nudges members who've
been away ≥`REENGAGE_AWAY_DAYS`(3) and have unseen activity (unread notifications +
new posts from people they follow since their last login) with a **single web push**.
Push-only — it reaches only members who installed the PWA + granted notifications, and
**no-ops entirely without VAPID** (like all push). Rate-limited per member via
`users.last_reengaged_at` (stamped every run so a member with nothing new isn't
re-scanned each tick; re-nudged at most once per `REENGAGE_COOLDOWN_DAYS`(7)).
Deactivated / username-less / push-unsubscribed members are excluded.

### Ads Manager

A unified dashboard over the existing "ads layer" (promoted posts + boosted jobs).
`GET /api/ads` returns the caller's advertised posts (`posts.promoted_until`) and
boosted jobs (`jobs.featured_until`), each with reach/engagement (post: views/likes/
reposts; job: views/applicants), plus `activeCount` + `totalImpressions`. Client: an
**Ads Manager** Discover tile → `#adsView` (`acOpenAds`: a 3-stat header + campaign
rows that deep-link to the post/job). This is the management surface over the
self-serve promote/boost flows; a full targeting/auction Ads Manager stays deferred.

### Atwe Ads — sponsored display ads + company revenue

**Additive to** promote-a-post / boost-a-job (none of those change). A **sponsored
ad** is a first-class creative (image/video + headline + CTA) that links **OUT** to
the advertiser's website — the "Featured Ad" unit shown while scrolling the feed.
- **Data** (`db.js`): `ad_campaigns` (advertiser_id, sponsor_name, title, body, media,
  media_kind, cta_label, dest_url, `status` requested|approved|active|paused|rejected|
  completed, days, amount_cents, paid, impressions, clicks, contact_email, review_note,
  starts_at/ends_at/paid_at), `ad_stats` (per-day impressions/clicks rollup for the
  trend), and **`company_revenue`** (source ad|boost|promote|pro, ref_id, payer, amount)
  — the ledger behind the admin Revenue dashboard. Peer-to-peer money (tips/orders/
  wallet sends) is NOT company revenue and never lands here.
- **Flow:** advertiser **requests** (`POST /api/ads/request`) → admin **reviews**
  (approve/reject in the dashboard) → advertiser **pays** (`POST /api/ads/campaigns/
  :id/pay` — wallet balance / Stripe `metadata.type=ad` / demo grant, `clientId`
  idempotent) → it runs in the feed until `ends_at` (a sweep in `/api/ads/feed`
  completes expired ones). `GET /api/ads/campaigns` (mine), `POST …/:id/cancel`.
- **Feed serve + tracking:** `GET /api/ads/feed?n=` returns active/paid in-window
  campaigns (random rotation); the client (`acFeedAds`/`acWeaveAds`) interleaves an
  `acAdCard` every ~6 posts in For You/Following. Impressions are batched
  (`POST /api/ads/impressions`, IntersectionObserver ≥50%, deduped per session);
  `POST /api/ads/:id/click` records a click + returns the dest URL to open.
- **`recordCompanyRevenue(source, refId, payerId, cents, note)`** writes the ledger
  row **and notifies every admin** (`notify` type `payment`) so a payment "pops up".
  It's wired into **all** paid platform paths — ad pay, job boost (demo + webhook),
  promoted post (demo + webhook), and Pro (webhook) — so the dashboard captures every
  channel, not just ads. Demo (no-Stripe) paths record the nominal amount so the
  dashboard is exercisable without Stripe.
- **Admin** (`admin.html`): a **Revenue** tab (`GET /api/admin/revenue?range=month|
  year` → this-month headline + vs-last-month, today/7-day/all-time cards, active-ads,
  a daily/monthly trend chart, by-source breakdown, and a recent-payments feed;
  auto-refreshes 30s + toasts on a new payment) and an **Ads** tab (`GET /api/admin/
  ads` review queue — approve/reject-with-note/pause/resume/delete + `POST /api/admin/
  ads` to publish an ad directly). Client: **Advertise** + **Ads Manager** Discover
  tiles (`acOpenAdCreate` → `#adCreateView`; `acOpenAds` now lists sponsored campaigns
  + promoted posts/boosted jobs together). Pricing `AD_DAY_CENTS` ($5/day, env-tunable);
  media capped ~3.5MB; `?ad=success|cancel` on Stripe return. Notif verbs `payment`/
  `ad_review`/`ad_approved`/`ad_rejected`.

### Affiliation badges (X "Verified Organizations" style)

A small **org logo shown right after a member's verified check** — on posts, the
profile, notifications — that taps through to the affiliated org. Two paths, both
admin-overridable (chosen model: **both**, with two-sided approval):
- **Business affiliates a member:** a business account invites an account
  (`POST /api/affiliations/invite {username}`, business-only); the member accepts
  (`POST /api/affiliations/:id/respond {accept}`); the member's badge becomes the
  **business's avatar** and tapping it opens the **business profile**. Either side
  removes it (`DELETE /api/affiliations/:id`). `affiliations` table (business_id,
  member_id, status invited|active|revoked).
- **Custom upload → admin approves:** any member uploads a small logo
  (`POST /api/affiliation/upload {badge,link?,label?}`, ~1MB cap) → admin review
  queue → approved badge shows next to their check, tapping opens the optional link.
  `aff_uploads` table (status pending|approved|rejected).
- **Resolved active badge** is denormalized onto the user (`users.aff_badge_img/
  aff_badge_kind/aff_business_id/aff_link/aff_label`) via **`resolveActiveBadge(userId)`**
  — a business affiliation wins over a custom upload; recomputed on every accept/
  revoke/approve/reject. Exposed as `affiliation{badge,kind,link,label,businessId,
  businessUsername}` on `mapPost` authors (via `POSTS_SELECT`), the social profile,
  and `publicUser` (`/api/auth/me`).
- **Client:** `acAffBadge(u)` renders the rounded-square logo after `vbadge(...)` in
  the post card / post detail / profile header / notifications (own account reads
  `S.user.affiliation`, kept fresh by `acAffSyncMe`). An **Affiliation** Discover
  tile → `#affView` (`acOpenAffiliation`): your current badge, pending uploads,
  accept/decline invites, businesses affiliating you, and (business accounts) invite
  + manage affiliates. Custom upload via `#affUploadView`.
- **Admin:** an **Affiliations** tab (`GET /api/admin/affiliations`) — the upload
  review queue (approve/reject-with-note) + active-badge list with **revoke**
  (`POST /api/admin/affiliations/uploads/:id/:action`, `.../:userId/revoke`).
- Notif verbs `aff_invite`/`aff_accepted`/`aff_review`/`aff_approved`/`aff_rejected`.

### Universal listing details & amenities + Rentals

To make **any industry** present properly (not just free text), listings carry a
structured details layer, and there's a first-class **rental** type:
- **Amenities + specs** on **products AND services** (`products.amenities TEXT[]` +
  `specs JSONB`; same on `services`). `cleanAmenities`/`cleanSpecs` sanitize + cap
  them; exposed on `mapProduct`/`mapListing`/`mapService` and stored on create/update.
  A shared client editor (`acDetailsEditor`/`acDetailsInit`/`acDetailsPayload`,
  curated amenity pills + custom add + key-value spec rows) is wired into the product
  + service forms; `acDetailsView` renders a specs grid + green-check amenity chips on
  the listing + service detail. Covers rentals, real estate, cars, equipment, menus…
- **Rentals** (`products.kind = 'rental'`, `rental_period` ∈ `RENTAL_PERIODS`
  night|day|week|month): a listing priced per night (stays), **day** (equipment/cars),
  **week**, or month, booked by date range. `rentalUnits(period,start,end)` counts
  calendar days for night/day, `ceil(days/7)` for week, month-diff for month (client
  mirrors via `_rentUnits`/`_rentPer`; the booking sheet says "Check-in/out" for
  stay-style night/month, "Start/End" for day/week). `rental_bookings` (product/guest/host/
  start/end/units/total/status requested|confirmed|declined|paid|cancelled). Flow:
  guest **requests** dates (`POST /api/rentals/:productId/book`, computes units×price)
  → host **confirms/declines** (`…/bookings/:id/respond`) → guest **pays from wallet
  balance** (`…/bookings/:id/pay`, velocity-checked + `walletClaimIdem`-idempotent,
  `walletTransfer` guest→host) → `paid`. Either side cancels before payment
  (`…/bookings/:id/cancel`); `GET /api/rentals/bookings?scope=guest|host`. Client: a
  rental booking block on the listing detail (date pickers + live total + Request to
  book; `acRentalBookBlock`/`acRentCalc`/`acRentalBook`), a **Bookings** Discover tile
  → `#bookingsView` (My trips / Requests tabs, confirm/decline/pay/cancel;
  `acOpenBookings`/`acBookingCard`/`acRentalPay`). Product form gains a "Rental / stay"
  kind + per-night/month picker. Notif verbs `rental_request`/`rental_confirmed`/
  `rental_declined`/`rental_paid`/`rental_cancelled`.

### Near-me discovery (geo)

Businesses save an approximate `users.lat`/`lng` (profile-update whitelist, biz-only,
range-validated; exposed on `publicUser` + `/api/auth/me`). The business directory
takes `?near=lat,lng` → a **haversine** distance column (SQL, no PostGIS), drops
businesses without coords, and sorts nearest-first, returning `distanceKm` per result.
Client: a **"Near me"** toggle in the directory (`acDirToggleNear` grabs the viewer's
`navigator.geolocation` once, re-queries, shows a distance chip via `acDistLabel` —
mi/km by locale), and a **"Use my current location"** button in the business profile
editor (`acPfUseLocation`/`acPfClearLocation`, `_pfGeo` sent in `saveProfile`). No map
tiles / external geocoding — distance only, brand-safe and key-free.

### Live shopping (pin a product to Go Live)

While broadcasting, the **host pins one of their own products** to showcase; viewers
get a buy card. The pinned product lives on the in-memory `liveStreams` entry
(`s.pinnedProduct`), exposed in `liveStreamPublic` (so a viewer who joins mid-stream
sees it). `POST /api/live/pin {streamId, productId}` (host-only, validates the product
is theirs + active via `LISTING_SELECT`) sets/clears it and fans an SSE `live`
`{kind:'pin', product}` to the host + viewers. Client: a `#liveShopCard` inside the
live overlay — host sees "Pin a product to sell" → an inline product picker
(`liveOpenPinPicker`/`livePin`), viewers see the product + a View button
(`liveBuyPinned` → listing detail). The `pin` SSE updates it live (`liveRenderShop`),
and `acWatchLive` renders any already-pinned product on join.

### AI commerce assistants

Three brand-safe AI commerce surfaces (all reuse the shared Anthropic client; degrade
to 503/heuristics without `ANTHROPIC_API_KEY`):
- **AI shopping concierge** (`POST /api/ai/shop {query}`): a natural-language product
  search — parses a price ceiling ("under $30") + keywords, retrieves a blocks-aware
  product pool (`LISTING_SELECT`, active/non-demo/non-deactivated), then Atwe AI
  shortlists ≤6 with a one-line reason; falls back to plain retrieval (`ai:false`)
  without a key. Client: a **Shop with AI** Discover tile → `#aiShopView`
  (`acOpenAiShop`/`acRunAiShop`, example chips, result cards → listing detail).
- **AI business assistant**: a "Write with Atwe AI" pill on the product form
  (`acProdDescAi`) drafts a product description from the name+kind via `/api/ai/write`
  (task `generate`).
- **AI customer-service** (`POST /api/ai/cs-answer {businessId, question}`,
  **owner-only**): drafts a short, business-grounded answer to a Q&A question from the
  business's own headline/bio/hours/categories (never invents facts). Surfaced as a
  "✦ AI" button on the owner's Q&A answer box (`acQaSuggest`).

### Digital-product auto-delivery

A **digital** product can carry `products.digital_content` (download link, license
key or access instructions, ≤4000 chars). It's **owner-only** in catalog responses
(`mapProduct(p, {owner})` adds `digitalContent`; public listings only ever see
`instantDelivery:true`). The instant a digital order is **paid**, `deliverDigitalGoods`
(called from `recordOrderPaid` + `fundEscrowOrder`) notifies the buyer (`digital_ready`)
and drops a server-built `meta.t='digital'` card into the DM thread carrying the
content. The buyer's **order detail** (`GET /api/orders/:id`) attaches each digital
line's content (buyer-only, paid states), rendered as a "⚡ Your digital delivery"
block (`acLinkifyPost` for links). Client: a digital-content field in the product
form (shown when kind=digital, `prodDigitalSec`), an "Instant delivery" line on the
listing, and the `digital` DM meta-card (`acMetaCard`, content hidden from the seller's
own sent card). Physical/service items are untouched.

### Referral program (invite → wallet bonus)

Each user has a shareable `users.referral_code` (lazily generated, 8 chars, unique).
A **new** account can claim one referral, which credits **both** wallets a one-time
`REFERRAL_BONUS_CENTS` ($5). `getOrMakeReferralCode` generates/persists the code;
`GET /api/referrals` returns the code, share link (`?ref=CODE`), invite list +
total earned; `POST /api/referrals/claim {code}` validates (caller has no
`referred_by`, account age ≤ `REFERRAL_CLAIM_WINDOW_DAYS`=30, code resolves to a
different user) then in **one transaction** sets `users.referred_by`, inserts a
`referrals` row (UNIQUE `referred_id` → reward is idempotent), and `walletCredit`s
both sides; notifies the referrer (`referral`). Client: a `?ref=` link is stashed in
`localStorage.atwe_ref` on boot and auto-claimed after sign-in (`maybeClaimReferral`,
in both `onAuthSuccess` and the token-boot path; server enforces eligibility), an
**Invite friends** Discover tile → `#referView` (`acOpenReferrals`: earnings hero,
code card, Share/Copy via `acShareReferral`/`acCopyText`, invite list).

### Booking deposits (held in escrow)

A bookable service can require a **refundable deposit** (`business_services.deposit_cents`,
set in the service manager). Booking that service holds the deposit from the customer's
**wallet balance** (`walletDebit` kind `deposit_hold`) and snapshots it on the
appointment (`deposit_cents` + `deposit_status` none/held/released/refunded). The
business **completing** the appointment releases it to them (`settleApptDeposit('business')`,
a new `completed` status); **declining/cancelling** refunds the customer
(`settleApptDeposit('customer')`). Settlement is idempotent via the `deposit_status='held'`
guard (no double-pay). Client: a deposit field in the service manager, a deposit notice
on the book sheet (gated on wallet balance via `acCanPayBalance`), a 🛡️ deposit chip +
"Mark completed · release deposit" on the appointment card.

### Trust & safety — auto-moderation + dispute SLA

- **Automated content moderation** (`moderatePost`, fire-and-forget on post create):
  a fast heuristic (`moderateHeuristic`) catches explicit violent threats / self-harm
  always; when `ANTHROPIC_API_KEY` is set, Atwe AI additionally classifies
  harassment/hate/threats. A hit inserts an `auto`-flagged row into the `reports`
  queue (`reporter_id` NULL = system, `reported_id` = author, one open flag per post).
  The admin queue's report SELECT is a **LEFT JOIN** on reporter (so system flags show)
  and sorts `auto` first; admin.html shows a "🤖 Auto-flagged" badge + "Atwe moderation".
- **Dispute SLA** (`DISPUTE_SLA_HOURS`=48): opening a dispute stamps `orders.disputed_at`;
  `GET /api/admin/disputes` returns `disputedAt` + `hoursLeft` + `overdue` and orders
  oldest-first, so admins see a countdown / "SLA overdue" badge per dispute.

### Make an offer (negotiate a listing price)

A buyer proposes a price on a listing; the seller **accepts / counters / declines**,
and on accept the buyer pays at the agreed amount — which builds a normal order
(reusing `insertOrder` + the wallet/escrow/Stripe/demo pay paths, so fulfilment,
shipping, escrow and reviews all work). `offers` table (product/buyer/seller,
`amount_cents`, `status` pending|countered|accepted|declined|paid|cancelled, `turn`
= whose move, `order_id`). Routes (blocks-aware, `requireHandle`): `POST /api/offers
{productId, amountCents}` (buyer makes an offer, ≤$50k), `GET /api/offers` (mine,
both directions) + `GET /api/offers/:id` (detail; buyer or seller only), `POST
/api/offers/:id/respond {action:accept|decline|counter, amountCents?}` (only the
side whose `turn` it is — counter flips the turn), `POST /api/offers/:id/cancel`
(either party withdraws), `POST /api/offers/:id/checkout` (buyer pays an **accepted**
offer at the agreed price → order; same balance/protected/Stripe/demo branches +
`clientId` idempotency + `applyStock`/`resolveShipping` as `/api/orders/buy`). Each
state change drops a server-built **`meta.t='offer'`** card into the DM thread (via
the shared `pushMetaCard` helper) carrying the live `offerId`; the card opens an offer
detail sheet (`#offerView`, `acOpenOffer`) that fetches live state and shows Accept/
Counter/Decline (responder) or Pay (buyer, accepted) or Withdraw. Client: a **"Make
an offer"** button on the listing detail (`acRenderListingBuy`, no-variant listings)
→ `#makeOfferSheet` (`acMakeOfferOpen`/`acMakeOfferSubmit`); `acOfferRespond`/
`acOfferCounterPrompt`/`acOfferCancel`; `acOfferPay` reuses the checkout sheet in a
new `mode:'offer'` (`acCheckoutPay` posts to the offer checkout route). Notif verb
`offer` (opens the DM); chat-list preview "🏷️ Offer". *(Optional auction mode is a
deferred phase 2.)*

### In-chat checkout (share a product into a DM)

`POST /api/atchat/share/product {to, productId}` drops a **buyable product card** into
a DM — a `meta.t='product'` message whose name/price/image are built **server-side**
from the live product (`LISTING_SELECT`, active, blocks-aware via `dmAllowed`), never
trusted from the client. The recipient taps it → the normal listing detail + checkout
(`acOpenListing`). Client: a **Product** tile in the chat composer's attach menu
(`acShareProductOpen`, DM-only) opens a picker of the sender's own listings
(`#shareProductSheet`, `acDoShareProduct`); `acMetaCard` renders the `product` branch
(`.mc-prod`), and the chat-list preview shows "🛍️ Product".

### Price-drop & saved-search alerts

Two marketplace alerts built on the wishlist + the restock pattern. **Price drop:**
when a seller lowers an **active** listing's price (detected in the product PATCH by
snapshotting `price_cents` before vs after), `notifyPriceDrop` pings everyone who
wishlisted it (`saved_products`) with a `price_drop` notif (deep-links to the
listing). **Saved searches:** `saved_market_searches` (user, `q`, optional `kind`)
let a buyer save a query; a newly posted listing that matches (`notifyMarketMatch`,
called from the product-create route — name/description ILIKE, blocks-aware, kind
filter) fires a `market_match` notif (mirrors `notifyJobMatch`, no flusher needed).
Routes: `GET/POST/DELETE /api/saved-market-searches`. Client: a "Save this search"
button on the marketplace (shown once the query is ≥2 chars) + a manager
(`#savedSearchView`, `acOpenSavedSearches`); notif verbs `price_drop`/`market_match`
(both `isProduct` → open the listing).

### Back-in-stock alerts

A buyer's **wishlist** (`saved_products`) doubles as a restock watch. When a seller's
edit flips a product from **sold-out → in-stock** (or hidden → active + in stock),
`notifyRestock` notifies every watcher (except the owner) with a `restock`
notification carrying `product_id` (added to `notifications` + `notify()`'s 7th arg
+ the notifications GET payload as `productId`/`productName`). The transition is
detected in the product PATCH route by snapshotting `productSoldOut(stock, variants)`
before vs after the update — so editing other fields, or lowering stock while still
in stock, never fires a spurious alert, and a re-sellout→restock fires again. Client:
the notif renders "<seller> restocked an item you saved" + the product name and
deep-links to the listing (`acOpenListing`).

### Coupons / discount codes (seller-issued)

Sellers issue discount codes buyers redeem at checkout. `coupons` (seller_id, `code`
unique per seller via `coupons_seller_code_idx` on `(seller_id, lower(code))`, `kind`
percent|fixed, `value`, `min_order_cents`, `max_uses`, `used_count`, `expires_at`,
`active`) + `coupon_redemptions` (one row per use, `redeemed` bool, `order_id`
nullable until an order exists; enforces **one-per-buyer**).
`mapCoupon`/`resolveCoupon(sellerId, code, subtotalCents, buyerId)` is the read-only
check (active / not-expired / under max_uses / meets min-order / not-already-used →
`{discountCents, coupon}` | `{error}`; percent = `round(subtotal*value/100)`, fixed =
`value`, clamped to subtotal) — safe to call from the no-commitment preview route.
Real checkout additionally calls **`claimCouponUse(couponId, buyerId)`** right before
creating the order: an atomic `INSERT … coupon_redemptions ON CONFLICT DO NOTHING
RETURNING`, `order_id` NULL until `attachCouponClaim` fills it in once the order
exists. This is what actually enforces single-use-per-buyer — checking only at
settlement (the old design) let the SAME buyer stack the discount across several
orders created before any of them paid, since the discount is baked into
`total_cents` at order-creation time. A failed/abandoned order releases its claim
(`releaseCouponClaim`, or the stale-pending sweep for an abandoned Stripe checkout)
so the buyer isn't locked out of a code they never benefited from. On pay,
`applyCouponRedemption(orderId)` just **confirms** the already-claimed redemption
(`UPDATE … SET redeemed = true WHERE … AND redeemed = false`, guarding against
double-confirming) then a **guarded** `UPDATE coupons SET used_count = used_count + 1
WHERE id = $1 AND (max_uses IS NULL OR used_count < max_uses)` so the counter can
never exceed the cap. NB two DISTINCT buyers can still each claim the discount once
racing the very last slot at the microsecond level — a bounded, seller-scoped
over-redeem (no wallet money is created); the guard hard-stops every later,
non-racing use.
Routes:
`GET/POST/PATCH/DELETE /api/coupons` (seller-scoped; POST validates `^[A-Z0-9]{3,24}$`,
409 on dup code; PATCH toggles `active`) + `POST /api/coupons/validate {sellerId, code,
subtotalCents}` (checkout preview, no commitment). Both checkout paths
(`/api/orders` cart + `/api/orders/buy`) take `couponCode` → `resolveCoupon` →
`total = subtotal − discount + shipping`, persisted on the order
(`orders.discount_cents`/`coupon_code`, in `insertOrder` + `ORDER_SELECT` + `mapOrder`'s
`subtotalCents`/`discountCents`/`couponCode`); `recordOrderPaid` + `fundEscrowOrder`
fire `applyCouponRedemption`. Client: a "Promo code" input + discount line in the
checkout sheet (`acApplyCoupon`/`acClearCoupon`, `AC._coCoupon`/`AC._coDiscount`); the
order detail shows the discount line; a **seller coupon manager** (`#couponsView`,
`acOpenCoupons`/`acCouponRow` + `#couponForm` `acCouponFormOpen`/`acSaveCoupon`/
`acToggleCoupon`/`acDeleteCoupon`), reachable from **Manage store**.

### Owner Dashboard (unified management hub)

Every account that **posts something** manages it from one place. `GET /api/dashboard`
aggregates the owner side of every postable entity: a **`needsAttention`** block
(orders to fulfil = seller orders `paid`/`escrow`; appointment requests = `requested`;
rental booking requests; new job applicants = applications still `applied`; reviews
without a response) + an **`activity`** block (products, total orders, active jobs,
upcoming events, courses, students, open quotes, unpaid invoices) + `isBusiness`. All
counts are per-owner subqueries. Client: `acOpenDashboard` → `#dashboardView` — a
**Needs attention** section (red `.sm-count.attn` badges, only rows with pending work;
an all-clear card when empty) + a **Manage** section linking into each existing owner
surface (Store & orders, Appointments incoming, Rental bookings host, Jobs `mine`,
Events, Courses teaching, Quotes/Invoices sent, Analytics). Reached from a **Dashboard**
row in the Me hub + a Discover tile. (No new management surfaces — it aggregates the
ones that already exist, so a business/creator has one hub instead of scattered tiles.)

### Storefront + Manage store

Every **business profile** surfaces a real **storefront**: a "Storefront" row on the
Business tab with an **Open store** button (visitors) / **Manage store** (owner).
`acOpenStorefront(biz)` (`#storefrontView`) renders the business header + a full
product grid from `GET /api/businesses/:id/products` (owner sees inactive items too,
visitors only active). **Manage store** (`acOpenStoreManage`, `#storeManageView`) is
the owner hub — rows for View storefront, Products (`acOpenSell`), Coupons
(`acOpenCoupons`), Orders (`acOpenOrders('seller')`, with a to-fulfil badge), Sales &
analytics (`acOpenShopAnalytics`), Wallet & payouts (`acOpenWallet`). It's reachable
from the business profile **and** from a **"Manage store"** group in Settings
(`#hubStoreGroup`, account-only).

### Product bundles (saver packs)

A seller groups several of their **own** products into a **bundle** sold at one
(usually discounted) price (`bundles`: seller_id, name, description, image,
price_cents, active + `bundle_items`: bundle_id, product_id, qty). Components must be
the seller's own **active, non-variant** products, **≥2 distinct** (a fixed bundle has
no variant choice; cap `BUNDLE_MAX_ITEMS`=20, ≤100 bundles/seller). `mapBundle`
derives `retailCents` (Σ component price×qty), `savingsCents` (retail − bundle price),
`shippingCents` (Σ physical lines' flat fee, matching `resolveShipping`), `soldOut`
and `needsShipping`. **Buying a bundle reuses the whole order pipeline** — `POST
/api/bundles/:id/buy` builds a normal multi-line order (one `order_items` row per
component at **retail** price; the bundle saving is recorded as the order
`discount_cents`), then pays via the exact same paths as a single listing (wallet
**balance**, **protected escrow**, **Stripe**, or **demo-grant**) with the same
`clientId` (kind `order`) double-tap/retry idempotency, `applyStock`/`restoreStock`,
`resolveShipping` ship-to snapshot and demo-seller block. So fulfilment, shipping,
escrow, reviews, returns, emails and the wallet all work unchanged. Routes (all
`requireHandle`/blocks-aware): `GET /api/bundles?seller=` (a seller's bundles —
active-only for visitors, owner sees all + sold-out), `GET /api/my-bundles` (owner
management), `GET /api/bundles/:id` (detail + seller + components; 404 hidden for
non-owners), `POST/PATCH/DELETE /api/bundles[/:id]` (`readBundleItems` validates the
component set on create/edit). Client: a **"Bundles & deals"** section on the
storefront (`acLoadStorefrontBundles` → `acBundleCard`, owner gets ＋Bundle), a detail
overlay (`#bundleView`, `acOpenBundle`: cover, savings price-box, component list, buy)
that routes through the **checkout sheet** in a new `mode:'bundle'` (`acBuyBundle` →
`acOpenCheckout` with a `fixedDiscount` + `noCoupon` flag — the checkout shows
Subtotal/Bundle-discount/Shipping/Total; `acCheckoutPay` posts to the bundle buy
route), an owner **manager** (`#bundlesView`, `acOpenBundles`, reachable from Manage
store + the Sell view) and a **create/edit form** (`#bundleForm`, `acBundleFormOpen`/
`acSaveBundle`/`acDeleteBundlePrompt`) with an own-products picker (checkbox + qty
stepper, `acBundlePickToggle`/`acBundleQty`) and a live retail-vs-bundle savings
preview (`acBundlePreview`).

### Subscribe & Save (recurring products)

A seller offers a recurring-delivery discount on a **physical** product
(`products.sub_enabled` + `sub_discount_pct`, 0–50%, `SUB_MAX_DISCOUNT`; surfaced on
`mapProduct` as `subEnabled`/`subDiscountPct`, exposed on every product SELECT, set
from the product form's "Offer Subscribe & Save" toggle). A buyer then **subscribes**
(`product_subscriptions`: buyer/seller/product/variant, qty, `interval_days` ∈
`SUB_INTERVALS` [7/14/30/60/90], `discount_pct` snapshot, `ship_to` JSONB snapshot,
`status` active|paused|cancelled, `next_at`, `last_order_id`, `fail_count`). Funded
from the **wallet balance** (consistent with the wallet-first design): the first
delivery is placed immediately and then a background driver charges each cycle.
`chargeProductSubscription` builds + pays ONE order through the normal pipeline
(`insertOrder` → `order_items` → `applyStock` → `payOrderFromBalance`), recording the
recurring saving as the order **discount** — so fulfilment, shipping, stock and
reviews all work unchanged. Routes (blocks-aware, balance-funded, `requireHandle`):
`POST /api/product-subscriptions` (idempotent first charge via `walletClaimIdem` kind
`order`; physical-only, needs a ship-to via `resolveShipping`), `GET
/api/product-subscriptions` (mine, non-cancelled), `PATCH …/:id` (pause / resume →
re-schedules + resets failures / change `intervalDays`), `DELETE …/:id` (cancel).
The driver `flushProductSubs` (interval `SUB_FLUSH_MS`, default 1h, `.unref()`)
charges every due active sub; a gone / sold-out / unaffordable product retries (next
`+2d`) and **pauses after `SUB_MAX_FAILS`=3** with a heads-up notification (notif
verbs `sub_renewed`/`sub_payment_failed`/`sub_out_of_stock`/`sub_paused`, all
deep-linking to the product). Client: a **"Subscribe & Save X%"** button on the
listing detail (`acRenderListingBuy`) → a sheet (`#subscribeSheet`, `acSubscribeOpen`/
`acRenderSubscribe`: frequency picker `_SUB_FREQ`, qty, address reuse of
`acAddrCard`/`AC._coAddrId`, per-delivery summary, balance-gated Start button) and a
**My Subscriptions** manager (`#subsView`, `acOpenSubs` from a Discover tile —
pause/resume/cancel via `acSubPause`/`acSubResume`/`acSubCancel`). A seller enables it
in the product form's physical-only Subscribe & Save section (`acProdSubToggle`).

> **Overlay stacking (important):** all `.overlay`s share one z-index tier (1000),
> so `showOverlay(id)` now **moves the opened overlay to the end of `<body>`** — the
> most-recently-opened overlay sits on top of any already-open one regardless of its
> position in the source. (Before this, a form defined earlier in the file — e.g. the
> product/bundle/coupon form — rendered *behind* the Sell view / storefront it was
> opened from.) The 12 higher-z tiers (`set-fs`/`crop-overlay`/`ob-screen`) still win
> via their own z-index. When adding an overlay that opens over another, you no longer
> need to place it later in the source — but the convention still helps readability.
>
> **Flat feature sheets:** `.job-card-modal` (the shared container for the wallet, job
> detail, and most feature overlays) is **flat** — `background:var(--bg)`, `border:none`,
> `box-shadow:none` — so it blends into the page (the `.overlay` scrim provides the
> separation) instead of reading as an outlined card-in-a-box; it runs wider (`max-width
> 520px`, tight `14px` padding, and `.overlay:has(> .job-card-modal)` trims the side
> gutter on phones). **Primary buttons — WHITE-primary token system (design
> blueprint "white acts, blue identifies"):** the ONE primary CTA per screen is a
> **WHITE pill** (`--primary` `#FFFFFF` fill + `--on-primary` `#1D1D1F` label on the
> Black theme; Light theme flips to a near-black `#111114` fill + white label). The
> canonical primary classes — `.ac-pill-btn.accent`, `.auth-btn-primary`,
> `.ac-post-btn` (composer Post) and `.ac-follow-btn` (Follow) — all reference
> `var(--primary)`/`var(--on-primary)`, so the whole app flips in one place. This
> **supersedes the old blue auth buttons** (Log in / Post / Buy now / Send are now
> white); `--accent` (blue) is reserved for **identity** only — links, active tab,
> selected/toggle-on states, verified badges, the AI hero card, and semantic fills
> stay their own colors. Secondary actions are plain `.ac-pill-btn` (grey-glass), so a
> Buy-now (white `.accent`) + Add-to-cart (grey plain) pair is never two loud buttons.
> The white primary carries no blue glow (neutral press-flare + `brightness(.92)` +
> `scale(.97)` on press). The `.wallet-actions .ac-pill-btn.accent` white-on-gradient
> rule is more specific and still wins on the (blue-gradient) balance card, keeping its
> Send pill white with a blue label. **Not yet flipped (deliberately, noted for a
> later pass):** `.ac-conn-btn` (Connect) stays blue, and a scattering of inline
> `background:var(--accent)` CTAs that don't use the shared classes.

### Sales tax + carrier-rate shipping (`shiptax.js`)

An optional-integration module (same graceful-degradation pattern as `mailer`/
`billing`/`push`): with **nothing configured**, checkout charges **zero tax** and the
seller's existing **flat shipping fee** — i.e. unchanged. Configuration is layered,
cheapest→richest, first match wins:
- **Sales tax** (`taxConfigured()` / `estimateTax({country,region,postal,taxableCents})`
  → `{taxCents,rate,source}`): a real tax API (`TAX_API_URL`+`TAX_API_KEY`, POSTed
  ship-to) → a region→rate JSON map (`SALES_TAX_RATES`) → a single flat
  `SALES_TAX_RATE` → none. Any API failure falls through to the next tier.
- **Carrier rates** (`ratesConfigured()` / `quoteRates({…,items,flatCents})` →
  `{options:[{id,label,amountCents,days}],source}`): a real carrier API
  (`SHIPPING_API_URL`+`SHIPPING_API_KEY`) → a `SHIPPING_RATES` JSON array of flat
  options → the seller's flat fee as a single "Standard" option.

`orders.tax_cents` snapshots the charged tax; `mapOrder` exposes `taxCents` and the
subtotal nets it out. The shared **`applyRatesAndTax(body, ship, items, taxableCents)`**
(taxable = subtotal − discount) resolves the chosen shipping option (`body.shipRateId`)
+ tax and is wired into all three checkout routes (cart `/api/orders`, `/api/orders/buy`,
bundle `/api/bundles/:id/buy`); `total = subtotal − discount + shipping + tax`.
**`POST /api/checkout/quote`** ({mode, sellerId|productId+qty+variantId|bundleId,
addressId|shipAddress, couponCode?, shipRateId?}) is a read-only preview returning
`{subtotalCents,discountCents,shippingCents,taxCents,totalCents,shippingOptions[],
selectedRateId, taxConfigured, ratesConfigured}` — its math mirrors the order routes so
the quoted total equals what's charged. `/api/config` exposes `taxEnabled` +
`shippingRatesEnabled`. Client: the checkout sheet calls the quote endpoint **only when
either is enabled** (`acQuoteActive` gate, so the no-config path makes no extra call) —
`acRefreshQuote` re-quotes on address / coupon / rate change, `acRenderCheckout` shows a
**selectable shipping-options list** (`.co-rate`, `acPickRate`) + a **Tax line**, and
`acCheckoutPay` sends the chosen `shipRateId`. The order detail shows the tax line too.
(Recurring Subscribe-&-Save orders intentionally stay on flat shipping / no tax.)

### Escrow / buyer protection (marketplace trust layer)

A **protected order** holds the payment until the buyer confirms — the trust layer
that makes buying from strangers safe. Escrow is **balance-funded** (debited from
the buyer's wallet into escrow, held off any user's balance — the ledger stays
zero-sum): `POST /api/orders/buy` / `POST /api/orders` accept `protected:true`
(requires balance to cover; `fundEscrowOrder` debits via `walletDebit` kind
`escrow_hold`, stamps `orders.status='escrow'` + `auto_release_at = now()+7d`, drops
a 🛡️ protected-order card into the chat). The lifecycle rides on `orders.status`
(`escrow | disputed | released | refunded` on top of the normal
`pending|paid|fulfilled|cancelled`):
- **Buyer confirms** receipt → `POST /api/orders/:id/confirm` → `releaseEscrow`
  credits the seller (ledger `escrow_release`), status `released`.
- **Auto-release** — `flushEscrows` (interval `ESCROW_FLUSH_MS`, default 60s)
  releases held, non-disputed escrows past `auto_release_at` so a silent buyer can't
  trap a seller's funds.
- **Dispute** — `POST /api/orders/:id/dispute {reason}` (buyer or seller) → status
  `disputed`, notifies the other party, surfaces in the admin queue.
- **Admin resolves** — `GET /api/admin/disputes` + `POST /api/admin/disputes/:id/
  resolve {outcome:refund|release}` → `refundEscrow`/`releaseEscrow` (thin wrappers
  over `settleEscrow(orderId, 'buyer'|'seller')`). Fund **and** settle are
  **atomic** (status flip + `walletCredit` in one transaction, `fundEscrowOrder`
  locks the buyer `FOR UPDATE`) so a crash can't strand or destroy held funds, and
  **idempotent** (status-guarded `UPDATE … WHERE status IN ('escrow','disputed')`).
  A protected order can't be `cancel`led (only `pending` orders cancel) — it uses
  confirm/dispute/auto-release.
Client: a "Buy with protection" button (shield) on the listing detail + cart
(shown when balance covers), order-detail escrow banner + Confirm / Open-dispute
actions (`acConfirmOrder`/`acDisputeOrder`/`#disputeView`), a 🛡️ protected order
meta-card, and an admin **Disputes** tab in `admin.html` (Refund buyer / Release to
seller). Notif verbs: `escrow_released`/`escrow_refunded`/`order_disputed`.

### Quotes / estimates (the "win the job" layer)

A service provider sends a customer a **priced proposal they accept or decline
*before* work** — the pre-work step every trade/agency/contractor/professional
business starts with (distinct from **offers**, which are buyer-initiated on an
existing listing, and **invoices**, which bill *for* work already agreed). Built to
reuse the entire invoice/payment pipeline: `quotes` (issuer/customer, itemized
`items` JSONB, amount_cents, note, `valid_until`, `status` sent|accepted|declined|
cancelled|expired, `invoice_id`). `quoteStatus` derives **expired** past
`valid_until`; `mapQuote`/`QUOTE_SELECT` mirror the invoice helpers. Routes
(`requireHandle`, blocks-aware): `POST /api/quotes {customerId, title, items[], note,
validUntil}` (drops a server-built `meta.t='quote'` 📋 card into the DM, notify
`quote_received`), `GET /api/quotes?scope=sent|received`, `GET /api/quotes/:id`
(issuer/customer only), `POST /api/quotes/:id/accept` (customer, claim-first `status
sent`→`accepted`, then **creates an invoice** from the quote — same items/total —
links `invoice_id`, drops the invoice Pay card, notify `quote_accepted`; returns the
invoice so the client jumps to pay), `POST …/decline` (customer), `POST …/cancel`
(issuer withdraws). Accepting an expired/declined/withdrawn/already-accepted quote is
rejected. Client: itemized create sheet (`#quoteCreate`, add/remove line-item rows +
live total, `acQuoteCreateOpen`/`acSubmitQuote`), a Quotes surface (To review / Sent,
`acOpenQuotes`), a detail with Accept &amp; pay / Decline (customer) or Withdraw
(issuer) → the linked invoice (`acOpenQuote`/`acAcceptQuote`/`acDeclineQuote`/
`acCancelQuote`), the 📋 `quote` DM meta-card, entry points in the user-actions sheet
(`paQuote`), the chat header ⋯ menu (Send a quote), and a **Quotes** Discover tile.
Notif verbs `quote_received`/`quote_accepted`/`quote_declined`.

### Invoices / payment requests (the "get paid" layer)

A user **bills another for work**: `POST /api/invoices {customerId, title,
items?|amountCents, note?, dueAt?}` issues an invoice (`invoices` table:
issuer/customer, items JSONB, amount_cents, due_at, status `sent|paid|cancelled`;
"overdue" is **derived** from `due_at < now` while unpaid). Issuing also **drops a
🧾 Pay card into the DM thread** (a server-built `meta.t='invoice'` message — not
client-forgeable). `GET /api/invoices?scope=received|sent`, `GET /api/invoices/:id`
(issuer or customer only), `POST /api/invoices/:id/pay` (customer only — Stripe
Checkout `metadata.type=invoice` or demo-grant), `POST /api/invoices/:id/cancel`
(issuer, while unpaid). The shared `recordInvoicePaid` (demo path **and** the
webhook `invoice` branch) flips paid + notifies the issuer (`invoice_paid`) +
pushes a live `invoice` SSE. Client: an Invoices surface (To-pay / Sent tabs,
`acOpenInvoices`), a detail view with Pay/Cancel (`acOpenInvoice`), a create sheet
(`#invoiceCreate`, reachable from the user-actions sheet "Send an invoice" /
`paInvoice` and the chat header ⋯ menu), the chat meta-card (`acMetaCard` invoice
branch), and `?invoice=success|cancel` on return. This closes the marketplace loop
(find work → chat → **get paid**).

### Tips (creator support)

Any user can **tip** another (`tips`: from_id, to_id, amount_cents, message).
`POST /api/tips/:userId {amount,message}` ($1–$500; not yourself; 404 on a
missing target) — Stripe Checkout when configured (`metadata.type=tip`, webhook
records the tip) or a demo instant-tip otherwise; the recipient gets a `tip`
notification. `GET /api/tips/summary` returns the recipient's count + total. The
shared `recordTip(fromId,toId,amountCents,message)` helper does the insert+notify
on both paths. Client: a "Send a tip" action in the user-actions sheet → an
amount sheet (`#tipSheet`, `acOpenTip`, presets `[3,5,10,20]` + custom);
`?tip=success|cancel` on return.

### Split payments (split a bill with @usernames)

A Splitwise-style **bill split** built on the wallet: a creator splits a total
across people, who each pay their share from their balance. Tables `splits`
(creator_id, title, total_cents) + `split_shares` (split_id, user_id,
amount_cents, paid, paid_at; UNIQUE `(split_id, user_id)`). `SPLIT_MAX_PARTICIPANTS
= 20`. `POST /api/splits` accepts either explicit `{title, participants:[{userId,
amountCents}]}` **or** an equal-split `{title, userIds, totalCents}` (each =
`floor(total / userIds.length)`); validates each user is real / has a username /
not deactivated / not the creator (the creator never owes a share), inserts the
split + shares, fires a `split_request` notif, and drops a server-built
`meta.t='split'` 🧮 **pay-card** into each participant's DM (permission-aware via
`dmAllowed`). `GET /api/splits?scope=created|owed` lists splits you're collecting
vs. ones you owe; `GET /api/splits/:id` (creator or a share-holder only, else
403/404 via `loadSplit`). `POST /api/splits/:id/pay` pays **your** share from your
wallet — **idempotent claim-first**: `UPDATE split_shares SET paid=true … WHERE
paid=false RETURNING amount_cents` claims the share before any money moves, then
`walletTransfer(me, creator, amount)` (atomic) lands it in the creator's balance;
a failed/insufficient transfer **reverts** `paid=false` (returns
`insufficientBalance`), and a second call returns `{alreadyPaid:true}` without
double-charging. `mapSplit` exposes `paidCents`/`myShareCents`/`myPaid`/`iAmCreator`
+ per-share state. Notif verbs `split_request`/`split_paid`. Client: a **Split a
bill** Discover tile → `#splitView` (Owed / Created tabs, `acOpenSplits`/
`acSplitTab`/`acLoadSplits`), a create sheet (`#splitCreate`, title + total +
`/api/social/mention-search` people picker → chips + an equal-split preview where
each pays `floor(total/(n+1))` — your own share excluded; `acSplitCreateOpen`/
`acSplitSearch`/`acSplitAddPerson`/`acSplitPreview`/`acSplitDoCreate`), a detail
view with a collected progress bar + Pay button (`#splitDetail`, `acOpenSplit`/
`acPaySplit`), and the 🧮 `split` DM meta-card (`acMetaCard` split branch →
`acOpenSplit`).

### Recurring / scheduled payments (standing orders)

A Cash App-style **standing order**: a user schedules a wallet payment to another
@username — **once** at a future date or **recurring** on a cadence
(`scheduled_payments`: from/to, amount_cents, note, `interval_days` NULL = one-time
else recurring ∈ `PAY_INTERVALS` [7/14/30/90], `status` active|paused|completed|
cancelled, `next_at`, `last_paid_at`, `runs`, `fail_count`). Funded from the **wallet
balance** — each run is a `recordMoneySend` transfer (💸 DM card + `money_received`
notify + wallet SSE), so it rides the existing money rails. Routes (balance-funded,
blocks-aware): `POST /api/scheduled-payments` ({to|toId, amount, note, intervalDays?,
startAt?}; one-time requires a future `startAt`, recurring defaults the first run to
one interval out; ≤100 active/sender), `GET /api/scheduled-payments?scope=outgoing|
incoming` (sender's standing orders, or what others will pay you), `PATCH …/:id`
(pause / resume — recurring resumes re-schedule from now), `DELETE …/:id` (cancel).
The driver `flushScheduledPayments` (interval `SCHEDPAY_FLUSH_MS`, default 1h,
`.unref()`) runs due payments: one-time → `completed`, recurring → re-scheduled;
insufficient balance / a since-added block retries (next `+1d`) then **pauses after
`PAY_MAX_FAILS`=3** (notif `sched_pay_failed`). Client: a **Scheduled** Discover tile
→ `#schedPayView` (You-pay / You-receive tabs, `acOpenSchedPays`/`acSchedPayTab`/
`acSchedPayRow` with pause/resume/cancel) + a create sheet (`#schedPayCreate`,
`acSchedPayCreateOpen`: mention-search payee picker, amount, note, a "Repeat
automatically" toggle → frequency + start date; `acSchedPayDoCreate`).

### Affiliate / creator commissions

Any user can generate a referral link for a **product** and earn a commission on
sales through it. `affiliate_links` (code → promoter + product, unique per pair) +
`affiliate_earnings` (one per order, `paid` flag); orders carry `affiliate_id` +
`commission_cents`. Rate is config-driven (`AFFILIATE_RATE_PCT`, default 10%, taken
from the seller's proceeds). Flow: a `?aff=<code>` link stashes the code
(`localStorage.atwe_aff`) + bumps `affiliate_links.clicks`; when the buyer purchases
that product (buy-now threads `affCode` → `resolveAffiliate`, which rejects the buyer/
seller as promoter), the order records the attribution, and on `recordOrderPaid`
`payAffiliateCommission(orderId, sellerCredited)` pays it — sourced from wherever the
sale proceeds actually landed. `sellerCredited` is only `true` for a balance/gift-
funded order (`payOrderFromBalance`/`payOrderFromSources`), where the seller's Atwe
wallet was just credited the sale total in that same transaction — only then is a
`walletTransfer` **seller→affiliate** correct, since that balance genuinely holds
this sale's money. A Stripe-paid or demo-granted order never moves the sale total
into the seller's Atwe wallet at all, so debiting the seller there would raid an
unrelated balance (whatever else happens to sit in their wallet) — instead the
platform fronts the commission directly via `walletCreditStandalone` (idempotent on
`order_id`; logs the earning paid) and fires an `affiliate` notif. Routes: `POST
/api/affiliate/link
{productId}` (get/create my link), `GET /api/affiliate` (dashboard: links + earned/
pending/sales), `POST /api/affiliate/click/:code`. Client: a **"Share & earn"**
button on the listing detail (`acGetAffiliateLink` — native share / copy), an
**Affiliate** Discover tile → `#affiliateView` (`acOpenAffiliate`: earnings hero +
per-link list). Notif verb `affiliate` (→ the listing).

### Group fundraising / money pools

A shareable goal anyone can chip in toward (distinct from a split, which assigns
fixed shares). `pools` (creator, title, description, `goal_cents`, `raised_cents`,
`closed`) + `pool_contributions`. A contribution moves money from the contributor's
wallet to the **creator's** via `walletTransfer` (velocity-checked, balance-funded),
increments `raised_cents`, and notifies the creator (`pool_contribution`). Routes
(blocks-aware): `POST /api/pools`, `GET /api/pools?scope=mine|contributed`, `GET
/api/pools/:id` (with contributors), `POST /api/pools/:id/contribute {amountCents}`,
`POST /api/pools/:id/close` (creator), `POST /api/pools/:id/share {to}` (drops a
server-built **`meta.t='pool'`** card into a DM via `pushMetaCard`). Client: a
**Pools** Discover tile → `#poolsView` (Mine/Contributed) + create (`#poolCreateView`)
+ detail with a progress bar (`#poolView`, `acOpenPool`/`acPoolContribute`); the pool
DM card (`acMetaCard` pool branch → `acOpenPool`); a `?pool=<id>` deep link.

### Wallet — peer-to-peer money (send to a @username)

A Cash App-style **wallet**: every account has a **balance** (`users.balance_cents`)
plus an append-only ledger (`wallet_tx`: `user_id`, `peer_id`, `kind`
send|receive|topup, `delta_cents` signed, `balance_after`, `note`). **Anyone can
send money to any other username.**

- `GET /api/wallet` → `{ balanceCents, transactions[] }` (history with the other
  party, newest first).
- `POST /api/wallet/topup {amount}` — **Add money** to your own balance. Stripe
  Checkout (`metadata.type=wallet_topup`) or a demo grant; `recordTopup` credits it.
- `POST /api/wallet/send {to|toId, amount, note}` — send to a **@username** (or id).
  Validates not-self / exists / blocks-aware / $1–$2,000. **If your balance covers
  it → instant, free internal transfer**; otherwise it charges the full amount
  (Stripe `metadata.type=wallet_send`, or demo) and the money lands in their balance.

**Money requests (wallet "Request" action, design blueprint Send·Request·Add·Cash out).**
A requester asks a payer for an amount; **money only moves when the PAYER pays**, from
their balance. `money_requests` (requester_id, payer_id, amount_cents, note, `status`
pending|paid|declined|cancelled). Routes: `POST /api/wallet/request {to|toId, amount,
note}` (not-self / exists / blocks-aware / $1–$2,000; notifies the payer + drops a
server-built **`meta.t='moneyrequest'`** payable DM card), `GET /api/wallet/requests?
scope=incoming|outgoing`, `GET /api/wallet/requests/:id` (party-only), `POST …/:id/pay`
(payer — **claim-first** `UPDATE … status='pending'→'paid' RETURNING` before any money
moves, so overlapping taps pay once; then `walletTransfer` payer→requester, velocity-
checked + `blockImpersonation`, reverts to pending on transfer fail; a second call
returns `{already:true}`), `POST …/:id/decline` (payer), `POST …/:id/cancel`
(requester). Notif verbs `money_request`/`money_request_paid`/`money_request_declined`
(never muteable — money) deep-link to the requests view. Client: a **Request** pill on
the wallet card (`acOpenRequestMoney` → `#requestMoneyView`), a **Money requests** row
(with a live "N to pay" count via `acWalletReqCount`) → `#moneyRequestsView` (To pay /
You asked tabs, `acMoneyReqTab`/`acLoadMoneyRequests`/`acMoneyReqRow`, Pay/Decline/
Cancel), and the `moneyrequest` DM meta-card with an inline **Pay $X** for the payer.
Balance-funded + zero-sum (no Stripe path — top up first); covered by a live end-to-end
check (create → pay moves money once, idempotent; decline/cancel; self/unknown guarded).

Core helpers are **transaction-safe** (a real `pg` client with `BEGIN/COMMIT`):
`walletCredit(client,...)` (balance + ledger row), `walletTransfer(from,to,amount,
note,sourceTopup)` (locks both user rows in id order to avoid deadlocks; debit
sender + credit recipient atomically; `sourceTopup` tops the sender up first so a
card-funded send keeps the ledger/balance invariant true), and `recordMoneySend`
(transfer → 💸 money DM card via `dmAllowed`, `money_received` notification, live
`wallet` SSE to both sides). Webhook branches `wallet_topup`/`wallet_send` mirror
the demo paths.

**Pay with balance** (the wallet is *spendable* in-app): the marketplace and tips
accept `payWith:'balance'` — `/api/orders/buy`, `/api/orders` (cart checkout) and
`/api/tips/:id` route through `walletTransfer` (buyer→seller / tipper→recipient,
money lands in the seller's balance) then run the normal record path
(`payOrderFromBalance` → `recordOrderPaid`; tips → `recordTip`). Insufficient
balance returns `400 {insufficientBalance:true}`. `publicUser.balanceCents` (on
`/api/auth/me`) lets the client gate the "Pay with balance" buttons (`acCanPayBalance`,
shown on the listing detail / cart / tip sheet when the balance covers it);
`acRefreshBalance` keeps `S.user.balanceCents` fresh (boot, `wallet` SSE, after any
pay/top-up).

**Savings pots / goals** (`wallet_pots`: user, name, optional `target_cents`,
`balance_cents`): wallet sub-balances. Moving money **into** a pot debits the
spendable balance (ledger `pot_in`) and credits the pot; **out** reverses it
(`pot_out`) — each in ONE transaction (row-locked) so the ledger + pot stay
consistent and zero-sum. `GET/POST/PATCH/DELETE /api/wallet/pots[/:id]` (delete
returns the pot's balance to the wallet) + `POST /api/wallet/pots/:id/move
{direction:'in'|'out', amountCents}`. Surfaced on the Wallet screen as a **Pots &
goals** section with a progress bar toward each goal (`acLoadPots`/`acPotCard`;
create `#potFormView`, move `#potMoveView`).

**Cash out to bank** (Stripe Connect, `users.stripe_connect_id`): a user onboards
an **Express** connected account once (`POST /api/wallet/connect` → hosted account
link; `?cashout=ready|refresh` on return), then `POST /api/wallet/cashout {amount}`
debits balance (`walletDebit`, atomic, `cashout` ledger kind) and transfers it to
their account (`billing.createPayout`) — refunding the ledger if Stripe rejects it.
`GET /api/wallet/cashout-status` reports `{configured, connected, payoutsEnabled,
balanceCents}`. `billing.isConnectConfigured()` gates the real flow (just needs the
secret key + Connect enabled); without Stripe it **degrades to a demo cash-out**
(debit + record, no real money). Connect helpers live in `billing.js`
(`createConnectAccount`/`createAccountLink`/`getConnectAccount`/`createPayout`).
The **`account.updated` webhook** flips `users.connect_payouts_enabled` the moment
onboarding completes (mapped by `stripe_connect_id`) and pushes a live `wallet`
`{type:'cashout_status'}` SSE; `cashout-status` reads that stored flag and
**self-heals** with a live `getConnectAccount` check if it's not yet true (so it
works even when webhooks aren't configured). The `/api/billing/webhook` endpoint
must be subscribed to **Connect (connected-account) events** to receive it.
Client: a "Cash out to bank" entry on the Wallet card → `#cashoutView`
(`acOpenCashout`/`acConnectBank`/`acDoCashout`), which shows "set up your bank"
until payouts are enabled and refreshes live on the `cashout_status` event. Client: a **Wallet** screen (`#walletView`, balance card +
Send/Add + history `acWalletRow`), a **Send money** sheet (`#sendMoneyView`,
prefilled from a profile/chat **or** a blank `@username` field —
`acOpenSendMoney`/`acOpenSendMoneyByUsername`/`acSendMoney`), an **Add money**
sheet (`#addMoneyView`), a 💸 `money` meta-card (`acMetaCard`), entry points on
**every profile** (a send icon by the ⋯ options), in the **chat header ⋯ menu**,
the **user-actions sheet** (`paMoney`), and **Discover** tiles (Wallet +
Send money); `?pay=success|cancel` / `?topup=success|cancel` on return.

**Webhook idempotency (money-safe):** Stripe delivers events *at-least-once*, so
the `/api/billing/webhook` handler **claims each `event.id`** in
`processed_stripe_events` (`INSERT … ON CONFLICT DO NOTHING`) before processing and
**releases the claim on a processing error** (so a failed event is still retried) —
a duplicate delivery is skipped, which is what prevents double-credits on wallet
top-ups / sends / tips. **But it only releases the claim when no money moved:** a
`moneyMoved` flag is set right after any wallet-crediting `record*` call
(`recordTip`/`recordInvoicePaid`/`recordOrderPaid`/`recordTopup`/`recordMoneySend`);
if a throw happens *after* funds moved, the claim is **kept** so a retry is deduped
(reprocessing would double-credit) — the trailing side-effect is sacrificed, never
the money invariant. **Cash-out payout safety:** `createPayout` is called with a
ledger-id idempotency key (`cashout_<txId>`), and the route **only refunds the
balance on a *definitive* Stripe rejection** (`StripeInvalidRequestError`/
`StripeCardError`) — on an ambiguous error (timeout/network) it keeps the debit for
reconciliation rather than risk paying the user twice.

**Anti-fraud velocity caps:** on top of the per-transaction $1–$2,000 limit and the
per-IP rate limiter, a **cumulative** ceiling bounds money *leaving* a wallet via the
user-initiated paths — `POST /api/wallet/send`, balance-paid `/api/orders[/buy]`
(incl. `protected` escrow funding), and balance-paid `/api/tips/:id`.
`walletVelocityCheck(userId, amountCents)` sums the user's outgoing ledger debits
(`wallet_tx.delta_cents < 0`, excluding `cashout` which has its own
`CASHOUT_MAX_CENTS` cap) over rolling **24h** and **7d** windows and rejects with
**HTTP 429** + `{velocityLimited, scope, limitCents, remainingCents}` and a clear
"daily/weekly sending limit" message (`walletVelocityError`) if the new outflow would
breach either ceiling. Config-driven: `WALLET_DAILY_CAP_CENTS` (default $5,000) /
`WALLET_WEEKLY_CAP_CENTS` (default $15,000); set a window to 0 to disable it. The
check runs *before* the idempotency claim / money move, and order paths
`dropPending()` (restore stock + delete the pending order) before returning. It's a
soft fraud ceiling (not a money-integrity invariant), so it intentionally isn't
row-locked. The client surfaces the 429 message via the existing `acHandlePayErr` /
catch handlers (`e.message`).

**Client idempotency (double-tap / retry safe):** the app sends a per-action
`clientId` (`acPayCid`, reused across retries, regenerated on success) with
send / top-up / cash-out **and balance-funded orders / escrow / tips** (buy-now,
cart checkout and tips thread a stable per-action cid; a failed/duplicate order
pay also drops the orphan `pending` order). The server claims `(user_id, kind,
clientId)` in `wallet_idempotency` (the PK is **kind-scoped** so the same cid
reused across two different actions can't replay the wrong result) **before** the
instant money move (`walletClaimIdem`),
caches the response (`walletStoreIdem`), and **replays the first result** on a
duplicate — so a double-tap or network retry can't create a second transaction.
A failed attempt releases the claim (`walletReleaseIdem`) so a genuine retry can
proceed; an *ambiguous* cash-out keeps the claim so a same-id retry can't
double-debit. No `clientId` → no dedupe (back-compat). (The Stripe-redirect
branches aren't claimed — the webhook is already idempotent.)

**Claim-before-charge (server-side race safety):** every path that moves money
after a "should I?" check first **atomically claims** the work so two concurrent /
overlapping requests can't both charge. The recurring drivers `flushScheduledPayments`
+ `flushProductSubs` push `next_at` forward with `UPDATE … WHERE status='active' AND
next_at <= now() RETURNING` *before* calling `recordMoneySend`/`chargeProductSubscription`
(rowCount 0 = another run took it → skip), so overlapping flush ticks never
double-charge a standing order / subscription. **Offer checkout**
(`/api/offers/:id/checkout`) claims the offer to a transient `paying` status
(`UPDATE offers SET status='paying' WHERE id=$1 AND status='accepted' RETURNING`)
before building the order and **reverts to `accepted`** on any failure — replacing a
read-then-write TOCTOU where two checkouts could each create an order. **PPV unlock**
(`/api/social/posts/:id/unlock`) does a claim-first `INSERT … ON CONFLICT DO NOTHING
RETURNING` on `post_unlocks` before the wallet transfer (deletes the claim row if the
transfer fails), so a double-tap can't charge the unlock twice. **DB backstop:** a
`users_balance_nonneg` CHECK (`balance_cents >= 0`, `NOT VALID` so it enforces new
writes without a boot-time scan) is the last line of defence — a balance can never go
negative even if an app guard is bypassed. The `/api/paylink/:code/pay` route also
runs `walletVelocityCheck` for parity with `/api/wallet/send`.

**Monetization billing pattern:** one-time payments use
`billing.createPaymentSession(user, {amountCents, productName, metadata,
successUrl, cancelUrl})` (inline `price_data`, no pre-made Price). The single
`/api/billing/webhook` switches on `session.metadata.type` —
`tip`/`event_ticket`/`newsletter_sub`/`invoice`/`order`/`creator_sub`/
`wallet_topup`/`wallet_send` (plus the older `boost`/Pro branches) —
and every paid path **degrades to a demo grant** when `billing.isConfigured()`
is false, so all flows are exercisable without Stripe.

### Ask for a referral

On a business's job, `GET /api/jobs/:id/referrers` lists your **accepted
connections who currently work there** (via `experiences.company_user_id =
poster` with `end_year IS NULL`); `POST /api/jobs/:id/refer {to}` sends them a
`referral_request` notification (job-scoped, connection-gated — non-connections
get 403). Surfaced as "Ask a connection for a referral" on the job detail.

### Open-to-Work preferences + #OpenToWork ring

`users.otw_visibility` (`off`/`recruiters`/`everyone`). A **Job-preferences hub**
(`acOpenPrefs`, from the search Discover actions) sets it via `GET/PUT
/api/open-to-work`, links to the worker listing, job alerts and resumes.
`everyone` lights the **green #OpenToWork ring** on the avatar (`acAvatarHtml(…,
otw)`) — exposed as `openToWork` on `/api/auth/me` + the social profile so the
ring shows to everyone; `recruiters` stays private (no public ring).

### Screening questions + applicant insights

- **Screening questions** (`jobs.screening` JSONB, ≤5): employer adds yes/no / number
  / text questions on the post; required ones with an `expect` are **knockouts**. The
  apply sheet renders them (the `expect` target is stripped from what seekers see),
  answers store in `job_applications.answers`, and the applicant view shows each
  answer plus an auto **✓ Meets / ✗ Missing requirements** flag (`answersMeet`).
- **Applicant insights:** every job exposes an `applicants` count + an
  `earlyApplicant` flag (<10) → "⚡ Be an early applicant" + "Posted …" on cards/detail.

### AI auto-screening + interview prep

- **Rank applicants:** `POST /api/jobs/:id/rank-applicants` (owner-only) has Atwe AI
  score every applicant (skills/experience/screening answers, knockout-aware) with a
  one-line reason; the applicants view's "✨ Rank" button reorders the list best-fit
  first with a `% fit` chip + reason. Read-only — never auto-rejects.
- **Interview prep:** `POST /api/jobs/:id/interview-prep` (seeker) generates likely
  questions + a tailored tip each, plus questions to ask the employer — surfaced as
  "Prep for the interview" on the job detail. Both: authz/existence checks **before**
  the no-key 503.

### Job analytics + candidate filters

- **Poster analytics:** opening a job (non-owner) records a `job_views` row
  (deduped one-per-viewer-per-day, owner excluded). `GET /api/jobs/:id/analytics`
  (owner-only) returns views, unique viewers, applicants, apply-rate, a zero-filled
  14-day views/applicants trend, and the pipeline status breakdown — shown via an
  "Insights" panel with a sparkline.
- **Candidate filters:** the Workers board GET supports `rateMax` (budget cap —
  rate-less workers still show) and `sort=rate` (cheapest first) on top of the
  existing skill (`q`) / location / schedule / remote filters.

### Employer applicant tools + salary insight

- **Applicant filter/sort/bulk:** the applicants view has filter chips (All /
  **Meets** when the job has screening / each non-empty status), best-fit sort
  (meets-requirements then shortlisted), and a **Select** mode for **bulk status
  changes** (`PATCH /api/jobs/:id/applicants {uids,status}`, poster-only, notifies
  each moved candidate).
- **Salary insight:** `GET /api/jobs/:id/salary-insight` annualizes peer jobs in
  the same industry → median + 25–75 range + an Above/Competitive/Below badge for
  the job's own pay (needs ≥3 peers, else `enough:false`). Shown on the job detail.

### Easy Apply + "How you match"

Modelled on LinkedIn Jobs, taken further with real AI:
- **Easy Apply** — applying attaches one of your resumes (snapshotted into
  `job_applications.resume_data` at apply time, so the employer can view it without
  cross-user access) + a cover note. **`POST /api/jobs/:id/ai-cover`** has Atwe AI
  write a note tailored to that job from your resume/profile. The applicant view
  shows each applicant's cover note and a read-only resume chip.
- **"How you match"** — **`POST /api/jobs/:id/match`** scores the seeker against a
  job (0–100 + level + skills you *have* / should *highlight* + a one-line summary),
  using their skills/experience/resume. Degrades to a keyword-overlap heuristic
  (`ai:false`) without a key — never Premium-gated.

### Atwe AI job/worker matchmaker

`POST /api/ai/jobmatch` (`mode: 'job' | 'worker'`). **Retrieval** pulls a candidate
pool from the DB by loose criteria (role/skills tokens, location, remote) — job mode
**featured-first**, worker mode **open-to-work-listing-first** — then **Atwe AI ranks
+ explains** the shortlist (model `claude-sonnet-4-6`, strict-JSON reply, brand-safe:
never says "Claude"/"Anthropic"). Degrades to plain retrieval order when no API key.

### Business directory

A browsable directory of business accounts: `GET /api/businesses/directory`
(`q`, `industry`, `verifiedOnly` filters, **blocks-aware both ways**) returns
businesses **verified-first** then by follower count, each with `followers` +
`jobs` counts (on top of `mapSearchUser`). Surfaced from the search Discover
actions ("Businesses",
`acOpenDirectory`) — a search box, a verified-only toggle, an industry chip
filter (from the official industry circles), and tappable business cards
(`#bizDirectory`, `acLoadDirectory`).

### Services & local directory

A two-sided **services marketplace** ("find a magician / plumber / tutor") plus
a **unified local hub** that surfaces everything nearby in one search. Any account
with a `@username` can offer a first-class **service** (`services` table: title,
category, area, rate, description, image, `active`) — distinct from a marketplace
*listing* (a service here is a profile of what you do, contact-by-chat, no
checkout). Routes: `POST /api/services` (offer; `requireHandle`, rate-limited),
`GET /api/services?q=&category=&area=` (browse, blocks-aware, active-only),
`GET /api/my-services`, `GET /api/services/:id` (404 on inactive-for-others;
owner sees their own), `PATCH/DELETE /api/services/:id` (per-row owner). `mapService`
joins the provider (`SERVICE_SELECT`). The **unified hub** `GET /api/local?q=`
aggregates five sections in one call — `services` (mapService), `businesses`
(mapSearchUser, verified-first), `listings` (marketplace service-listings via
`LISTING_SELECT`), `jobs` (open roles, featured-first), `events` (upcoming) — all
blocks-aware. Client: a **"Services"** Discover tile + search scope chip opens the
hub (`acOpenServices` → `#servicesView`: search box, category chips `_SERVICE_CATS`,
"Offer a service", "My services"; `acLoadLocal` renders the sections — a category
chip narrows to `/api/services?category=`). `acServiceCard` is post-style (provider
header, photo, title, rate, Message/View); `acOpenService` (`#serviceView`) is the
detail with a "Message" CTA (opens a DM) or owner Edit/Remove; `acOpenServiceForm`
(`#serviceForm`) offers/edits; `acOpenMyServices` (`#myServicesView`) manages your
own. The main search page's `services` scope renders `acLoadServices` directly.

### Trust & safety

- **Business verification:** `business_verify_status` (`none`/`pending`/`verified`);
  a business requests it (`/api/business/verify`), an admin approves/denies in the
  dashboard. Verified businesses get a badge.
- **Reporting + admin queue:** `reports` is a unified flag (`target_type` ∈
  job/listing/user/post/feedpost, `target_id`, `reason`, `note`, `status`), with a
  one-open-report-per `(reporter, target)` partial unique index. The report sheet
  (`acOpenReport`/`#reportSheet`) presents a full **X/Truth-Social-style reason list**
  (`_REPORT_REASONS`, title + description + radio row per reason): illegal activity ·
  IP infringement · sensitive content · underage · prostitution · privacy violations ·
  illegal sales · harassment/hate · doxxing · spam · "I don't like this content".
  Submit is gated until a reason is picked; the server validates against `REPORT_REASONS`
  (unknown → `other`). Admins work the queue in `admin.html` (Resolve / Dismiss / Remove
  item + bulk actions).

### AI content moderation scanner (admin **AI Scan** tab)

A one-click sweep of shared/visible content for inappropriate behavior — the "keep Atwe
pure business" tool. It covers posts, listings, showcases, ads, profiles **and group /
channel messages** (moderation of group content is intentional). Gated by
`auth.requirePerm('moderation')`; the one thing it **never touches is private 1-to-1 DMs**
(`at_messages`). Two tables (`db.js`): `moderation_scans` (admin_id, scope,
label, status running|done|error, scanned, flagged, ai, timestamps) + `moderation_flags`
(scan_id, kind, target_id, owner_id, group_id, category, severity, reason, excerpt,
status open|actioned|dismissed).
- **Detection** — `moderateBatch(texts)`: the `moderateHeuristic` regex always runs
  (threats/self-harm), and when `ANTHROPIC_API_KEY` is set a strict-JSON haiku pass
  classifies the full inappropriate taxonomy (`MOD_CATEGORIES`): harassment/abuse · hate ·
  violence · sexual/pornography · underage · prostitution · drugs · scam · spam · illegal ·
  privacy/doxxing · other. Normal business/marketing/opinion text is not flagged. Degrades
  to heuristic-only without a key.
- **Gather** — `gatherScanItems(scope, opts)` pulls candidates per scope (`full`, `posts`,
  `groups`, `listings`, `profiles`, `ads`, `user`, `group`) from posts,
  `at_group_messages` (group/channel content — never `at_messages` 1:1 DMs),
  products, showcases, ad_campaigns and user bios/headlines
  (≤`SCAN_CAP` each). `runModerationScan` batches them (`SCAN_BATCH`) through
  `moderateBatch`, inserts flags, and updates the scan row (fire-and-forget; the client polls).
- **Routes:** `POST /api/admin/moderation/scan {scope,username?,groupId?}` (audits
  `moderation.scan`), `GET …/scan/:id` (poll progress), `GET …/scans` (history),
  `GET …/flags?status=&scanId=`, `POST …/flags/:id/resolve {action}` where action ∈
  `dismiss|warn|suspend|ban|delete`. **warn** DMs the owner a content warning; **suspend**
  (prompted days) / **ban** set `users.status`, revoke sessions + `rtKickUser` and notify;
  **delete** removes the flagged content (`deleteFlaggedContent`: deletes a post/product/
  showcase, blanks a group message, rejects an ad, nulls a profile bio). All audit-logged.
- **Admin UI** (`admin.html` **AI Scan** tab, `renderModerateView`): a gradient
  **"Scan Atwe"** button, scope pills, a targeted **@username / group** scan box, live
  polling progress, and Open/Actioned/Dismissed flag cards (`modFlagCard`) — severity badge,
  human category label (`MOD_CAT_LABEL`), kind, clickable owner @handle + account-status
  pill, group name, reason + excerpt, and Warn/Suspend/Ban/Delete-content/Dismiss actions.

### Security / authorization (networking)

- **Per-row ownership:** job edit/delete/applicant-status require `posted_by` =
  caller (or admin); experience/skill/listing mutations require the owning `user_id`;
  candidate-save and saved-search rows are scoped to the owner.
- **Plan is authoritative server-side** (looked up from the DB, never trusted from
  the client) for the free-business job cap — but it is still **not** a general
  authorization boundary, only a feature gate.

## Agentic Atwe AI ("do it for me")

Atwe AI can take **actions**, not just draft text, via the Anthropic SDK's tool-use
(no new dependency). `POST /api/ai/agent {message}` calls the model with a small set
of safe tools (`AGENT_TOOLS`: `create_event`, `draft_invoice`, `schedule_post`,
`draft_reply`) and a brand-safe system prompt that resolves relative dates to ISO.
**The server never executes a side-effecting action itself** — when the model calls
a tool it returns `{action:{tool,label,input}}` to the client; a plain answer returns
`{text}`. The client (`acOpenAgent`/`acAgentGo` → `#agentView`, a **"Do it for me"**
Discover tile) renders a **confirmation card** (`acAgentActionCard`) with the parsed
args, and only on **Confirm** (`acAgentConfirm`) calls the matching existing,
authenticated route — `create_event`→`/api/events`, `schedule_post`→`/api/social/posts`,
`draft_invoice`→ resolve `@username`→id then `/api/invoices`; `draft_reply` is text-only
(copy). So every action is user-confirmed and reuses existing per-row authz. Degrades
to `503` without `ANTHROPIC_API_KEY`. Brand-safe (never exposes the AI vendor).

## Atwe AI Copilot

Atwe AI is woven across all three layers via a shared, brand-safe endpoint:
- **`POST /api/ai/write`** (`AI_WRITE_TASKS`: improve / expand / shorten /
  rephrase / professional / funny / generate / reply / headline / about /
  summarize / translate; haiku, rate-limited, 503 without a key) powers the
  **post composer** assistant (`acComposeAi` toolbar button → menu that rewrites
  the draft in place), the **chat composer** (`acChatAi`: improve/rephrase/
  translate the draft, Suggest a reply, Summarize chat — via a recent-thread
  transcript), the **profile optimizer** (`acProfileAi` "Improve" on the
  headline/bio edit fields), and the **selection editor** (below). Shared client
  helpers: `acAiAssist`/`acAiRun`, results shown in the Atwe AI card
  (`acAiShowResult`, reuses `#acExplainOverlay`).
- **Selection → "Fix with Atwe AI"** (WhatsApp/Meta-AI style): selecting text in
  the chat composer (`#acInput`, DM or group) pops a floating toolbar
  (`#acSelToolbar`) above the message box — a "Fix with Atwe AI" pill that expands
  to Fix / Professional / Funny / Shorter / Rephrase chips (`_SEL_AI_ACTIONS` →
  the `improve`/`professional`/`funny`/`shorten`/`rephrase` write tasks). The
  picked action rewrites **just the selected substring in place** and re-selects
  the result (`acSelAiAct` splices `/api/ai/write` output back into the textarea).
  A `selectionchange` listener (`acSelCheck`, rAF-debounced, guarded to the open
  thread + composer focus) shows/hides it; the bar's `onmousedown` preventDefault
  keeps the textarea selection alive while a chip is tapped.
- **`POST /api/ai/digest`** — a "what's new in your network" summary of recent
  posts from people you follow (friendly text when the network is quiet, 503
  without a key); surfaced as a "Catch me up" card atop the For You feed
  (`acFeedDigest`).

- **`POST /api/social/posts/:id/translate`** — inline post translation (X/FB-style):
  translates a post's body into the reader's browser language (haiku, brand-safe,
  503 without a key). Client adds a "Translate post" toggle under each post body
  (`acTranslatePost`/`acBrowserLang`), inserting the translation in place with a
  "Show original" toggle.

These join the earlier AI surfaces (jobmatch, resumes, screening, interview prep,
match/cover, cloud checklists, `/api/explain`) — all degrade to 503/heuristics
without `ANTHROPIC_API_KEY` and never expose "Claude"/"Anthropic".

## Personalization & recommendations

The home feed and search are personalized to the signed-in member from signals they
already produce — no separate ML model:
- **Signals:** explicit interests = `users.categories` (the industry picker captured
  at signup), `hashtag_follows`, and the **follow graph** (`follows`); behavioral =
  likes/views/reposts, the **authors you engage with**, **dwell time** (how long you
  linger on a post — `post_dwell`), and **recent searches** (`search_history`);
  negative = **"Not interested"** (`post_hides`) + mutes.
- **Dwell time** (`post_dwell`, the strongest implicit signal — TikTok/IG/X weight
  watch/read time heavily): the client tracks how long each feed card is actually
  on-screen (an IntersectionObserver in `public/index.html`'s `Dwell` module, ≥50%
  visible, paused when the tab is backgrounded or you've navigated off the feed) and
  **batches** the totals to `POST /api/social/dwell` (1s floor drops scroll-pasts;
  per-report and per-row caps for anti-abuse; author's own posts ignored). One row
  per `(post_id, viewer_id)` accumulating `ms`, with `author_id` denormalized so the
  ranker can cheaply find "the authors you linger on".
- **Recency-decayed author affinity** (replaces the old flat like/repost + dwell
  lists): a single query scores each author by your likes (weight 1), reposts
  (weight 2) and dwell (scaled by seconds, ≤3), each **divided by `(1 + age/7d)`** so
  a recent interaction counts far more than an old one (`post_likes.created_at` was
  added for this). The ranked authors split into a **strong tier** (top 15 → bigger
  boost) and a **mild tier** (the rest), so the people you care most about *right now*
  lead your feed and stale affinities fade.
- **Personalized For You ranking** (`/api/social/feed?scope=foryou`): the base
  engagement+recency score is nudged by per-viewer boosts — +3 followed hashtag, +2
  shared interest category (`u.categories ?| $2`), +2 **friend-of-a-friend** author,
  **+3.5 strong-affinity author** (`$4`, decayed engage+dwell top 15), **+1.5
  mild-affinity author** (`$7`), **+1.5 recent-search topic**, and **−3 for authors
  you've marked "Not interested"**; `post_hides` posts are filtered out entirely
  (both scopes). Boosts only nudge; Following stays chronological.
- **Endless, always-fresh feed** (`/api/social/feed`, For You + Following): the home
  feed is **infinite-scroll**, not a fixed page. The client appends pages as a bottom
  sentinel (`acFeedSetupSentinel`/`acLoadFeedMore`, `IntersectionObserver`, 600px
  prefetch) nears view, sending the ids it already has (`seen`, exact within-session
  dedupe ≤150) so each page is the **next unseen batch** (Following also pages via a
  `before` created-at cursor). The server returns `{ posts, hasMore }` (`hasMore` =
  near-full page); when it's false the client drops in a **"You're all caught up"**
  end-cap. **Already-seen suppression**: For You excludes posts served to you in the
  last **3 hours** (`feed_impressions`), so refresh/scroll feels fresh, not recycled.
  **Refresh fallback**: the suppression is captured in `seenSuppressClause`; when a
  fresh **first-page** load returns < 10 posts (the viewer has recently seen almost
  everything), it re-runs **without** suppression and **`ORDER BY random()`** — so a
  pull-to-refresh always fills the screen AND brings a fresh mix every time, never a
  stale repeat and never a false "Nothing here yet".
  **Exploration** (first page only): a few **fresh, low-engagement, unseen** posts
  (<3 likes+reposts, last 48h) are woven in (positions ~5/13/21) so new content +
  creators get a chance — the exploration-vs-exploitation balance. Promoted "Ad"
  slots + the who-to-follow module are first-page only. Newly appended cards are
  re-observed by the dwell tracker, so time-on-post is measured through the whole scroll.
- **Topic-cluster diversity** (`diversifyFeed`, For You only, post-rank): a greedy
  re-order of the ranked list so it never stacks the same author back-to-back nor
  repeats a post's primary `#hashtag` within 3 slots — pulling the next-best
  *different* item up instead (fetches a `post_id → tags` map for the feed window).
  Falls back to plain rank order when nothing else qualifies, so a genuinely
  one-topic feed is never starved. Runs before the promoted-post hoist.
- **Ranking observability / weight tuning** (`feed_impressions`): the For You route
  recomputes, per served post, exactly which boosts fired (`attributeForYou`, mirrors
  the SQL using the same signal sets) and **logs every served position** with those
  signals + an approximate score (`logFeedImpressions`, fire-and-forget, never blocks
  the response; pruned to 14 days). Logging all positions (not just the top) is what
  lets already-seen suppression page correctly; the analytics below scopes to the
  likely-*viewed* top-25 (`position < 25`) so un-scrolled rows don't dilute the rates.
  Admins can pass **`?debug=1`** to `/api/social/feed`
  to get a per-post `_signals`/`_score` breakdown. `GET /api/admin/feed-signals?days=`
  aggregates each signal's **impressions and engagement rate** (the same viewer later
  liking/reposting/opening that post) so boost weights can be tuned from real lift
  instead of by hand — surfaced as a **Feed** tab in `admin.html` (per-signal table +
  engagement-rate bars).
- **Live-tunable ranking weights** (`ranking_weights` in `app_settings`): the For You
  boost weights are **not hardcoded** — they live in a config (`DEFAULT_RANKING_WEIGHTS`
  + `_rankingWeights` cache, loaded on boot) and are passed into the feed `ORDER BY` as
  params (`$8–$15`: hashtag/category/friendOfFriend/strongAffinity/mildAffinity/
  recentSearch/notInterested + `recencyHalfLifeHours`). `attributeForYou` uses the same
  cache so the debug score stays in sync. `GET/PUT /api/admin/ranking-weights`
  (validated + clamped: boosts 0–20, half-life 0.5–168h) swap the cache so the **very
  next feed load** uses them — no deploy. Edited from the admin **Feed** tab (number
  inputs per signal + defaults shown, Save / Reset), right above the signal-performance
  table: see what performs, then tune it. This is the closed loop: rank → measure → tune.
- **Negative feedback:** `POST /api/social/posts/:id/not-interested` (X-style) hides
  the post from your feeds and down-ranks that author for you. Surfaced as "Not
  interested in this post" in the post ⋯ menu (`paNotInterested`, removes the card).
- **Recent searches / search-as-signal:** committed searches are logged
  (`POST /api/search/log`, debounced client-side, dedupes + caps 50);
  `GET/DELETE /api/search/recent` power a "Recent" chip row on the empty search page
  (`acLoadRecentSearches`), and recent single-word searches act as a soft topic boost.
- **Search / Explore page (X-style, mirrors the home + chat top bars).** Leads with
  the **≡ menu** (no top-bar avatar anywhere now — `acShow`/`syncTopbar` keep the
  hamburger on Home *and* Search). The scope row (`#acSearchScopes`,
  `acRenderSearchScopes`/`acSetSearchScope`) is **word-only tabs** — All · People ·
  Services · Shop · Jobs · Businesses · Industries · Posts · Feeds · Chats · Groups —
  styled like the feed tabs (roomy `gap:34px`, bold-white active, left-edge fade, a
  grey hairline inset to `--feed-gutter`, scrollable); no pill chips. The empty state
  (`acSearchDiscover` → `.ac-explore`, inside `#acSearchPageResults`) is a clean
  **Explore**: a beautiful gradient **"Ask Atwe AI"** hero (`.xp-ai`, `acOpenAiMatch`),
  then a single **DISCOVER** row of **shortcut tiles** (`.xp-tile` — borderless
  icon-in-rounded-square tiles in a horizontal-scroll `.xp-grid`). **Engine is
  discovery-only (design blueprint: "search + discover the world, nothing personal"):**
  the tiles are Jobs · Find workers · Marketplace · Shop with AI · Services · Businesses ·
  Events · Courses · Communities · Newsletters · Showcase. **Every personal surface
  (Wallet, Send money, Orders, Cart, Sell, Subscriptions, Rewards, Gift cards, Invoices,
  Quotes, Business dashboard, Appointments, Bookings, Resumes, Ads, …) moved to the
  Profile hub** (see the Me-hub section) and no longer appears here. Then the live
  discovery sections
  **Trending** (`#acTrending`), **Who to follow** (`#acPymkSection`), **Discover
  shorts** (`#acDiscoverShorts`), and a **Circles** section that is an **optional
  search** (`#acCircleSearchInput` → `acCircleSearch` → `#acCircleResults`) rather than
  a full dump — type any category and matching **company-defined official circles**
  (`/api/circles` `official`, no @username, joinable like communities) appear.
  Everything aligns to the one 18px gutter (the `.ac-explore` 10px + the `.ac-list`
  8px; stock section paddings are neutralized inside `.ac-explore`).
- **Who to follow = friends-of-follows** (`/api/social/suggestions`, X-style): people
  followed by the people YOU follow, ranked by how many of your follows follow them
  (then verified/popularity), with a popularity fallback when your network is small.
- **"Followed by people you follow" social proof:** `FOLLOWED_BY_SQL(uCol, viewer)`
  builds an up-to-3 list (verified first) reused in suggestions, the profile payload
  (`followedBy`/`followedByCount`), and personalized people search (which also ranks
  in-network results first). Client: `acFollowedByLine`/`acFollowedByText` render
  "Followed by Alice, Bob and N others" on suggestion cards, profiles and search rows.
- **AI "Show me what matters"** (`POST /api/ai/for-you`): retrieves the posts, people
  and open roles most relevant to the member (network + interests + followed hashtags)
  and has Atwe AI write a short briefing; returns the structured picks too, so it still
  works (sans summary) without an API key. Surfaced as an accented card atop the For
  You feed (`acOpenForYou` → `#forYouView`), next to the "Catch me up" digest.

### New-member onboarding (cold-start)

A first-run flow that warms up the personalization signals above so a brand-new
account lands on a feed that already reflects them — the cold-start fix for
"the algorithm doesn't know me yet". Gated on `users.onboarded` (default `false`;
set `true` once the member finishes or skips) + `users.intent` (their stated goal).
`publicUser` exposes `onboarded`/`intent` (legacy rows with `onboarded=undefined`
read as `true`, so existing users never see it). Endpoints:
- `GET /api/onboarding/topics` — a de-duped, ≤24 topic list to follow: the member's
  signup `categories` first, then **trending hashtags** (last 30d), then a curated
  base set (`ONBOARD_BASE_TOPICS`); each `{tag,on}` reflects current follow state.
- `GET /api/onboarding/people` — ≤12 suggested follows, **same-industry first**
  (`u.categories ?| cats`) then verified/followers, excluding self/blocked/
  deactivated/already-followed (`mapSuggestUser` + a `sameIndustry` flag).
- `POST /api/onboarding/finish {intent}` — sets `onboarded=true` and records the
  `intent` (one of `ONBOARD_INTENTS`: hiring/job/network/sell/explore).

Topic/people follows reuse the existing `POST/DELETE /api/social/hashtag/:tag/follow`
and `POST /api/social/follow/:id` — onboarding only *orchestrates* them, so the same
follow graph + hashtag-follow signals that drive For You get seeded on day one.
Client: a 4-step `#onboardingFlow` overlay (`OB` state, `maybeStartOnboarding(user)`
guard on `user.onboarded !== false`) — **goal** (AI-framed "What brings you to
Atwe?" with 5 goal cards), **topics** (chips, `obToggleTopic`), **people**
(`obFollow`), **done** (a getting-started tip list tailored to the chosen intent +
universal Search/AI/Complete-profile/Feed tips). Triggered after signup
(`suShowProfileSetup`) and on boot for any not-yet-onboarded account; `obFinish`
drops the member straight onto their For You feed.

## Loyalty / rewards points

A rewards program on top of the wallet: buyers **earn points on purchases** (~1% back —
`pointsForOrder` = 1 point per whole dollar of order total) and **redeem** them for
wallet credit (`POINTS_PER_DOLLAR`=100 → 100 points = $1; `LOYALTY_MIN_REDEEM`=100, in
whole-dollar steps). `users.points_balance` + `points_lifetime` + an append-only
`loyalty_tx` ledger (delta, reason order|redeem|bonus, order_id, balance_after).
`awardPoints(userId, points, reason, orderId)` is fire-and-forget from the paid-order
paths (`recordOrderPaid` + `fundEscrowOrder`, so demo/Stripe/balance/escrow + cart/buy/
bundle all earn) — best-effort, never blocks an order. **Cosmetic status tiers**
(`LOYALTY_TIERS`: Bronze/Silver/Gold/Platinum by lifetime points). Routes: `GET
/api/loyalty` (balance, lifetime, redeemableCents, tier + nextTier, last 50 ledger
rows), `POST /api/loyalty/redeem {points}` (snaps to whole-dollar steps; atomic —
guarded points debit then `walletCreditStandalone`, refunds the points if the credit
fails; emits a `loyalty` SSE). Client: a **Rewards** Discover tile → `#loyaltyView`
(`acOpenLoyalty`: gradient points hero + tier/next-tier, a redeem button, the earn/
redeem explainer, and ledger history; `acRedeemPoints` confirms + credits the wallet).

## UI internationalization (i18n)

A lightweight, build-free i18n layer (in `public/index.html`) — **framework + a
curated set** of high-traffic strings, expandable. **English strings are the lookup
keys**, so anything untranslated (or any language without an entry) falls back to
readable English. `I18N_LANGS` lists 14 languages (en, es, fr, de, pt, it, ru, tr,
hi, zh, ja, ko + RTL **ar**, **he**); `I18N_DICT[lang][englishKey] = translation`.
- **`i18nT(key, vars)`** — translate (named `i18nT`, NOT `t`, to avoid the many local
  `t` variables); `{var}` interpolation. **`applyLocale(code)`** persists
  (`localStorage.atwe_lang`), sets `<html lang/dir>`, toggles `body.rtl`, and re-runs
  **`translateStatic()`** which walks `[data-i18n]` (textContent), `[data-i18n-ph]`
  (placeholder) and `[data-i18n-aria]` (aria-label). `i18nResolve()` picks the saved
  lang, else the browser language, else English. Called on boot right after
  `applyTheme()`.
- **To extend coverage:** tag a static element with `data-i18n="English string"`
  (or `-ph`/`-aria`), or call `i18nT('English string')` in JS, then add the key to
  `I18N_DICT` for each language. `setNav` translates settings page titles via
  `i18nT(data-title)`; `openSettings` re-runs `translateStatic` over the overlay.
- **RTL:** ar/he flip `document.dir` + `body.rtl` (a few CSS tweaks mirror the
  iOS-settings chevrons + text-align; the flexbox layout mirrors naturally).
- **Picker:** Settings → Display & accessibility → **Language** (`#langView`,
  `acOpenLanguage`/`acSetLanguage`; `syncLangRow` shows the current language).
  Currently tagged: the settings header + Display page + the bottom-nav aria-labels,
  plus a common-actions dictionary (Post/Reply/Send/Save/Cancel/…) ready for reuse.

## Demo mode (admin showcase)

A pre-launch admin toggle that fills the platform with **~100 tagged demo accounts**
so you can preview how a busy, fully-used platform looks, then remove them in one
click. Lives in `demo.js` (`seedDemo`/`teardownDemo`).
- **Tagging + teardown:** demo accounts are `users.is_demo = true`; deleting them
  cascades away **all** their content (posts, follows, stories, products, hashtags),
  so toggling off returns the platform to real users only — no leftovers.
- **What's seeded:** personal + business accounts across ~16 industries with
  realistic names/usernames, **royalty-free placeholder photos + banners**
  (randomuser portraits + Lorem Picsum, loaded by URL — no real identities), bios/
  headlines/categories, posts (some with images, hashtag-indexed), 24h stories,
  business products, and a follow graph (they follow each other *and* the toggling
  admin, so the admin's own feed/stories/suggestions fill up).
- **Toggle:** `GET/POST /api/admin/demo {on}` (admin). `on` seeds only when empty
  (idempotent, `_demoBusy`-guarded); `off` runs `teardownDemo`. State is cached in
  `app_settings.demo_mode` + `_demoMode`, exposed via `/api/config.demoMode`.
- **Buying is blocked:** `/api/orders/buy` + `/api/orders` reject any listing whose
  seller `is_demo` with `400 {demo:true}` → the client shows "This is a demo listing
  — buying is disabled in demo mode" (`acHandlePayErr`).
- **UI:** an amber switch in `admin.html` → Site view (`toggleDemo`), and a slim
  amber **"Demo mode — sample content"** pill in the main app when active
  (`acRenderDemoBanner`, gated on `/api/config.demoMode`). Best used **pre-launch**
  so demo data never tangles with real activity.

## Completion-sprint additions (commerce / money / social / messaging)

A batch of "feature-completeness" additions on top of everything above. Each reuses
existing infrastructure (wallet, locked-placeholder, GIF picker, mention-search, the
post composer) rather than inventing new patterns.

- **Returns / RMA** (`order_returns`: requested|approved|declined|refunded, one open
  per order via a partial unique index). `POST /api/orders/:id/return {reason}` (buyer,
  refundable states `paid|fulfilled|delivered|released`), `PATCH /api/orders/:id/return
  {action:approve|decline}` (seller). Approve refunds via `walletTransfer` seller→buyer
  (fallback `walletCreditStandalone` so the buyer is always made whole), flips the order
  to `refunded`, restocks the items; notify `return_requested`/`return_approved`/
  `return_declined`. Order detail exposes `order.return` + `canReturn`; UI = a
  Request-return button + reason sheet (`#returnView`) and seller Approve/Decline
  (`acReturnOpen`/`acReturnSubmit`/`acReturnResolve`).
  **Prepaid return labels** (optional — same Shippo integration as outbound labels,
  `shiplabels.js`): additive to the flow above — buying a label never gates or delays
  the refund, which still fires immediately on approve. Once a return is
  `approved`/`refunded`, the seller can buy a real label (`POST
  /api/orders/:id/return/label/rates` then `…/return/label/buy {rateId}`) — ship-from
  is the **buyer's** address (the order's ship-to snapshot, since they're shipping the
  item back), ship-to is the **seller's** own saved default address (the same one used
  for outbound labels). The seller's wallet is debited the exact re-fetched rate
  (kind `return_label`), same idempotency-before-state-guards + balance-precheck +
  mark-regardless-of-debit-outcome pattern as the outbound route. Stored on
  `order_returns.label_url`/`label_cost_cents`/`label_carrier`/`label_tracking` and,
  unlike the outbound label, exposed to **both parties** on `order.return` (the buyer
  needs it to actually ship the item) — `sendReturnLabelEmail` mails the buyer a
  download link (best-effort) and a `return_label_ready` notif/push fires too. UI: a
  "📦 Buy a return label" button on the return block (seller, once approved, no label
  yet) opens the same `#labelSheet`/rate-picker as outbound (`acLabelOpen('return')`,
  generalized with a `kind` so both flows share one sheet + `_acLabelBase()` picks the
  right API path); once bought, a "📄 Prepaid return label" link shows to both sides.
- **Product Q&A** (`product_questions` + `product_answers`, Amazon-style, keyed on the
  product's seller — the seller's answer is flagged `bySeller` + sorted first).
  `GET/POST /api/products/:id/qa`, `POST /api/products/qa/:qid/answer`, `DELETE
  /api/products/qa/:qid` (asker or seller), `DELETE …/answer/:aid`. Q&A section on the
  listing detail (`acLoadProductQA`, reuses the `.qa-*` styling from business Q&A).
- **Gift cards are a SEPARATE balance** (Apple/Amazon model, NOT merged into the wallet).
  `gift_cards` carries `recipient_id` (sent-to), `owner_id` (current holder — spendable)
  and `balance_cents` (remaining store credit; minted = amount, drawn down on spend /
  move-to-wallet). **Money model (strictly zero-sum):** buying debits the buyer's wallet
  and the **card holds the value** (`balance_cents = amount`, `owner_id` NULL = unclaimed);
  `POST /api/gift-cards {amountCents,to?,message?}` optionally sets `recipient_id` + drops a
  `meta.t='gift'` DM card. **Claim owns it** (does NOT touch the wallet balance): `POST
  /api/gift-cards/redeem {code}` (out-of-band code) or `POST /api/gift-cards/:id/claim`
  (a card addressed to you). **Move to wallet** (partial/full) transfers card→balance
  atomically (`POST /api/gift-cards/:id/to-wallet {amountCents}`; card −X / wallet +X).
  `GET /api/gift-cards` returns received / owned / sent groups (`mapGiftCard`:
  `balanceCents`, `ownedByMe`, `claimable`, `depleted`). **Spend at checkout** — a chosen
  gift card pays FIRST, the wallet balance covers the remainder (split tender):
  `payOrderFromSources` (ONE tx: card −giftPart, balance −remainder, seller +total), wired
  into `/api/orders/buy` + `/api/orders` via `giftCardId` (+ `resolveGiftFunding` pre-check;
  escrow/bundle stay balance-only). Notify `gift_received`. Only the (future) Atwe debit
  card is tied to the wallet balance.
- **Gift-card client:** Discover **Gift cards** tile → `#giftCardView` (Buy/Redeem +
  received/owned/sent/used groups). Cards render as a **premium Apple-Wallet flip card**
  (`.atwe-card`, shared, compact solid near-black, no light outline): the front shows the
  **remaining balance** + an inline status tag (Received / Used up); tapping **flips up**
  (vertical 3D `rotateX`, back pre-rotated upright — the face has **no `overflow:hidden`**,
  which would flatten the 3D on iOS and mirror the front) to the **code** + issue date
  (`acGiftCardHtml`/`acCardFlip`). Owned cards show **Move to balance** (`acGiftMoveOpen` →
  `#giftMoveView`, partial/all) + Copy code; received show **Add to my cards**
  (`acClaimGift`). The **Wallet** shows owned gift cards as a card stack
  (`acLoadWalletGiftCards`). The Buy pane has a **delivery selector** — Digital (instant,
  live) vs **Physical card (+$5) — "coming soon"** (`acGiftDeliv`). **Checkout
  payment-source picker** (`acRenderCheckout` "Pay with"): gift cards → **Atwe Card**
  (wallet balance) → Credit/debit card (`acPickSource`/`AC._coSource`;
  `acCheckoutPay(payWith, giftCardId)`). Covered by the money suite (claim owns a separate
  balance; move-to-wallet zero-sum) + a full-flow E2E (buy → send → claim → move → split-
  tender spend, $100 conserved).
- **Atwe Card (debit, coming soon)** (`card_waitlist`: one row per user, latest email):
  a premium card **tied to the wallet balance** — same `.atwe-card` flip material
  (`acDebitCardHtml`): front = name/@handle + live Atwe balance + a "Coming soon" chip,
  back = a masked card number. The card program isn't live yet; the view (`#debitCardView`,
  `acOpenDebitCard`, Discover **Atwe Card** tile + a Wallet entry row) explains it and
  captures **waiting-list signups** in a **two-step flow** (`acCardPane`): tap **"Join the
  waiting list"** → the email step reveals (`acCardWaitlistStart`, prefilled with the
  account email) → **Apply** (`acJoinCardWaitlist`) → a confirmation card ("You're on the
  waiting list 🎉"). Routes: `POST/GET/DELETE /api/debit-card/waitlist` + `GET
  /api/debit-card/status` ({onWaitlist,email,balanceCents}). Email-validated, rate-limited,
  upsert (one row/user). No real card issuance / Stripe Issuing yet — this is the honest
  "looks ready, apply early" surface until the real program launches.
- **Admin Cards dashboard** (`admin.html` **Cards** tab, Money nav, `requirePerm('revenue')`):
  the company's card-program control room — issue comp/promo gift cards, freeze scam cards,
  and see the outstanding liability. `gift_cards` gains `status` (`active`/`void`) +
  `void_reason`/`voided_by`/`voided_at` + `company_issued`. **Freezing a card** (`POST
  /api/admin/gift-cards/:id/void {reason}`) sets `status='void'` and **every money path
  gates on `status='active'`** — claim-by-code, claim-by-id, `to-wallet`, `resolveGiftFunding`
  and `payOrderFromSources` all reject a frozen card, so a scam/chargeback card can't be
  claimed, moved to a wallet, or spent (balance preserved so `…/unvoid` restores it).
  **Company-issued cards** (`POST /api/admin/gift-cards/issue {amountCents,toUsername?,note?}`,
  `company_issued=true`, no one charged — Atwe funds it) optionally DM + notify a recipient.
  `GET /api/admin/cards?q=` returns program stats (`outstandingCents` = live liability =
  Σ balance on active cards, `issuedCents`, `frozenCents` = Σ balance parked on frozen
  cards, `redeemedCents` = Σ spend across ALL cards regardless of current status — freezing
  a card later doesn't un-happen its past redemptions — so `issuedCents = outstandingCents +
  frozenCents + redeemedCents` reconciles exactly even after a partially-spent card is
  frozen, active/frozen/companyIssued counts) + a searchable card list (code/@username
  ILIKE, a leading `@` stripped before matching) + the Atwe Card waitlist. `mapGiftCard`
  exposes `status`/`frozen`/`companyIssued`; `claimable` also requires `status !== 'void'`.
  A frozen card's error is centralized in **`giftCardFrozenError()`**, reused by every
  claim/spend entry point (redeem, claim-by-id, to-wallet, `resolveGiftFunding`) so the
  message is identical everywhere instead of each route deriving its own; a client-side
  order/checkout that resolved a now-frozen `giftCardId` gets an explicit 400 instead of
  silently falling back to the wallet balance. **`/void` and `/unvoid`** share one
  implementation (`setGiftCardFrozen`, mirroring `wallet-freeze`'s single-toggle pattern) —
  freezing notifies the current holder, or the intended recipient if the card was sent but
  never claimed (`giftcard_frozen` notif). `buyer_id` is `ON DELETE SET NULL` (not
  CASCADE) — it's provenance, not ownership, so deleting the issuing account can never
  destroy a card someone else has since claimed. All actions audit-logged
  (`giftcard.issue`/`.void`/`.unvoid`). Client (`renderCardsView`/`loadCards`/
  `issueGiftCard`/`voidCard`/`unvoidCard`): a liability hero, stat cards, an **Issue a gift
  card** form, a searchable list with Active/Frozen/Company pills + Freeze/Unfreeze, and a
  **Gift cards ⇄ Atwe Card** sub-tab (the waitlist + the "coming soon, gated on
  card-issuing partner + KYC" note). A frozen card the member still owns shows an amber
  **"On hold"** badge everywhere it's rendered (`acGiftCardHtml`) rather than looking
  identical to a spendable card; one sent to a member but frozen before they claimed it
  gets its own **"On hold"** section on the Gift Cards page instead of silently vanishing.
- **Payment links** (`payment_links`: unique code, fixed or open amount, running
  `collected_cents`/`pay_count`). `POST /api/payment-links {amountCents?,note?}`, `GET`
  (mine), `PATCH /api/payment-links/:id` (active toggle), `GET /api/paylink/:code`
  (public preview), `POST /api/paylink/:code/pay {amountCents?}` (walletTransfer
  payer→owner). Discover **Payment link** tile → `#payLinkView`; `?paylink=<code>` deep
  link opens the pay sheet after auth (`_pendingPayLink`, `acOpenPayLink`).
- **Pay-per-view post unlock** (`posts.ppv_cents` + `post_unlocks`) — reuses the
  subscriber-only **locked-placeholder** path. `POSTS_SELECT` computes `ppv_ok` (author
  or unlocked); `mapPost` ships a locked placeholder (no body/media) with `ppvCents`
  when unauthorized. `POST /api/social/posts/:id/unlock` (walletTransfer viewer→author,
  idempotent insert, notify `ppv_unlock`, returns the unlocked post). Composer PPV price
  row (`#acPpvRow`, mutually exclusive with sub-only); locked card "Unlock for $X"
  (`acUnlockPost` swaps the card in place via `.ac-post[data-postid]`).
- **GIFs in posts** — the create-post route accepts `gifUrl` (`cleanGifUrl`-validated
  Tenor/Giphy CDN host), stored as the post image (same as chat). Composer GIF button
  (`#acPostGifBtn`) opens the existing GIF picker via a callback hook (`acGifPicked` →
  `AC._gifPickCb`), sets `_acPostGif`, renders a preview; `acSubmitPost` sends `gifUrl`.
- **Tag people + co-author posts** (one shared `post_tags` table, `kind` `tag`|`author`).
  Create-post accepts `taggedIds` (≤20) + `coAuthorIds` (≤5), each validated
  (real/usernamed/non-deactivated/non-blocked/non-self), inserted + notified
  (`tagged`/`coauthor`). `POSTS_SELECT` aggregates them; `mapPost` exposes `tagged[]` +
  `coAuthors[]`. Composer "Tag people" / "Add collaborator" buttons → a mention-search
  picker (`#postTagPicker`) → removable chips (`#acTagChips`); the post card shows
  co-authors inline ("Name & First") and a "with @a, @b" line.
- **Scheduled-posts manager** — scheduling already existed (a future `scheduled_at`;
  feeds filter `created_at <= now()` so a scheduled post stays hidden until live). Added
  `GET /api/social/scheduled` (my pending future posts) + a `#scheduledPosts` manager
  (`acOpenScheduledPosts`, Cancel reuses the post-delete route), reachable from a
  "Scheduled" link in the composer's schedule row.
- **Inline message translate** — a "Translate" action on an incoming text message
  (long-press menu, `mmTranslateItem`) translates it into the reader's browser language
  via the AI write `translate` task and shows the result in the AI card (`acMsgTranslate`
  → `acAiShowResult` + `acBrowserLang`).

**Deferred / not yet built** — the planned roadmap is now **complete**: the "heavy
batch" (product **bundles**, **Subscribe & Save**, **recurring/scheduled payments**,
**multi-tier creator subscriptions**) plus the infra phase (**UI i18n**, **sales-tax +
carrier-rate shipping** via `shiptax.js`, **loyalty/points**) are all done — see those
sections. **QR-connect** (device-link QR login + profile QR; deps `qrcode` + vendored
`jsqr`) and **voice-note transcription** (optional STT, `stt.js`) are also done — see
"QR connect" and "Voice-note transcription". **The full roadmap is shipped.** A
design/polish pass (spacing, motion, light-theme parity, empty states,
accessibility) has since covered: light-theme parity across the message/menu/
popover surfaces (switched several hardcoded-dark components onto the shared
`--menu-bg`/`--menu-hl` system), a systemic accessibility fix (auto-backfilled
`aria-label`s), and a typography/spacing convergence pass (unified font-size/
weight drift across popup-menu rows, section headers, contact-row names, and
empty-state text; unified bottom-sheet corner radius and non-pill CTA buttons onto
the existing `--r-xl`/`--r-pill` tokens). Remaining: a full motion-token audit.

## Conventions

- **One-file-per-surface frontend.** `index.html` is the app; `admin.html` is the
  dashboard. Don't introduce a framework, bundler, or split these into modules
  unless explicitly asked. Match the existing inline style — vanilla DOM APIs,
  `getElementById`, banner-comment sections.
- **One verified badge everywhere, scaled to the name it sits next to.** A person's
  verified check is ALWAYS `vbadge(acIsVerified(u))` (the `AC_VBADGE` seal — a filled
  disc with the check **knocked out in the background colour**). It is a **neutral
  silver/white seal, NOT blue**: `.vbadge{color:var(--verify)}` (a theme var — soft
  silver `#d3d5d7` on Black/Dim, slate `#5b7083` on Light) and `.vbadge-v{stroke:
  var(--bg)}` so the check is a clean cutout that reads on any theme. **Size is
  `width:.9em;height:.9em`** (and `.ac-bizverify svg` likewise, `margin-left:6px`
  for breathing room from the name, kept identical everywhere the badge appears)
  — it scales with whatever font-size it inherits, so a badge next to a 20px
  profile name renders visibly larger than one next to a 13px comment name,
  matching that name's actual rendered size (at 90% of it, not 100% — a check
  mark that size reads as "next to the name," not "as big as the name") instead
  of looking tiny-next-to-huge or huge-next-to-tiny. This
  depends on **HTML structure, not just CSS**: the `${vbadge(...)}`/`${BIZ_VBADGE}`
  output must be a child of (or unwrapped sibling directly inside) the SAME element
  that carries the name's own font-size — e.g.
  `<span class="ac-item-name">${escHtml(u.name)}${vbadge(acIsVerified(u))}</span>`,
  NOT `<span class="ac-item-name">${escHtml(u.name)}</span>${vbadge(...)}` (the
  latter sits inside the *outer* container, which usually has no explicit
  font-size and falls back to the ambient default — the exact bug that made the
  badge drift out of proportion with the name across different-sized contexts).
  When adding a new name+badge site, always put the badge INSIDE the name's own
  font-sized span/element. **`vertical-align` (not a centered value)** is what
  makes the badge sit like an actual character in the name — its bottom edge on
  the same line as the bottom of the surrounding lowercase letters — rather than
  centered on the text's full line-height, which reads as floating above where a
  letter would sit; verified by real-pixel ink-bottom measurement (not just
  `getBoundingClientRect()` on a text range, which can reflect the font's
  line-box/descent metrics rather than the actual rendered glyph edge). A plain
  `baseline` lands dead flush (sub-pixel across a wide range of font sizes); the
  shipped value is **`-.08em`**, a deliberate small owner-requested nudge so the
  badge reads a hair lower than dead-flush (not a bug — don't "fix" it back to
  flush without checking first).

  **Direct-flex-child sites (the one real exception to "nest inside the name's
  span").** A handful of containers put the badge(s) as a **direct flex child**
  of a `display:flex`/`inline-flex` row instead of nesting them inside the
  name's own inline span — `.ac-prof-name` (profile header), `.me-hero-name`
  (Me-hub hero card), `.ob-pname` (onboarding people row), `.fcmt-name` (feed
  comment name), `.ac-sgc-name` (who-to-follow card name), `.rec-name`
  (recommendation card name), `.feed-head-name` (immersive feed card head),
  `.pinfo-nm` (contact-info screen name). They're built this way on purpose —
  the name text truncates with an ellipsis on overflow, and the badge must
  never get clipped along with it, so it sits *outside* the truncating span, as
  a sibling flex item instead. In that configuration, flexbox's baseline
  synthesis for a baseline-less replaced element (the SVG) does **not** land in
  the same place as inline `vertical-align:baseline` — it sits noticeably too
  high, by an amount that (verified by real-pixel measurement, not just DOMRect)
  depends on the container's **inherited line-height**, not just its font-size:
  a container with an unusually tight explicit line-height (`.ac-sgc-name`,
  `1.3`) needs far less correction than one inheriting the root's generous
  `1.6`. So **each site is individually calibrated** to land at the same final
  target as the inline sites (flush + the same hair-lower nudge) — see the
  `.ac-prof-name>.vbadge,.me-hero-name>.vbadge{transform:translateY(.26em)}` /
  `.ob-pname>.vbadge{...23em}` / `.fcmt-name>.vbadge{...27em}` /
  `.ac-sgc-name>.vbadge{...06em}` / `.rec-name>.vbadge{...2em}` /
  `.feed-head-name>.vbadge{...24em}` / `.pinfo-nm>.vbadge{...25em}` rules. When
  adding a new flex-direct-child site, don't guess a shared number from another
  site — measure it fresh (real screenshot pixel-scan, not DOMRect), with
  **generous spacing** between test candidates on the calibration page: a first
  pass at this crowded many candidates too close together on one page and the
  crowding silently corrupted a couple of the numbers, which only surfaced once
  each site was retested in isolation with room to breathe.

  The Postshot canvas painter mirrors the inline case (`_psVerified(…, verify,
  bg)`). Businesses get `BIZ_VBADGE` (the same neutral seal, rounded-square) via
  `.ac-bizverify` — its SVG content sits further inside its own viewBox than the
  checkmark's circle does, so it carries its own small `translateY(.17em)` on
  the inner `svg` (verified against the same inline target as `.vbadge`); its
  OWN flex-direct-child compensation in `.ac-prof-name` is a SEPARATELY
  calibrated `.21em` (not `.vbadge`'s `.26em`) since the two boxes' proportions
  differ. When a badge sits in a flex row with a `gap`, wrap the name+badge
  (e.g. `.ac-post-nameline`) so it hugs the name. Don't reintroduce the old
  plain `.ac-pdot` dot or the blue accent fill.

  **Affiliation badge (`.ac-affbadge`, the small rounded-square org-logo image
  an admin approves) reads as part of the SAME seal group as the checkmark, not
  a separate floating element** — `align-self`/`vertical-align` both `baseline`
  (matching `.vbadge`'s own approach) land its bottom EXACTLY flush with
  `.vbadge`'s own bottom in every plain inline context (`.notif-text`,
  `.ac-post-name`), verified by measuring the affiliation badge's bottom
  against the checkmark's bottom directly (not against the text), since the
  goal is specifically "these two badges sit together." `margin-left` matches
  `.vbadge`'s own `6px` so the checkmark→logo gap reads the same as the
  name→checkmark gap. Its two flex-direct-child sites (`.ac-post-nameline`,
  `.ac-prof-name`) each carry their own calibrated compensating transform
  (`-.25em`, `.24em`) — again measured against `.vbadge`'s actual position in
  the same row, not the text.
- **Brand safety.** Keep user-facing strings under the "Atwe" brand; don't expose
  "Claude"/"Anthropic" in UI copy, labels, or the system prompt.
- **"Anchored" design language.** When the owner says **"Anchored"**, apply the
  full spec in `docs/ANCHORED.md`: pure-black full-screen, only answer-fields
  boxed, rock-steady layout (fixed header/footer, buttons morph in place — no
  blink/jump), sharp high-contrast type, no emojis, purposeful micro-motion,
  pill buttons (grey→white, red = destructive).
- **⋯ menu material (unified, iOS-style, per theme).** Every three-dots menu —
  post/profile/user action sheets (`.action-sheet`), the chat/message glide menus
  (`.mm-sheet` / `.ac-head-sheet`), and the AI/tools popover (`.ai-menu-pop`) —
  shares ONE frosted material driven by CSS variables (`--menu-bg` / `--menu-border`
  / `--menu-sep` / `--menu-hl` / `--menu-shadow` / `--menu-blur` / `--menu-maxh`),
  set per theme so each looks native like an iOS context menu: **dark frosted** in
  Black/Dim, a **light frosted** material in Light (never a black box on white).
  Components reference the variables only — don't hardcode menu colors; to restyle
  menus, edit the variable block (just before `.action-sheet`). Two rules matter:
  (1) **capped height + internal scroll** — `--menu-maxh` (≈`min(66vh,432px)`, ~8-9
  rows) caps every menu so a long option list shows the first several and scrolls
  inside, iPhone-style, never taller than the screen (the JS anchors —
  `acAnchorMenu`/`_anchorSheet`/`_acAnchorPopover` — measure the capped height, so
  it always fits on-screen). (2) **instant blur** — the frosted layer must be
  blurred the moment the menu opens, so menu overlays skip the container
  opacity-fade (`#postActions`/`#ownPostActions`/`#ownProfileActions`/`.mm-overlay`
  `:not(.closing){animation:none}`) and the cards animate with **transform only**
  (never opacity — a fading blurred layer looks "black first, blurry a second
  later"). (3) **only the menu card is frosted, not the whole screen** — the
  action-sheet host overlays (`#postActions`/`#ownPostActions`/`#ownProfileActions`)
  override the modal `.overlay`'s full-screen `backdrop-filter` to `none` with a
  plain near-black scrim (`rgba(0,0,0,.9)`); the frost lives on the `.action-sheet`
  card via `--menu-blur`, matching the chat/glide menus. Menu rows have **no
  per-item separators** (`.as-item`/`.mm-item` draw no divider line) — group breaks
  are explicit `.mm-sep` elements only. Keep both invariants when adding a new menu: reuse a shared class and
  never animate a backdrop-filtered card's opacity. **Icon language:** menu icons
  are one consistent Lucide/SF-style **line** set — 24×24 viewBox, `fill:none`,
  **1.7** stroke, round caps/joins (enforced in CSS on `.as-item svg` / `.mm-item
  svg` / `.aimp-item svg`, so icon markup carries paths only, no per-path stroke
  attrs). New menu icons must match: simple, geometric, single-concept, stroke-only
  — don't paste heavier/filled icons from elsewhere.
- **"Glide menu" design.** When the owner says **"Glide menu"** (or "make it like
  the Glide menu"), use the iOS context-menu pattern already built for chat
  message options + the delete sheet (`#msgMenu` / `#msgDeleteOverlay` in
  `public/index.html`): a frosted translucent-black sheet (`rgba(0,0,0,.5)` +
  `backdrop-filter:blur(28px) saturate(1.7)`) so content shows through; rows with
  the **label left, icon right**, grouped by thin `.mm-sep` separators, evenly
  spaced rounded edges; a grey rounded highlight (`.mm-item.hl`,
  `rgba(255,255,255,.14)`) that **follows the finger as it drags** over the rows
  (press-and-hold, slide, release to select — see `_bindThreadLongPress` /
  `_glideSet`); the sheet is a fixed popover anchored next to where it opened
  (`_anchorSheet`), not centered; backdrop is a plain dark scrim (no blur).
- **Backend is modular:** `db.js` (data), `auth.js` (identity), `server.js`
  (routes/composition). Keep new data access in `db.js` and new auth logic in
  `auth.js` rather than inlining in routes.
- **Model IDs** live in two places — `server.js` (the real call) and the `MODELS`
  array (display only). Update `server.js` when changing the actual model.
- **Persistence parity.** When you add a new piece of per-user state, wire it in
  three places: a DB column/route, a `Sync.*` write-through, and the guest
  `localStorage` path — otherwise accounts and guests drift.
- **Style/UX commit history** shows heavy iteration on the glassmorphic UI.
  Preserve the existing CSS custom properties and visual language when editing
  styles; `admin.html` mirrors the same dark palette.
- No TypeScript; plain JS and CommonJS (`require`) on the server.

## Deployment

Railway builds with NIXPACKS and runs `node server.js`. Healthcheck path is
`/api/health` (timeout 100, restart on failure up to 10 retries). In the Railway
project: attach a **PostgreSQL plugin** (provides `DATABASE_URL`) and set
`ANTHROPIC_API_KEY`, `JWT_SECRET`, `ADMIN_EMAIL`, and `APP_URL`. Schema is created
on first boot.

The primary domain is **`atwe.com`** (admin at **`admin.atwe.com`**).

Optional, for full functionality:
- **Admin subdomain:** point `admin.atwe.com` (and the apex/`www`) DNS at the same
  Railway service and add both as custom domains. One service handles both via the
  host-check middleware; set `ADMIN_HOST` if the subdomain differs.
- **Legacy domain:** the old `atwe.ai` (apex/`www`) 301-redirects to `atwe.com`
  (a bare visit lands on the Atwe AI page via `?go=ai`; deep links keep their path),
  and `admin.atwe.ai` → `admin.atwe.com`. Add `atwe.ai`/`admin.atwe.ai` as custom
  domains on the same service for the redirect to fire.
- **Email:** set the `SMTP_*` vars (any provider) to send real verification/reset
  emails instead of console logs.
- **Billing:** set `STRIPE_SECRET_KEY` + `STRIPE_PRICE_ID`, create a Stripe webhook
  endpoint pointing at `/api/billing/webhook`, and set `STRIPE_WEBHOOK_SECRET`.

The committed `data/`, `dist/`, `.next/` ignores are defensive — none are produced
today.

## Gotchas for AI assistants

- There is **no lint**, and only a **small opt-in money/auth test suite**
  (`npm test`, skips without a database) — for anything it doesn't cover, verify
  backend changes by running the server against a Postgres instance and hitting
  the endpoints; verify frontend changes in the browser.
- The server **degrades gracefully without `DATABASE_URL`** (health + guest chat
  work; DB routes return a clear error). Don't assume a DB is always present.
- `plan: 'pro'` only widens `max_tokens` — it is **not** a security boundary.
- **Two persistence modes** (server for accounts, localStorage for guests) — a
  change that only touches one will cause drift. Keep `Sync` and the guest path
  in step.
- `DB_SSL` auto-detect keys off `@host` in the URL, so **socket-style**
  connection strings need an explicit `DB_SSL=false`.
- **External integrations are all optional** (DB, SMTP, Stripe) and degrade
  gracefully — test the "not configured" path too, and gate UI on `/api/config`.
- The **Stripe webhook must stay above `express.json()`** (it needs the raw body).
- The **admin subdomain is a separate origin** — it has its own token/sign-in and
  does not see the main app's `localStorage`.
- The frontend files are large — prefer targeted `Grep`/`Edit` over rewrites.
