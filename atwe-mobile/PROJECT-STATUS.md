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
- **Nav icon SIZE was wrong even after the artwork was right.** They were rendering at
  **21pt**. The files are exported at 26/52/78 — i.e. for a **26pt** box, so at 21 a phone
  was resampling them instead of picking exact pixels — and the web's own proportion is a
  34px icon in a 50px tab (68%); 21 in this 40pt pill is 52%, which is why they read small.
  Now 26 (65%). Checked by rendering a contact sheet of all ten at @3x on black and looking
  at it, not by trusting the file swap.
- **Every image the app references was enumerated, not assumed:** `app.json` has six
  icon-ish keys (app icon, splash ×2, Android adaptive foreground, Android notification
  icon) and all six point at the three regenerated files; the code references exactly the
  ten new nav icons and the splash mark. No stale path anywhere.
- **Verified:** `npx tsc --noEmit` clean (it caught one real error — the unread hook
  returns `{unread}`, not `{count}`, which would have failed a build), and
  `npx expo export --platform ios` produces a **4.84 MB** bundle with all **ten** new
  nav icons at three densities each plus the new splash listed in its asset manifest.

### …and the design caught up with the web too (same run)
The phone was still on the design the web had **before** the card/margin/colour work.
Everything below is now driven by tokens in `src/theme/tokens.ts`, so the next change
is one number rather than a sweep:
- **The palette was a different app's.** `accent` was X's `#1D9BF0`; the brand blue named
  in the design law is **`#0088FF`**, and it appears nowhere on the web. Surfaces, text
  greys, danger/success/warning and both themes are now the web's actual values (`--s2`
  `#141416`, not `#1C1F24`).
- **The post is a CARD, not a row with a hairline under it** — the single biggest visual
  gap. `src/theme/tokens.ts` carries the web's CLASSIC preset with the same derivation:
  `innerRadius = cardRadius − pad`, `shape = innerRadius × 2`. Change `pad` or
  `cardRadius` and the avatar, the photo's corner and the pill height all follow; never
  type those sizes separately.
- **Five equal action pills**, each `shape` tall with the card's own padding as the gap,
  the pill in the PAGE colour so it reads as a hole punched through the card and the
  glyph a step quieter (`postPill` / `postPillInk` — Light takes them DOWN from the card,
  since the card there is already a hair from white). Counts are compacted, so a
  seven-digit like count still fits five-across on a 320px phone.
- **One margin, 14px**, on every screen — 18 files, converted to `spacing.gutter` rather
  than retyped. `app/(auth)/login.tsx` keeps its own wider inset: the start screen is the
  one exception the web made too.
- **One option-row height (55)** on the Me hub and Settings; a row with a subtitle may
  still grow past it, as on iPhone Settings.
- **No hollow buttons to fix** — the web's problem (a secondary button whose fill was on
  `:hover` only, invisible on a phone) never existed here: `Button` was always solid, and
  the only `borderWidth` left in the app is the ring around an unread dot.
- Removed the dead `bellDot` style and the unread query left behind by the bell.
- **Verified:** `npx tsc --noEmit` clean throughout and `npx expo export --platform ios`
  builds, so every route and import still resolves after the sweep.

## Recently added (Beam: groups + photos in messages)
- **Groups are real.** Beam has **Chats / Groups** tabs; the Groups list is
  `GET /api/atchat/groups` (avatar, preview, unread, member count, and an **@** when you
  were mentioned since you last read — the one thing worth interrupting someone for in a
  busy group). A row opens **`app/group/[id].tsx`**: the live thread over
  `GET /api/atchat/groups/:id`, sending via `POST …/messages` with an optimistic echo and
  `clientId` idempotency (the server has a unique index on group+sender+clientId, so a
  double-tap or a retry lands once). Live over SSE, **scoped to that group** — a message
  elsewhere on the account must not make the open thread refetch.
  - A group message carries a **sender**, which a DM does not, so `GroupMessage` is a
    superset rather than a reuse of `DmMessage`. The name and face show **once per run**
    of consecutive messages from one person; repeating them on every line is what makes a
    group read like a log file rather than a conversation. The avatar gutter is held open
    on the rest of a run so bubbles do not step left and right.
  - A **broadcast group is a channel**: admin-post-only. The composer says so instead of
    letting someone type into a message the server will refuse.
- **Photos in messages**, in both DMs and groups. `src/lib/pickPhoto.ts` picks, then
  **downscales to 1280px / quality 0.7** — and that is not an optimisation, it is what
  makes the feature work: a modern phone photo is 4–8 MB and the server refuses anything
  over `MAX_IMG_CHARS` (3.5M base64 chars), so sending the original would fail for most
  real photos. It mirrors that ceiling locally so a too-big photo gets a plain sentence
  instead of an opaque 400, and a **cancel says nothing** — cancelling is deliberate, not
  an error.
  - The composer grew an attachment slot (thumbnail + remove), and **a photo with no
    caption is a valid message** — requiring text as well would let you attach one and
    then not be allowed to send it.
  - New deps: `expo-image-picker ~17.0.11`, `expo-image-manipulator ~14.0.8`. **`npx expo
    install` cannot run in the build environment** (Expo's version API is not reachable
    through the egress proxy), so the versions were read from
    `node_modules/expo/bundledNativeModules.json` — the SDK's own answer — and installed
    with plain npm. Do that rather than guessing a version.
  - `NSPhotoLibraryUsageDescription` was already present, checked rather than assumed: a
    missing one is an instant crash on a real phone, not a warning.
- **Verified:** `npx tsc --noEmit` clean, `npx expo export --platform ios` builds
  (4.87 MB, up from 4.84 with the new native modules).
- **Not yet:** voice notes (needs an audio library), reactions, replies-in-thread, and
  calls.

## Recently added (Beam finished, buying works, and a check that catches silent drift)

Five slices, all verified against a real server and Postgres rather than by
reading the code. Two of them started as bug hunts and turned into the most
valuable thing in the batch.

### 1. Every photo in the app was invisible, and had been all along

The backend does **not** ship stored photos inline. Anything over 2KB — which is
every real photo — is rewritten by `mediaRef()` into a signed **relative** path,
`/api/media/<kind>/<id>/<idx>/<sig>`. That is exactly right in a browser and
completely wrong here: React Native has no document origin, so
`<Image source={{ uri: '/api/media/…' }} />` resolves to nothing and renders
blank. Avatars, post images, DM and group photos, story media, listing covers,
profile banners — all of them. Confirmed against a real payload before touching
anything, then confirmed the same path with the API base in front serves the
bytes with no auth header.

**`src/lib/media.ts` → `mediaUri()`** joins a relative path to the API base and
passes `data:`, `http(s):` and `//host` through untouched. **Every image site in
the app goes through it.** Add a new one and it must too.

### 2. Voice notes in Beam

The server has taken them since long before this app — `media` as a base64 data
URL, `mediaKind: 'audio'`, `durationSec` — so this was only ever the missing
half. Tap the mic where the send arrow sits when nothing is typed; the pill
becomes a recording bar (breathing red dot, running timer, bin, send). In the
thread a note is a real player on both sides, in DMs and groups.

- **Mono AAC at 48kbps**, deliberately neither of `expo-audio`'s presets:
  HIGH_QUALITY is stereo 128k (four times the bytes for speech nobody can tell
  apart) and LOW_QUALITY drops iOS to `AudioQuality.MIN`, which is audibly rough.
- **Five-minute ceiling, and hitting it SENDS** rather than discarding — the
  recorder has already stopped taking audio, so holding it hostage only loses
  what was said. Under a second is a mis-tap.
- The bubble you just sent plays the **file still on disk**, not the data URL
  going up: iOS will not reliably open a `data:` URI, and a megabytes-long
  string does not belong in a render tree.
- New deps: `expo-audio ~1.1.1`, `expo-file-system ~19.0.23` (pinned explicitly,
  it was only a transitive), `expo-clipboard ~8.0.8`. Versions read from
  `node_modules/expo/bundledNativeModules.json`, never guessed — `npx expo
  install` cannot reach Expo's API through the egress proxy.

### 3. Group messages had no sender, and a check so that cannot happen again

Typing the group message shape against the **live payload** instead of against
what a DM looks like turned up a bug that had been shipping since groups landed.
The server sends a nested `sender` object and a `deleted` flag; the app declared
flat `sender_id` / `sender_name` / `sender_avatar` and `deleted_all`. Nothing
errored — TypeScript was told the wrong shape, so it agreed. On a phone: no name
and no face on anyone's message ever, a deleted message never said so, and
run-grouping compared `undefined` to `undefined`, so a whole group read as one
unbroken run from nobody.

**`tools/check-api-types.js`** is the check that class of bug needed:

```
TOK=<bearer> UN=<username> BASE=http://localhost:3000 node tools/check-api-types.js
```

It fetches every endpoint the app calls and verifies each field each interface
names is genuinely there. A **required** field never sent is a failure; an
**optional** one is reported to eyeball, because absence can be legitimate
(`ppvCents` rides only on a locked post) or a bug. An empty list is **skipped,
never passed** — nothing to compare proves nothing. **Run it against a populated
account after touching any `src/api/*.ts` type.**

It found three more on its first runs:
- `Order.buyerName`/`sellerName` — the server sends `buyer`/`seller` OBJECTS, so
  every order row silently dropped its "from …" line.
- `User.emailVerified` — the wire says **`email_verified`**, and `is_admin`
  likewise. Not a server slip: `publicUser` has always sent those two in
  snake_case. Settings therefore told every account its email was "Not verified".
  **Do not "tidy" those two names back to camelCase.**
- `Quote.eta` is a **range** (`{minAt, maxAt, handleDays, transitDays}`), not a
  date string. Rendered as one it reads "Invalid Date" under every total in the
  shop.

30 interfaces now check clean.

### 4. Message actions: react, reply, copy, delete

Press and hold a bubble for a frosted sheet — the phone's reading of the web's
Glide menu, label left, icon right — with six reactions above it. One emoji per
person, and picking the one already there clears it (which is what the server
does with a repeat). Optimistic, reverting if the server disagrees; your own
reaction chip is outlined in the accent. Reply shows a strip above the composer
and a quoted spine inside the sent bubble. Delete for me, or — your own message,
or any message if you run the group — for everyone.

Two things to keep: the sheet's actions fire ~180ms **after** it closes (an
Alert raised from inside a closing modal is a known iOS deadlock), and the
message being acted on is held as an **id**, never an object, so a refetch
mid-gesture cannot leave the sheet acting on a stale copy.

### 5. Buying, and the order afterwards

Engine could show a listing and open a chat about it; it could not take money.
Now: quote first, then buy, on exactly the endpoints the web uses — so what the
buyer is shown is what they are charged and no arithmetic happens on the phone.

- **Where** — pick a saved address or add one. Only name, street and city are
  required; that is the server's rule and a deliberate one, since much of the
  world has no postcode or state.
- **What** — subtotal, discount, shipping, tax, total from
  `POST /api/checkout/quote`; each line only appears when the server has it, a
  shipping choice only when there is more than one, and the expected arrival is
  shown **before** paying.
- **How** — both from the Atwe balance. **Buy with protection** (escrow, the
  default) holds the money until the buyer confirms; **Pay now** credits the
  seller immediately. Short of the total, the button becomes Top up.
- **One `clientId` per purchase, kept across retries** — that is what makes a
  double-tap or a dropped connection charge once. Verified: the same id twice
  returned the same order and moved no further money.
- **Order detail** (`app/order/[id].tsx`) — a walked timeline, items, totals,
  who it is with, ship-to, tracking with a real carrier link. Buyer confirms
  (behind a dialog naming the amount) or disputes; seller marks sent (carrier
  from the accepted list, tracking optional — small sellers often have none);
  either side marks it arrived, which deliberately does **not** release money.
- Plus the address book at Settings → Shopping, since an address saved wrong had
  nowhere to be fixed.

Verified by driving both sides: ship → buyer sees the tracking → mark delivered
(still escrow, money still held) → confirm → released, 9000 landing in the
seller's balance, confirming again refused. On a second order: a dispute sticks
and shows to both sides, an empty reason is refused, and a disputed order can no
longer be confirmed.

**Not built: paying by card.** That goes through Stripe Checkout on the web and
is real work; rather than half-wire it, the sheet says plainly that you top the
balance up first and offers the way there.

**Gotcha worth keeping:** `Alert.prompt` is **iOS-only**. On Android it is
undefined, so a guarded call is a button that does nothing. Use a sheet.

## Recently added (buying, selling, booking — and the first look at the screens)

### 6. The cart, and selling from the phone

The server keeps ONE cart grouped by seller, because an order goes to a single
business — so the screen is a list of little carts, each with its own total and
its own Checkout. Buying from two sellers really is two orders.

**One thing worth knowing:** a cart checkout that succeeds but whose response is
lost cannot be retried into a replay. The server's "your cart is empty" guard
runs BEFORE the idempotency claim, so the retry is refused rather than returning
the first order. No double charge either way, but the buyer would see a failure
for something that worked — so on a failure the sheet re-reads the cart, and if
that seller's group is gone it says the order already went through.

Selling: **Your listings** (the owner's own list, hidden ones included, because
a seller who cannot see what they took down cannot put it back), a small create/
edit form, and **Sales**, which leads with orders paid for and waiting to be
posted rather than with revenue. Two load-bearing details in the form — a blank
stock box means UNTRACKED and is sent as null, and the photo is only sent when
it CHANGED, since the stored one comes back as a signed URL rather than bytes.

### 7. Your own profile, posts with pictures, and stories

There was no way to change your name, photo, headline, bio or website from the
phone at all. Three server rules the editor respects: name and username are
always sent (the route refuses a body with no name and reads a missing username
as "clear it"); a photo only when it changed; and **every field must be
prefilled** — `location` and `website` were missing from the app's User type, so
those boxes would have opened blank and the first save would have wiped them.

The composer takes a photo now, with a description box beside it, and a picture
with no words is a valid post. The story tray has YOU first, with a + when you
have nothing up. That turned up a viewer bug: `bg` on a story is a preset id
('g1'…'g6'), which is what the web writes, and the viewer only trusted a hex —
so every text story posted from a browser rendered plain black. `src/lib/storyBg.ts`
resolves both.

### 8. Booking

A business with opening hours can be booked. The times offered are generated
from those hours, cut into pieces the length of the service, with anything
already taken removed. Taking one is CONFIRMED on the spot — publishing it was
the approval. An Appointments screen runs both sides, and a services manager
sets out what is offered, how long it takes and an optional deposit.

The hours themselves are now editable in the profile editor: the Book sheet
could say "they haven't put up their opening hours" and there was nowhere on the
phone to put them up.

**A real money bug, caught by driving it:** the deposit is decided from the
SERVICE ROW and the server only looks it up when a `serviceId` is sent. Sending
the service NAME alone — all the sheet did at first — meant a service with a
deposit took none, silently, and the business would have believed it was
protected. **Always send `serviceId`.** Verified: without it "deposit 0, held
false"; with it, held, released on completion, refunded on cancellation.

### 9. A business profile that shows it is a business

Open/closed now with the week underneath, the star rating tapping into reviews
you can read and write, and the shop grouped by the seller's own sections.
Open-now is computed from the READER'S clock, which is the only honest reading:
hours are stored as wall-clock times with no timezone, so a traveller checking a
shop abroad sees it wrong. That is a limit of the storage, not of the phone.

### 10. Looking at the screens — `npx expo export --platform web`

Everything above was verified by driving the API and by the compiler. Nobody had
seen a pixel. Expo builds the same code for the web through react-native-web, so
the screens can be LOOKED at. **How:**

```bash
cd atwe-mobile
npm i --no-save react-dom@19.1.0 react-native-web@~0.21.0 @expo/metro-runtime@~6.1.2
EXPO_PUBLIC_API_URL='' npx expo export --platform web --output-dir dist-web
# then serve dist-web at the ROOT of an origin that proxies /api to the server
# (expo-router does not know a path prefix, and there is no CORS on the API)
```

Drive it with Playwright at 390x844 and navigate CLIENT-SIDE (`history.pushState`
+ a `popstate` event) — every hard reload re-runs the splash and photographs it
instead of the screen. It reaches about half the screens; the rest bounce between
the splash and the login gate because the harness fights the app's auth timing.
**It is not a phone** — glass, haptics and native sheets are not what renders —
but it is the difference between having seen the work and not, and it earned its
keep immediately:

- **The splash could hang forever on a deep link.** It waits for the Home feed to
  settle, and Home does not always mount: arrive on a notification about an order
  or a shared listing link and nothing ever says the feed is ready. Capped at
  `SPLASH_MAX_WAIT` (2.5s).
- **One card corner.** The post card was at 30 and every other card at 20 —
  `radius.card` is now the one name for it; `radius.lg` stays for what is NOT a
  card (a photo in a form, a story preview).
- Orders said the word "Back" where every other screen has a chevron; Home was
  chopping "Collections" mid-letter at its scroll edge.

Also: `expo-secure-store` has NO web implementation and throws, taking the auth
bootstrap with it — token storage falls back to localStorage on web only. Nothing
ships to a browser.

### The standing check: `tools/check-api-types.js`

**Run it against a POPULATED account after touching any `src/api/*.ts` type.**

```bash
TOK=<bearer> UN=<username> BASE=http://localhost:3000 node tools/check-api-types.js
```

37 interfaces, checked against what the server really sends. It has now found
six real bugs: the group message shape, order buyer/seller, `email_verified`
(snake on the wire, and `is_admin` too — **do not "tidy" those back to
camelCase**), the `eta` range, and two more. A required field the server never
sends is a failure; an optional one is reported to eyeball, because absence can
be legitimate. An empty list is skipped, never passed.

## SHIPPING 0.2.0 — the pre-flight is DONE, the build is yours to fire

Everything that can be checked without an Expo login has been checked, because a
build that fails still costs a credit. State as of this commit:

| | |
|---|---|
| version | **0.2.0** (was 0.1.0) — build number is remote + auto-incremented |
| iOS bundle id | `com.atwe.app` |
| API the build talks to | `https://atwe.com` — set in `eas.json` **and** as the fallback in `app.json`, and confirmed **baked into the compiled bundle** |
| TestFlight app | ascAppId `6789639912` |
| fresh clone | `npm ci` → 941 packages clean; `expo export --platform ios` bundles (5.27 MB) |
| expo-doctor | 16/18 — the two failures are network fetches this container's proxy blocks (Expo's config schema, the RN Directory), not the project |
| typecheck · haptics guard · API types | all green |

**The one real problem found, and it is the kind that ships and then crashes.**
`expo-asset` was **not a direct dependency** — only pulled in sideways by
`expo-audio` and `expo`. expo-doctor is blunt about it: *"Your app may crash
outside of Expo Go without this dependency. Native module peer dependencies must
be installed directly."* Outside Expo Go **is** a TestFlight build. Pinned to the
SDK-54 version (`~12.0.13`).

**Two things that looked like problems and were not** — checked rather than
assumed, so nobody re-opens them:
- The app icon carries an alpha channel, which App Store Connect rejects. Every
  pixel measures **alpha 255** — the channel exists but nothing is transparent —
  and Expo flattens the iOS icon onto white anyway (`removeTransparency` in
  `withIosIcons`). Safe.
- Two `localhost` strings appear in the compiled bundle. They come from
  `@expo/metro-runtime`'s own dev-server plumbing, inert in a release build. Our
  source has none.

Also removed `ios.config.usesNonExemptEncryption`, which Expo prints a warning
about and **ignores** whenever `ios.infoPlist.ITSAppUsesNonExemptEncryption` is
present — and that is the one App Store Connect actually reads.

### To fire it

This container has **no Expo login**, so the build cannot be started from here —
that needs the account password and 2FA. From a machine that has the repo:

```bash
cd atwe-mobile
npx eas-cli login          # once per machine
npx eas workflow:run build-ios.yml
```

That workflow builds the production profile **and submits to TestFlight** in one
go (`.eas/workflows/build-ios.yml`). Or the two steps by hand:

```bash
npx eas build -p ios --profile production
npx eas submit -p ios --latest
```

**The Expo dashboard's "Run workflow" button needs the GitHub repo connected to
the Expo project first** — PROJECT-STATUS has that listed as not yet done, so
assume the CLI is the route until somebody connects it.

Then: Apple processes the build (usually 5–20 minutes) and it appears in
TestFlight as **Atwe 0.2.0**.

## Three Engine worlds: Events, Services, Businesses

The website offers eleven things to discover; the phone offered three. It now
offers six, and these are complete features rather than surfaces:

**Events** (`app/events.tsx`, `app/event/[id].tsx`, `app/new-event.tsx`,
`EventCard`) — four shelves (Upcoming · Going · Hosting · Past), the list
**grouped by day**, and a detail that answers the only question on the screen:
am I going. All three RSVP answers the server can give are handled — done, a
Stripe URL for a ticketed event (paying is a browser step), and a 400 with
`full` + `canWaitlist` when the seat cap is reached, which turns the button into
"Join the waiting list". Hosting: put one up in a minute, see who is coming,
cancel it (attendees are told) or delete it.

**Services** (`app/services.tsx`, `app/service/[id].tsx`, `app/offer-service.tsx`)
— with no category chosen this is the **local hub** (`/api/local`): one search
across services, businesses, open roles and what's on, because somebody typing
"plumber" does not care which of our tables the answer is in. Choosing a category
narrows to services proper. No checkout on a service detail on purpose — a
service is arranged by talking to somebody, so the one white action is Message.

**Businesses** (`app/businesses.tsx`) — the directory, verified-first, with a
verified-only filter and a distance chip when the viewer has shared a location.

Wired into Engine (3 tiles → 6) and into a new **Discover** group in Settings.

### The checker earned its keep again

`check-api-types.js` failed with *"Service: required but never sent → name,
durationMin, depositCents"* — a **name collision**, not a wire mismatch:
`appointments.ts` already exports `Service` for a BOOKABLE service, and the new
services-marketplace type had taken the same name. Two concepts under one name is
how a silent bug starts, so the new one is `ServiceListing`. Four new interfaces
now verified against live payloads; 50 in total, 0 failures.

**A grouped list should not say the date twice.** "Tomorrow" as a heading with
"Wed, Sep 2, 4:23 PM" under it is the same fact twice, so `EventCard` takes
`underDayHeading` and shows the clock alone there. Everywhere else — the local
hub, a profile — there is no heading, so it carries the whole date.

## The nav bar's INSET is the founder's number, not the web's

Matching `--nav-inset` 23 exactly made the bar visibly narrower than the one they
had been living with, and they said so: *"it looks a little narrow now"*. So the
web's PRINCIPLE is kept — the bar sits inside the cards, deliberately, so the two
lines read as a decision — and the amount is theirs: **inside by 4, not 9**. On a
390pt phone that is a 354pt bar, against 344 at the web's value and 362 if it
simply matched the cards.

`GlassTabBar` spells this out rather than reading a token, because it is the one
number in that file that is NOT the web's and a future reader would otherwise
"fix" it back.

## Notification rows and list dividers

Two more the web is explicit about and the phone was not doing:

- **A notification row is `var(--bg)` with NO divider and a subtle unread dot.**
  The phone tinted every unread row with `accentDim` AND drew a line under each,
  so a page of unread alerts was a wall of blue stripes. The dot is the whole cue.
- **A list hairline is INSET to the gutter** (`::after` with `left/right:
  var(--feed-gutter)`), which is what makes a list read as rows sharing a page
  rather than a table with ruled lines. `borderBottomWidth` on the row itself
  cannot do that — it always spans the full width, padding included — so there is
  now a `RowDivider` that pins itself absolutely to the row's bottom, costing no
  height. Its parent must be `position:relative`.

## The nav bar: why it went muddy, and the web's actual recipe

The founder photographed the bar going orange over an orange photo, and called it
"really bad". They were right, and the cause is specific: it was **real Liquid
Glass with NO tint**, and untinted glass takes its colour from whatever is behind
it. Apple's own bars are tinted; clear glass is for a bar over a controlled
background, not over a scrolling feed of other people's photos.

It is still `glassEffectStyle="regular"` — Apple's real material, which is what
was asked for — now tinted with the web's own near-black.

Four numbers were also simply wrong, all of them the web's and all of them
checkable in `public/index.html`:

| | web | phone was |
|---|---|---|
| icon (`--nv-size`) | **34** | 26 — 24% smaller, hence "much bigger" |
| inset (`--nav-inset`) | **23** | 14, the CONTENT gutter |
| height | 50 tab + 4+4 padding = **58** | 56 |
| border | `1px rgba(255,255,255,.05)` | none |
| active pill (`.bn-indicator`) | the whole tab, fully round | a 46×40 rounded rect |

**The inset is the one worth understanding.** 14 is `--feed-gutter`, the content
margin — and the web is explicit that the bar must NOT share it: it sits
deliberately INSIDE the cards, so the two lines read as deliberate rather than as
a near-miss. That is why `nav.inset` is its own token and not derived.

The pill's colour was already right (`rgba(255,255,255,.14)` dark,
`rgba(0,0,0,.06)` light) — only its shape was wrong.

**A caveat when reviewing this in the web preview:** `isLiquidGlassAvailable()`
is false there, so the preview shows the iOS < 26 fallback (the web's
`rgba(18,18,21,.90)` + a whisper of blur). The real Liquid Glass only appears on
the device. Do not judge the material from a screenshot taken here.

## Design parity — the phone's values ARE the web's now, and a check that keeps them there

The tokens were "ported 1:1 from the web" once, and then the web moved on. Nobody
could see it, because the drift is invisible in a diff of either file alone. Read
out of `public/index.html` and compared, value by value:

| | web | phone was |
|---|---|---|
| the hairline (`--b2`) | `rgba(255,255,255,0.08)` | `#242830` — opaque, lighter, and visibly **blue** |
| a LIKED post | `--rose` = **#0088FF** | `#F91880` — **X's pink** |
| a REPOSTED post | `--accent` = **#0088FF** | `#00BA7C` — **X's green** |
| every bottom sheet (`--r-xl`) | 24 | 30 (aliased to the card corner) |
| `--r-sm` / `--r-lg` | 11 / 18 | 10 / 20 |
| motion | 120 / 200 / 350 | 160 / 220 / 320 |
| `--accent-dim` | `0.10` | `0.14` |
| missing entirely | `--s3`, `--b1`, `--post-skel`, `--on-green`, `--purple`, `--nav-inset` | — |

**`--rose` being blue is the one worth remembering.** It reads like a pink, and it
is #0088FF. So on the web a lit action is blue — which is the colour law working as
written (blue is the selected/toggle-on colour), not an exception to it. The app was
carrying two colours from X's palette that appear nowhere in Atwe.

Also split what the web keeps separate and the phone had conflated: `--green` is the
FILL (#88FF00, both themes, dark ink via `--on-green`), `--green-txt` is green TEXT
(darkened on Light, where lime on white is unreadable). The phone's
`success`/`danger`/`warning` are the TEXT tokens; `green`/`red`/`amber` are the fills.

### Two near-misses, recorded so nobody repeats them

- **`body.light` matched loosely also catches `body.light .sf-look-warm`**, whose
  cream `#faf4ec` / `#f3e9dc` are a **storefront look option**, not the Light theme.
  A first pass "fixed" the phone's Light surfaces to cream on the strength of it.
  The real Light palette is `#F5F5F7`, which the phone already had. Match the
  selector EXACTLY.
- **`--feed-gutter` is 16 in `:root` and 14 inside the phone media query.** 14 is
  right for the phone; a naive read of `:root` alone says otherwise.

### `tools/check-design-tokens.js`

```bash
node tools/check-design-tokens.js
```

Reads the real values out of `public/index.html` and asserts the phone matches —
50 colours across both themes, plus gutter, nav inset, post geometry, five radii
and three durations. Self-tested: reintroducing each of the four drifts above fails
it by name. Two of its own bugs are baked in as comments, because both passed on
broken input: CSS writes `.04` and `0.04` for the same number, and a lazy match to
the first `}` truncates the `post` object at its getters.

## The homepage, against the web's own rules

Looking at it rather than assuming, three things did not match:

1. **A 3px blue underline under the active feed tab.** The web has none — it draws
   one in its non-solo top bar and then explicitly turns it off for these rows
   (`.tb-feedtab.active::after{display:none}`). It was also blue, which the colour
   law reserves for identity.
2. **The tab words were the wrong size and weight** — 17px/700 against the web's
   **15px/600, active 700 white**. The web is emphatic that Home's and Beam's tab
   words must be identical across worlds, so there is now one `FeedTab` component
   rather than a copy per screen, and the size never changes between states.
3. **A hairline under the Dailies.** The web removed it at the founder's request;
   the phone still drew one.

## And a real bug the design pass turned up: `/` redirected to a profile

Opening the app at the root landed on **"Couldn't load this profile"**. The
deep-link parser treats an unrecognised hostname as the first path segment — right
for `atwe://user/sam`, where Linking puts `user` in the hostname, and badly wrong
for a web address: `http://localhost/` parsed `localhost` as a handle and sent the
HOME SCREEN to `/user/localhost`. An http(s) link from a host that is not ours now
returns null. On a phone this path is normally dormant (a cold launch has no
initial URL), but it is live on anything served over http and would send a
shortened or wrapped link to a nonsense profile.

## Recently added (Jobs — the half of Atwe that was missing from the phone)

Atwe is a business super-app and its two-sided **jobs marketplace** was not on
the phone at all. It is now, both sides of it.

**Looking for work** (`app/jobs.tsx`, `app/job/[id].tsx`, `src/components/JobCard.tsx`)
— search by title, company or keyword; four shelves (All · Saved · Applied ·
Posted) and filters for remote and contract type. A role opens to who is hiring,
what it pays, where it is, the description, and **How you match**: a 0–100 score
with the skills that carried it and the ones worth adding. **Easy Apply**
(`ApplySheet`) answers the employer's screening questions and writes a cover
note, with **"✦ Write it for me"** drafting one from your own profile and résumé.
Saved roles, withdraw, and a **status tracker** — every application shows
Applied / Reviewed / Shortlisted / Hired / Not selected, in colour.

**Hiring** (`app/post-job.tsx`, `app/applicants/[id].tsx`) — post a role in
under a minute (only the title is required, same as the server), then work the
pipeline: every applicant is a card with their note, their answers, whether they
**meet the requirements**, and one tap to shortlist, hire, decline or message
them. Close a role or delete it.

**Open to work** (`app/workers.tsx`) — browse people looking, and list yourself.

**The bug that mattered most is one nobody would have reported.** Being *listed*
and being *visible* are two different switches on the server: `worker_listings`
holds what you do, `users.otw_visibility` decides who may see it — **and it
defaults to `off`**. Posting a listing without touching it puts you on a board
nobody can search, silently. Proved it live: two real listings in the database,
board returned zero. The app now sets both together (a first listing goes
`everyone`), shows who can currently find you, and puts the three-way choice on
your own card. An amber dot and "Listed, but nobody can see it" if it is ever off.

**Also found and fixed while looking at the screens:**
- **A horizontal strip in a flex column must be told `flexShrink: 0`.**
  `flexGrow: 0` alone leaves flex-shrink at 1 on the web build, so the list below
  took the space: the chips' own 8px padding was squashed away entirely and two
  stacked filter rows **visibly overlapped**. Measured 24.3px tall against 35px
  of content. It was already latent on the Marketplace's kind tabs, where one row
  hid it. `styles.rowStrip` is the shared fix.
- Employers type "Remote" into the location box **and** tick the remote flag, so
  cards read "Remote · Remote". One helper (`showsPlace`) now decides, shared by
  the card and the detail so they cannot disagree.
- Your own listing appeared twice on the workers board — once as your card, once
  as a row. The server has no reason to exclude you (an employer wants everyone),
  so the screen does.
- The detail repeated the role's name in the header bar directly above the same
  name in Display type. The bar is back-arrow and heart now, nothing in between.
- "0 applicants · be an early one" reads badly at zero; it is "Be the first to
  apply" now, everywhere, in one voice.
- A match card from the no-AI heuristic with no skills matched was a bare number
  and nothing else. It now says what would make it sharper.

**Verified against the real server + Postgres, not by reading code:** posted
three roles as one account, applied from another with screening answers,
shortlisted them, watched the status appear on the candidate's side, saved a
role, confirmed a **non-poster gets 403** on the applicant list, and listed
somebody open to work. Every screen shot in **both themes, 0 page errors**.

**Six new interfaces are in `tools/check-api-types.js`** — Job, JobPoster,
ScreeningQuestion, Applicant, WorkerListing, JobMatch — all checked against live
payloads (Job alone is 25 fields). The three that need particular data (a job
that asks a screening question, a job of your own with an applicant, the match
POST) are **found from the live board** rather than hard-coded, so the check
keeps working on any account.

## Recently added (how the app FEELS — system-wide haptics)

Every tap, tick and confirmation in Atwe now goes through **one module**,
`src/lib/haptics.ts`, instead of 25 scattered `expo-haptics` calls that each
picked their own intensity. Six named intents, and a screen chooses what it
MEANS rather than how hard it should buzz:

| intent | Apple generator | when |
|---|---|---|
| `tap()` | Impact **light** | anything you press: a button, a menu row, a card that opens |
| `press()` | Impact **medium** | the few weighty acts — start recording, pay, go live |
| `select()` | **selectionChanged** | a value changing: a tab, a chip, a quantity, a caret landing, a character deleted |
| `success()` | Notification **success** | it worked — a post landed, money moved, an order was placed |
| `warning()` | Notification **warning** | a destructive confirmation is being offered |
| `error()` | Notification **error** | it failed or was refused |

Shipped map: 10 taps · 3 presses · 26 selections · 14 successes · 8 warnings ·
21 errors, across 37 files. Zero files import `expo-haptics` directly.

**Three rules the module exists to enforce, each of which had already been
broken:**

1. **Nothing runs together.** The Taptic Engine cannot separate two events
   fired within a few tens of milliseconds — they merge into one long buzz,
   which is the opposite of crisp. `MIN_GAP` (45ms) coalesces them, so a fast
   scrub through a picker ticks cleanly instead of humming.
2. **Nothing fires twice for one gesture.** `<Button>` and `<AuthButton>` own
   their haptic and fire it on **`onPressIn`** — a real button clicks on the way
   DOWN, and that moment is most of what separates "mechanical" from "laggy".
   Three handlers passed to a Button were firing their own as well (Add to cart,
   Pay, Book it), so those buzzed again ~100ms later on the way up. Fixed.
3. **Nothing can break.** Every call is fire-and-forget and swallows its own
   errors: a simulator, a device with no engine, the web build — all silently do
   nothing rather than throwing inside a press handler.

**Press-in is safe inside a scrolling list**, which is not obvious: iOS's
ScrollView holds a touch back (`delaysContentTouches`, on by default and never
overridden here) until it knows the finger is not scrolling, so dragging the
feed past a button never fires it. The controls that must NOT work that way are
the ones you can start a scroll from directly — the like/repost/bookmark pills
on a post card tick on **release** for exactly that reason.

**Text fields** (`src/components/HapticInput.tsx`, now used in 21 files —
there is no bare `<TextInput>` left in the app): a tick as the caret lands and a
tick as a character comes back OUT. Typing forward is **deliberately silent** —
iOS already gives the keyboard its own feedback, and a second generator per
keystroke is the muddy buzz the whole module exists to avoid.

**Settings → Appearance → Haptics** turns the lot off and remembers it
(`atwe_haptics`, read once at launch in `app/_layout.tsx` before anything can be
tapped). Some people find any vibration unpleasant and iOS's own switch is three
screens deep in Accessibility. Turning it off ticks last; turning it on ticks
first — the control demonstrates itself in both directions. Verified in the web
preview: present in both themes, survives a reload, 0 page errors.

### The standing check: `tools/check-haptics.js`

```bash
node tools/check-haptics.js
```

Feel is the one thing a screenshot cannot show, so it is the one thing that rots
quietly. Three rules: nobody imports `expo-haptics` directly; no handler passed
to a `<Button>` fires its own press haptic; anything declaring itself a `tab` or
a `radio` has a selection tick. Self-tested — reintroducing each of the three
bugs makes it fail by name.

## Next up (phases 3, 4, 6, 7 remain partial)
1. ~~Profile navigation from feed/detail~~ ✅ done (`app/user/[username].tsx`).
   ~~Stories tray + viewer~~ ✅ done (`StoriesTray` + `app/story/[userId].tsx`).
   Next: **Circles/Following full feed tabs on Home**; native **video** story
   playback (add `expo-video`); a "Your story" add affordance on the tray.
2. Onboarding / signup polish; Settings surfaces (theme, privacy, account).
3. Then per the Architecture & Build Plan: Beam · Engine · Atwe AI · Profile/
   money · App Store polish.

### What is genuinely left
- **Phase 3 — Beam:** ~~groups, media/voice, reactions~~ ✅ done. **Calls** remain.
  They need `react-native-webrtc` (a config plugin, and no Expo Go — fine, since
  we ship through EAS anyway). The honest blocker is that a call cannot be TESTED
  here at all: no device, no second party. Building it means handing over several
  hundred lines nobody has watched work. Flagged to the founder as a decision
  rather than assumed either way.
- **Phase 4 — Engine:** ~~buying~~ ✅ ~~cart~~ ✅ ~~jobs + hiring + open-to-work~~ ✅
  done. **Paying by card** remains
  — it goes through Stripe Checkout, a browser flow; the sheet currently says
  plainly that you top the balance up first.
- **Phase 6 — Profile & money:** ~~storefront management~~ ✅ ~~appointments~~ ✅
  ~~business profile~~ ✅ done. **Business analytics** (the reach dashboard, as
  distinct from the sales one) remains.
- **Phase 7 — App Store:** Apple Pay; the public listing needs Apple to approve
  the developer account.
- **Android release:** configured and buildable; needs a Play developer account.
- **Home-screen widgets:** genuinely blocked in managed Expo — a widget is a
  separate WidgetKit target written in Swift, which needs prebuild + a config
  plugin. Not a matter of more effort in this codebase.

## Universal links are OFF, deliberately — and here is how to put them back

`ios.associatedDomains` (`applinks:atwe.com`, `applinks:www.atwe.com`) is
**removed from app.json**. It is the one thing that failed the first real 0.2.0
build, and it is worth knowing exactly why because nothing about it is a code
problem:

```
Provisioning profile "*[expo] com.atwe.app AppStore 2026-07-10T15:37:01.685Z"
doesn't support the Associated Domains capability. (in target 'Atwe')
...doesn't include the com.apple.developer.associated-domains entitlement.
```

The profile Apple issued on **10 July** predates the capability, so Xcode refuses
to sign. The generated entitlements file asks for exactly two things and only one
of them is a problem — `aps-environment` (push) is already on the profile and has
worked since 0.1.0; `com.apple.developer.associated-domains` is not.

**What is actually lost:** tapping an `atwe.com` link in Messages or Safari opens
the WEBSITE rather than the app. That is all. `src/lib/deeplinks.ts` still parses
both shapes (`atwe://user/sam` and `https://atwe.com/sam`), the app's own scheme
still works, and a tapped push notification still routes correctly — those use the
notification payload, not universal links. Android's `intentFilters` are untouched,
because Android app links need no Apple profile.

**To restore it** (a five-minute job, needing the Apple Developer portal):
1. developer.apple.com → Certificates, Identifiers & Profiles → **Identifiers** →
   `com.atwe.app` → tick **Associated Domains** → Save.
2. Force EAS to mint a fresh profile that includes it:
   `npx eas credentials -p ios` → production → **Build Credentials** → remove the
   existing provisioning profile so the next build generates one.
3. Put the key back in `app.json`:
   `"associatedDomains": ["applinks:atwe.com", "applinks:www.atwe.com"]`
4. Serve `/.well-known/apple-app-site-association` from atwe.com — **this is the
   half people forget.** Without it iOS silently declines to open the app even
   with a correct profile, and it must be served as `application/json` with no
   file extension and no redirect.

Left undone on purpose: it needs Apple-portal access, it is a convenience rather
than a feature, and it was standing between the founder and having the app on
their phone at 2am.

## 🚢 THE SHIP SWITCH — how a new version reaches the founder's phone

**Push the working branch to `ship`. That is the whole thing.**

```bash
git push origin claude/claude-md-docs-cajkf9:ship --force
```

`.eas/workflows/build-ios.yml` fires on a push to **`ship` and nothing else**,
builds the production profile, and submits to TestFlight by itself. The founder
does nothing — they get a TestFlight notification about 20 minutes later.

**Why a dedicated branch rather than either extreme.** It used to fire on EVERY
push, and that emptied the account's monthly iOS build credits twice — every
colour tweak, one credit. Removing the trigger fixed the cost and created a worse
problem: shipping became six clicks in a web page that a non-technical founder had
to perform by hand, and on 1 Sep it took most of an hour of their evening with me
talking them through each click. The `ship` branch is the middle ground: **work is
free, shipping is one push, and WHEN to ship is still their call** — they say "ship
it", we push.

`ship` is a **pointer, not a place work accumulates** — force-push it, its history
is deliberately disposable.

**A push trigger only fires when the workflow file exists ON the branch pushed**,
so `ship` must be made from a branch that already has it. Pushing the working
branch to `ship` does exactly that, which is why that is the documented move.

**Running it by hand still works** (Expo dashboard → Workflows → Run workflow →
enter the git ref → Load → pick the file → Confirm, or
`npx eas workflow:run build-ios.yml`). Note the dashboard's git-ref box defaults
to `main`, **and `main` has no `atwe-mobile/` in it at all** — so it reports "no
workflow files found" until you type the working branch. That cost real confusion.

### What was learned about the cost, and it is not what this file used to say

**A FAILED build costs nothing.** The build page says so outright: *"This build
does not count towards your EAS Build usage."* Only a build that succeeds spends
a credit. This file's old advice — be cautious, a failure is expensive — was
wrong, and it made a careful debugging session out of something that should have
been "press the button and read the error". Press the button.

Historical note: every workflow run in the account has failed, back to July, all
triggered by "GitHub push". The three successful TestFlight submissions (0.1.0,
one month before 0.2.0) were done another way.

## ⚠️ Build in batches — one SUCCESSFUL build is one credit

`.eas/workflows/build-ios.yml` used to run **on every push that touched
`atwe-mobile/**`**. Each run is one of the account's monthly **iOS build credits**, so
every ordinary change — a colour, an icon, a one-line fix — spent one. That is what ran
the credits out in an earlier run, and it quietly happened again: **three routine commits
in one afternoon cost three builds** before anyone noticed.

**The push trigger is now REMOVED. Pushing changes nothing.** A build happens only when a
person asks for one:

```
Expo dashboard → Workflows → "Build and submit iOS" → Run workflow
# or
cd atwe-mobile && npx eas workflow:run build-ios.yml
```

**So: commit and push freely while working — that is free — and run ONE build at the end
of a batch.** Do not restore the trigger, however convenient auto-shipping looks; the
founder asked for exactly this and the reason is a real, recurring cost.

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
