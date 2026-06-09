# CLAUDE.md

Guidance for AI assistants (and humans) working in this repository.

## What this is

**Atwe AI** — a single-page web chat application: an "intelligent assistant for
business" UI backed by the Anthropic Claude API. A thin Express server proxies
chat requests to Claude and serves a self-contained, installable PWA frontend.

The product wraps Claude under the brand name **"Atwe"**. User-facing copy never
mentions Claude or Anthropic directly — the system prompt and model labels
present the assistant as "Atwe AI". Keep that branding intact in UI strings.

## Stack & layout

- **Backend:** Node.js + Express (`server.js`), `@anthropic-ai/sdk`
- **Frontend:** one self-contained file — `public/index.html` (~2300 lines: HTML,
  CSS in a single `<style>` block, and vanilla JS in a single `<script>` block).
  No framework, no build step, no bundler.
- **PWA:** `public/manifest.json`, `public/sw.js` (service worker), SVG icons
- **Deploy:** Railway (`railway.json`, NIXPACKS builder)

```
server.js              Express server + 3 API routes
package.json           deps: express, @anthropic-ai/sdk, dotenv; dev: nodemon
railway.json           Railway deploy config (start cmd, healthcheck)
.env.example           required env vars
public/
  index.html           the entire frontend (HTML + CSS + JS inline)
  manifest.json        PWA manifest
  sw.js                service worker (cache-first shell, bypasses /api/)
  icon.svg             app icon (purpose: any)
  icon-maskable.svg    app icon (purpose: maskable)
```

## Running locally

```bash
npm install
cp .env.example .env      # then set a real ANTHROPIC_API_KEY
npm run dev               # nodemon, auto-restart on change
# or: npm start           # plain `node server.js`
```

Server listens on `PORT` (default **3000**) → http://localhost:3000

There are **no tests, no linter, and no build** configured. "Building" the
frontend just means editing `public/index.html` and reloading the browser.

### Environment variables

- `ANTHROPIC_API_KEY` — **required**; the server fails to answer chats without it
- `PORT` — optional, defaults to `3000`

`.env` is gitignored. Never commit a real key.

## API surface (`server.js`)

| Method | Route          | Purpose |
|--------|----------------|---------|
| GET    | `/api/health`  | Liveness check (used by Railway healthcheck). Returns `{ status, timestamp }`. |
| GET    | `/api/test`    | Smoke-tests the Anthropic key with a tiny Haiku call. |
| POST   | `/api/chat`    | Main endpoint. Body `{ messages, plan }`. Calls Claude and returns `{ content, usage }`. |

`/api/chat` details:
- `messages` is the Anthropic-format conversation array (`{ role, content }`);
  `content` may be a string or a content-block array (text + base64 image).
- `plan` is `'free'` or `'pro'` and **only controls `max_tokens`** (`pro` → 4096,
  otherwise 1500). It is not real authorization — there's no server-side auth.
- The model is hardcoded to **`claude-sonnet-4-6`** with a fixed Atwe system
  prompt. `/api/test` uses `claude-haiku-4-5-20251001`.

Static files are served from `public/` via `express.static`. JSON body limit is
`4mb` to accommodate base64 image uploads.

## Frontend architecture (`public/index.html`)

Everything lives in one file, organized by banner comments
(`STATE`, `STORAGE`, `AUTH`, `DOM HELPERS`, etc.). Key pieces:

- **`S`** — the single global state object: `{ user, plan, chats, projects,
  activeId, loading, recording, model }`.
- **`Store`** — persistence layer. All state is kept in **`localStorage`** under
  keys `atwe_user`, `atwe_chats`, `atwe_projects`, `atwe_plan`. There is **no
  backend database**; auth and history are entirely client-side.
- **`MODELS`** — display labels ("Atwe Standard" / "Atwe Advanced"). Note both
  currently map to the same underlying id; the model selector is cosmetic.
- **Auth** is fake/local: login/signup just derive a name from the email and
  store it. No password is verified or sent anywhere. Guest mode is supported.
- **Chat flow** (`sendMessage`): builds an Anthropic-format message (optionally
  with a base64 image block), POSTs to `/api/chat` with a 30s `AbortController`
  timeout, then renders the reply with a typewriter effect. Only the **text** of
  a message is stored in localStorage — images are sent but not persisted.
- **Markdown** is rendered by a small hand-rolled `renderMarkdown`/`escHtml`
  (bold, code, lists, headers) — no markdown library.
- **Voice input** uses the browser `SpeechRecognition` API; **images** via a file
  input read as base64 data URLs.
- Error handling in `sendMessage` maps HTTP statuses (401/403, 429, 5xx) and
  network failures to friendly, brand-safe messages.

## PWA / service worker

`sw.js` is **cache-first for the app shell** (`/`, `/index.html`) and
network-falls-back-to-cache for other GETs. It **explicitly bypasses `/api/`**
requests so chat calls always hit the network. The cache is versioned via the
`CACHE` constant (`atwe-v1`).

> When you change cached assets in a way that must invalidate old clients, bump
> the `CACHE` version string in `sw.js` (e.g. `atwe-v1` → `atwe-v2`). The
> `activate` handler deletes any cache whose key doesn't match.

## Conventions

- **One-file frontend.** Do not introduce a framework, bundler, or split
  `index.html` into modules unless explicitly asked. Match the existing inline
  style — vanilla DOM APIs, `getElementById`, banner-comment sections.
- **Brand safety.** Keep user-facing strings under the "Atwe" brand; don't expose
  "Claude"/"Anthropic" in UI copy, labels, or the system prompt.
- **Model IDs** live in two places — `server.js` (the real call) and the `MODELS`
  array (display only). Update `server.js` when changing the actual model.
- **Style/UX commit history** shows heavy iteration on the glassmorphic UI
  (animations, mobile/tablet polish). Preserve the existing CSS custom properties
  and visual language when editing styles.
- No TypeScript; plain JS and CommonJS (`require`) on the server.

## Deployment

Railway builds with NIXPACKS and runs `node server.js`. Healthcheck path is
`/api/health` (timeout 100, restart on failure up to 10 retries). Set
`ANTHROPIC_API_KEY` in the Railway project's environment. The committed
`data/`, `dist/`, `.next/` ignores are defensive — none are produced today.

## Gotchas for AI assistants

- There is **no test suite or lint** — don't claim to "run tests"; verify changes
  by reasoning and, if needed, by starting the server and hitting the endpoints.
- `plan: 'pro'` is **not a security boundary**; it only widens `max_tokens`.
- History/auth are **client-only**; clearing localStorage wipes everything and
  there's no recovery.
- The frontend file is large — prefer targeted `Grep`/`Edit` over rewriting it.
