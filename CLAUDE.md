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
railway.json           Railway deploy config (start cmd, healthcheck)
.env.example           required + optional env vars (grouped by concern)
public/
  index.html           the entire main-app frontend (HTML + CSS + JS inline)
  admin.html           standalone admin dashboard (separate page + own sign-in)
  manifest.json        PWA manifest
  sw.js                service worker (cache-first shell, bypasses /api/)
  icon.svg             app icon (purpose: any)
  icon-maskable.svg    app icon (purpose: maskable)
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

There are **no automated tests, no linter, and no build step**. "Building" the
frontend just means editing `public/index.html` / `public/admin.html` and
reloading the browser. To verify backend changes, start the server and hit the
endpoints (a throwaway local Postgres works well for end-to-end checks).

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
are no separate migration files.

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
list): a sticky header (back + title + Done), a **"Search settings"** bar, an
account card, and grouped rounded cards of rows with rounded-square colour icon
tiles + chevrons (`.iset-group`/`.iset-row`/`.iset-ic`). The hub follows X's
information architecture and slides into sub-pages (`.iset-body[data-page]`):
**Your account · Privacy & safety · Security & access · Notifications · Premium
& verification · Display & accessibility · Atwe Assistant · Your data & storage
· About · Admin**. Navigation is `setNav(page)`/`setBack()`; `setSearchInput`
filters a static `SET_SEARCH_INDEX` and jumps to a setting's page.
`openSettings()` populates everything and resets to the hub; account-only rows,
the admin group and Sign out are gated by `isAccount()`/`is_admin`. Boolean rows
(read receipts, private views, push, dark mode + new **Larger text** /
**Reduce motion**) are `.ios-switch`es driven by `syncPrivacyRows`/`syncPushRow`/
`syncThemeButtons`; 2FA/plan show a value chip (`syncTwoFaRow`). The
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
/api/notification-filters`; `toggleNotifFilter` persists them. Display prefs
persist per-device (`applyDisplayPrefs`, `body.big-text`/`body.reduce-motion`).
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
`presence_visibility` (who sees you online — gates `broadcastPresence`/
`presenceVisibleTo` on the SSE stream), `connections_visible` (hide your
connections list — gates `/api/social/connections/:username`), `who_can_request`
(everyone/network/nobody — gates `POST /api/connections/:id`),
`who_can_add_groups` (everyone/connections/nobody — gates the group-members
route), `share_profile_updates` (notify connections with a `profile_update`
notif when your headline changes), `personalized` (opt out of the For-You boost
terms). Surfaced as a **Connections & visibility** + **Activity & personalization**
group on Privacy & safety (switches + `.iset-select` pickers). **Connected
accounts** (`GET /api/account/connected`, `oauth_provider`), **Hibernate**
(`POST /api/account/deactivate`, password-gated + rate-limited, reversible —
login reactivates). A deactivated account is hidden everywhere a person is
discoverable or reachable: profile 404s, and `NOT deactivated` is filtered from
the feed (both scopes + promoted), all/people/businesses search, mention-search,
both suggestion endpoints, the business directory + `/api/local`, the follows
list, the stories tray, services/marketplace/candidates, group-add, and
`canContact` (DMs). Presence (online/last-seen) reports false for them too.
Events and the live-call roster intentionally persist. And a device
**App lock** (`atwe_applock` SHA-256 passcode covering the app on boot/resume)
live on Security / Your account.

### Profile — X-style tabbed page

`acRenderProfile(d, mine)` renders an X-style profile: banner, a large
overlapping avatar, action buttons, name/handle/headline/bio, a meta row
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
(you can't revoke/delete yourself). Missing/expired/non-admin tokens fall back to
the sign-in view.

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

`sw.js` is **cache-first for the app shell** (`/`, `/index.html`) and
network-falls-back-to-cache for other GETs. It **explicitly bypasses `/api/`**
requests so chat and data calls always hit the network. The cache is versioned
via the `CACHE` constant (`atwe-v1`).

> When you change cached assets in a way that must invalidate old clients, bump
> the `CACHE` version string in `sw.js` (e.g. `atwe-v1` → `atwe-v2`). The
> `activate` handler deletes any cache whose key doesn't match. `admin.html`
> isn't pre-cached, but the network-first fallback still serves it.

## AtChat — messaging & social

The bulk of `server.js` and `public/index.html` is **AtChat**, a self-contained
messaging + social product layered on the same accounts/auth/DB. It only works for
**signed-in accounts with a `username`** (guests get the AI chat only). All routes
live under `/api/atchat/*`, `/api/social/*`, `/api/feeds/*`, `/api/circles/*`,
`/api/rt/*`. The frontend lives in one big `AC` state object + `AC.*`/`ac*`
functions, organized by banner comments.

### Surfaces

- **Multiple conversations with the same person** (Gmail-thread style): an extra
  conversation is a `dm_threads` row (pair normalized `a<b`, optional title); its
  messages carry that `at_messages.thread_id`. **`thread_id IS NULL` = the original
  main chat**, so all existing behavior is unchanged and extra threads are purely
  additive. `GET/POST /api/atchat/threads/:peerId` (list with per-thread last
  message + unread / create), and the read (`GET /api/atchat/with/:id?thread=`),
  send (`{threadId}`) and `…/read?thread=` are all thread-scoped (opening one
  conversation never clears another's unread). The chat list stays **one row per
  person** with a count badge (`conversations.thread_count`); tapping a multi-thread
  row opens a picker (`acOpenThreadPicker`), and picking someone in New Chat who you
  already have history with asks **Continue vs Start a new chat** (`acComposePickPerson`
  → `#threadChoice`). `resolveDmThread` validates a thread belongs to the pair.
- **DMs** (`at_messages`): 1:1 chat. Text, photo, video/file, voice notes, rich
  "meta" cards (poll / event / location / contact), replies, forwards, reactions,
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
  (`#acListScreen.msgsearch`). Hide/reveal, **pin**
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
  **Stickers & GIFs** (composer attach → "Sticker / GIF", `#stickerView`): a
  **sticker** is a big emoji sent as a normal text message (`_STICKERS`, renders
  via `acEmojiOnly`) — always available. A **GIF** is sent by its remote URL
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
  per-member `last_read_at` (not per-message). **Invite links** (`at_groups.invite_code`,
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
  through the SSE stream.
- **Stories / Status** (ephemeral 24h updates): photo or text-on-gradient statuses
  (`stories` table, `expires_at = now()+24h`; reads always filter `expires_at >
  now()` + a 10-min sweep deletes expired). Shown to your **followers** (audience =
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
  (`acOpenStory`/`acStoryShow`/`acStoryNext`/`acStoryPrev`), a **composer** (photo or
  text-on-gradient, `#storyCompose`), and an author **seen-by** list (`#storyViewers`).
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
  (`acEditPost`/`acSaveEditedPost`). A repost re-surfaces the post in
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
  (falling back to `[image]`), and `acPostMedia` renders a swipe-snap carousel
  (`.ac-imgcar` + dots, `acCarScroll`) for 2+ images.
  **Bookmarks** (`post_bookmarks`, private; a Bookmarks feed tab + `bookmarked`
  on `mapPost`) with **folders** (`bookmark_folders` + `post_bookmarks.folder_id`,
  null = unsorted; deleting a folder keeps its bookmarks via `ON DELETE SET
  NULL`): `GET/POST/PATCH/DELETE /api/social/bookmark-folders[/:id]`, the bookmark
  POST takes an optional `folderId` (upserts), `PUT /api/social/bookmarks/:postId/
  folder` moves one, and `GET /api/social/bookmarks?folder=:id|unsorted` filters.
  Client: a folder chip row on the Bookmarks tab (`acBmkFolderBar`/`acBmkFilter`),
  a manager (`#bmkFolderManage`), and a "Save to folder" picker (`#bmkMove`) in
  both post overflow menus. **Hashtags** (`post_hashtags`, indexed on post create via
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
  **Following** stays chronological. **Home-feed layout** (X-cleanup pass): the feed
  scope tabs (`#tbFeedTabs`) are a horizontally-scrollable row with **no underline**
  (active = bold white text only) ending in a **Search** entry; the two AI helpers
  moved off the feed into a **✦ top-bar button** (`#tbAiBtn` → `#aiHub` sheet with
  "Show me what matters" + "Catch me up"); **`acPostCard` is FB/LinkedIn-style** —
  header row on top (`.ac-post-top`: avatar + name), content full-width below
  (`.ac-post-body`), with `acFitPostImg` sizing a wide photo full-width vs.
  indenting a narrow/portrait one under the name; the inline **who-to-follow** module
  (`acFeedSuggestModule`) is X-style vertical rows (`.ac-sg-row`, avatar + name/@handle
  + Follow pill). Stories were removed from the home feed (now on the Feeds tab).
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
  (`acFeedMore` → Save · Copy link · Not interested · Report video / Delete-if-mine;
  `feedpost` is a `REPORT_TYPES` target). **Comments** are flat with their own
  hearts (`feed_post_comments` + `feed_comment_likes`): `GET/POST
  /api/feedposts/:id/comments`, `DELETE …/comments/:cid` (commenter or post owner),
  `POST …/comments/:cid/like {on}`; the bottom-sheet (`#feedComments`,
  `acFeedOpenComments`/`acRenderComments`/`acFeedSendComment`/`acFeedCommentLike`)
  posts/lists/likes/deletes inline and keeps the rail's comment count in sync.
  Counts + my-state ride on `mapFeedPost` (`likes`/`dislikes`/`comments`/`myVote`/
  `saved`); `feedPostVisible` gates engagement (exists, not blocked, discover-open);
  notify verbs `feed_like`/`feed_comment`. **Reply controls** (`posts.reply_scope`:
  `everyone`/`following`/`mentioned`) — the composer picks who can reply; replies
  are enforced server-side in the create-post route (via `canReplyTo`) and the
  detail route returns `canReply` to gate the reply box. **Lists** (`lists` +
  `list_members`, owner-scoped): curated timelines — create/rename/delete, add/
  remove members, `GET /api/social/lists/:id/timeline` shows members' posts;
  reachable from the Me hub + an "Add to list" action on profiles.
  **timeline/feed**, profiles,
  follows; **circles** (private post audiences, `circles`/`circle_members`/`post_circles`)
  and **feeds** (joinable broadcast channels, `feeds`/`feed_members`/`post_feeds`).
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

### Realtime (SSE)

- One stream per connection: `GET /api/rt/stream?token=<short-lived stream token>`
  (minted by `GET /api/rt/token`; the 30-day bearer never goes in a URL). The stream
  token carries the issuing session's hash (`sh`) and is re-checked against
  `auth_sessions` on connect, so a logged-out session can't reconnect.
- Server fan-out: `rtClients: userId → Set<res>` (multi-device). `rtPush(userId,…)`
  hits every connection; `rtBroadcast`; `rtKickUser` force-closes a user's streams
  (used on password reset / log-out-everywhere). Presence is derived from open
  connections; "offline" only when the **last** connection closes.
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
- Business avatars render as an **app-shape rounded square** (`.user-avatar.biz`,
  `border-radius:28%`) via `acAvatarHtml(name, avatar, cls, biz)` — the one visual
  tell that distinguishes a business from a person.
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

> **Boot hydration:** `S.user` (set in both `onAuthSuccess` and the token-boot path)
> must include the business fields — `accountType`, `businessVerifyStatus`,
> `headline`, `categories`, `businessHours`, `balanceCents`, etc. — or business-gated
> UI (anything behind `acIsBiz(S.user)`) silently breaks after a page reload.

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
estimate. `creator_subs (subscriber_id, creator_id, status, period_end)` — access
lasts while `status='active' AND period_end > now`. `POST /api/creator/:id/subscribe`
goes through **Stripe Checkout `mode:'subscription'`** (`billing.createRecurringSession`,
inline monthly `price_data`, `metadata.type=creator_sub`) or **demo-grants 30 days**
when Stripe is unconfigured; `DELETE` cancels (access stays until period end). The
webhook handles `checkout.session.completed`(creator_sub) → grant, and `invoice.paid`
→ renew, both via the shared `recordCreatorSub` helper (a `creator_sub` notif fires).
**Subscriber-only posts:** `posts.subscribers_only` (composer toggle, creators only).
`POSTS_SELECT` computes a `sub_ok` entitlement flag; `mapPost` ships a **locked
placeholder** (no body/media, `locked:true`) to non-entitled viewers. Inaccessible
sub-only posts are **hidden from the For You/Following feeds** (`SUBONLY_FEED_FILTER`)
but shown as **locked teasers on the creator's profile**. Profile payload carries
`subPrice`/`subBlurb`/`isSubscribed`/`subscriberCount`; `publicUser` exposes the
owner's `subPriceCents` (gates the composer toggle). Client: `acCreatorSubCard` on
the profile, `#creatorSubView` settings overlay, `?creatorsub=success` on return.

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
  is untouched) → `order_shipped` notif; `…/deliver` (either party → `delivered_at`;
  a normal paid order also becomes `fulfilled`; escrow stays held for buyer confirm) →
  `order_delivered`. Order detail shows a **status timeline** (Ordered→Paid→Shipped→
  Delivered), the carrier/tracking, the ship-to, and a printable **packing slip**
  (`acPackingSlip`, ship-to + items, opens a print window).
- **Per-product reviews (verified buyers only):** `product_reviews` (1–5 ★ + body,
  unique per product+reviewer); `hasPurchased` gates writes (must have a paid/
  fulfilled/delivered/released order of the item). `GET/POST/DELETE
  /api/products/:id/reviews` (avg + count + `canReview`/`purchased`/`mine`); avg ★
  surface on the detail + listing/shop cards. Buyer is prompted to "Review your
  purchase" once received. (Distinct from `business_reviews`, which rate the seller.)
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

### In-chat checkout (share a product into a DM)

`POST /api/atchat/share/product {to, productId}` drops a **buyable product card** into
a DM — a `meta.t='product'` message whose name/price/image are built **server-side**
from the live product (`LISTING_SELECT`, active, blocks-aware via `dmAllowed`), never
trusted from the client. The recipient taps it → the normal listing detail + checkout
(`acOpenListing`). Client: a **Product** tile in the chat composer's attach menu
(`acShareProductOpen`, DM-only) opens a picker of the sender's own listings
(`#shareProductSheet`, `acDoShareProduct`); `acMetaCard` renders the `product` branch
(`.mc-prod`), and the chat-list preview shows "🛍️ Product".

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
`active`) + `coupon_redemptions` (one row per use; enforces **one-per-buyer**).
`mapCoupon`/`resolveCoupon(sellerId, code, subtotalCents, buyerId)` (validates active /
not-expired / under max_uses / meets min-order / not-already-used → `{discountCents,
coupon}` | `{error}`; percent = `round(subtotal*value/100)`, fixed = `value`, clamped
to subtotal) / `applyCouponRedemption(orderId)` (on pay: atomically claims a use via
`UPDATE … WHERE used_count < max_uses RETURNING` + records the redemption). Routes:
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
top-ups / sends / tips. **Cash-out payout safety:** `createPayout` is called with a
ledger-id idempotency key (`cashout_<txId>`), and the route **only refunds the
balance on a *definitive* Stripe rejection** (`StripeInvalidRequestError`/
`StripeCardError`) — on an ambiguous error (timeout/network) it keeps the debit for
reconciliation rather than risk paying the user twice.

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
(`q`, `industry`, `verifiedOnly` filters) returns businesses **verified-first**
then by follower count, each with `followers` + `jobs` counts (on top of
`mapSearchUser`). Surfaced from the search Discover actions ("Businesses",
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
  job/listing/user/post, `target_id`, `note`, `status`), with a one-open-report-per
  `(reporter, target)` partial unique index. Admins work the queue in `admin.html`
  (Resolve / Dismiss / Remove item).

### Security / authorization (networking)

- **Per-row ownership:** job edit/delete/applicant-status require `posted_by` =
  caller (or admin); experience/skill/listing mutations require the owning `user_id`;
  candidate-save and saved-search rows are scoped to the owner.
- **Plan is authoritative server-side** (looked up from the DB, never trusted from
  the client) for the free-business job cap — but it is still **not** a general
  authorization boundary, only a feature gate.

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

## Conventions

- **One-file-per-surface frontend.** `index.html` is the app; `admin.html` is the
  dashboard. Don't introduce a framework, bundler, or split these into modules
  unless explicitly asked. Match the existing inline style — vanilla DOM APIs,
  `getElementById`, banner-comment sections.
- **Brand safety.** Keep user-facing strings under the "Atwe" brand; don't expose
  "Claude"/"Anthropic" in UI copy, labels, or the system prompt.
- **"Anchored" design language.** When the owner says **"Anchored"**, apply the
  full spec in `docs/ANCHORED.md`: pure-black full-screen, only answer-fields
  boxed, rock-steady layout (fixed header/footer, buttons morph in place — no
  blink/jump), sharp high-contrast type, no emojis, purposeful micro-motion,
  pill buttons (grey→white, red = destructive).
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

- There is **no test suite or lint** — verify backend changes by running the
  server against a Postgres instance and hitting the endpoints; verify frontend
  changes in the browser.
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
