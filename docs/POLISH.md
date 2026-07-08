# POLISH.md — Stage 1 Audit (launch-readiness)

> **Source of truth** for the polish project defined in [ATWE-FINAL-master-brief.md](./ATWE-FINAL-master-brief.md).
> Produced by the Stage 1 audit (static code audit of the full repo against Sections 2–5 of the brief,
> the Phase 1 color brief, the Phase 2 Living Light brief, and the v25 / feature-intro reference HTMLs).
>
> **Conventions:** `- [ ] (PAGE · SEVERITY) Problem → Proposed fix → Files involved`.
> **BUG** = functionally broken (own tier, above P0) · **P0** = breaks the design law or a broken/confusing flow ·
> **P1** = inconsistency / below-the-bar polish · **P2** = refinement or feature-tweak suggestion.
>
> **Audit method note:** this pass was a *static* audit (code-level, line-cited). Node.js is not installed on
> this machine, so nothing was executed — every item marked *(verify at runtime)* must be re-checked in a live
> browser (both themes, desktop + mobile) during its execution phase, and the Section 5 QA sweep re-run on every
> screen touched. Line numbers refer to the current commit (`dcdc77d`).

---

## 0. EXECUTIVE SUMMARY

The good news: the Phase 1 color repaint has largely landed. The Black theme sits on true `#000000` with the
approved token values (`--bg/--s1/--s2/--divider/--t1..t3/--accent:#0A84FF/--accent-tint:#DBE9FF` +
correct semantic families), the Light theme uses `#007AFF`/`#1D1D1F` with hairlines, buttons mostly follow the
Apple anatomy, chat wallpapers and story backgrounds are already law-compliant, and typography is Inter with
correct headline weights. The X-style skeleton (hairline feed, word tabs, floating nav) is recognizably there.

The gaps that block launch-readiness:

1. **The Living Light system is ~10% built.** The engine skeleton (rim/boost/opening-lap/idle-drift code) exists
   at `public/index.html:39654-39813`, but by its own comment it is "reserved for AI entry points — currently just
   the home feed's Atwe AI ⋯ tab". There is **no Layer A stage** (mouse pool + grid), `.spin` is on exactly **one**
   element app-wide (no login card, no major boxes), **no AI comets exist at all** (no `.ai-orb`/`aiGlow`/
   `#page-glow` anywhere), no Light-theme AI shimmer, and no reveal-by-light (`data-reveal` count: 0). → §2.
2. **A third theme (Dim) exists** and must be removed (picker card, CSS blocks, THEME_META, prefs). → §1.
3. **Navigation**: the 5 tabs exist in the right order but are icon-only (no word labels) and named
   Chat/Search instead of **Talk/Engine**; ~35 personal-management surfaces live inside the Search/Discover
   page and must migrate to Profile. Routing is fully function-based, so this is low-risk. → §5.
4. **Feature intro sheets do not exist** (0 matches) — the component, the per-user seen registry, and the wiring
   must be built per `docs/atwe-feature-intro.html`. → §6.
5. **Back behavior** is an Android-style close-the-top-thing chain with a pushState exit trap: it never restores
   a previous screen's scroll, has no per-screen URL routing (only profile/circle/group set a path), and two flows
   still use native `confirm()`. → §3.
6. **Color-law violations are few but real**: rainbow HSL circle avatars, off-brand `#0ea5e9` sky-blue across all
   transactional emails + locked/terms/privacy/guidelines pages, red unread dot on the nav, white (not blue)
   login primary button, decorative green (Open-to-Work ring, profile-strength checks) and amber (rating stars). → §1, per-page sections.

Item counts: **7 BUG · 31 P0 · 24 P1 · 15 P2** (excluding the Living Light / intro-sheet build plans, which are
tracked as single P0 programs with acceptance checklists).

---

## 1. GLOBAL — COLOR LAW & THEMES (applies to every page)

### Two themes, not three (brief §2.2)
- [ ] (GLOBAL · P0) A third "Dim" theme exists → remove it entirely → `public/index.html:1055-1060` (menu vars), `:3204-3218` (theme block + sidebar/topbar/bottom-nav overrides), `:3195` (`.theme-swatch.sw-dim`), `:9035` (picker card `data-theme="dim"`), `:15805-15843` (`THEME_PREFS`, `THEME_META.dim`, `applyThemeClasses` `body.dim` toggle), i18n "Dim" label. Migrate saved `localStorage.atwe_theme === 'dim'` → `'black'` on boot. Acceptance: `grep body.dim` and `'dim'` theme literals return 0; picker shows Black · Light · System only.

### Foreign hues (brief §2.1 — "any other hue anywhere is a bug")
- [ ] (GLOBAL · P0) Circle/industry avatars paint full-spectrum rainbow gradients (`hsl(0-360°…)`) → replace `_circleGrad()` with a single law-compliant treatment (flat grey `#48484A` like the default user avatar tint, or `--accent` blue) → `public/index.html:22849-22854` (used at `:20833, :20850, :21772`).
- [ ] (GLOBAL · P0) All transactional emails use sky-cyan `#0ea5e9` as the brand accent and off-palette greys (`#3f3f46`, `#a0a0a8`, code box `#f1f5f9`) → change `ACCENT` to the law blue and re-map text greys to `#8E8E93`/`#6E6E73` → `mailer.js:61,71,75,91,98`.
- [ ] (GLOBAL · P1) `locked.html` uses `#0ea5e9` accent + Tailwind lime-green `rgba(34,197,94)` / light red `rgba(239,68,68)` for code-ok/code-bad → swap to `#0A84FF`, `#30D158`-family, `#FF453A`-family → `public/locked.html:11,48-49`.
- [ ] (GLOBAL · P1) `guidelines.html`, `terms.html`, `privacy.html` define `--accent:#0EA5E9` → `#0A84FF` → `public/guidelines.html:10`, `public/terms.html:10`, `public/privacy.html:10`.
- [ ] (GLOBAL · P1) Verified-badge grey drifts per theme (`#d3d5d7` black / `#dcdcdc` dim / slate-blue `#5b7083` light) → DECIDED (§9.5): keep `#d3d5d7` dark, replace the Light value with a non-blue neutral grey (`#6E6E73`-family); the dim value dies with the Dim theme → `public/index.html:91, :3210, :3231`.
- [ ] (GLOBAL · P2) Legacy alias tokens `--rose`, `--violet`, `--money` (all now remapped to blue/green) invite future drift → after the color phases land, rename call sites to `--accent`/semantic tokens and delete the aliases → `public/index.html:113-125`.

### Green / red / yellow outside their semantic roles
- [ ] (GLOBAL · P1) Bottom-nav unread dot is **red** (`.bn-dot{background:var(--red)}`) — red is destructive/error only; an unread badge is informational → use `--accent` blue (matches the in-list unread badge, which is already blue) → `public/index.html:7730`.
- [ ] (PROFILE · P1) Open-to-Work avatar ring is decorative green → DECIDED (§9.3): blue `--accent` ring, keep the "OPEN TO WORK" label → `public/index.html:7298-7301`.
- [ ] (PROFILE · P1) Profile-strength checklist checkmarks are green for "done" (progress, not success) → `--accent` to match the meter's blue fill → `public/index.html:6805` (meter fill `:6798`).
- [x] (COMMERCE · P1) Review/rating stars fill with warning-amber (`--amber`) — RESOLVED BY DECISION (§9.2): gold stars are an approved exception; no code change → `public/index.html:5125, :5334, :7021`.
- [ ] (GLOBAL · — noted OK) Correct semantic uses verified and to be kept: accept-call green / end-call red (`:7901-7903`), missed-call red (`:6490`), online dot green (`:7830`), offline banner red→green (`:6558-6559`), recording mic red (`:7323`), wallet ledger `--fin-up/--fin-down`, swipe delete red / mark-unread blue (`:6442-6443`), demo & impersonation amber banners (warning).

### Borders in Black theme (brief §2.3 — "light is the only edge")
- [ ] (GLOBAL · P1) Sweep for container borders at rest: most cards comply, but `.ac-post` carries `border:1px solid rgba(255,255,255,.10)` in at least one rule and `.ac-item:active` paints a `1.5px` white border; audit each hit of `grep -n "border:1px\|border: 1px" public/index.html` against the whitelist (inputs, list-separator hairlines, grey/semantic button edges) and delete the rest → `public/index.html:1505, :3605` + full grep list. *(verify at runtime in both themes)*

### Buttons & typography
- [ ] (AUTH · P0) Login/signup primary buttons are **white** (`#loginOverlay .auth-btn-primary{background:#fff;color:#000}` and `.is-loading{background:#fff}`) — DECIDED (§9.4): restyle auth primaries (incl. loading state) to the blue-pill anatomy with `#DBE9FF` text → `public/index.html:300-304, :424-425, :841`.
- [ ] (GLOBAL · — noted OK) `.ac-pill-btn.accent` (solid blue + tint), grey glass secondary (`rgba(255,255,255,.06)` + .5px hairline), hover 1.05 / press .85 + scale .97 / disabled 40% — all present and compliant (`public/index.html:292-304, :806-825`). Typography Inter, headlines 700–800 at −0.03…−0.05em — compliant.

---

## 2. GLOBAL — LIVING LIGHT SYSTEM (Phase 2 brief + v25 reference; Black theme only)

**Current state** (all in `public/index.html`): CSS for `.spin`/`.rim-flood`/`.rim-inner` exists (`:763-796`) and
matches the v25 recipe; the engine (collect, pointermove rim/boost, idle drift, opening lap, melt, MutationObserver
re-collection, reduced-motion static rim) exists (`:39654-39813`); tokens declared without `@property` (`:154-158` —
correct; the one `@property --wave-angle inherits:false` at `:2359` is unrelated to light vars and safe).
Light theme correctly disables `.spin`/floods (`:794-795`).

**Gap list — everything below is missing and constitutes one P0 program:**

- [ ] (GLOBAL · P0) **Layer A stage absent** — no `.stage` element, no dark-indigo mouse pool (`--pgx/--pgy` never set on root; the loop doesn't write them), no faint grid → mount `.stage` per Phase-2 §3 once in the shell, write `--pgx/--pgy` in the rAF loop → engine at `public/index.html:39786-39812` + new CSS.
- [ ] (GLOBAL · P0) **`.spin` coverage ≈ zero** — exactly one element (`#acFeedTabAi`, `:9277`) is marked; the law requires every *major box* on every screen (auth card first, sheets, hero panels, key containers — never chips/rows) → roll out `.spin` markup + `--gr` sizing across screens; the engine already injects floods on collect → markup across `index.html`.
- [ ] (AUTH · P0) **Login/signup card is not a `.spin` box and gets no opening lap** — Phase-2 §7 requires the full system on auth from first paint → mark the auth card `.spin` + `data-glow`, ensure the lap plays when the login overlay is shown → `public/index.html` auth overlay markup (~`:8400-8700` region) + engine.
- [ ] (GLOBAL · P0) **Opening lap plays once per hard page load only** — DECIDED (§9.8): re-trigger the lap on boot + login-screen show + top-level tab switches, capped at once per screen per session; keep per-box stagger → `public/index.html:39773-39812`.
- [ ] (GLOBAL · P0) **AI comets do not exist** — no `.ai-orb` CSS, no `aiGlow` engine, no `#page-glow` fixed frame, no error-state red pulse, no `aria-busy` wiring → port §6 of the Phase-2 brief / v25 verbatim (ES5-ify to match the file), mount `#page-glow` in the shell, implement `aiGlow.start/stream/success/error/stop` with the ≤2-simultaneous rule and offset-path fallback → new code in `index.html`.
- [ ] (GLOBAL · P0) **Light theme has no AI state at all** — the brief requires a subtle blue shimmer border on the working element in Light → add the shimmer class + wire it from the same `aiGlow` call sites → new CSS + engine.
- [ ] (GLOBAL · P0) **No AI operation is instrumented** — nothing calls any glow today; the AI-entry-point inventory with box/page scopes is in §7b below and must be wired thinking → streaming → final lap → gone → all `ac*Ai*` call sites.
- [ ] (GLOBAL · P1) **Button movement flare is partial** — only `.auth-*`, `.ac-pill-btn.accent`, `.auth-input`, `[data-glow]` are collected; grey/semantic buttons app-wide have no `--boost` flare or cursor wash → extend the Phase-2 §2 recipes to the app's real button classes (`.ac-pill-btn` grey/danger, `.btn`-equivalents) and add them to `collect()` → `public/index.html:801-834, :39703-39707`.
- [ ] (GLOBAL · P1) **Reveal-by-light missing** — zero `[data-reveal]` usage → add the CSS + IntersectionObserver from Phase-2 §5 and apply to major sections (respect reduced-motion) → new code.
- [ ] (GLOBAL · P1) **No cleanup cap** — comet engine (once built) must guarantee zero leftover DOM after 50 cycles; MutationObserver re-collect exists but `spins` never prunes detached nodes (slow leak on heavy navigation) → filter `document.contains(el)` on collect → `public/index.html:39703-39725`.

**Acceptance:** the Phase-2 §9 checklist verbatim, on login + one screen per tab, at 60fps on a mid-range phone,
reduced-motion verified, scrolling lights nothing, Light theme shows only the AI shimmer.

---

## 3. GLOBAL — QA SWEEP (Section 5 of the brief)

### Back behavior & routing
- [x] (GLOBAL · BUG) Browser back never restores the previous *screen* — FIXED (Phase 0): `acShow` now pushes the outgoing screen + captured scroll positions onto a `_navStack`; popstate pops and un-hides it (screens are persistent divs), re-applying scroll via a silent `appTab` restore; overlays still unwind first, same-screen swaps fall back to `acScreenBack`, double-back-to-exit kept at root → `acShow`/`navStackPush`/`navStackPop`/`appGoBack` in `public/index.html`.
- [x] (GLOBAL · BUG) No per-screen URL routing — FIXED (Phase 0, groundwork): `/post/:id`, `/job/:id`, `/listing/:id` now parse in `parseDeepLink`, open via `openDeepLink` on boot, and the three openers sync the address bar (`acSetPath`); job/listing overlays clear the path on close; `/ai` already existed; server catch-all + `ogForPath` verified tolerant. Tab-root paths (e.g. /talk, /engine) deliberately deferred to Phase 1 since they encode the new tab names.
- [x] (GLOBAL · BUG) Notification detail reads `AC._notifs[i]` by index — FIXED (Phase 0): the row now passes the notification's stable id and `acOpenNotifDetail` looks it up by id (string-compared), so a refetch between render and tap can never surface the wrong row → `acOpenNotifDetail`/`notifRow` in `public/index.html`.
- [x] (GLOBAL · P0) Two native `confirm()` dialogs remain — FIXED (Phase 0): resume delete (`acResumeDelete`) and group-cloud delete (`acCloudDelete`) now use the branded Promise-based `appConfirm` with title/message/Delete; `grep "confirm('"` and `` confirm(` `` return 0 native uses. (`acCloudRename` still uses native `prompt()` — an input dialog, not a confirm; left for a later polish phase.)
- [ ] (GLOBAL · P1) `navTopOverlay()` can return a stale/closing overlay if back fires in the same tick as a manual close → de-register overlays synchronously on close → `:39625` area.

### Failure/empty/loading states
- [x] (TALK · BUG) Group-invite preview "Loading…" hang — INVALID (verified in Phase 0, no change): both `acOpenJoinInvite` and `acOpenGroupInvite` already repaint the body with a designed error state in their catch blocks (`public/index.html:32405-32473`); the Stage-1 citation pointed at the static placeholder markup, not the loaders. A sweep of every other "Loading…" loader (~16 surfaces: devices, community, newsletters, events, courses, resumes, notif prefs, onboarding, forward sheet…) confirmed each renders a failure state too.
- [x] (PROFILE · P0) Bad profile deep link shows no "not found" state — FIXED (Phase 0): `acLoadProfile` now branches definitive errors (404/410/403) to a new shared `acNotFound` state ("This profile isn't available" + Back to Home) and gives transient errors a real Try-again retry; previously every failure rendered a misleading "check your connection" card with no way out.
- [x] (GLOBAL · P0) No shared not-found surface for bad deep links — FIXED (Phase 0): `acNotFound(el, title, sub)` added beside `acErr` (same `.ac-err` component, no new design) and wired into profile + post detail (`acLoadPostView` 404/410/403 → "This post isn't available"); unknown `/username` paths route through the profile branch, job/listing overlays already show could-not-load states with a close, circle/group misses toast and stay put. *(visual pass at runtime still pending — no Node on this machine)*
- [ ] (GLOBAL · P1) Empty-state sweep: most lists have designed empties, several teach; blocked/muted/muted-words empties have no CTA (`:17014, :17036, :17062`), and the per-feed empties (For You / Following / Collections / Circles) plus search no-results must each teach + one blue pill per brief §4 → audit every list surface during each page phase (checklist in each page section).
- [ ] (COMMERCE · P1) Payment amount inputs stay editable while a payment is in flight (send money `:27118-27128`, checkout `:29353`) → disable inputs during the pending state (buttons are already guarded).

### Console/toasts/PWA/mobile (static results; re-verify at runtime)
- [ ] (GLOBAL · P1) Push `notificationclick` falls back to `/` when `data.url` is missing — audit every `notify()` verb ships a deep link where actionable, and that those links survive the nav restructure → `public/sw.js:38`, `server.js` `sendPushForNotif`.
- [ ] (GLOBAL · P2) `acSecretTick` 1s interval is undocumented → confirm purpose or remove → `public/index.html:38441`.
- [ ] (GLOBAL · — noted OK) No leftover `console.log`; no dead `onclick` handlers found in a 50-handler sample; tap targets ≥40px effective; safe-area insets handled (top scrim, nav pill, FAB); scroll listeners passive; sw.js network-first shell + `/api/` bypass correct; manifest icons/shortcuts complete.
- [ ] (GLOBAL · P0) Zero-console-errors law + both-theme visual verification could **not** be checked statically (no Node on this machine) → first execution phase must start by running the app and sweeping every route in both themes, desktop + mobile viewports.

---

## 4. FEATURE INTRO SHEETS (brief §4 — component does not exist; build to `docs/atwe-feature-intro.html`)

- [ ] (GLOBAL · P0) Build the sheet component: grab handle · animated glyph in rounded square w/ breathing blue halo · 2-3-word title · one lead line · ≤3 staggered icon rows · one blue pill CTA; spring rise (transform/opacity only), app dims+scales behind; dismiss via CTA / swipe-down / backdrop / Escape; never stacks with another modal, max one per session; Black theme runs ~1.5 decelerating Living-Light laps around the sheet edge, Light theme clean, reduced-motion static with faint rim → new component in `public/index.html` (reuse `.sheet` reference CSS).
- [ ] (GLOBAL · P0) Per-user "seen" registry persisted **server-side** (not just localStorage): `user_intro_seen` (user_id, intro_key, seen_at) + `GET/POST /api/intros` (or fold into `users.intros_seen` JSONB); client checks before showing; wire keys: `home`, `talk`, `engine`, `ai`, `profile`, `wallet` → `db.js`, `server.js`, `index.html`.
- [ ] (GLOBAL · P1) Copy is teaching, not marketing (reference copy in `docs/atwe-feature-intro.html` for Engine/Talk/Wallet is approved tone) → draft Home/AI/Profile equivalents for review in that copy register.

---

## 5. NAVIGATION RESTRUCTURE PLAN (brief §3 — pre-approved; plan only in Stage 1)

### 5.1 Current → target tabs
Current markup `public/index.html:9369-9387` (bottom nav), `:9140-9157` (desktop sidebar `snav-*`), `appTab()` at `:19483-19521`.

| Slot | Today | Target | Work |
|---|---|---|---|
| 1 | `bnav-home` "Home" (icon only) | **HOME** | add word label |
| 2 | `bnav-chat` "Chat" | **TALK** | rename everywhere user-facing + label; keep `appTab('chat')` internal id |
| 3 (center) | `bnav-search` "Search" | **ENGINE** | rename + label + strip personal tiles (5.3); design "one powerful input + clean discovery tiles" |
| 4 | `bnav-ai` "Atwe AI" | **ATWE AI** | add word label |
| 5 | `bnav-profile` "Profile" | **PROFILE** | add word label + absorb migrations (5.3) |

- [ ] (NAV · P0) Add visible word labels under all five icons (currently icon-only with `aria-label`); labels via `data-i18n` translatable strings ("Home", "Talk", "Engine", "Atwe AI", "Profile" added to `I18N_DICT` ×14 languages); active state blue; identical in both themes → `:9369-9387, :9140-9157, :15857+`.
- [ ] (NAV · P0) Rename every user-facing "Chat(s)"/"Messages" **tab/section label** to Talk (list to be finalized during execution: nav aria/labels, right-rail "Messages" tile `:9404`, sidebar labels, settings rows, onboarding tips, intro copy). Message-verb copy ("Message @x") stays.
- [ ] (NAV · P0) Rename "Search"/"Explore" surface labels to Engine (nav, right-rail "Search Atwe" `:9396`, placeholders "Search Atwe", sidebar) — the *input* placeholder can stay "Search Atwe…" (Engine is the tab, search is the act).
- [ ] (NAV · P0) Badges per brief: Talk unread badge (exists as `bnavDot` `:9376`, recolor red→blue per §1) **and a Home new-posts indicator (does not exist today)** → add a `bn-dot` to `bnav-home` driven by the feed's new-posts signal (SSE `msg`-equivalent for posts / first-page delta) → `:7730, :9371, :38796`.
- [ ] (NAV · P1) Bottom nav is already a floating rounded bar (`:7690+`) — verify both-theme material after Dim removal.

### 5.2 Mechanics (from the routing map — low risk)
`appTab()` is function-based; no string-keyed navigation. Renames are label/i18n-only. All migrating surfaces
are opened via `acOpen*()` functions and can be re-homed by moving their entry rows. Notification deep links and
DM meta-cards route by function, not location — unaffected.

### 5.3 Migration map — every personal surface out of Engine, into Profile
Discover tiles live in `acSearchDiscover()` `public/index.html:19821-19932`. Target Profile organization
(Apple-Settings-like groups on the Me hub, `#acMeScreen` `:23252-23296`):

**→ Profile · "Money" group:** Wallet `acOpenWallet` · Send money `acOpenSendMoneyByUsername` · Invoices `acOpenInvoices` · Quotes `acOpenQuotes` · Split a bill `acOpenSplits` · Pools (mine) `acOpenPools` · Scheduled payments `acOpenSchedPays` · Rewards `acOpenLoyalty` · Gift cards `acOpenGiftCards` · Atwe Card `acOpenDebitCard` · Payment links `acOpenPayLinks` · Affiliate earnings `acOpenAffiliate` (tiles at `:19903-19920`).

**→ Profile · "Shopping" group:** Orders `acOpenOrders('buyer')` · Cart `acOpenCart` (keep cart badge) · Saved/wishlist `acOpenSaved` · Subscriptions `acOpenSubs` · Addresses `acOpenAddresses` · Bookings (my trips) `acOpenBookings('guest')` (tiles at `:19891-19899`).

**→ Profile · "Selling & business" group (business/seller accounts):** Sell / My listings `acOpenSell` · Sales `acOpenShopAnalytics` · Manage store `acOpenStoreManage` · Advertise `acOpenAdCreate` + Ads Manager `acOpenAds` (merge to one "Ads" row) · Business analytics `acOpenBizAnalytics` · Team `acOpenTeam` · Affiliation badges `acOpenAffiliation` · Post a job `acPostJobOpen`.

**→ Profile · "Work" group:** My resumes `acOpenResumes` · Job preferences / Open to work `acOpenPrefs` · My applications `acOpenJobsView('applied')` · Saved jobs `acOpenJobsView('saved')` · Job alerts `acOpenSavedSearches` · Saved candidates `acOpenSavedCandidates` (some rows already exist in the Me hub `:23274-23284` — dedupe).

**→ Profile · "Planning" group:** Appointments `acOpenAppointments('mine')` · Agenda/calendar `acOpenAgenda` · My events & tickets (Events scope `attending`/`mine`) · Drafts & scheduled posts `acOpenDrafts`/`acOpenScheduledPosts` (today composer-only) · Dashboard `acOpenDashboard` (already in hub).

**→ Profile · "App" group (exists):** Settings, Notifications, Devices, Help, Invite friends `acOpenReferrals`, Get a handle `acOpenClaimHandle`, Log out.

**STAYS in Engine (discovery of the world):** universal search + scopes · Marketplace `acOpenMarketplace` · Shop with AI `acOpenAiShop` · Services & local `acOpenServices` · Business directory `acOpenDirectory` (+ near-me) · Find a job / Find workers `acGoJobsBoard` · Communities · Events (upcoming/discover) · Newsletters (discover) · Showcase discover · Courses (discover) · Trending · Who to follow · Shorts · Circles.

- [ ] (NAV · P0) Execute the map above: rebuild Engine's empty state as pure discovery (input + discovery tiles + trending/suggestions), rebuild the Me hub with the grouped sections; no personal-management feature remains in Engine → `:19821-19932`, `:23252-23296`.
- [ ] (NAV · P0) Profile presentation is Apple-Settings-like: grouped `.me-group` rows (pattern already exists and scales), one hierarchy, not a dumping ground; badge counts (orders to fulfill, unread invoices) on rows where cheap.
- [ ] (NAV · P1) Update every internal link/menu/empty-state/onboarding mention that points into old locations (e.g. empty-wallet CTA in a Discover tile, "Find it in Search" copy, right-rail tiles `:9396-9414`, sidebar scope buttons `:19605-19611`).

### 5.4 Redirect table (nothing may 404 — brief §3 + hard rule 8)
The SPA has few *URLs*; most navigation is in-app. Complete inventory from `handleUrlParams()` `:14093-14180`:

| Link/param | Today | After restructure | Action |
|---|---|---|---|
| `/<username>`, `/circle/<u>`, `/group/<u>`, `?u=` | deep links | unchanged | none |
| `/ai` | AI tab path | unchanged | none |
| `?go=home\|search\|chat\|profile\|call\|contacts\|ai` | tab jump | same targets under new names | keep old values as aliases; add `talk`/`engine` aliases |
| `?verify= ?reset= ?ref= ?aff= ?joingroup= ?pool= ?paylink=` | flows | unchanged | none |
| Stripe returns (`?checkout/boost/promote/ad/tip/ticket/nlsub/creatorsub/invoice/order/pay/topup/cashout`) | toast/flow | unchanged (surfaces move but functions are the same) | none |
| Push/notification deep links | function-routed | retarget to new homes automatically (functions move with surfaces) | verify each verb (§3 push item) |
| Emails | `APP_URL` + params above | unchanged | none |

- [ ] (NAV · P0) Implement `?go=talk` / `?go=engine` aliases (keep `chat`/`search` working forever) and re-verify every push/email deep link post-migration → `:14096`, `sw.js:38`, `server.js` notify/push.

### 5.5 Affected files
`public/index.html` (nav markup, appTab, acSearchDiscover, Me hub, i18n dict, labels/copy), `public/manifest.json`
(shortcuts "Search"→Engine, "Messages"→Talk), `server.js` (push payload URLs if any hardcode `?go=search|chat`),
`public/sw.js` (none expected), i18n dictionaries (in-file).

---

## 6. PAGE-BY-PAGE FINDINGS

### LOGIN / SIGNUP / AUTH
- [ ] (AUTH · P0) Primary buttons are white, not the blue pill (see §1) → `public/index.html:300-304, :424-425, :841`.
- [ ] (AUTH · P0) No opening lap / `.spin` on the auth card (see §2) → auth overlay markup + engine.
- [ ] (AUTH · P1) Desktop auth hero uses *static* ambient blue radial glows (`:235-236, :242` logo drop-shadow) — Phase 2 Layer A forbids constant haze; light must come only from movement/lap/AI → remove the static glows once the Living Light lap covers the auth screen.
- [ ] (AUTH · — noted OK) Colors, frosted secondary buttons w/ hairline, Inter, 800-weight titles, red error text, personal-vs-business first step (`:8665-8676`), skippable 4-step onboarding with no stale tab names (`:8613-8651`) — compliant.
- [ ] (AUTH · P1) Onboarding "done" tips + intro copy must mention the new tab names (Talk/Engine) once renamed; add the five-tab framing to the last step → `:15640-15660`.

### HOME (feed)
- [ ] (HOME · P0) Engagement row icons are **filled** glyphs (`.ac-post-actions svg{fill:currentColor}`) — DECIDED (§9.1): convert the engagement set (views/reply/repost/like/bookmark/share) to the stroke/outline icon language; keep sizes/counts → `public/index.html:4538, :24204-24222` (post-detail row too, `.ac-pf-actions`).
- [ ] (HOME · P0) Desktop feed tabs draw a 3px blue **underline** (`.ac-feedtab.active span::after`) — word-only tabs law → remove underline; bold/white active only (mobile already correct) → `:4381, :1902-1963`.
- [ ] (HOME · P1) Desktop/mobile feed-tab treatments differ (underline vs bold; gap 3px vs 34px) → converge on the mobile X-style treatment at all breakpoints → same lines.
- [ ] (HOME · P2) Desktop chat top-tabs use a pill radius on active (`.tb-feedtab{border-radius:var(--r-pill)}`) → word-only → `:1915-1918`.
- [ ] (HOME · P1) Empty states for For You / Following / Collections / Circles: verify each teaches + one blue pill ("Create your first post" on empty Home per brief §4) *(verify at runtime — strings not all reachable statically)* → feed render fns.
- [ ] (HOME · P0) New-posts indicator on the Home tab missing (see §5.1).
- [ ] (HOME · P2) Story ring "unseen" gradient uses the three legacy tokens (all now blue) — visually fine; simplify to one accent gradient and drop the alias tokens → `:4847`.
- [ ] (HOME · P2) Promoted-post "Ad" label legibility pass (clear but subtle; keep X-style quiet label) → `:5608, :24178`.
- [ ] (HOME · — noted OK) Hairline dividers between posts, full-bleed rows on the correct gutter, full-width rounded media (16px) + mosaic grid, one `vbadge` treatment, who-to-follow carousel borderless — compliant.

### TALK (today "Chat")
- [ ] (TALK · BUG) Group-invite preview can hang on "Loading…" forever (see §3) → `:10430, :10438`.
- [ ] (TALK · P0) Sent-bubble "unseen" delivery animation flips the bubble to white (`--accent-tint` bg + black text) before settling blue — a color-state that reads as a different message type → animate opacity/transform only, bubble stays blue → `:3435-3441`.
- [ ] (TALK · P1) Muted-chat unread badge uses text-grey fills (`--t4`/`--t3`) as badge background — poor contrast and off-role token → use a muted-opacity accent badge → `:3933, :3937`.
- [ ] (TALK · P1) Unread rows double-signal (blue badge + blue bold timestamp) → keep the badge, return the timestamp to `--t3` → `:6484-6485`.
- [ ] (TALK · P1) Draft indicator on chat rows is **red** "Draft:" — red = destructive only → grey or accent → chat-list row renderer.
- [ ] (TALK · P1) Empty states (no chats / calls / contacts / starred): verify teach + blue pill ("Start a conversation… invite contacts" per brief §4) *(verify at runtime)*.
- [ ] (TALK · P2) Cloud tool icons are all identical blue tiles — fine by law; consider subtle glyph differentiation only if usability demands (no new hues) → `:1578-1620`.
- [ ] (TALK · — noted OK) Wallpaper presets (`_CHAT_THEMES` `:34355-34365`) and story text-status backgrounds (`_STORY_BGS` `:32449-32456`) are fully law-compliant (blue/grey/black only); call UI green/red semantics correct; swipe actions correct; passcode pad matches the native-passcode law.

### ENGINE (today "Search")
- [ ] (ENGINE · P0) Execute §5.3: strip all personal-management tiles; Engine becomes one powerful input + clean discovery tiles + trending/suggestions → `:19821-19932`.
- [ ] (ENGINE · P0) Search results "no results" state must teach + offer a way back to discovery (currently none found statically) *(verify at runtime)* → `acDoSearch` render paths.
- [ ] (ENGINE · P1) "Chats" scope inside the discovery surface searches your private messages — DECIDED (§9.9): drop the scope from Engine; message-content search lives in Talk's own search only → `:19788`.
- [ ] (ENGINE · P1) `.xp-ai` "Ask Atwe AI" hero gradient: verify Light-theme legibility (no glow effects in Light) → `:6867-6881`.
- [ ] (ENGINE · P1) Icon language: Explore tiles are stroke icons, engagement rows filled — resolve via the HOME icon decision so the app has one icon grammar → `:6895` vs `:4538`.
- [ ] (ENGINE · P2) 20+ same-size tiles have no hierarchy — after the migration prune (which removes most), order rows by usage and keep the AI hero dominant → `:19870-19926`.
- [ ] (ENGINE · — noted OK) Scope tabs are word-only w/ left-edge fade and correct active treatment.

### ATWE AI (tab + touchpoints)
- [ ] (AI · P0) No comet/shimmer system exists — the entire §2 program applies here first (box scope on the answer card, page scope for whole-chat jobs). Current interim state (animated logo-mark "thinking" + word-typewriter streaming) is compliant as visible-thinking but must be upgraded → `:2150-2160, :16402`.
- [ ] (AI · P1) Thinking vs streaming are visually identical (same spinning mark) → comets solve this (thinking → streaming ×1.5); until then acceptable.
- [ ] (AI · P1) Guest mode: verify guests who tap Home/Talk/Engine/Profile get teaching sign-in states, not blank screens *(verify at runtime)* → `appTab` auth gate `:19483+`.
- [ ] (AI · P2) Composer icon buttons (`#plusBtn` title-only, `#micBtn` title-only) lack aria-labels → add → `:9333-9342`.
- [ ] (AI · — noted OK) Brand safety verified (no Claude/Anthropic in UI or prompts); model "selector" is a read-only settings label, not clutter; error messages branded; every AI operation has context-appropriate loading feedback.

**AI entry-point inventory (comet scopes for Phase 3 wiring):**
| Operation | Route | UI fn | Scope |
|---|---|---|---|
| Main AI chat | `/api/chat` | `sendMessage` `:16289` | box (answer bubble); page for "summarize chat" |
| Writing assistant (post/chat/profile/product/selection) | `/api/ai/write` | `acComposeAi` / `acChatAi` / `acProfileAi` / `acProdDescAi` / `acSelAiAct` | box |
| Catch me up | `/api/ai/digest` | `acFeedAiPick('catchup')` | page |
| Show me what matters | `/api/ai/for-you` | `acFeedAiPick('matters')` | page |
| Job/worker matchmaker | `/api/ai/jobmatch` | `acJobMatch` / `acCandidateMatch` | page |
| Resume builder | `/api/ai/resume` | `acOpenAiResume` | page |
| Interview prep | `/api/jobs/:id/interview-prep` | `acInterviewPrepOpen` | box |
| Rank applicants | `/api/jobs/:id/rank-applicants` | `acRankApplicants` | page |
| AI cover note | `/api/jobs/:id/ai-cover` | `acAiCover` | box |
| Alt text | `/api/ai/alt-text` | `acGenAltText` | box |
| CS answer draft | `/api/ai/cs-answer` | `acQaSuggest` | box |
| Shopping concierge | `/api/ai/shop` | `acRunAiShop` | box (result list) |
| Cloud checklists | `/api/…/cloud/ai-checklist` | `acCloudAiChecklist` | box |
| Translate post / message | `/api/social/posts/:id/translate`, write task | `acTranslatePost` / `acMsgTranslate` | box |
| Agentic "do it for me" | `/api/ai/agent` | `acAgentGo` | page |
| Skill assessment gen | `/api/skills/:id/assessment` | `acStartAssessment` | box |
| Transcribe voice note | `/api/atchat/transcribe` | `acMsgTranscribe` | box |

### PROFILE / ME HUB / SETTINGS
- [ ] (PROFILE · P0) Execute §5.3 migration + Apple-Settings grouping (Money / Shopping / Selling & business / Work / Planning / App) → `:23252-23296`.
- [ ] (PROFILE · P0) Profile-not-found state (see §3).
- [ ] (PROFILE · P1) Open-to-Work green ring + profile-strength green checks (see §1).
- [ ] (SETTINGS · P0) Theme picker: remove the Dim card (see §1) → `:9035`.
- [ ] (SETTINGS · — noted OK) iOS-hub structure, page-bg hairlines, blue `.ios-switch`, floating frosted search pill, GPU push/pop honoring reduced-motion, me-hero gradient (dark surface tones — compliant), trust chip greys — all compliant.
- [ ] (PROFILE · P2) Blocked / muted / muted-words empties lack CTAs (see §3) → `:17014-17062`.

### WALLET & MONEY (migrating into Profile)
- [ ] (WALLET · P1) Empty wallet must teach (explain add-funds and getting-paid + blue pill) per brief §4 *(verify at runtime — no empty-state string found statically)* → `acOpenWallet` render.
- [ ] (WALLET · P2) Balance-card gradient is `--accent`→`--violet` (both blue — compliant) — DECIDED (§9.11): keep the blue gradient signature card; during alias cleanup replace `--violet` with an intentional two-stop blue gradient token → `:4660-4665`.
- [ ] (WALLET · — noted OK) Ledger green-in/red-out is semantic finance signaling; pots progress bars blue; gift-card flip material near-black; send/top-up flows have pending guards + client idempotency. *(Amount-input disable item in §3.)*

### COMMERCE (listing → checkout → orders)
- [ ] (COMMERCE · P1) Listing detail shows several actions at once (Buy now + Add to cart + protection + offer + Subscribe & Save…) — brief: one clear primary, secondary behind menus/sheets → keep "Buy now" primary + "Add to cart" secondary, fold the rest into the sheet/⋯ per listing type → `:27522-27557` + `acRenderListingBuy`.
- [x] (COMMERCE · P1) Rating stars amber — RESOLVED BY DECISION (§9.2): gold stays; no change (see §1).
- [ ] (COMMERCE · P1) Checkout `acCheckoutPay` double-submit: button guard exists; add input disabling + an explicit in-flight flag *(verify at runtime)* → `:30770+`.
- [ ] (COMMERCE · P1) Empty states sweep: orders (buyer+seller), my listings, saved, subscriptions — most teach; confirm CTAs land post-migration.
- [ ] (COMMERCE · — noted OK) Order status timeline blue/grey (correct), address book + floating-label forms compliant, escrow shield styling fine, destructive actions confirm via `appConfirm` (except the two §3 native confirms).

### ADMIN (admin.html)
- [ ] (ADMIN · P1) Activity-feed / moderation category color-coding: category classes render with no per-category CSS in places (`.act-<category>`); where colors exist they must be semantic-only → audit + define the category → color map once (blue info / green positive / red destructive / amber warning) → `public/admin.html:261, :2057, :2120, :1938`.
- [ ] (ADMIN · P1) Action buttons lack disabled-while-pending on moderation/user-status/refund actions (double-click risk; server guards exist) → add busy flags → `admin.html:2512-2514` + siblings.
- [ ] (ADMIN · P1) Silent failures: several fetch handlers show nothing on error → toast every failed action → `admin.html:1507, :3243` + sweep.
- [ ] (ADMIN · P2) `.jdot.grey` uses text token `--t3` as a status dot → dedicated neutral grey → `admin.html:401`.
- [ ] (ADMIN · P2) `.mod-sev.medium` and `.low` both amber → differentiate (blue/neutral for low) or document → `admin.html:290`.
- [x] (ADMIN · Q) Admin is dark-only (no Light theme) — RESOLVED BY DECISION (§9.6): admin is exempt, dark-only by design; document the exemption in CLAUDE.md during the Admin phase.
- [ ] (ADMIN · — noted OK) Palette otherwise on-law (#0A84FF accent, correct surfaces/hairlines/typography); no dead onclicks found.

### EMAILS & AUX PAGES
- [ ] (EMAIL · P0) Order-confirmation and order-shipped emails are raw unbranded HTML (no Atwe header/wrapper) while auth emails use the branded template → wrap all transactional mail in the shared brand template → `server.js:15346-15363`, `mailer.js` `brand()`.
- [ ] (EMAIL · P0) Email accent `#0ea5e9` + off-palette greys, and the template's dark base — DECIDED (§9.7): rebuild the shared template on a **light base** (white bg, `#1D1D1F`/`#6E6E73` text, `#0A84FF` accent/CTAs, Atwe header + footer); this supersedes the dark-header `prefers-color-scheme` idea → `mailer.js:61-98` (dark header `:84`).
- [ ] (AUX · P1) locked/terms/privacy/guidelines accent + locked's wrong green/red (see §1).

### PWA
- [ ] (PWA · P1) Manifest shortcuts say "Search" / "Messages" → rename to Engine / Talk with the restructure → `public/manifest.json`.
- [ ] (PWA · P1) Push deep-link audit post-restructure (see §3) → `sw.js:38`, `server.js`.
- [ ] (PWA · — noted OK) Network-first shell, `/api/` bypass, cache versioning, icons, safe-areas, offline banner.

---

## 7. REMOVE CANDIDATES — **APPROVED by Yiddi, 2026-07-06** (items 1–6 approved for removal; item 7 was a keep-recommendation and stays)

1. **Dim theme** (pre-approved by the brief; tracked as P0 in §1).
2. **"Chats" scope in Engine search** — message search belongs to Talk (§ENGINE item).
3. **Duplicate Discover tiles** after migration: "Advertise" + "Ads Manager" → one **Ads** row; "Sell" + "Sales" → one **Store** row (Manage store already aggregates Products/Coupons/Orders/Analytics); "Appointments" + "Agenda" → one **Calendar** row with appointments inside.
4. **Legacy alias tokens** `--rose/--violet/--money` after call-site cleanup (§1).
5. **Static auth-hero blue glows** once the Living Light lap owns the auth screen (§AUTH).
6. **`acSecretTick`** if it turns out to be dead code (§3).
7. *(Question, not proposal)* the cosmetic "Atwe Standard/Advanced" model label — it's one read-only settings line; suggest keeping until real tiers exist.

## 8. ADD / TWEAK IDEAS (suggestions only — not scheduled)

1. **URL routing for major screens** (`/post/:id`, `/job/:id`, `/listing/:id`) — makes refresh/share/back solid and unlocks OG previews for posts/listings/jobs via the existing `ogForPath`.
2. **Home new-posts pill** ("↑ New posts") in addition to the tab dot — X-style, tap to scroll-top-and-refresh.
3. **Per-row badge counts in Profile groups** (orders to fulfill, invoices to pay, applications moving) so Profile reads like a live dashboard, feeding from `GET /api/dashboard`.
4. **Engine zero-state "what can I find?" showcase** — 3-4 rotating example queries as tappable chips (uses existing recent-searches UI patterns).
5. **A `docs/DESIGN-TOKENS.md`** one-pager generated from the final token block, to keep future work on-law.
6. **Global grep CI check** (a tiny npm script) that fails on hex colors outside the approved list — enforcement for hard rule 3.

## 9. DECISIONS — answered by Yiddi, 2026-07-06 (LAW for every phase; supersedes the open questions)

1. **Engagement icons → OUTLINE.** Convert the engagement row (and post-detail row) to the stroke icon language.
2. **Rating stars → KEEP GOLD** — recorded as an approved color-law exception (amber `--amber` fill on stars only).
3. **Open-to-Work ring → BLUE** (`--accent`), keep the "OPEN TO WORK" label.
4. **Auth primary buttons → ~~BLUE~~ WHITE.** ⚠️ **SUPERSEDED (2026-07, by Yiddi) — see the Design Blueprint "Complete Edition".** The blueprint's Law 2 ("white acts, blue identifies") makes the ONE primary action per screen a **WHITE** pill (`#FFFFFF` fill, `#1D1D1F` label; Light theme `#111114`/white); this **explicitly supersedes decision 9.4** ("Log in, Post, Buy now, Pay, Send, Join are all white"). Blue (`--accent`) is now reserved for identity only. The codebase already follows this via the `--primary`/`--on-primary` tokens on `.auth-btn-primary`/`.ac-pill-btn.accent`/`.ac-post-btn`/`.ac-follow-btn`. So Phase 2 must **keep auth buttons WHITE**, not revert them to blue.
5. **Verified badge on Light → NEUTRAL GREY** (replace slate-blue `#5b7083` with a non-blue neutral).
6. **Admin back-office → DARK-ONLY, exempt** from the Light-theme requirement (by design; document in CLAUDE.md).
7. **Transactional emails → LIGHT BASE** — redesign the shared template on white with `#1D1D1F`/`#6E6E73` text and `#0A84FF` accents.
8. **Opening lap policy → boot + login screen + top-level tab switches, capped at once per screen per session.**
9. **Message search → TALK.** Remove the "Chats" scope from Engine; global message-content search lives in Talk's search only.
10. **Atwe Pro surfaces → LEAVE AS-IS** (out of scope for this project).
11. **Wallet balance card → KEEP the blue gradient** signature card (tonal blues, law-compliant).
12. **Repost + like active color → BOTH BLUE**, confirmed as intended.

> §7 Remove Candidates: **items 1–6 approved for removal** (item 7 was a keep-recommendation, not a removal — the cosmetic model label stays).
> §10 Phase Plan: **approved in full.** Each phase still starts only on an explicit per-phase "go".

## 10. PHASE PLAN — **APPROVED IN FULL by Yiddi, 2026-07-06** (execute one at a time, each independently reviewable; each phase starts only on an explicit "go")

| Phase | Scope | Contents |
|---|---|---|
| **0** | **All BUGs** | Back-stack/scroll restore + URL routing groundwork, notification stale-index, group-invite hang, native `confirm()` ×2, profile/deep-link not-found states, runtime console-error sweep (first live run, both themes) |
| **1** | **Navigation restructure (§5)** | Tab renames + word labels + i18n, badges (Talk blue unread, Home new-posts), Discover→Profile migration + Apple-Settings grouping, Engine cleanup, `?go=` aliases, manifest shortcuts, link/copy sweep, redirect verification |
| **2** | **Global tokens & themes** | Dim removal, rainbow circle avatars, email light-base rebuild + branding (§9.7), aux-page colors, nav dot color, border sweep, auth buttons → blue (§9.4), OTW ring → blue (§9.3), Light verified badge → neutral grey (§9.5), alias-token cleanup |
| **3** | **Living Light (§2)** | Stage layer, `.spin` rollout + opening-lap policy, button flares, reveal-by-light, AI comets (box/page per §6 inventory) + Light-theme AI shimmer, reduced-motion, 60fps verification |
| **4** | **Feature intro sheets (§4)** ✅ | Component + server-side seen registry + wiring (Beam · Circles · Atwe AI · Wallet) + copy |
| **5** | **Home** | Outline icons (§9.1), tab treatment convergence, empty-state teaching, stories polish, ad label |
| **6** | **Talk** | Bubble delivery animation, unread/muted badges, draft label, empty states, thread polish |
| **7** | **Engine** | Discovery zero-state design, no-results teaching, icon grammar, tile hierarchy |
| **8** | **Atwe AI** | Comet wiring verification on every entry point, guest-mode teaching states, composer labels |
| **9** | **Profile + migrated surfaces** | Deep polish of every migrated surface in its new home, wallet empty state, per-row badges |
| **10** | **Commerce flows** | Listing action hierarchy, checkout hardening, empty states, seller surfaces (stars stay gold per §9.2 — no change) |
| **11** | **Admin** | Category color map, busy states, error toasts (dark-only confirmed per §9.6 — document in CLAUDE.md) |
| **12** | **Final QA sweep** | Full Section-5 sweep on every route, both themes, desktop + mobile, PWA + push deep links, DoD checklist (brief §8) |

> Phases 5-11 re-run the Section 5 QA checks on every screen they touch and produce before/after screenshots in both themes, per the brief.

---
*Stage 1 complete and reviewed (2026-07-06): all §9 questions answered, §7 removals and the §10 phase plan approved in full; nothing was rejected. Two items resolved by decision with no code change (gold stars, admin dark-only).*

*Phase 0 executed (2026-07-06): back-stack + scroll restore · post/job/listing deep-link URLs · notification stable-id lookup · two native confirm() dialogs → appConfirm · shared not-found states (profile + post). The group-invite hang was verified INVALID (loaders already handle errors). All inline script blocks syntax-checked via JavaScriptCore. NOT yet done from Phase 0: the live console-error sweep in both themes — Node.js is not installed on this machine, so no runtime run was possible; it must open the next phase that has a runtime available. Awaiting review + the "go" for Phase 1.*

*Phase 2 executed (2026-07-08, deployed): rogue-color purge (#0ea5e9 everywhere → law blue; aux pages → pure-black + law text greys; emails → light-base per §9.7), rainbow circle avatars → flat --s2 + blue glyph, nav dot red→blue, OTW ring/label green→blue (§9.3), profile-strength check green→blue, Light verified badge → neutral grey #6E6E73 (§9.5). §9.4 recorded as SUPERSEDED — auth primaries stay WHITE per the Design Blueprint. Dim confirmed fully removed; admin dark-only. Live-verified both themes, 0 console errors (this also closes Phase 0's outstanding runtime sweep).*

*Phase 3 executed (2026-07-08, local — not yet published): the Living Light system per blueprint §05. Layer A cursor pool (#page-glow fixed stage, --pool radial, 12% peak, 420px radius, smoothed follow; touch = under finger during drag only) · Layer B bulb rim (2.5px twin-geometry ring as a lazily-rigged child span on cards/inputs/sheets, lights on hover, ~3.5s melt) · Layer C opening lap (~2.5 decelerating laps / 3.6s around the viewport on boot + each tab's first open, once per screen per session, then melt) · Layer D button flares (white primary hover .97 + rim hint, press .92 + scale .97; grey/semantic hover 1.05; disabled 40% no light) · Layer E AI comets (3 comets orbit the answer container at ~160px/s ONLY while Atwe AI works → one final lap → gone; Light theme = travelling blue shimmer; wired to the AI chat pending bubble + the shared AI result card). Engineering rules honored: light vars stay plain (no @property inherits:false), zero scroll listeners, transform/opacity only, reduced-motion → laps/comets replaced by a static soft-glow fade. Owner tweak folded in: press/tap flash softened ~60-65% (alphas .55/.35→.20/.13, peak .85; accent-pill press energy 1→.4) — hover/movement/idle light untouched. All layers live-verified (dark, light, reduced-motion, real AI-chat round-trip), 0 console errors.*

*Phase 4 executed (2026-07-08): **feature-intro sheets** — a one-time Apple-style welcome card shown the FIRST time an account enters each of the four worlds (**Beam · Circles · Atwe AI · Wallet**). Server-side seen registry: `users.intro_seen` JSONB (idempotent jsonb-append via `POST /api/intro-seen`, exposed on `publicUser.introSeen`), mirrored in `localStorage.atwe_intro_seen` so a dismissed sheet never re-shows across sessions/devices/reinstalls even before the server round-trips. Component: `#introSheet` overlay (rises from the bottom via the shared `sheetUp` keyframe, near-black `--s1` surface / light-panel in Light, 28px top radius, 36×5 grab handle, 84px glyph disc with a blue identity halo, 22/700 title, subtitle, exactly 3 benefit rows [blue dot + bold headline + caption], full-width WHITE-primary CTA). Blue is identity-only (glyph halo + benefit dots); everything else is neutral. Appear "lap" reuses the Phase-3 `.spin` bulb-rim driven by `introLap()` — scoped to the card, NOT the removed global opening lap. Trigger: `_introSoon(id)` fires from each world's entry (`acGoMessages`/`acSetFeed('circles')`/`appTab('ai')`/`acOpenWallet`) → `maybeIntro(id)` self-gates on `_introReady` (armed 1.5s after boot/login lands, so a restored/deep-linked tab never auto-pops), signed-in-with-username, onboarding-done, a BLOCKERS list (login/signup/onboarding/app-lock/plans/splash), and the seen registry; one sheet at a time (queues to the next visit, never stacks). Dismiss (button / scrim tap / drag-down) writes seen immediately (local cache first, then server, retry-on-fail). Reduced-motion → fade, no rim lap; RTL-mirrored; `role=dialog`+`aria-modal`+`aria-labelledby`, CTA focus + 48px target. Verified with a deterministic Playwright pass (38/38): all four titles/copy/3-benefits, dialog a11y, CTA focus + ≥44pt, once-only via the real `maybeIntro` gate, not-ready + open-blocker suppression, dark + light card surfaces, reduced-motion `--rim=0`, RTL right-alignment, 0 console errors. Extensible — a new sheet is one `INTRO_SHEETS` entry + one `_introSoon` call. SW → v956.*

*Phase 4 refinement (2026-07-08, by Yiddi): the intro sheet is now a **floating rounded card**, not a bottom-anchored sheet — grab handle removed entirely; all four corners rounded equally at **30px** (matching the pill CTA's roundness); inset **16px** left/right/bottom (+ safe-area) so it floats above the dimmed backdrop. The padding rule is scoped `.overlay.intro-overlay` so it wins over the base `.overlay{padding:20px}`. Shared style — all four sheets (and any future one) render identically. Everything else unchanged (glyph+halo, title/subtitle, 3 benefit rows, white CTA, sheetUp appear, bulb-rim lap, both themes, reduced-motion, RTL, a11y). Re-verified: 30px×4 corners, 16px×3 insets, no handle, 0 console errors, dark + light. SW → v957.*

*Phase 3 adjustment (2026-07-08, by Yiddi): **Layer C — the opening lap — removed entirely** (the viewport lap orb, its per-session seen registry, the appTab wrapper that fired it, AND the older engine boot-lap on `.spin` elements). No light plays on its own at boot, login, or a tab's first open; every remaining layer is pointer- or AI-driven only (pool, rim, flares, comets — all verified intact after removal). This supersedes §9.8's opening-lap policy.*
