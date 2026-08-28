# The regression suite

58 probes that drive a **real browser against a real Postgres** and assert the
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
