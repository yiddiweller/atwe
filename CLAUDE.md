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
  `chat_mute_until` (JSONB map of muted thread → expiry).
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
| PUT | `/api/plan` | user | Set own plan (`free`/`pro`) — authoritative. |
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
| POST | `/api/admin/business-verify/:id` | admin | Approve/deny business verification. |

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

- **DMs** (`at_messages`): 1:1 chat. Text, photo, video/file, voice notes, rich
  "meta" cards (poll / event / location / contact), replies, forwards, reactions,
  edits, per-message delete (for me / for everyone), star, hide/reveal. **Message
  yourself** (self-chat) is supported and behaves like WhatsApp (no presence/typing/
  unread on yourself). DM permission is gated by contact-privacy + chat requests.
- **Groups & channels** (`at_groups`, `at_group_members`, `at_group_messages`): group
  chat; a `broadcast` group is a **channel** (admin-post-only). Group read state is a
  per-member `last_read_at` (not per-message). Group "Cloud" = a shared per-group
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
- **Calls:** 1:1 audio/video and group calls + "live" broadcasts over WebRTC, signalled
  through the SSE stream.
- **Social:** posts/replies (`posts`), likes, polls; **timeline/feed**, profiles,
  follows; **circles** (private post audiences, `circles`/`circle_members`/`post_circles`)
  and **feeds** (joinable broadcast channels, `feeds`/`feed_members`/`post_feeds`).
  `posts.to_main=false` means a post is circle/feed-only — **single-post reads must
  apply the visibility gate** (`GET /api/social/posts/:id` checks
  own-or-public-or-circle-member-or-feed-viewer).
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
- **Boosts (monetization):** `POST /api/jobs/:id/feature` sets `featured_until`
  (`JOB_BOOST_DAYS = 30`). With `STRIPE_BOOST_PRICE_ID` set it goes through real
  **Stripe Checkout** (`billing.createBoostSession`, `mode: 'payment'`); the webhook
  branch (`metadata.type === 'boost'`) flips `featured_until`. Featured jobs **sort
  first** everywhere — lists, search, and the AI matchmaker.

### Networking graph & profile

- **Connections** (`connections`): request → accept, mutual (a real bidirectional
  graph). **Mutual-connection hints** on profiles; **people-you-may-know**
  suggestions (`/api/connections/suggestions`).
- **Skills + endorsements** (`user_skills`, `skill_endorsements`), **work experience**
  (`experiences`, with an optional `company_user_id` FK linking to a business account),
  **profile views** (`profile_views` → viewer list + count).
- **Connection-gated messaging:** opt-in `users.dm_connections_only` (off by default)
  restricts DMs to connections.

### AI resumes

Seekers build CVs with **Atwe AI**: a guided form collects who they are + their
history, `POST /api/ai/resume` (enriched with their saved `experiences`/`user_skills`)
returns a structured resume JSON, and it's stored in **`resumes`** (`data` = `{answers,
resume}`, owner-scoped upsert by client id). A "My Resumes" surface (from the search
Discover actions + the jobs-board toolbar) lists them; the preview renders a printable
white CV with **Download (HTML) / Print / Edit / Delete**. Degrades to 503 without a key.

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
