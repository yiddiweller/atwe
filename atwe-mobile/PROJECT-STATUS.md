# Atwe iOS — Project Status & Resume Point

_A living checkpoint so work can resume seamlessly. Update it as phases land._

> **Resume trigger:** when the founder says **"continue with the app"**, read this
> file top-to-bottom and continue from **Next up** — same phased, hand-held,
> one-step-at-a-time style. (Also registered in the repo's `CLAUDE.md`.)

## Where we are (current)

- **App:** `atwe-mobile/` — native iOS (and Android) client, **Expo SDK 54 +
  TypeScript + Expo Router**, talking directly to the existing Atwe backend
  (Express + Postgres on Railway). No backend changes.
- **Verified on a real iPhone** via Expo Go (SDK 54, tunnel mode): five-world
  navigation, theming, and **real login against the live backend** all run.
- **Delivery today:** dev preview via `npx expo start --tunnel` + Expo Go
  (needs the Mac running). TestFlight (Mac-free) comes after Apple approval.

### Built so far
- **Phase 0 — Foundation:** design tokens ported from the web CSS (Black/Light,
  "white acts, blue identifies", silver verified seal); ThemeProvider; typed
  REST client (`src/api/client.ts`) + reconnect-safe SSE (`src/api/sse.ts`);
  Keychain auth + 2FA challenge (`src/auth/*`); five-world tab bar
  (Home · Beam · Engine · Atwe AI · Profile) with blur + haptics; real login;
  real Profile screen (live account).
- **Phase 1 — real Home feed:** `app/(tabs)/index.tsx` +
  `src/components/PostCard.tsx` over `GET /api/social/feed` (For You / Following),
  X-style cards (avatar/verified/business shape, media, interactive like,
  locked/promoted states), pull-to-refresh, loading/empty/error states.
- **Phase 1 — interactive Home:** tappable cards → **post detail** with replies
  (`app/post/[id].tsx`, `GET /api/social/posts/:id`) + a docked **reply bar**;
  a **composer** modal (`app/compose.tsx`, `POST /api/social/posts`) with the
  white Post pill; the **compose FAB** on Home. `usePost`/`createPost` in
  `src/api/social.ts`; routes registered in `app/_layout.tsx`.
- **Phase 1 — tap-into-profiles:** tapping a person's avatar or name anywhere in
  the feed (or post detail) opens their **X-style profile** (`app/user/[username].tsx`,
  `GET /api/social/profile/:username`): banner, overlapping avatar, verified seal,
  @handle, headline/bio, location · Joined, Following/Followers/Posts counts, an
  optimistic **Follow** button, and their post timeline (reuses `PostCard`).
  `useProfile`/`followUser` + `Profile` type in `src/api/social.ts`; `monthYear`
  in `src/lib/format.ts`; route registered in `app/_layout.tsx`; `PostCard` avatar
  + name are now `goProfile` pressables. (Ships in the next TestFlight build.)
- **Phase 6 (started) — Wallet / money + Me hub:** `app/wallet.tsx`
  (`GET /api/wallet`) — an accent balance card + peer-to-peer transaction history
  (signed amounts, peer avatars, green for incoming), with **Send money**
  (`app/wallet-send.tsx` → `POST /api/wallet/send`, clientId-idempotent, server-side
  $1–2k / velocity / block enforcement, green-tick success). `src/api/wallet.ts`
  (`useWallet`/`sendMoney` + `money`/`txLabel`). The **Profile** tab now has a
  quick-links group (Wallet w/ live balance + Notifications) → the start of the
  Me hub. Add-money / cash-out / pots / requests / the full Me-hub grid come next.
- **Phase 2 — Notifications:** `app/notifications.tsx` (`GET /api/notifications`) —
  X-style rows (actor avatar + verified seal + human sentence + time), unread rows
  accent-tinted, marks-all-read on open, taps deep-link to the post / profile /
  chat; the `login` security row shows a shield. Reached via a **bell** in the Home
  header with a live **unread badge** (`GET /api/notifications/count`, `useNotifCount`,
  30s poll). `src/api/notifications.ts` (`useNotifications`/`useNotifCount`/
  `markAllNotificationsRead` + `notifText` verb map); route registered.
- **Phase 5 (started) — Atwe AI:** `app/(tabs)/ai.tsx` is real (was a placeholder) —
  a working assistant chat over `POST /api/chat`: an intro hero with example
  prompts, user/assistant bubbles, a "thinking…" indicator, and a composer that
  sends the running conversation and renders the reply. `src/api/ai.ts`
  (`sendChat` + `ChatMessage`). In-memory for now; saved chat history, the agentic
  action-cards (`/api/ai/agent`) and streaming come in later slices.
- **Phase 3 (started) — Beam / messaging:** `app/(tabs)/beam.tsx` is real (was a
  placeholder) — the live **conversation list** (`GET /api/atchat/conversations`:
  avatar, name, last-message preview, time, unread badge). Tapping a row opens
  **`app/chat/[peer].tsx`** — a working 1:1 DM thread (`GET /api/atchat/with/:id`
  polled every 5s; iMessage-style bubbles, mine=accent/right, theirs=grey/left)
  with an optimistic **send** (`POST /api/atchat/with/:id`, clientId-idempotent).
  Profiles now have a **Message** button (→ `/chat/:id`) so you can start a chat.
  `src/api/beam.ts` (`useConversations`/`useThread`/`sendDm` + `conversationPreview`);
  route registered. Later slices: realtime SSE, groups, calls, media/voice, the rich
  composer, chat requests, typing/read receipts.
- **Phase 4 (started) — Engine / Explore:** `app/(tabs)/engine.tsx` is now real
  (was a placeholder) — a live **Explore** surface mirroring the web
  `acSearchDiscover`: **Trending** hashtags (`GET /api/social/trending`) + a
  **Who to follow** list (`GET /api/social/suggestions`) with optimistic Follow
  pills and tap-through to profiles. `useTrending`/`useSuggestions` + `Trend`/
  `SuggestUser` types in `src/api/social.ts`. Now has a **search field** →
  `GET /api/search?scope=people` (debounced, `useSearchPeople`/`SearchUser`),
  showing tap-through people results; empty query falls back to Explore. Next
  Engine slices: more search scopes (shop / jobs / posts) + the marketplace.
- **Phase 1 — stories:** a horizontal **stories tray** across the top of Home
  (`src/components/StoriesTray.tsx`, `GET /api/stories` → accent ring = unseen,
  muted ring = seen) + a full-screen **story viewer** (`app/story/[userId].tsx`,
  `GET /api/stories/:userId`): segmented progress bars, 5s auto-advance, tap-right/
  left to skip, marks each seen (`POST /api/stories/:id/view`). Image + text render
  fully; **video shows a placeholder** until a native player (expo-video) is wired
  — the one deliberate gap. Hooks in `src/api/stories.ts`; tray is the Home
  FlatList `ListHeaderComponent`; route registered. (Ships in the next build.)

## Recently added (native, latest run)
- **Real Liquid Glass tab bar** via Expo Router native tabs
  (`expo-router/unstable-native-tabs` → real iOS `UITabBar`) — the authentic
  Apple material, not a BlurView fake. Nav icons ship as @1x/@2x/@3x density
  variants (26/52/78px white templates) so they render crisp at ~26pt.
- **Pure `#000000`** background across theme + splash + adaptive icon.
- **Animated opening splash** (`src/components/AnimatedSplash.tsx`): a small
  centered Atwe mark that fades in, gently "breathes", then dissolves to the app —
  handed off seamlessly from the native splash. Wired in `app/_layout.tsx`.
- **Me hub (Profile tab):** rebuilt from the foundation stub into the web
  `acGoProfileHub` — an account hero card (→ own profile) + grouped rounded rows
  with blue-tint icon discs (Account · Money [Wallet w/ live balance · Send money]
  · App [Notifications · Settings]).
- **Settings screen** (`app/settings.tsx`): iOS-Settings-style — Appearance theme
  picker (Black/Light/System, live), account facts, Sign out.
- **Marketplace (Engine):** `app/marketplace.tsx` (`GET /api/marketplace`) — search
  + kind tabs (All/Goods/Digital/Services/Rentals) + post-style `ListingCard`s;
  `app/listing/[id].tsx` detail (gallery, price, rating, seller, save-to-wishlist,
  Message-seller CTA, Visit-store, more-from-seller). `src/api/marketplace.ts`
  (`useMarketplace`/`useListing`/`saveListing` + `listingPrice`). A **Discover →
  Marketplace** tile now leads the Engine Explore surface. Full in-app checkout
  (address + wallet/escrow) is a later slice.
- **Auto-ship pipeline:** pushes to the working branch now trigger an EAS Workflow
  build + TestFlight submit automatically — the founder just taps **Update** (no
  Mac, no manual `eas build`).

## Recently added (native, prior run)
- **Post actions complete:** repost + bookmark are now interactive on every card
  (optimistic, revert-on-error) alongside like (`repostPost`/`bookmarkPost`).
- **Infinite Home feed:** `useInfiniteFeed` (seen-based paging) + `onEndReached`
  load-more with a footer spinner, de-duped across batches.
- **Liquid Glass tab bar:** floating frosted pill (`GlassTabBar`) with active accent
  chip + the exact web nav glyphs. **Real Atwe app icon** from brand assets.
- **Perf (backend, deployed to prod main):** gzip the JSON API (was skipping all
  `/api/*`) except the SSE stream — cuts feed transfer ~30-60% on web + native.

## Recently added (this run — phases 1, 2, 5 and native push COMPLETE)
- **Making an account on the phone** (`app/(auth)/signup.tsx`): the web's
  page-by-page shape — personal-or-business FIRST (it changes what "your name"
  means), then name + handle with the rules checked as you type, then email +
  password. `signup()` in `AuthProvider`; linked both ways with login.
- **Native push, end to end** (`src/api/push.ts`): asks 2.5s AFTER sign-in (never
  on first launch — a prompt before somebody knows what the app is gets refused),
  registers the Expo token through `POST /api/push/subscribe`, sets the Android
  channel, and handles a tapped notification by routing to what it is about.
  **Backend:** `push.js` now tells a phone token from a browser subscription and
  sends via Expo (which holds the Apple/Google certs, so no VAPID needed);
  `pushToUser` decides PER SUBSCRIPTION — it used to bail entirely when VAPID was
  unset, which would have meant no push to the app at all.
- **Links from outside** (`src/lib/deeplinks.ts`): `atwe://` and
  `https://atwe.com/...` both resolve to the right screen, including a bare
  `/<handle>` as a profile. Handled when the app is running AND when a link
  launched it. **The site now serves the association files** Apple and Google
  fetch to confirm the app owns the domain (`public/.well-known/*`, routed ABOVE
  express.static — static was serving Apple's extension-less file as
  octet-stream, which Apple refuses outright).
- **Offline, honestly** (`src/lib/connection.tsx` + `OfflineBanner`): asks whether
  Atwe *answers*, not whether wifi is on — a hotel network that has not been
  logged into looks perfectly connected. Re-checks and reconnects the live stream
  on resume, and shows a brief green "Back online".
- **Home is complete** — all four web tabs (For You · Following · Circles ·
  Collections) in a scrolling row, and **video stories now play** via `expo-video`
  (the one deliberate gap in the story viewer is closed).
- **Beam is live, not polled** — `useRealtime`/`useRealtimeInvalidate` put the SSE
  client to work: the conversation list and an open thread update the instant a
  message, read receipt, edit or deletion arrives. The old 5s poll is now a 25s
  safety net for when iOS silently kills the socket.
- **Atwe AI can act** — an instruction routes to `POST /api/ai/agent`, which hands
  back a described action rendered as a **confirmation card** with the real
  details; only on agreement does the app call the ordinary authenticated route
  (`create_event` / `schedule_post` / `draft_invoice` / `draft_reply`).
- **Money is complete on the phone** — Send, **Request** (`wallet-requests.tsx`,
  pay/decline, claim-first so two taps pay once), **Add money** (`wallet-topup`),
  **Cash out** (`wallet-cashout`, with the three honest states: not set up / bank
  not connected / ready), plus **Orders** (bought + sold, plain-words status).
- **Search across everything** (`app/search.tsx` + `src/api/search.ts`): all seven
  web scopes — people, posts, shop, jobs, services, businesses — each rendered as
  what it is. Engine's box now opens it.
- **Store + Android readiness**: universal links, the permission wording Apple
  requires, accessibility roles/labels/Dynamic Type throughout, notification icon
  + colour, Android package/permissions/app-links/adaptive icon, and EAS profiles
  producing a Play app-bundle and a shareable apk.
- **Verified**: `npx tsc --noEmit` clean, and `npx expo export --platform ios`
  produces a real 4.83 MB bundle — every import resolves and every route compiles.
  Also fixed two PRE-EXISTING type errors that would have failed a build (a tone
  the Text component did not have, and an untyped `require()` image source).

## Recently added (this run — brand + navigation caught up with the web)
- **The app carried the OLD logo.** Every brand asset is regenerated from the web's
  current mark (`public/logo-mark.png` — the swirl; the app still had the trefoil
  knot): `assets/icon.png` (iOS, opaque — an iOS icon may not have alpha),
  `assets/adaptive-icon.png` (Android foreground) and `assets/splash.png`, which is
  also the mark `AnimatedSplash` fades in on launch. Each output keeps the **exact
  ink-to-frame proportion measured off the file it replaces** (61.9% for the icons,
  79.9% for the splash) rather than a guessed padding, so nothing shifts on a home
  screen. Generator: `/tmp/mkicons.js` pattern — scale by the mark's INK bounds, not
  by the file, because the source has its own margin.
- **The tab bar was the old layout AND the old artwork.** It is now the web's:
  **Home · Beam · Engine · Notifications · Account**, each icon the founder's own
  drawing in two states — **outline when you are not in that world, solid when you
  are** — taken from `tools/nav-icons/*.png` at 26/52/78 (@1x/@2x/@3x). Never
  hand-redraw these; they come out of `tools/nav-icons/build.js`.
  - **Atwe AI left the bar**, exactly as it did on the web. `href: null` keeps `/ai`
    a real routable screen — the Me hub, deep links and anything that pushes to it
    still work — it simply has no seat.
  - **Notifications took its seat**: `app/notifications.tsx` moved into `(tabs)`, and
    the **unread dot moved off the Home header's bell onto the tab**. The bell was the
    only way in before there was a tab; keeping both would put the same thing on
    screen twice, so the bell is gone.
  - `GlassTabBar` draws from a fixed `TABS` list and filters the navigator's routes
    through it, so a hidden route can never leak a seat back into the bar.
  - The **Account tab used an Ionicons person**, not the founder's artwork. It does now.
- **`src/constants/worlds.ts` was stale and is imported by nothing** — the old five
  worlds with the old icons. Updated rather than left, because a list describing a bar
  that no longer exists is a trap: the next person edits it, sees no change, and hunts
  a bug that is not there. `GlassTabBar` remains the single source of truth.
- **Verified:** `npx tsc --noEmit` clean (it caught one real error — the unread hook
  returns `{unread}`, not `{count}`, which would have failed a build), and
  `npx expo export --platform ios` produces a **4.84 MB** bundle with all **ten** new
  nav icons at three densities each plus the new splash listed in its asset manifest.

## Next up (phases 3, 4, 6, 7 remain partial)
1. ~~Profile navigation from feed/detail~~ ✅ done (`app/user/[username].tsx`).
   ~~Stories tray + viewer~~ ✅ done (`StoriesTray` + `app/story/[userId].tsx`).
   Next: **Circles/Following full feed tabs on Home**; native **video** story
   playback (add `expo-video`); a "Your story" add affordance on the tray.
2. Onboarding / signup polish; Settings surfaces (theme, privacy, account).
3. Then per the Architecture & Build Plan: Beam · Engine · Atwe AI · Profile/
   money · App Store polish.

### What is genuinely left
- **Phase 3 — Beam:** groups, media/voice, reactions, calls.
- **Phase 4 — Engine:** buying inside the app (address + wallet/escrow checkout).
- **Phase 6 — Profile & money:** managing a storefront, business analytics.
- **Phase 7 — App Store:** Apple Pay; the public listing needs Apple to approve
  the developer account.
- **Android release:** configured and buildable; needs a Play developer account.
- **Home-screen widgets:** genuinely blocked in managed Expo — a widget is a
  separate WidgetKit target written in Swift, which needs prebuild + a config
  plugin. Not a matter of more effort in this codebase.

**Delivery note:** new native code reaches the founder's phone only via a rebuild
(`eas build -p ios --profile production` → `eas submit`). Before the next build,
**sync the repo `package.json` to the founder's working SDK-54 set + worklets**
(see the divergence note below) so the repo builds cleanly — ideally set up the
GitHub → Expo online build so updates don't need the Mac.

## How to run (fresh machine)
```bash
# the app lives on the working BRANCH — clone it, not default main:
git clone -b claude/claude-md-docs-cajkf9 https://github.com/yiddiweller/atwe.git atwe-app
cd atwe-app/atwe-mobile
npm install --legacy-peer-deps
npx expo install --fix
npx expo install react-native-worklets   # Reanimated 4 companion (SDK 54)
export EXPO_TOKEN=<expo access token>      # or `npx expo login`
npx expo start --tunnel                    # scan QR with Expo Go
```
**Future updates:** `git pull` in `atwe-app`, then `npx expo start --tunnel`.

## Company documents (durable, in `docs/`)

- **`docs/ATWE-Complete-Product-Book.pdf`** — THE master reference (Final
  Edition, 73 pp): vision, design system, five worlds, complete built
  inventory, 1–2-yr roadmap (+§5.8 verification sweep), advisor brainstorm,
  Part 7 Running the Company. Served admin-only via the dashboard's
  **📘 Product Book** button (`GET /api/admin/product-book`).
- `docs/ATWE-Complete-Feature-Audit.pdf` (41 pp) and
  `docs/ATWE-iOS-Architecture-Build-Plan.pdf` (10 pp) — the companion audits
  the book absorbs. Treat the book as the single source of truth.

## Apple / distribution status
- **Apple ID:** business email (ceo@atwe.com), 2FA on.
- **Apple Developer Program: APPROVED** (founder confirmed, 28 Aug 2026), enrolled
  as **Individual**, Team `TH3FQ8FMKB`. Business isn't a legal entity yet; upgrade
  Individual → Organization (ATWE INC) before public App Store launch.
  *(This section said "PENDING" long after the EAS section below already recorded a
  successful production build under that Team ID — a build Apple would not have
  issued certificates for otherwise. Two places tracking one fact is how that
  happened; the EAS section is the one that gets touched during real work, so treat
  it as the source of truth and keep this line in step with it.)*
- **Nothing is blocked on Apple any more.** Certs, provisioning profile and the
  APNs push key are already created and held on EAS, so rebuilds skip the Apple
  login and 2FA entirely. The remaining step to get it on the phone is
  `eas submit -p ios --latest` → TestFlight → install; after that every update is
  the founder tapping **Update** in TestFlight.

## Key decisions (locked)
- **True native, phase by phase** (not a web wrapper) — matches the premium spec.
- **Dedicated `atwe-mobile`** project — currently staged inside the backend repo
  (a standalone GitHub repo couldn't be created from the build env); README has
  the `git subtree split` to lift it out later.
- **Reuse 100% of the backend**; only the UI is rebuilt natively.

## Gotchas learned (don't re-hit these)
- iOS Expo Go is always the latest SDK → the project MUST track it (currently 54).
- `npm install` needs `--legacy-peer-deps` (SDK 54 @types/react peer nit).
- SDK 54 Reanimated 4 moved its babel plugin → **no manual plugin** in
  `babel.config.js` (babel-preset-expo auto-includes it); needs
  `react-native-worklets` installed.
- **`react-native-worklets` MUST be a listed dependency in package.json** —
  Reanimated 4.1.x refuses to build without it (`pod install` fails: "install a
  version between 0.5.0 and 0.8"). Add via `npx expo install react-native-worklets`.
  It got dropped once during a `git checkout -- package.json`; keep it committed.
- `--tunnel` needs an Expo login (EXPO_TOKEN or `npx expo login`).
- **EAS cloud build needs `atwe-mobile/.npmrc` with `legacy-peer-deps=true`** —
  the global npm config isn't present in the cloud, so without this file the
  "Install dependencies" build phase fails on the @types/react peer conflict.

## EAS / TestFlight (first production build SUCCEEDED — 10 Jul 2026)
- **EAS project:** `@yiddiweller/atwe` (owner org `yiddiweller`), projectId
  `e7cc019c-b415-4fa0-9f63-283aaf8d1ad6` (app.json `extra.eas.projectId`).
- **Bundle id:** `com.atwe.app`. Apple Team: YEHUDA WELLER (Individual, TH3FQ8FMKB).
  Distribution cert + provisioning profile + APNs push key auto-created & stored on
  EAS servers, so rebuilds skip the Apple login/2FA.
- **Next:** `eas submit -p ios --latest` → TestFlight → install on the real iPhone.
- **Later:** connect the GitHub repo to Expo so builds trigger online (Mac-free);
  upgrade Apple Individual → Organization (ATWE INC) before public App Store launch.
- ~~Repo/local divergence~~ **RESOLVED:** the committed `package.json` is the
  working SDK-54 set (expo ~54, react-native 0.81.5, react-native-worklets 0.5.1)
  and a fresh clone now installs and bundles cleanly — verified with a real
  `expo export`. `expo-video` was added on the same pass.
