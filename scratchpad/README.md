# The regression suite

60 probes that drive a **real browser against a real Postgres** and assert the
things this app has actually got wrong before — corner geometry, icon ink,
contrast, focus rings, paint order, offline behaviour, money invariants.

They were living **only in a session scratchpad**, i.e. one container restart from
being lost, while `CLAUDE.md` referenced 39 of them by name as though they were
part of the project. That is the same mistake the nav-icon generator made and it
is recorded here so it is not repeated: **anything the docs cite by name belongs in
the repo.**

## Running them

They need a browser and a database, neither of which is a project dependency:

```bash
# a throwaway Postgres, and a server pointed at it
DATABASE_URL=postgres://atwe:atwe@localhost:5432/atwescore \
JWT_SECRET=scoresecret PORT=3262 node server.js &

# playwright-core + pngjs must resolve from the directory you run in
cd scratchpad && bash run-all.sh
```

Each probe seeds its own accounts and exits non-zero on failure. `fullscan.js` is
the broad one — 33 surfaces × 3 configurations, looking for JS errors, failed
requests and blank screens rather than for a design.

## Why they measure pixels

Repeatedly, a check that read `getComputedStyle` or a DOM rectangle passed on
visibly broken output: a transformed element reports its scaled box, a
`::-webkit-search-cancel-button` reports `display:block` whether or not the rule
applies, a border the same colour as what sits behind it is indistinguishable
from none. Where the question is "what does a person see", these sample real
pixels from a screenshot.

## The desktop layout (`deskcols.js`, `authpane.js`)

Two probes for the desktop shell, added after the founder found four layout bugs in a
row that no existing probe could see:

- **`deskcols.js`** — the desktop is three columns on EVERY page at EVERY width. It
  checks Home's columns at all four of X's bands, that every panel world lands on the
  same columns, that the sidebar is byte-identical across the five worlds (including the
  first nav item's y — if the header changes height the nav below it moves, and that is
  what reads as "off"), that Beam's conversation list sits exactly where the rail does,
  and that the rail's Post pill shares the search field's edges. It found a real bug on
  its first run: the icon-rail rule still collapsed Post into a 48px circle after the
  button moved into the rail, at every width from 768 to 1281.
- **`authpane.js`** — the sign-in form is centred in the LEFT panel on the start screen
  and on every wizard step, at five widths.

**`TOK` must be exported** for `deskcols.js` (a bearer token for a real account).

**One trap worth repeating: Playwright's `colorScheme` does not flip this app's theme.**
Atwe carries its own preference in `localStorage.atwe_theme` and follows the OS only when
that is `'system'` — so a "both themes" run that sets `colorScheme` tests Black twice and
passes. Set the real preference. The first version of `deskcols.js` did exactly that.
