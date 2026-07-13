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

## Next up (Phase 1 continued → then phases 2–7)
1. ~~Profile navigation from feed/detail~~ ✅ done (`app/user/[username].tsx`).
   ~~Stories tray + viewer~~ ✅ done (`StoriesTray` + `app/story/[userId].tsx`).
   Next: **Circles/Following full feed tabs on Home**; native **video** story
   playback (add `expo-video`); a "Your story" add affordance on the tray.
2. Onboarding / signup polish; Settings surfaces (theme, privacy, account).
3. Then per the Architecture & Build Plan: Beam · Engine · Atwe AI · Profile/
   money · App Store polish.

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
- **Apple Developer Program:** enrolled as **Individual** — **payment confirmed,
  enrollment PENDING approval** (awaiting the "Welcome" email). Business isn't a
  legal entity yet; upgrade Individual → Organization (ATWE INC) before public
  launch.
- **On approval:** connect Apple account to EAS (App Store Connect API key) →
  `eas build --platform ios` (cloud) → `eas submit` → install via **TestFlight**
  (real icon, no Mac needed). Then every update = tap "Update" in TestFlight.

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
- **Repo/local divergence:** committed `package.json` still lists SDK-53 versions;
  the founder's LOCAL copy was aligned to SDK 54 (`expo install --fix` +
  `react-native-worklets`). Sync the repo package.json to the working SDK-54 set on
  the next pass so a fresh clone builds clean.
