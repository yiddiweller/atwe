# Atwe iOS — Project Status & Resume Point

_A living checkpoint so work can resume seamlessly. Update it as phases land._

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
- **Phase 1 (in progress) — real Home feed:** `app/(tabs)/index.tsx` +
  `src/components/PostCard.tsx` over `GET /api/social/feed` (For You / Following),
  X-style cards (avatar/verified/business shape, media, interactive like,
  locked/promoted states), pull-to-refresh, loading/empty/error states.

## Next up (Phase 1 continued → then phases 2–7)
1. Post detail + reply; compose screen; profile navigation from feed.
2. Onboarding / signup polish; Settings surfaces (theme, privacy, account).
3. Then per the Architecture & Build Plan: Beam · Engine · Atwe AI · Profile/
   money · App Store polish.

## How to run (fresh machine)
```bash
git clone https://github.com/yiddiweller/atwe.git atwe-app
cd atwe-app/atwe-mobile
npm install --legacy-peer-deps
npx expo install --fix
npx expo install react-native-worklets   # Reanimated 4 companion (SDK 54)
export EXPO_TOKEN=<expo access token>      # or `npx expo login`
npx expo start --tunnel                    # scan QR with Expo Go
```
**Future updates:** `git pull` in `atwe-app`, then `npx expo start --tunnel`.

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
- `--tunnel` needs an Expo login (EXPO_TOKEN or `npx expo login`).
