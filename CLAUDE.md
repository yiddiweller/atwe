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

## Stack & layout

- **Backend:** Node.js + Express (`server.js`), `@anthropic-ai/sdk`
- **Database:** PostgreSQL via `pg` (`db.js`) — users, projects, chats
- **Auth:** `bcryptjs` (password hashing) + `jsonwebtoken` (JWT) in `auth.js`
- **Frontend:** one self-contained file — `public/index.html` (~2400 lines: HTML,
  CSS in a single `<style>` block, and vanilla JS in a single `<script>` block).
  No framework, no build step, no bundler.
- **Admin:** `public/admin.html` — standalone dashboard page (its own HTML/CSS/JS)
- **PWA:** `public/manifest.json`, `public/sw.js` (service worker), SVG icons
- **Deploy:** Railway (`railway.json`, NIXPACKS builder)

```
server.js              Express app: composition root + all API routes
db.js                  pg Pool, schema bootstrap (CREATE TABLE IF NOT EXISTS), admin seed
auth.js                bcrypt + JWT helpers; requireAuth / optionalAuth / requireAdmin
package.json           deps: express, @anthropic-ai/sdk, dotenv, pg, bcryptjs, jsonwebtoken
railway.json           Railway deploy config (start cmd, healthcheck)
.env.example           required + optional env vars
public/
  index.html           the entire main-app frontend (HTML + CSS + JS inline)
  admin.html           standalone admin dashboard (separate self-contained page)
  manifest.json        PWA manifest
  sw.js                service worker (cache-first shell, bypasses /api/)
  icon.svg             app icon (purpose: any)
  icon-maskable.svg    app icon (purpose: maskable)
```

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
- `ADMIN_EMAIL` — account with this email is auto-granted admin on signup, and any
  existing matching account is promoted on boot
- `DB_SSL` — `true`/`false` to force DB SSL; omit to auto-detect (SSL on for
  remote hosts, off for localhost). **Note:** auto-detect keys off `@host`, so
  socket-style connection strings need an explicit `DB_SSL=false`.
- `PORT` — optional, defaults to `3000`

`.env` is gitignored. Never commit real secrets.

## Database schema (`db.js`)

- **`users`** — `id` (serial), `name`, `email` (unique), `password_hash`,
  `plan` (`free`/`pro`, default `free`), `is_admin` (bool), `created_at`
- **`projects`** — `id` (TEXT, client-generated), `user_id` (FK → users, cascade),
  `title`, `created_at`
- **`chats`** — `id` (TEXT, client-generated), `user_id` (FK → users, cascade),
  `project_id` (FK → projects, set null), `title`, `messages` (**JSONB**, the
  full conversation array), `created_at`, `updated_at`

`messages` is stored as JSONB — the whole conversation lives on the chat row;
there is no separate messages table. Deleting a user cascades to their projects
and chats.

## API surface (`server.js`)

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| GET | `/api/health` | — | Liveness (Railway healthcheck). Returns `{ status, db, timestamp }`. |
| GET | `/api/test` | — | Smoke-tests the Anthropic key with a tiny Haiku call. |
| POST | `/api/auth/signup` | — | Create account. Returns `{ token, user }`. |
| POST | `/api/auth/login` | — | Returns `{ token, user }`. |
| GET | `/api/auth/me` | user | Refresh the client's view of the account. |
| GET | `/api/projects` | user | List the user's projects. |
| PUT | `/api/projects/:id` | user | Upsert a project (create/rename, idempotent). |
| DELETE | `/api/projects/:id` | user | Delete a project. |
| GET | `/api/chats` | user | List the user's chats (newest first). |
| PUT | `/api/chats/:id` | user | Upsert a chat (title + messages + projectId). |
| DELETE | `/api/chats/:id` | user | Delete one chat. |
| DELETE | `/api/chats` | user | Delete all the user's chats. |
| PUT | `/api/plan` | user | Set own plan (`free`/`pro`) — authoritative. |
| GET | `/api/admin/users` | admin | List all users with chat counts. |
| PATCH | `/api/admin/users/:id` | admin | Change a user's `plan` / `is_admin`. |
| DELETE | `/api/admin/users/:id` | admin | Delete a user (cascades). |
| POST | `/api/chat` | optional | Calls Claude, returns `{ content, usage }`. |

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

A **separate self-contained page** (not part of `index.html`), reachable from
Settings → Admin → Open when the signed-in user `is_admin`. It reads
`localStorage.atwe_token`, calls the `/api/admin/*` endpoints, and renders a user
table with stat cards. Controls: toggle plan (free/pro), toggle admin, delete
user. Server-side guards still apply (you can't revoke/delete yourself). If the
token is missing/expired/non-admin, the page shows a gated message instead of the
table.

## PWA / service worker

`sw.js` is **cache-first for the app shell** (`/`, `/index.html`) and
network-falls-back-to-cache for other GETs. It **explicitly bypasses `/api/`**
requests so chat and data calls always hit the network. The cache is versioned
via the `CACHE` constant (`atwe-v1`).

> When you change cached assets in a way that must invalidate old clients, bump
> the `CACHE` version string in `sw.js` (e.g. `atwe-v1` → `atwe-v2`). The
> `activate` handler deletes any cache whose key doesn't match. `admin.html`
> isn't pre-cached, but the network-first fallback still serves it.

## Conventions

- **One-file-per-surface frontend.** `index.html` is the app; `admin.html` is the
  dashboard. Don't introduce a framework, bundler, or split these into modules
  unless explicitly asked. Match the existing inline style — vanilla DOM APIs,
  `getElementById`, banner-comment sections.
- **Brand safety.** Keep user-facing strings under the "Atwe" brand; don't expose
  "Claude"/"Anthropic" in UI copy, labels, or the system prompt.
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
`ANTHROPIC_API_KEY`, `JWT_SECRET`, and `ADMIN_EMAIL`. Schema is created on first
boot. The committed `data/`, `dist/`, `.next/` ignores are defensive — none are
produced today.

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
- The frontend files are large — prefer targeted `Grep`/`Edit` over rewrites.
