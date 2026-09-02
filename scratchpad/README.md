# The regression suite

63 probes that drive a **real browser against a real Postgres** and assert the
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

**`TOK` must be exported** for several probes (a bearer token for a real account). Mint one
with `mint-token.js` — a bare `auth.signToken` is not enough, the token's hash must also
exist in `auth_sessions` or `requireAuth` 401s:

```bash
export TOK=$(DATABASE_URL=postgres://atwe:atwe@localhost:5432/atwescore \
  JWT_SECRET=scoresecret node scratchpad/mint-token.js)
```

The `JWT_SECRET` must be the one the server is running under, or you get the insecure dev
fallback and a token the server rejects.

## The chat header (`chathead.js`)

The owner redesigned the chat page from a drawing: the header is three shapes floating on
the page colour with the conversation running BEHIND them, not a bar. The probe measures the
geometry (one height, even gaps, even insets), that the header paints no bar and no divider,
that the scroller reaches the top of the screen while the message list is padded to clear
it, and — the one that caught a real bug on its first run — that **a tap in the GAP between
two shapes reaches the message behind**. The stack and the header row inside it both span
the full width, so making only the stack transparent to the pointer was not enough.

It also covers the presence dot, calling having moved to the ⋯ menu (checked by geometry,
since the buttons stay in the DOM), and Light theme, where it found two things that were
invisible on a white page: the composer and a sent-but-unseen bubble.

**The top fade is measured on real pixels, and its ordering matters.** A tall white block is
dropped into the thread so the ramp being measured is the gradient's own alpha rather than
whatever message happened to be there, and the number asserted is how far the brightness
takes to travel from a quarter-lit to three-quarters-lit — short means a step, long means a
fade (51px now, 14px before). **That block must be prepended before anything else touches
the thread**: an earlier ordering ran it after the menu tests and read a ramp of 0, because
the thread had been re-rendered and the block was gone.

## How a conversation scrolls (`chatscroll.js`)

Beam's thread is a **native scroller** now — it used to be a custom transform scroller on the
main thread, which is why it could never feel like Home. The probe was rewritten with the
change, because its old assertions could only fail on correct code: **a native rubber band
never appears in `scrollTop`**, so reading `SC.y` going negative is not a way to prove the
bounce. What it checks instead is the property that decides whether the browser bounces at
all (`overscroll-behavior:contain`, never `none`), that nothing is transforming the content,
that a real gesture moves it, that the bottom scrim stays pinned (painted **magenta** and
found by pixel — a plain before/after diff picks up any content that happened to shift), that
no live `backdrop-filter` overlaps the thread on a phone, and that swipe-to-reply still
travels. It caught a real regression on its first run: the scrim, previously a child of the
viewport, detached the moment the viewport actually scrolled and painted a gradient band
across the middle of the conversation.

**Smoothness itself is not measurable here** — no touch digitiser, no ProMotion display, no
iOS momentum — so the probe asserts the thread is BUILT like the surfaces it is compared to.

It also covers the **sideways time reveal**, where "not smooth" WAS measurable: the reveal
started 12px in because the gesture's own commit threshold was not subtracted, and it
clamped dead at its limit instead of easing. The probe samples the whole response curve.
One of its checks had to be strengthened — **`late < early` alone passes on a hard clamp**,
since a clamp gives late = 0 — so it also requires the reveal to still be moving at the end.

`voicenote.js` covers the other half of the same screen: a note this device cannot decode
must mark itself unplayable **on load** (`preload="metadata"` already fires the error, so
no tap is needed) and say "Can't play" rather than showing a play button and 0:00. Only
`MEDIA_ERR_SRC_NOT_SUPPORTED`/`DECODE` count — a **network** error is a flaky connection,
not a broken file, and must stay retryable; that is asserted separately.

**One trap worth repeating: Playwright's `colorScheme` does not flip this app's theme.**
Atwe carries its own preference in `localStorage.atwe_theme` and follows the OS only when
that is `'system'` — so a "both themes" run that sets `colorScheme` tests Black twice and
passes. Set the real preference. The first version of `deskcols.js` did exactly that.
