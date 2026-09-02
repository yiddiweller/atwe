# Browser probes for the phone app

These drive the **real UI** in a browser and measure it. They are the half of
the testing that `tools/check-*.js` cannot do: a type check and a source scan
can prove a component is written correctly, only a probe can prove a screen
actually **renders, opens and is on screen**.

> **They used to live in a session scratchpad**, which is one restart from being
> lost — the same mistake `tools/nav-icons/build.js` was rescued from. They are
> committed for that reason. Keep them here.

## What each one proves

| probe | what it asserts |
|---|---|
| `sweep2.js` | every one of 54 screens renders text and throws no error, in **both themes** (`THEME=dark\|light`). The broadest net. |
| `sheets.js` | every sheet wrapped in `<SheetGlass>` still **opens** and still shows a visible primary button. The wrap is a text transform over 18 files; a mangled span would swallow a sheet's body and nothing else would notice. |
| `retract.js` | the top bar slides fully away on scroll and comes fully back, on all four worlds. |
| `gap.js` | content starts exactly where the bar ends — the ~88pt dead-space bug. |
| `statusclash.js` | the retracted bar never rests **on** the clock. |
| `drawer.js` | the sidebar opens on Home *and* Beam with all 13 rows. |
| `noplus.js` | no ＋ in any top bar, and everything it used to reach is still reachable. |
| `menu2.js` | the top-right menus pin their right edge to the button that opened them. |
| `glassbtn.js` | a spread of screens render with no page errors. |

## Running them

Four things have to be true. **The preview is a WEB build of the phone app** —
it cannot render Liquid Glass or a native blur, so it proves *structure,
geometry and behaviour*, never material. Judge the material on a real phone.

```bash
cd atwe-mobile

# 1. a backend + its database (the probe DB, not production)
#    the default is postgres://atwe:atwe@localhost:5432/atwescore on :3262

# 2. build the phone app for web
EXPO_OFFLINE=1 EXPO_PUBLIC_API_URL='' npx expo export --platform web --output-dir dist-web

# 3. serve it at the ROOT of its own origin, proxying /api to the backend.
#    Expo Router must be at the root, and the app's fetches must be same-origin
#    (there is no CORS on the API) — this tiny front door satisfies both.
DIST=$PWD/dist-web API=http://localhost:3262 PORT=4399 node tools/probes/previewserver.js &

# 4. a signed-in session
export PW=/path/to/a/dir/containing/node_modules/playwright-core
export TOK=$(node tools/probes/jobtok.js <userId> | node -pe "JSON.parse(require('fs').readFileSync(0)).token")

./tools/probes/run-all.sh
```

`react-dom` and `react-native-web` are **not** project dependencies — they are
only needed for this preview. Install them without saving:
`npm install react-dom@19.1.0 react-native-web@~0.21.0 --no-save`.

Overridable: `BASE` (default `http://localhost:4399`), `CHROME` (a Chromium
binary), `PW`, `REPO`, `DATABASE_URL`, `JWT_SECRET`, `EM` (sweep2 logs in
through the real UI and needs the account's email).

## Three traps that made a probe lie

1. **A tab navigator keeps sibling screens mounted.** Home's ≡ is still in the
   tree with zero bounds at 0,0 while Beam is showing, so `.find()` clicks the
   invisible one. **Pick chrome by geometry (`width > 0`), never by document
   order.** This has bitten three times.
2. **Two things share an `aria-label`.** A post card's ⋯ and the top bar's ⋯ are
   both "More", and a world renders its list before its chrome — so the first
   match is the wrong one. Pick by position.
3. **Killing the preview server from the shell that runs the probes kills the
   shell** — `pkill -f previewserver` matches its own command line. Use:
   `for pid in $(pgrep -x node); do grep -qa previewserver /proc/$pid/cmdline 2>/dev/null && kill $pid; done`
