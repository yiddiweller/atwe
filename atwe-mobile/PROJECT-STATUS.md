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

## Finishing it: the seller's half, business ops, Beam's corners, the social gaps

Four batches, all against a real Postgres, all shot in both themes, all landing
with zero page errors. The app went **74 screens → 95**, and the four checkers
grew with it.

### Manage store — the hub the phone did not have

The BUYING side was complete; the running-a-business side had almost nothing,
and what existed was scattered (listings on an Account row, sales behind an icon
inside that screen). `app/store.tsx` is now the one place, with a live count of
orders waiting so nobody has to open it to find out whether anything is.

**Discount codes** — buyers could already TYPE one at checkout, so the box was
there for codes that could not exist. **Bundles** — several of your own things
for one price, and the SAVING is what the card leads with, because the saving is
the product. **Make an offer** — propose, counter, accept, decline, withdraw,
pay; ONE list rather than two shelves, because an offer changes sides as it goes
and splitting "mine" from "theirs" would move a row across the screen
mid-conversation. **Product Q&A** on every listing, seller's answer flagged.

**The checkout learned two targets rather than growing two checkouts.** `bundle`
quotes like anything else; `offer` deliberately CANNOT be quoted — the price is
already agreed between the two of them, so asking the server to price it is the
wrong question and the route refuses. `isQuotable()` makes that a rule rather
than a special case scattered through the sheet.

Proved with money, not screenshots: an offer at $38 → countered $42 → accepted →
paid moved **$42.00 out and $41.58 in** (the 42¢ is Atwe's own 1% fee), and the
same `clientId` replays the SAME order with no second charge. A bundle quoted
$80 subtotal / $10 discount / $70 total and charged exactly that.

### Running the business

**Reach** (who is looking, as distinct from Sales — what they bought), with a
30-day bar chart drawn as thirty rectangles rather than a chart library to carry
forever, and the one figure anybody can act on today: how well they answer
people, said as "usually within 12 min". **Team** with per-permission ticks and
the other side of it (businesses that have invited YOU). **Auto-messages**.
**Cart reminders**, with sent and recovered always together — sent alone is a
business messaging people with no idea whether it works. **Shipping labels**,
gated on the provider being configured.

### Beam's rarer corners

A ⋯ tools menu, because six rarely-used destinations in a header is six icons
nobody can tell apart: **search messages · starred · scheduled · broadcast lists
· labels · locked chats**. Plus a per-chat sheet for the three things that
belong to ONE conversation — disappearing messages, labels, and locking it.

**View-once** photos, and both halves proved against the server: the sender's
own copy carries the image, the RECIPIENT's copy has `image: absent`, opening
returns it once, and a second attempt is a 410 — which the screen reports as
"you have already opened this one", because that is the feature working.

### The social gaps

**Polls** (results hidden until you have voted or it has closed — showing counts
to somebody who has not voted is how you get a poll that measures the first
answer), **quote posts**, **lists**, **close friends**, **story highlights**,
and **translate**.

### What the guards caught, and what was wrong with the guards

Between them the four checkers caught, in these four batches alone:

- **`AppConfig` declared TWICE**, in two files, with nothing importing the
  `types.ts` one — so the type checker was faithfully verifying a shape the app
  never used while the real one quietly drifted.
- **The type checker could not see `export interface X extends Y {`** at all. It
  reported "no such interface" and SKIPPED it, which reads exactly like a type
  that legitimately has no example. `TeamMember` was being silently ignored.
- **The haptics guard followed `onPress={named}` but not `onPress={() =>
  named(x)}`** — which is what you write the moment a choice takes an argument,
  i.e. most of the time. It flagged CORRECT code, and the "fix" would have been
  to add a second buzz. Both widened, both self-tested by re-breaking them.

And three wrong guesses about the server, all found by driving it:

1. `POST /api/social/lists/:id/members/:uid` does not exist — adding takes the
   id in the BODY as `uid`, only removing takes it in the path.
2. `GET /api/highlights/:id` does not exist — the LIST route already returns
   each highlight with its items. Every highlight opened as "not available".
3. `POST /api/highlights` answers `{ok, highlightId}`, not `{highlight}`.

Plus two field names that fail SILENTLY rather than erroring, both now written
into the modules so they cannot be re-guessed: the team routes take
`permissions` as an **object** (the wrong name falls back to the role's
defaults, so somebody gets different access from the one that was ticked), and a
broadcast list takes `members`, not `memberIds` (the wrong name creates the list
empty and nobody finds out until they send to it).

**Final state: 86 interfaces checked against live payloads with 0 failures, 186
files under the haptics guard, 50 design tokens matching the web, all 106
notification verbs named. 51 screens swept in both themes and again as a
brand-new account — 153 loads, zero errors, nothing blank.**

## The night run — money, the post menu, the profile, Beam and notifications

Five batches after the Engine was finished, all against a real Postgres and all
shot in both themes with zero page errors.

### The money the wallet did not already cover

Ten surfaces on one `src/api/money.ts`: **gift cards** (a SEPARATE balance from
the wallet, Apple's model — a card holds its money until it is spent or moved
across), **invoices**, **quotes**, **rewards**, **invite friends**, **split a
bill**, **pools**, **scheduled payments**, **payment links**, **Subscribe &
Save**. Wired into the Account page as MONEY / GETTING PAID / TOGETHER.

Driven end to end, not just rendered: paying a split twice moves the money ONCE
and is zero-sum ($60 out, $60 in, the second call answers `alreadyPaid`);
accepting a quote produced a real invoice with the same lines and paid it; 400
points redeemed to $4; a gift card claimed by its recipient and $10 moved across.

**Three problems, each found by a guard rather than by eye:**

1. **The pool contributor is FLAT** — `{name, username, avatar, amountCents,
   at}` — not a nested `user` with `createdAt`. Declared the nested way it
   typechecked perfectly and would have rendered a list of blank names and blank
   times.
2. **`Quote` was already taken by `checkout.ts`** (a checkout price preview).
   Two concepts under one name — and worse, the type checker reads every api
   file concatenated, so it would have silently verified the WRONG one. Renamed
   `WorkQuote`, exactly as `Service` → `ServiceListing` before it.
3. **Paying an invoice is Stripe-or-nothing, not wallet balance.** The first
   version sent `payWith:'balance'` and a `clientId`; the route reads neither.
   Code that claims a behaviour the server has not got is a lie waiting to be
   believed.

### The post ⋯ menu — a safety hole, not a missing convenience

There was no way, anywhere on the phone, to **report** a post, **mute**
somebody, **block** them, or get a post **out of your feed**. `PostMenu` is a
real bottom sheet (Report needs a second page for the reason, and two stacked
system alerts read as an error rather than as a menu), and the reasons are the
server's own `REPORT_REASONS` — inventing friendlier labels would just mean every
report arriving mislabelled.

A hidden, muted, blocked or deleted post now actually LEAVES the list. The feed
is not refetched, so leaving the card sitting there made every one of those
actions look like it had failed. Proved by driving it: 24 posts, tap Not
interested, 23 posts.

No Unpin row, deliberately: `mapPost` carries no pinned flag, so a feed card
genuinely does not know, and saying "Unpin" on a guess is worse than not
offering it.

### The post header, on the web's actual numbers

- the picture is **36** (`card.shape`), the size at which its own radius is 18 —
  the same as the photo's — so it nests in the card's corner. It was 44.
- pinned to `flex-start`, so its inset is the card's padding on BOTH sides and
  its centre lands on the corner arc's centre.
- **the text column is given exactly the picture's height and centred in it.**
  Pinning the picture to the padding edge while a taller text column set the row
  height is what left the name ~4px below the face on the web, and the same
  thing was happening here. Fixing the column's height removes it by
  construction rather than by a nudge.
- the time and the ⋯ are ONE cluster in their own box, not a pair inside that
  fixed-height centred column — which is what puts them on one line, and lets
  the ⋯ sit at the padding edge where its corner is concentric.

**The tab row ends with the word "Add", not a pinned "+".** The web's own rule,
and not decoration: the pinned + sat on top of the last tab and chopped
"Collections" mid-word. As the row's last scrolling child it clears them, one
step quieter than a tab label so it reads as an extra action rather than a fifth
tab.

### The profile is tabbed — Posts · Replies · Media · Likes · About

Replies and Media came free (the payload already carried `replies`; Media is the
posts with a photo). **Likes is lazy** — most visits never open it, and loading
it with the profile would slow every visit for the few that do. **About** is new:
the trust score with the real dealings count, experience, education, licences,
skills (with the assessed tick and the endorsement count), recommendations. Each
block renders only when it has something, so a personal account shows one honest
line rather than five empty headings. A **pinned post** shows with its label and
is dropped from the timeline below it. **"Follows you"** beside the handle, and
**"Followed by Alice, Bob and 3 others"** with their faces.

**Word-only tabs, not pills** — the web's own `.ac-prof-tabs`, and for a measured
reason: five pills are ~700px of content in a 390px row, so "About" sat half
off-screen WHILE WHITE, i.e. the one indicator that says where you are was the
one being clipped. Five words fit inside the gutter.

The About types were written from the docs and were wrong; a real payload put
them right before a pixel rendered. An experience carries no `location` and no
`description` on the profile (edit-form fields), so two lines would have been
permanently blank; a certification has `credentialId`; a skill has `endorsed`
(did I endorse it), a different question from `endorsements` (how many did).

### Engine leads with the Ask Atwe AI hero

The web's `.xp-ai`, and it is the colour law working as intended: blue is
IDENTITY here (the assistant's own colour), so the gradient may be the accent
while the pill inside it stays white, which keeps "white acts" true even on a
coloured ground. There is no `--accent-mid` token, so the gradient's midpoint is
named explicitly rather than invented on the palette.

### You can start a conversation from Beam

Until now the only way to message somebody was to find their **profile** first —
and the empty Beam screen said so out loud, which means you had to already know
where they were before you could talk to them. A compose button (and a real
button in the empty state, not an instruction) opens a person picker: saved
contacts at rest, a search over everybody the moment you type, reusing the same
mention-search the composer uses rather than adding a second ranking.

### Notifications that say what happened, and stop repeating themselves

**The app knew 21 verbs. The server sends 106.** Everything else fell through to
"interacted with you" — a job application, a split request, an accepted quote, a
shipped order, a frozen wallet. It looks deliberate, it tells the reader nothing,
and nothing ever errored. The map is now GENERATED from the server's own
`PUSH_VERBS`, and **`tools/check-notif-verbs.js`** fails when the server grows
one the app has not got.

`app_<status>` (reviewed/shortlisted/rejected/hired) is built at the moment a
hiring status changes, so it is not in `PUSH_VERBS` and the generator cannot see
it — those four are named by hand with the reason recorded beside them.

**Consecutive** notifications of the same kind, from the same person, about the
same thing collapse into one row with a count. Every sign-in writes a `login`
row, and a test account had eighteen identical lines pushing everything real off
the bottom; 56 became 3. Only consecutive ones group — gathering scattered
events would reorder the timeline and lose the thread of what happened when —
and only when nothing is lost by it, so two likes on DIFFERENT posts stay two
events.

### The guards, and what each one is for

| tool | what it stops |
|---|---|
| `check-haptics.js` | one vocabulary; no double-buzz; every choice ticks |
| `check-design-tokens.js` | 50 colours + geometry + motion drifting from the web |
| `check-api-types.js` | a declared field the server never sends |
| `check-notif-verbs.js` | a notification the app cannot name |

Every one is self-tested by reintroducing the bug it exists to catch. Between
them they caught, in this run alone: two double-haptics in code written the same
session, a nested type that was flat, a name collision that would have made the
type checker verify the wrong interface, and 89 unnameable notifications.

### A brand-new account was walked through all 29 screens

Because empty states and first-run flows are where a new person actually lands.
Every screen rendered, every empty state was a human sentence with a way forward,
and there were zero page errors.

## The Engine is COMPLETE: eleven worlds, same as the web

The website's Discover row has eleven destinations. The phone had six. The
remaining five landed together, all backed by one new `src/api/discover.ts` that
mirrors the server's `mapShowcase` / `mapNewsletter` / `mapCommunity` /
`mapCourse` / `mapLesson` shapes exactly:

**Showcase** (`app/showcase.tsx`, `app/showcase/[id].tsx`) — the "show off
anything" surface. Discover ranks by popularity; a detail is the image gallery,
the description, an **appreciate** heart, comments (post + delete your own, and
the owner can moderate any comment on their own item), and — when the creator
attached one of their own listings — a product card that goes straight to buying
it. Deliberately distinct from Featured, which only pins an existing post.

**Newsletters** (`app/newsletters.tsx`, `app/newsletter/[id].tsx`,
`app/newsletter/issue/[id].tsx`) — Discover / Subscribed / Mine, subscribe and
unsubscribe, the issue list, and a reader. **A paid newsletter is honest about
it**: the server answers `402 {locked:true}` on an issue you have not paid for,
so the reader shows the lock and the price rather than an error, and the
Subscribe button carries the amount. Paying is a browser step (Stripe Checkout),
same as a ticketed event.

**Communities** (`app/communities.tsx`, `app/community/[id].tsx`) — Mine /
Discover, join and leave, the announcement channel called out at the top (it is
a real broadcast group and joining the community joins it), and the sub-groups
underneath, each joinable. The owner cannot leave their own community and the
button says so instead of failing.

**Courses** (`app/courses.tsx`, `app/course/[id].tsx`,
`app/course/lesson/[id].tsx`) — Discover / Learning / Teaching, a detail with the
teacher, the price, a progress bar, and the curriculum **grouped by module** the
way the server sends it. Enrolling is free-instant or wallet-funded; the lesson
viewer has the notes, the video, prev/next, and mark-complete, which updates the
progress bar without a reload. **The content gate is the server's, not ours** —
an unenrolled viewer gets the outline with `locked:true` and no body, which is
exactly what the screen renders, so there is nothing to leak.

**Shop with Atwe AI** (`app/ai-shop.tsx`) — plain-language product search over
`POST /api/ai/shop`, with the one-line reason the assistant gives for each pick.
It degrades: with no API key the server still returns plain retrieval and
`ai:false`, and the screen simply drops the reasons rather than showing an error.

Two shared pieces came out of building five screens at once, because writing the
same header six times is how six headers drift apart:
- **`PageHeader`** — back arrow, title, optional trailing action. One place.
- **`Shelf`** — the horizontal chip row every one of these worlds uses to switch
  scope. It owns its own select tick, so the haptics guard is satisfied by
  construction rather than by remembering.

Engine went 6 tiles → **11**, and the Settings **Discover** group lists all of
them.

### `flexGrow: 0` is not enough — a strip needs `flexShrink: 0` too

The two chip rows overlapped: measured **24.3px tall against 35px of content**.
In a flex column a child with `flexGrow: 0` will still be SHRUNK below its own
content height by whatever sits under it. Both properties, every time — it is now
one shared `rowStrip` style so it cannot be half-remembered.

### The type checker was verifying a fraction of what it claimed

`check-api-types.js` reported `ShowcaseAuthor` as **2 fields** when the interface
declares six. It read one field per LINE, so anything written `{ a: string; b:
number }` lost everything after the first semicolon — and it had been quietly
under-checking every compact interface in the file since it was written.

The obvious fix — split on every `;` — was **worse**: it tore inline object
literals apart mid-brace and produced three confident FAILs on types that were
completely correct (MoneyRequest, Profile, Applicant). A checker that cries wolf
is worse than no checker, because the next real failure gets waved through.

The right split is **at brace depth 0 only**:

```js
const lines = []; let d = 0, cur = '';
for (const ch of body) {
  if (ch === '{') d++; else if (ch === '}') d--;
  if ((ch === '\n' || ch === ';') && d === 0) { lines.push(cur); cur = ''; }
  else if (ch !== '\n') cur += ch;
}
```

**56 interfaces · 0 with a required field the server never sends.** Twelve of
those are new this run and every one was checked against a real payload from a
real Postgres, not against the docs.

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
  ~~business profile~~ ✅ ~~gift cards, invoices, quotes, rewards, referrals,
  splits, pools, scheduled payments, payment links, Subscribe & Save~~ ✅
  ~~the tabbed profile with About~~ ✅ ~~business reach analytics~~ ✅ DONE.
- **Notifications:** every verb the server sends is named, and consecutive
  duplicates group. What is NOT built: the web's in-overlay detail page for a
  sign-in alert, and the Atwe brand mark in place of the shield glyph on that
  row — the app icon has no alpha channel, so it cannot be tinted as a mask; it
  needs a transparent mark exported alongside it.
- ~~**Stories:** video~~ — CORRECTION, this note was stale for several
  sessions. Video stories PLAY (`expo-video`, `app/story/[userId].tsx`). It was
  true once, was fixed, and the note was never updated; it was repeated to the
  founder as fact. Worth remembering: a "known gap" is only worth as much as the
  last time somebody checked it.

### What is genuinely left, as of the finishing pass

- **Calls in Beam.** Needs `react-native-webrtc`. The blocker is not writing it
  — it is that a call cannot be TESTED here at all: no device, no second party.
  It would ship as several hundred lines nobody has watched work. The founder's
  call, and it should be made knowingly.
- **Live location.** Needs `expo-location`, a position watch and map links, with
  no GPS here to exercise any of it. Same shape of problem as calls, smaller.
- **Paying by card.** Stripe Checkout is a browser flow; in-app you top the
  balance up first. Apple Pay is the real answer and is Phase 7.
- **Buying a shipping label** is built but UNTESTED — no provider is configured
  in this environment, so `shippingLabelsEnabled` is false, the routes 503 and
  the button never appears. That is also its behaviour on the live server until
  the founder configures one, and the manual carrier + tracking entry is
  untouched.
- **Android release** — configured and buildable, needs a Play developer account.
- **Home-screen widgets** — genuinely blocked in managed Expo: a widget is a
  separate WidgetKit target in Swift. Not a matter of more effort here.
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

## The founder's nine-item list (this run)

They opened 0.4.0 on their iPhone and named nine things. All nine were addressed;
what is honestly incomplete is said so below rather than counted.

1. **Signing up was broken** — the blocker. At "What's your name?" you could type
   and nothing appeared. One shared `TextInput` answered all seven questions, so
   one native UITextField carried the previous step's state across: coming off the
   birthday step it still held a `maxLength` of 10 (iOS skips an undefined prop in
   the diff, so a cap is never cleared, only replaced) and a delegate predicted-text
   of the ten characters of a date, so every keystroke was measured as 10 + 1
   against a cap of 10 and refused before it could be drawn. Each question builds
   its own field now (`key={step}`), and the birthday no longer touches that field
   at all. **Native-only** — on the web each step renders a fresh DOM `<input>`, so
   the browser preview cannot prove or disprove it; what the preview DID prove is
   that a new account now walks start → email → code → birthday → name → password →
   @username and lands on its own feed.
2. **The code screen** is the web's `.otp-row`: six 54px boxes at radius 16 with
   the next one lit as the caret, and the web's resend line counting down from 30
   under it. ONE hidden input does the typing — six real inputs with focus hopping
   between them breaks paste, breaks backspace at an empty box, and breaks iOS's
   one-time-code autofill.
3. **The birthday** is the web's `.su-dob-wheels` to the pixel: 220 tall, 44 rows,
   88 of padding, a band of two hairlines rather than a filled block, faded at both
   ends, opening at ~25 with the 18 floor stated underneath. It also emits its value
   on mount — the wheels showed a complete date while the field was still empty, so
   Continue sat dead with nothing on screen saying why.
4. **The start screen's buttons** were 334 wide against the web's 310. The reason
   they kept missing: the start screen is TWO nested boxes on the web with different
   padding from a wizard step's (overlay 20 + `.auth-inner` 20 = 40 a side; a step is
   the app's one 14px margin). Built the same way now and measured at 310 at x=40,
   the live web's own numbers. The press-and-hold glow was already there — it grows
   to 1.04 on the web's own curve with a light wash at the finger.
5. **The opening mark** now ROLLS on the web's 2.4s curve while its fill sweeps
   grey → white → grey on a 2s beat, breathing .94 → 1.06. It was a flat white mark
   dimming slightly: the roll was right, the light was missing.
6. **Signing in plays the welcome moment**, which the phone did not have at all:
   the mark rolls in see-through at .28, dims away as your own photo zooms up
   through it at full colour, and the whole stage eases forward as the black lifts.
7. **Business pictures are round**, everywhere. Checked as a business account: 28
   avatar-shaped boxes on the feed, every one a full circle.
8. **The top bar** carries the Atwe mark + the world's name on the left and the
   plus / ⋯ / your photo on the right, on Home, Beam, Engine and Atwe AI.
9. **Account and Settings are the web's design.** This was the biggest one and,
   side by side, plainly right: the phone still had the flat list the web itself
   threw out — ~35 rows under uppercase headings with blue-tint icon discs — while
   the web has an identity hero, a wallet card, a search bar and section rows that
   each open a page of their own. Both pages are rebuilt from one table each
   (`src/me/sections.ts`, `src/settings/pages.ts`) that drives the hub, the pages
   AND the search, so a row lands in all three in one edit.

### 0.9.0 — Liquid Glass, done the way it actually works

**Three attempts at the nav bar were wrong, and the mistake was never a number.**
Each time the approach was: draw our own pill, put a glass texture inside it,
argue about the tint. Apple's own line, from the iOS 26 guidance, is *"if your
app already uses native controls, you get Liquid Glass automatically"*. It is
not a material you paint on. It is what the SYSTEM draws — the tint derived from
the content behind it, its own specular rim, its own scroll-edge state, its own
morph. A custom view with a `GlassView` in it can imitate that and will never be
it, which is exactly what the founder kept seeing and saying.

The old comment in `(tabs)/_layout.tsx` stated the error outright: the system bar
*"can't be reshaped, and we need it to morph into a + ball on scroll"*. That
trade — our effect over Apple's material — is what made Liquid Glass impossible.
And it bought nothing: **iOS 26 ships the morph itself**;
`minimizeBehavior="onScrollDown"` IS the shrink-on-scroll that was being
hand-rolled at the cost of the material.

**THE TWO CASES ARE DIFFERENT, and knowing which is which is the whole thing:**

| | what it is | what to do |
|---|---|---|
| tab bar, nav bar, toolbar, sheet | a **component** — behaviours no view can imitate | hand it to the system |
| button, card, any surface | a **material** — `GlassView` IS `UIGlassEffect` | apply it yourself |

So the five worlds are now expo-router's `NativeTabs`, a real
`UITabBarController`; and buttons go through `src/components/Glass`, which maps
onto Apple's own two styles:

- **`.glass`** — secondary. Translucent, **no tint**, content shows through.
- **`.glassProminent`** — primary. The same material carrying a tint, which is
  what makes it read as the loud one.

The colour law survives: still one loud action per screen, made of glass rather
than paint. **TINT IS FOR PROMINENCE, NEVER FOR COLOUR** — a tint heavy enough
to become the surface's colour has replaced the material with paint and it stops
being glass. That rule is in the file, because it is the one that was broken
three times. `isInteractive` is on everywhere: it is what makes glass bend and
catch light under the finger, it is **off by default**, and without it a glass
surface is a static pane — which is most of what "it doesn't look like Apple's"
means.

Consequences worth remembering:
- The founder's own nav artwork is **kept**: `Icon src={{default, selected}}`,
  and UIKit renders a tab image as a template, so the outline/solid pair still
  reads as off/on. Labels stay hidden, matching the web.
- The hand-painted press wash (three circles faking the web's radial `.tap-lit`)
  now runs **only on the fallback**. Real glass lights itself; painting over it
  is the covering-the-material mistake in miniature.
- A **destructive button is never glass**, on any iOS. It has to be
  unmistakable, and translucency is the opposite of that. `Glass` takes a
  `plain` flag so that decision lives in one place.
- `GlassTabBar` is **deleted**, not left dead. git has it if this needs undoing.

**WHAT COULD NOT BE VERIFIED, and it is not small.** `NativeTabs` is an **alpha**
API in SDK 54, and neither a `UITabBarController` nor `UIGlassEffect` can be
rendered in the browser preview this app is otherwise checked in — the web
fallback draws a stand-in tab bar at the TOP of the screen, so tab navigation
could not be exercised here at all, and every glass surface falls back to paint.
What is proven: it typechecks, it bundles, the fallback is unchanged, all 54
screens load and a full new-account signup still works end to end. Whether the
tab bar runs on a real iPhone is unproven, and **a navigation shell that fails is
an app that does not open** — if it does, revert `89d104c` alone.

**Headers followed in 0.10.0** — see the next section. Sheets and menus are
still plain views.

### 0.10.0 — the content scrolls UNDER the chrome

The founder sent three screenshots with Apple Messages beside them: *"instead of
it should stay a black piece on top and bottom it rather go underneath that and
it should get blurry."* They are right, and it is not a colour problem. Every bar
in this app was a solid row sitting ABOVE the scroll view, so a screen read as
three stacked blocks — a black slab, the content, a black slab — and a post or a
story ring was CUT at the slab's edge rather than passing behind it. A modern iOS
app has one continuous surface with translucent chrome floating over it. That is
the whole reason a bar reads as glass: you can see what is behind it.

**`src/components/Chrome.tsx` is the fix, and it is two halves that must agree.**
`ChromeBar` is the bar — absolutely positioned, carrying its own safe-area inset,
drawn as real Liquid Glass on iOS 26 (`GlassView`), as `systemChromeMaterial` —
the exact blur UIKit's own navigation bar uses — below that, and as a near-opaque
fill on web/Android, where a blur nobody can render reads as a smear. `chromePad`
is the top padding the surface underneath needs, so its content STARTS below the
bar and then travels under it.

**The pad is a constant, not a measurement, and that is deliberate.** A measured
height arrives a frame late and the whole page visibly jumps; every bar here is a
fixed row of fixed-size controls, so each component now pins its own height
(`SHELF_H`, `FEED_TABS_H`, `BEAM_TABS_H`, `CHAT_HEAD_H`…) and the pad is exact on
the first render. It is safe as a constant only because the app is
portrait-locked — the top inset never changes after launch. The ~30 inside pages
whose bar is bespoke use `useFloatingChrome()` instead, which measures. **It
measures the bar's CONTENT, not the bar**: putting `onLayout` on a `GlassView`
would mean trusting a native wrapper to forward the prop, and a wrapper that
quietly drops it leaves every one of those pages hidden behind its own header.

**A search field or a filter strip belongs to the bar, not to the page.** Left in
flow they sit as a second solid strip and the content stops at THEM instead — so
`PageHeader` gained a `below` slot and the shelves, search rows and chip strips
moved inside the glass. Jobs' bar is 192pt tall as a result; it occupies exactly
the space it always did, and now the listings run underneath it.

**Three traps, each of which shipped wrong once during this pass:**
- **A JSX tag scanner must not track quotes.** JSX text is full of apostrophes
  (`that's`), so a scanner that treats `'` as a string delimiter swallows the rest
  of the file and silently skips the tag. Braces alone find the end of an opening
  tag.
- **`\bhorizontal\b` matches `swap-horizontal-outline`.** An icon name inside a
  quoted string made the sweep skip a screen's only real scroller.
- **A horizontal chip strip left OUTSIDE the bar renders at y=0, behind it.** Jobs
  and Marketplace both looked like their whole header had collapsed onto itself.

**Proved two ways, because the browser cannot show glass at all.**
`tools/check-chrome.js` is the source-level invariant — 82 screens: every one
that floats a bar drops the screen's own top inset and pads every vertical
scroller under it (self-tested by re-breaking `starred.tsx`, which it catches on
both counts). And a runtime probe drives 90 routes in the preview at 390×844 and
fails if any text sits behind the bar at REST, which is how the two collapsed
headers and a `styles.center` with no `flex: 1` were found. What the preview
CANNOT show is the blur itself — on the web the bar is the opaque fallback, and
the shots prove only the geometry: content ghosting through it as you scroll.

### 0.10.0 — fully rounded: no squared corner, anywhere

*"The text bar as well as the text bubbles should be fully rounded on both
sides. It should look very cool like liquid similar to the iMessage. I am
talking about the whole entire app."*

**Every bubble carried one squared-off corner and that was the whole problem.**
`borderBottomRightRadius: 4` on a sent message, `borderBottomLeftRadius: 4` on a
received one — the old chat "tail". Three corners round, one nearly square, in
the 1:1 thread, in groups and on the Atwe AI page. iOS 26 Messages dropped that
years-old shape; the tails are gone here too, and a bubble is now round on all
four corners.

**No single radius can do both, and that is the whole lesson.** iOS clamps a
corner to half the shorter side, so anything that keeps a 41pt one-line bubble
circular (20.5 and up) also turns a 62pt two-line one into a lozenge. Two goes
at picking one number both failed for that reason — 44, then 22 — and the
founder rejected each on sight.

So the shape follows the BOX. `useBubbleRadius` watches the bubble's own height:
a capsule while it is one line, `radius.bubble` (18 — iMessage's own corner) the
moment it is two. The first render guesses from the text's length rather than
starting wrong and correcting, because a bubble that visibly pops from capsule
to rectangle as a thread paints is worse than either shape; `onLayout` settles
anything the guess got wrong on the same frame.

**The composer's two ends were not the same object.** The ＋ was a bare 34pt
glyph and the mic a 38pt filled disc, so the right end hugged the pill's edge
while the left floated 6pt further in — one was a shape and the other was not,
and it read as lopsided. Two identical discs at identical insets is the only way
two ends can match: measured, 38x38 both, 11pt in from each side and 8pt up from
the bottom on both.

**The chat composer cannot simply be `pill`, and the reason is worth keeping.**
The ＋ and the mic sit in its bottom corners under `overflow: 'hidden'`, so too
big a corner CLIPS them. Solving `(r-padH)^2 + (r-padV)^2 <= r^2` for the button's
own corner gives r <= 35 at 14pt of side padding; it ships at 34 with 14. It is a
true capsule at rest (52pt tall) and stays one through two and three lines.
Widen the padding before raising the radius.

**The law, applied to the whole app:** anything you type into is a capsule
(`radius.pill`) if it is one line, and `radius.bubble` if it can grow — 32 named
fields across 155 files: every form field, every search bar, the reply boxes, the
Q&A ask box, the story caption, the bio, the offer and counter-offer amounts, the
password field. A photo inside a bubble takes the bubble's corner minus its
padding, so the two nest instead of arguing. The cards inside a conversation
(money, invoice, order) moved from a 14pt box to the app's own card corner — a
tight rectangle beside a capsule reads as a different app.

**Two things deliberately NOT rounded, so they are not "fixed" later:** the
six-digit code boxes at signup are exact squares and would become six circles,
and a bottom SHEET is round on top and flush to the screen at the bottom — those
files are listed by name in the checker.

`tools/check-rounding.js` holds the line: nothing that draws a message may set a
per-corner radius, and a field may only be `pill` or `bubble`. Self-tested by
putting the tail corner back, which it catches by name.

**The web still uses a 22px bubble and a 24px composer** — this is the phone
going first, so the two are deliberately out of step until the founder says to
mirror it. The web's composer radius is load-bearing there (its inner cards are
derived from it), so that is a change to make on purpose, not by sweep.

### 0.10.0 — the edge, not a bar

*"When I scroll up and down there's no black bar on top, and on the bottom it
goes in the background and it gets blurry and darker as you go down. I want this
idea in the whole entire app."* Three reference shots, all of the same thing: a
screen with no chrome boundary anywhere.

**A translucent bar is still a bar.** It has an edge, and an edge is a line
across the screen saying "the app stops here". What a modern phone does instead
is DISSOLVE the content at the top and bottom: it goes behind, blurs, darkens,
and is gone, with the controls floating on top as their own rounded pieces.

`ChromeBar` therefore draws no fill and no hairline. It draws three things:
- **A progressive blur** — `BLUR_LAYERS` blur views stacked at the edge, each
  shorter than the last, so they overlap most at the very edge and taper to one
  thin layer. Stacked blurs compound (each samples what is already drawn beneath
  it), which is how you ramp a blur without a native masked view — the only
  other way, and a new native dependency. iOS only; Android's blur is unreliable
  and the browser has none, so both fall through to the fade.
- **A scrim held at `SCRIM` (0.86) across the whole bar**, so a control is
  legible over ANY content — a white photo included. This is not a gradient from
  strong to nothing: the first attempt was, and on Home the feed tabs sat in the
  weak end of it and were washed out by a photo passing behind. Two elements,
  not one gradient, because a single one places its stops as FRACTIONS and the
  bars here run from 35pt to 190pt — the same fractions leave a tall bar's
  controls standing on almost nothing.
- **A `FADE_TAIL` (30pt) that reaches PAST the chrome into the page**, where the
  scrim lets go and the blur's own outer edge is hidden. Without it the fade
  would have to be gone by the bottom of the bar, which is exactly where the
  controls are.

`useFloatingFoot` adds the tail to its padding and `chromePad` does not, and
that asymmetry is deliberate: a conversation RESTS against the bottom, so
without it the newest message would sit permanently half-dissolved. A feed does
not rest against the top, so 30pt of dead space there would be a gap.

**Every chrome control now floats on its own surface.** Once the bar is gone
there is nothing behind a bare glyph but the page's own scrolling content, and a
chevron over a photo is unreadable. `ChromeButton` / `ChromeSurface` are Liquid
Glass on iOS 26 and a tinted disc below it — the same material `BrandBar`'s
＋ · ⋯ · photo already used, so the top of every screen reads as one family. The
back arrow and the one action on all 45 `PageHeader` pages, plus 30 bespoke
headers found by codemod, and in a conversation the person or group became a
PILL beside them rather than a label on a bar.

**The composer floats too.** Messages travel under it and dissolve into the
bottom of the screen. Its `ChromeBar` takes `inset={false}`, because
`GlassComposer` already carries the safe-area inset itself and a second one
lifts it off the bottom of the screen.

Verified in both themes against a real 17-message thread and a photo-heavy feed:
content ghosting through and dissolving at both edges, no boundary line
anywhere, chrome legible over a white photo. What the preview still cannot show
is the blur — on the web only the fade renders.

### 0.10.0 — the tab icons, and menus that actually open

**The tab icons were 19pt of ink in a 26pt box.** UIKit does not resize a
tab-bar image — it draws it at the image's own point size — so the 72% of the
canvas the glyph filled WAS the size on screen, noticeably smaller than the SF
Symbols in any Apple tab bar. `tools/build-nav-icons.py` crops the shared
padding off the founder's 160pt masters and writes a 30pt canvas with a 27pt
mark: 40% bigger, nothing redrawn. It crops the FAMILY with one box rather than
each icon to its own — the bell is narrower than the four rings on purpose, and
normalising each glyph would inflate it against its neighbours.

**The ＋, the ⋯ and your own photo now open a menu.** Three dots PROMISE a list
and were silently a shortcut to one thing; the avatar went straight to the
profile with nothing behind it. `GlassMenu` is that list, drawn the way iOS 26
draws a context menu: Apple's real Liquid Glass (`GlassView`), label left and
icon right — Apple's order, and the web's glide menu's. It **grows out of the
button**, which is the part that makes it read as native: the caller hands over
the button's own on-screen rect (`measureInWindow`) and the card's transform
origin is the corner nearest it. A card that scales from its own middle reads as
a dialog. There is no dim behind it, because an iOS context menu darkens
nothing — the glass and the shadow are what separate it.

Home's ＋ is New post · New story · Sell an item · Post a job; its ⋯ is
Settings · Saved · Help & feedback; your photo is View profile · Wallet ·
Settings · Log out on every world. Beam keeps its own two sheets — they are
purpose-built and already open something.

**The bottom bar's shrink-on-scroll is already on, and cannot be a slide.**
`minimizeBehavior="onScrollDown"` is set, and `automatic` / `never` /
`onScrollDown` / `onScrollUp` is the entire list react-native-screens exposes.
Apple's behaviour is to MINIMISE the bar into a small pill in place, not to
slide it off the bottom; hand-rolling the slide is precisely the trade that cost
this app the real material three times over. It needs iOS 26 — on 18–25 the
native side logs a warning and leaves the bar alone.

### 0.10.0 — why the bar shrank on Account and nowhere else

The founder found it themselves: on the Account page, scrolling down collapses
the tab bar from right to left into a little pill. *"Is there a way you can do
the same thing in the home and beam page."*

**iOS finds a tab's scroll view ONCE.** `tabBarMinimizeBehavior` needs a scroll
view to minimise against, and UIKit resolves it when the tab's view controller
is set up. Account renders `<ScrollView>` unconditionally, so there was always
one to find. Home, Beam, Engine and Alerts all did this instead:

    {isLoading ? <spinner/> : isError ? <error/> : <FlatList .../>}

— so at the moment iOS looked, there was no scroll view at all, and the bar
never shrank on those worlds again. Each now keeps **one always-mounted list**
with loading and error inside its own `ListEmptyComponent`. Beam went from four
FlatLists behind a four-way tab conditional to one list whose rows, empty state
and pull-to-refresh come from a `pane` descriptor — four lists read identically
on screen, but swapping the whole list out on every tab tap is the same bug
arriving a second way.

**The chrome now renders AFTER the content, everywhere.** It is absolutely
positioned with `zIndex: 20`, so it still paints and receives touches on top —
but in the native view order the page's own vertical scroller is now first,
rather than sitting behind a bar that (on Home) contains a HORIZONTAL ScrollView
of feed tabs. A horizontal strip that never scrolls vertically is exactly the
wrong thing for UIKit to pick.

`tools/check-chrome.js` now guards it: all five worlds must keep a scroller
mounted and none may hide it behind a loading branch. Self-tested by putting
Home's list back behind `isLoading`, which it catches by name.

**And the ＋ is back**, as `ComposeFab` on Home and Beam — the web's own compose
button, white because white is the one primary action per screen. It earns its
place precisely because the bar minimises away: it floats clear of the bar,
stays put when the bar shrinks to its pill on the LEFT, and is what leaves you
able to write something with the bar gone. A ＋ INSIDE the minimised pill is not
possible — UIKit draws the active tab's icon there, and react-native-screens
exposes no accessory API.

### 0.10.0 — the top chrome leaves too

*"When I scroll up, it goes up entirely on the whole entire app screen. You
shouldn't have this black bar on top."* Sent with a shot of Home on 0.9.0: the
story tray sliced in half by a band that never moves.

**The bar now retracts.** `useChromeRetract()` watches a world's scroll and
`ChromeBar` slides itself out of the way — down and it goes, up and it comes
back, pinned open at the top where there is nothing above to reveal. It is the
counterpart to iOS 26 taking the tab bar away at the bottom, and the same thing
the web's own top bar has always done.

**What slides is the bar's CONTENT, not the bar.** `ChromeBar` measures itself
and travels by its height LESS the safe-area strip, so a fully retracted bar
still leaves that strip covering the clock — a screen that lets a photo run
under the time is not tidier, it is unreadable. The screen only has to hand over
its scroll events; the arithmetic lives in one place.

The thresholds are 6pt rather than 0 on purpose: a finger is never perfectly
still, and a bar that flips on a 1pt wobble reads as a fault.

**The scrim behind the chrome is now two numbers, and the difference is the
point.** Where the blur runs, IT is what keeps a label legible over a white
photo — the tint only has to take the edge off, and a heavy one turns the glass
back into the black band the whole thing exists to remove. So iOS gets 0.42;
the browser and Android, which have no blur at all, keep 0.86 because there the
tint is the only thing between a label and the photo. The single 0.86 that
shipped a build ago was the browser's number applied to the phone.

Verified by measuring the bar's real position through a scroll on all four
worlds: Home 0 → −98 → 0, Beam 0 → −110 → 0, Engine 0 → −105 → 0, Alerts
0 → −35 → 0. `tools/check-chrome.js` now also fails a world whose chrome has no
`retract` — self-tested by taking Beam's off.

**A note for next time: none of the last five rounds has been on a phone.**
0.10.0 carries the dissolving chrome, the fully rounded bubbles and fields, the
floating controls, the bigger tab icons, the glass menus, the minimise fix and
this — and every screenshot the founder has sent since was taken on 0.9.0.

### 0.10.0 — two grades of chrome button, which is Apple's own split

Four more references — Photos, Voicemail, the Phone keypad — and read together
they say one thing the app was missing. Apple's floating chrome has **two**
grades, not one:

- a **quiet** dark circle or capsule: the filter button, `Edit`, a bare ＋;
- one **prominent** lighter capsule that the screen is actually FOR: `Select`,
  `Greeting`. It is `.glassProminent` — the same material carrying a tint — and
  in the Photos shot you can watch a green message bubble tint it as it scrolls
  behind, which is the giveaway that it is glass and not paint.

`ChromeSurface` now takes `prominent`, and `ChromePill` is the same control with
a WORD in it — Apple names a chrome action wherever the word is shorter than the
explanation an icon would need, and it becomes a capsule sized to its label
rather than a glyph squeezed into a circle. The tint is NEUTRAL, not the brand
colour: what colours Apple's prominent pill is whatever is scrolling behind it.

Applied where the app already had a bare word floating in a header row: the
composer (`Cancel` quiet, `Post` prominent), Add story, Add money and Cash out.
**One prominent button per screen** — a screen with two has none.

### Built, not yet shipped — the cards inside a conversation

Beam's own pitch is *"send money in the chat: pay, request or split a bill
without leaving the conversation"*, and on the phone every one of those rendered
as the literal text **"📎 Attachment"**. Somebody sent you $50 and you saw a
paperclip. An invoice arrived with no way to pay it. An order, a split, a quote,
a shared listing, a call that had just happened — all the same dead paperclip,
in the thread AND in the chat list, so a list of conversations could not tell you
whether somebody had sent you money or a photo of their cat.

`components/MetaCard` draws them now — the web's `acMetaCard`, ported. Nineteen
kinds: money, money request, invoice, quote, split, order, offer, pool, gift
card, digital delivery, product, cart reminder, call log, location, live
location, contact, Daily reply and sticker. **Most share one shape** and that is
deliberate rather than lazy — the web's `mc-invoice`: a tinted disc, a title, a
line of context, an amount, the whole thing tapping through. Money, calls,
places, contacts, products and Daily replies each get their own, because each is
saying something a row cannot.

The point is that **the phone already had every destination** — `invoice/[id]`,
`quote/[id]`, `split/[id]`, `order/[id]`, `listing/[id]`, `pool/[id]`,
`offer/[id]`. The card was the missing link between a conversation and them.

Four things worth keeping:
- **A card IS the bubble.** No coloured pill behind it — the same reason a
  sticker has none. A blue bubble wrapped round a grey card is two backgrounds
  arguing.
- **The body is not printed twice.** The server sends text alongside a card for
  the chat-list preview and for anything that cannot draw one; under the card it
  just says everything again. A Daily reply is the exception the other way — the
  card IS the reply, so it renders the body itself.
- **A card gets a wider bubble** (90% against a text bubble's 78%). At 78% every
  title truncated — "You received m…" — and every subtitle wrapped to three
  lines. And the amount never shrinks or wraps: a figure broken across two lines
  is unreadable and a truncated one is worse. The title gives way instead.
- **`last_meta` is the bare TYPE, not JSON.** The conversations query selects
  `lm.meta->>'t'`, so `metaLabel` reads it directly. Checked against the server
  rather than assumed — parsing it as JSON would have thrown on every real value
  and fallen straight back to the paperclip this exists to replace.

**Not built:** `buttons`, `inboxmenu`, `askhuman`, `form`, `formreply`, `doc`,
`deal`, `moneydrop`, `shopcampaign`, `callschedule` — business-inbox and
automation cards whose surrounding surfaces the phone does not have. They fall
through to nothing rather than to a paperclip.

**Checked** against nineteen real seeded cards in a live thread, both themes:
every one draws, none says "Attachment", and the chat list names them. Plus the
usual 162 screen loads and all five checkers.

### 0.8.0 — the chopped text

The founder photographed three screens with the bottom of the letters sliced
off: the wallet balance `$0.00`, the `@handle` echoed on the password screen,
and the `@` beside the username field. One cause behind all three, and it is the
same primitive that was wrong the build before.

`Text` applies the `body` variant by default, and body carries
`lineHeight: 21`. **Any style that raised `fontSize` past 21 without also
raising `lineHeight` was drawing a tall glyph inside a short box**, and on iOS
that clips. A scan found **thirteen** styles with that shape — including the
40px balance on the Wallet screen, which nobody had reported yet.

Fixed twice over, on purpose:
- **In the primitive.** When a style sets a `fontSize` at least as large as the
  line box it would inherit, and says nothing about `lineHeight`, the inherited
  one is dropped and the font decides. Deliberately only when it would actually
  clip — below that the roomier default is the look that shipped.
- **At each site.** All ten `Text` styles now name their own line box (~1.18×,
  which is what a browser gives a heading and what `.auth-steptitle` uses at
  30/34.5), so the spacing is a decision rather than whatever is left over. The
  three `TextInput` styles are deliberately exempt: an input has no inherited
  line height to be crushed by, and setting one on iOS shifts the caret.

**`tools/check-lineheight.js`** is the guard, and it is a SOURCE check rather
than a screenshot one for a reason worth remembering: **a browser does not clip
a short line-height, it lets the text overflow.** The web preview every other
part of this app is checked in physically cannot show this class of bug. It is
only visible on a real phone, so it has to be caught in the source or not at
all. Self-tested by re-breaking the wallet balance.

**And the Continue button sat under the keyboard** on the signup steps — visible
in the founder's third screenshot, half-covered on the @username step.
`KeyboardAvoidingView` works out its own lift by measuring its frame against the
keyboard's, and inside a safe-area view that already claims the bottom inset the
two measurements disagree. Replaced with the web's own rule, ported: read the
keyboard's height directly (`lib/keyboard`, the `--kb` custom property) and pad
the step by `max(26 + safe-area, keyboard + 16)`, which is `.auth-step`'s
padding-bottom verbatim. No measurement left to get wrong. `Screen` drops its
bottom edge on those steps so the inset is not counted twice.

**Checked:** 162 screen loads (54 × dark, light, business), a full new-account
signup end to end, and all six checkers.

### 0.7.0 — what the founder found on a real phone

Creating an account **works** — confirmed on their iPhone, which is the one thing
the browser preview could never prove. Three things they marked, and all three
were real:

**1. The terms line rendered at two sizes.** "By continuing, you agree to our"
came out at the right 10.5px and the *Terms* / *Privacy Policy* links beside it
at 15. The cause was not that line: `components/Text` defaulted `variant` to
`body` on EVERY Text, so any Text nested inside another was stamped with body's
15px/21 and blew out of whatever it was sitting in. Fixed at the root with a
nesting context — a Text inside a Text now takes no base style unless it asks
for a variant, which is the rule CSS has, and it fixes every nesting in the app
at once rather than this one. Measured after: all three runs on that line are
10.5px.

**2. Opening the app blinked a bigger logo.** iOS draws its own launch screen
first and the animated one mounts over it, so the two have to agree — and they
did not: the launch screen drew **splash.png at 104** while the animation faded
**logo-mark.png in from nothing at 62**, starting dark grey. A big white mark,
a gap, then a smaller dim one growing in. Now: the same file at the same size,
and the animation *starts* at the launch screen's exact end state (full white,
full opacity, full scale) and moves away from it rather than toward it. The
pulse runs white→grey→white rather than grey→white→grey for that reason.
**`tools/check-splash.js`** keeps the two files in step, because two numbers in
two files is exactly the pair that drifts; it is self-tested against both
failures.

**3. The nav bar still did not read as Liquid Glass** — their third complaint
about it, beside a screenshot of Apple's own Phone tab bar, which you can plainly
see the call list through. Two things were wrong and one is still unknown:
  - The tint was **.28**, which is our own paint rather than a lens. It is .10
    now, and the colour-bleed it was fighting (an orange photo turning the bar
    orange) is left to `regular` glass, which is Apple's ADAPTIVE material and
    already solves it — the heavy tint was fixing a problem the material fixes
    better.
  - A **1px border was drawn on top of the glass**, which turns any glass
    surface into an outlined pill. Gone on the glass path; the fallback keeps
    its hairline, since a blur has no rim of its own.
  - **The fallback was a solid pill with extra steps** — a hand-rolled blur at
    intensity 12 under a near-opaque `rgba(18,18,21,.90)` fill. It now uses
    `systemChromeMaterial`, the exact UIKit material a native tab bar uses, at
    full strength with nothing painted over it.

**The unknown, and it decides everything:** Liquid Glass needs **iOS 26**. Below
that the bar draws the chrome fallback and always will, and there is no way to
tell the two apart from a photograph. So **Settings → About now reports the iOS
version and which material the bar is actually drawing** — "Liquid Glass" or
"Chrome (needs iOS 26)". One screenshot of that page settles it.

**Checked:** 162 screen loads (54 × dark, light, business), a full new-account
signup end to end, and all five checkers.

### Finishing it off (0.6.0)

The three gaps named above were closed, and one real bug turned up doing it.

- **Beam has the web's four tabs — All · Chats · Calls · Contacts.** *All* is the
  merge and what it opens on: every conversation, DM and group together, newest
  first. Two lists side by side make you check both to find out what just
  happened. *Calls* is a plain read of `/api/calls` — worth having whether or not
  a call can be placed from the phone yet. A **missed** call is red; a
  **silenced** one is not, because that is the "silence unknown callers" setting
  working as asked and colouring it would say otherwise. *Contacts* opens the
  conversation, not the profile — this is the messaging world, and the reason to
  look somebody up here is to say something to them.
- **Settings → Security & access:** the devices signed in, with the one you are
  holding marked and deliberately given no action (it cannot sign itself out from
  there; a control that does nothing is worse than none), remove-one, and sign
  out everywhere — which logs this device out locally too rather than leaving the
  app holding a dead token. Changing a password goes through the emailed link on
  purpose: an unlocked, signed-in phone should not be enough to change the
  credential that gets you back in if the phone is stolen.
- **Settings → Your data & storage:** download everything of yours as a real file
  handed to the share sheet, and deactivate — reversible, and it says so in those
  words, because "deactivate" and "delete" are not the same thing.
- **Account → Help & feedback**, its own card as on the web. Feedback goes
  straight into the `support_requests` inbox staff already work, not a mailto:
  link to a mail app somebody may never have set up. Proven end to end: a real
  row landed with the right category.

**The bug:** that row came back stamped `0.1.0` — a version in neither app.json
(0.5.0) nor package.json (0.2.0). It was reading `Constants.expoConfig.version`,
the runtime manifest, which is not the file. A version on a support ticket is the
first thing anybody checks, and a wrong one is worse than none. `src/lib/version`
now reads app.json directly, and package.json was pulled into step — two fields
that can disagree eventually do.

**Still not there, and why:** *Premium & verification* — selling a subscription
inside an iOS app is Apple's business, not a Stripe redirect, and doing it wrong
is how an app gets rejected. *Atwe Assistant* — nothing behind it yet. Placing a
call still needs `react-native-webrtc`, which cannot be tested from this
environment.

**Checked:** 162 screen loads (54 screens × dark, light, and as a business), the
four checkers (haptics 198 files, 50 design colours, 106 notification verbs, 44
API shapes with no required-field gaps), and the call log proved against seeded
rows so the missed / silenced / answered states were each seen rendering.

### What is honestly NOT there
- The web's **Customers, Creating, Atwe AI and Help & feedback** sections of the
  Account page, and Settings' **Security & access, Premium & verification, Atwe
  Assistant and Your data & storage**, have no screen on the phone yet. A row that
  opens an empty page is worse than one that is honestly absent, so they are left
  out rather than stubbed. Nothing that was reachable before was dropped.
- **Beam still has Chats + Groups where the web has All · Chats · Calls · Contacts.**
  Calls need `react-native-webrtc`, which cannot be tested from this environment.
- The **Liquid Glass bar** uses the real API — `GlassView` `regular` +
  `isInteractive` inside a `GlassContainer` so the bar and its active pill merge —
  but `isLiquidGlassAvailable()` is false in the browser preview, so the preview
  always draws the blur fallback. **It can only be judged on a real iOS 26 phone.**

### Two real bugs the rebuild turned up
- `/jobs` and `/orders` ignored a scope, so "Jobs I posted", "My applications" and
  "Saved jobs" would all have landed on the same unfiltered board. Both are
  deep-linkable now.
- The date wheels never emitted their starting value, so the birthday step's
  Continue was dead on arrival with a complete date on screen.

### Checked
- 150 screen loads (50 screens × dark, light, and as a business account): one flag,
  `/business-analytics` returning 403 to a personal account, which is the server
  being right and is unreachable from the UI for one.
- The four durable checkers: haptics (196 files), design tokens (50 colours),
  API types (44 interfaces, 0 required-field gaps), notification verbs.

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

### Round eleven — every button is real glass, not paint

The founder sent a photograph of a floating circular back button over content —
translucent, content showing through, a faint rim — and said *"all the buttons
should have this Apple liquid glass button, and it should be real"*.

The problem was never the material, it was that there were **two of it**. `Glass`
(real `UIGlassEffect` via `expo-glass-effect`) existed and `Button`/`ChromeButton`
used it; everything else hand-rolled its own disc:

    <Pressable style={[styles.disc, { backgroundColor: c.s2 }]}>

which is a painted grey circle. Next to real glass it looks nearly right. **On top
of it — a chip inside a chrome bar, a ✕ on a photo — it reads as a sticker stuck
to a window**, which is most of what "it doesn't look like an Apple app" means.

**One primitive now, in `Glass.tsx`:** `GlassSurface` (a pressable pane) and
`GlassIcon` (the same cut to a circle, `size` in, radius derived — iOS clamps a
radius to half the shorter side anyway, and a hand-typed 17 beside a 34 is one
edit from an oval). `Chrome.tsx`'s `ChromeSurface`/`ChromeButton` are now literally
`= GlassSurface` / `= GlassIcon`: two copies of a glass disc is how a back arrow
ends up a visibly different button from a composer's ＋.

**Converted** (23 sites): the story + highlight viewers' close, the compose ＋
(now `.glassProminent` carrying `--primary`, the same treatment `Button` gives its
primary, so the app's loudest control is not made of a different substance
depending on which file drew it), the Beam composer's ＋ and idle send, the
recording cancel, the attachment ✕ and view-once "1", the iMessage tapback bar, a
profile's Book/Message discs (which were **hollow outlined circles** — the one
thing design rule 3 forbids), both quantity steppers, the applicant stage
capsules, and every filter chip: the shared `Shelf` plus a new shared `GlassChip`
replacing six near-identical hand-rolled copies across Jobs / Marketplace /
Events / Services / Workers / post-job / offer-service / add-story / ApplySheet /
BookSheet.

**What deliberately stays a solid fill, because a colour is doing a job:**
- **The armed send button.** That blue circle IS iMessage's send and IS the
  affordance; a see-through one would be the quietest thing on the bar at the
  moment it matters most.
- **A chosen chip.** The fill is the answer to "which one am I on"; a
  see-through selected state cannot say that.
- **Destructive buttons** (`Button kind="danger"`, already `plain`) — a
  destructive action has to be unmistakable and translucency is the opposite.
- **Decorative discs that are not buttons** — a wallet transaction's icon, a
  notification's brand mark, a meta-card's glyph, a colour swatch. Glass on a
  `<View>` would be the material pretending.
- **The voice-note play control**, which lives INSIDE a message bubble and is
  tinted BY that bubble; glass there would sample the bubble it already sits on.
  It is the checker's one exemption, named in the file.

**`tools/check-glass-buttons.js`** is the guard: a circular or capsule style used
as a Pressable's own background may not carry a NEUTRAL fill (`s1`/`s2`/`s3`/`bg`
or a hand-mixed white alpha). A SEMANTIC fill — accent, primary, danger — passes,
because the rule is about grey, which is glass pretending. Self-tested: putting
`backgroundColor: c.s2` back on the composer's ＋ fails it by name; it caught
three sites the manual sweep missed (`applicants` move, the attachment ✕, the
view-once toggle).

**One real regression the sweep introduced and the type-checker caught:**
converting the cart's steppers dropped their `disabled={busy === key(i)}` guard,
because `GlassIcon` had no such prop — a double-tap would have fired the same
quantity change twice. `GlassSurface`/`GlassIcon` take `disabled` now (0.5
opacity, `accessibilityState`), and it is documented on the prop as exactly this
failure. **Any future conversion has to carry the guards the Pressable was
carrying.**

Verified: `tsc` clean, all 7 runnable checkers green, and 15 screens driven in a
real browser against a real database — every one renders, **0 page errors**. The
composer's two discs measure 38×38 at the same y with 31pt of inset on each side.
The web preview cannot draw Liquid Glass at all, so what it proves is the
FALLBACK (a near-opaque disc with a rim) and the geometry; the material itself
only exists on the phone.

**Then the verification pass found a real one.** The story viewer's close button was a
**white disc with a white ✕ on it** on a Light-theme phone — invisible. The material's
fallback is chosen by THEME, and I had forced the glyph to white (correct, since it sits
on a photograph) without making the DISC follow. My own doc-comment had anticipated it
and named the fix; I never implemented the prop.

`overContent` does now: a button on full-bleed media keeps the DARK material whatever the
app's theme is — which is what Apple's own photo viewers do. Applied to the story close
and the three "remove this photo" ✕ buttons (composer, compose, add-story), all of which
sit on a picture. **Any new control over media needs it**, and `check-glass-buttons.js`
now fails the build if a glass button forces a white glyph without it. That check had its
own bug worth remembering: it found the opening tag's end at the first `>`, which lands
**inside an arrow function in a prop** (`onPress={() => …}`) and hid every prop written
after it — so it reported two correctly-marked buttons as broken. It tracks brace depth
now.

Touch targets: three controls (the tab row's "Add", the composer's photo and poll glyphs)
drew smaller than Apple's 44pt floor and were relying on `hitSlop` 8, which only reaches
39–41. Widened to clear 44. Nothing drawn moved.

Verified after: `tsc` clean, **all nine** checkers green (including the two that need a
live server + browser), 25 screens driven in both themes with **0 page errors and 0
clipped elements**, and the top-bar retraction re-measured unchanged — Home 0→−98→0,
Beam 0→−110→0, Engine 0→−105→0, Alerts 0→−35→0.

### Round twelve — the text bar was never a capsule, and the ＋ was paint

Three things the founder called, all correct.

**1. "The text bar should be fully rounded on both sides, except if it starts a
second row."** It never was. The pill declared `minHeight: 52` with
`borderRadius: 26` — which LOOKS like a capsule in the stylesheet, half of 52 —
but `minHeight` is a floor, and the real box measures **64pt**: a 38pt button
with 7 of padding either side, plus its border. A corner has to be half the BOX
(32) to close, so the bar has been a rounded rectangle at every height it ever
had, and my earlier claim that it was a capsule was wrong.

`useComposerRadius` (in `bubbleShape.ts`, beside the bubbles' own) drives it off
the measured height like everything else here: `radius.pill` while under 74,
`radius.bubble` (18) once the typing wraps. **NEVER derive a capsule's radius
from `minHeight`** — let `radius.pill` clamp itself. The radius has to go on
BOTH the clipping wrapper and the pill: the wrapper is what actually cuts the
glass, and a fixed corner there squares off the capsule drawn inside it.

Measured: 64pt → `999px` (clamps to 32, a true capsule); forced to 76pt → `18px`.
The browser's `<textarea>` does not grow the way RN's multiline `TextInput`
does, so the wrap case is proved by forcing the box taller — RN Web drives
`onLayout` from a ResizeObserver, so that exercises the real code path.

**2. Nav icons 30pt → 24pt.** `build-nav-icons.py` went `PT = 27, INK = 0.90`,
putting a **24.3pt mark** on screen. The number that matters is the VISIBLE
MARK, not the canvas: UIKit draws a tab-bar image at its own point size and the
glyph sits inside `INK` of it. Regenerated all 30 files; never hand-redraw them.

**3. The compose ＋ was a white ball.** It shipped white under the colour law's
"white is the one primary action per screen", and the founder rejected it on
sight — rightly. When you scroll, iOS shrinks the tab bar into its little glass
pill on the left, and a solid white disc opposite it is the one thing on screen
made of paint. Two floating controls on the same line have to be the same
substance. It is `GlassIcon` now — the app's one glass button, the same material
as the chrome buttons and the minimised tab pill.

**On "we lost the real Liquid Glass":** we did not, and it is worth writing down
because it will come up again. The grey blob at the top of every preview
screenshot is `expo-router/…/NativeTabsView.**web**.js` — the router's own
web-only stand-in for a tab bar, since a browser has no `UITabBarController`. It
appears in zero lines of our source, the glass work touched neither
`app/(tabs)/_layout.tsx` nor `assets/nav/` (**zero commits**), and the iOS build
uses `NativeTabsView.js` (react-native-screens, the real controller). The
preview server now hides it, so a screenshot represents the phone.

### Round thirteen — the floating ＋ is gone

The founder photographed it and said remove it. Done: `ComposeFab` is deleted,
not just unmounted, and with it the last floating control on Home and Beam.

**Nothing was lost, which is why this was a clean delete.** Both worlds already
had a better way in, and the FAB was duplicating it:

- **Home** — the top bar's ＋ opens a glass menu with **New post · New story ·
  Sell an item · Post a job**. Four destinations against the FAB's one. There is
  also the quiet "Add" at the end of the feed-tab row, the same as the web.
- **Beam** — the top bar's ＋ opens the new-chat sheet directly.

It had been added back a few rounds earlier at the founder's own request ("bring
back the web's ＋ button"), then reworked twice — white, then glass — before they
saw it in place and did not want it at all. Worth remembering rather than
re-adding on the next reading of the web: **the web's ＋ lives in the tab row,
not floating over the feed**, and the phone now matches that.

`spacing.gutter` and the safe-area maths it needed went with it; nothing else
referenced the component. tsc clean, eight source checkers green.

