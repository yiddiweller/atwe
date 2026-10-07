# Atwe — iOS (React Native + Expo)

The native iPhone (and, from the same codebase, Android) client for **Atwe** —
the business-networking platform at [atwe.com](https://atwe.com). It talks
directly to the **existing** Atwe backend (Express + PostgreSQL on Railway) over
its REST API and SSE realtime stream. **No backend changes are required.**

> This is the **Phase-0 foundation**: project config, the Atwe design-token
> system, a typed API client + realtime SSE client, secure auth (Keychain +
> Face-ID-ready), and the five-world native tab navigation with a real login and
> a real Profile screen. Each world (Home · Beam · Engine · Atwe AI · Profile)
> is then built out phase by phase — see the Architecture & Build Plan document.

## Requirements

- **Node** 20+ and **npm**
- **macOS + Xcode** for a local iOS simulator/device build — _or_ nothing but a
  browser, using **EAS Build** (Expo's cloud builder) + the **Expo Go** app on
  your iPhone. You do not need a Mac to preview.

## Run it (fastest path — on your own iPhone)

```bash
npm install --legacy-peer-deps           # lenient peer-dep resolution (SDK 54)
npx expo install --fix                    # align native deps to the installed SDK
npx expo install react-native-worklets    # Reanimated 4 companion (SDK 54)
npx expo start --tunnel                    # QR code; --tunnel works on any network
```

> Targets **Expo SDK 54** (matches the current App Store Expo Go). `--tunnel`
> needs a free Expo account (`npx expo login`, or set `EXPO_TOKEN`).

Scan the QR with the **Expo Go** app (iOS) → the app boots against production
Atwe. Log in with a real account; the Profile tab shows your live account.

> On a physical device pointing at a **local** backend, set
> `EXPO_PUBLIC_API_URL` to your Mac's LAN IP (e.g. `http://192.168.1.20:3000`),
> not `localhost`.

## Run on the iOS Simulator (needs Xcode)

```bash
npm run ios
```

## Cloud builds & TestFlight (no Mac needed)

```bash
npm i -g eas-cli
eas login
eas build:configure                 # writes the iOS credentials / project id
eas build --platform ios --profile preview      # internal test build
eas build --platform ios --profile production   # App Store build
eas submit --platform ios                       # upload to App Store Connect → TestFlight
```

Set the real `extra.eas.projectId` in `app.json` after `eas build:configure`.

## Project structure

```
app/                       expo-router routes (file-based native navigation)
  _layout.tsx              providers + auth gate + root stack
  (auth)/login.tsx         real sign-in (handles the 2FA challenge)
  (tabs)/_layout.tsx       the five-world tab bar (blur + haptics)
  (tabs)/index|beam|engine|ai|profile.tsx
src/
  theme/                   design tokens ported from the web CSS + ThemeProvider
  api/                     typed REST client, config, SSE realtime, shared types
  auth/                    Keychain token storage + AuthProvider (bootstrap/login)
  components/              themed primitives (Text, Button, Screen, …)
  constants/               the five worlds
  lib/                     React Query client
assets/                    app icon / splash (replace the placeholders)
```

## Architecture at a glance

- **Expo (managed) + TypeScript + Expo Router** — native navigation, edge-swipe
  back, typed routes; one codebase → iOS **and** Android.
- **TanStack Query** over a thin typed `api` client (bearer token from the
  Keychain). **SSE** realtime via an XHR-streaming client (`src/api/sse.ts`).
- **"White acts, blue identifies"** — the Atwe button/color law is encoded in
  the tokens, so the app stays unmistakably Atwe while gaining iOS materials.
- **Security** — the 30-day bearer lives only in `expo-secure-store` (Keychain);
  a global 401 drops the session; Face ID unlock via `expo-local-authentication`.

## Making this its own repository

This foundation currently lives in the `atwe-mobile/` folder of the backend repo
because a new GitHub repo couldn't be created from the build environment. To
split it into the intended standalone **`atwe-mobile`** repo:

```bash
# from a checkout of the backend repo
git subtree split -P atwe-mobile -b atwe-mobile-split
# create an empty atwe-mobile repo on GitHub, then:
cd /path/to/new/atwe-mobile && git init && git pull <backend-repo> atwe-mobile-split
git remote add origin git@github.com:<you>/atwe-mobile.git && git push -u origin main
```

(Or simply copy the `atwe-mobile/` folder into a fresh repo — it is fully
self-contained.)
