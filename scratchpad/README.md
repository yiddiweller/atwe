# The regression suite

64 probes that drive a **real browser against a real Postgres** and assert the
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

## The composer's proofreader (`fixtext.js`)

One tap fixes a message's spelling and grammar; while it works the text shimmers
blue-and-white. The probe covers when the button appears, the working state, the text
actually being replaced, Undo restoring the original verbatim, and a failure saying so.

**Proving the text really WAVES took four attempts, and three passed on a deliberately FLAT
fill** — the trap is worth knowing. Counting "some blue and some white pixels" passes flat.
The per-pixel spread of blueness passes flat, because subpixel antialiasing produces fringes
at both extremes. Per-column averages over the shimmer's whole box pass flat too, since the
box spans the bar's full width and catches a few pixels of neighbouring chrome. What works is
a **Range over the shimmer's own text** to get the exact line rectangles, column averages
inside those, and a threshold **calibrated by measuring a flat fill** — flat reads ~59, the
wave ~255, and the check demands 120.

It also owns two things the owner corrected afterwards. The button is the Atwe mark in the
same **white as the `+`** with **no disc behind it**, so it is checked against the `+`'s own
colour rather than a hardcoded value — and its three dots must fit inside the swirl's open
centre, so their total width is measured against the hollow's real size — the widest clear
horizontal BAND through the mark (0.465 of it, decoded from the PNG's alpha), not the largest
inscribed square (0.421), which is the wrong figure for a row of dots. It also asserts they
are three EVEN CIRCLES — each square, all the same size, equally spaced, with a gap over 0.6×
the dot, which is what stops them closing into a single dash — and that the mark itself is
under 80% of the blue send beside it while its button still matches it. And the bar is a **capsule on one line, a 28px rounded
box once the message wraps**: 28 is asserted as `sendRadius + inset`, i.e. derived from the
send button rather than typed, so a future change to either has to move both. NB the Light-
theme legibility check measures the dots against **the bar**, not the button — the button
has no fill any more, so comparing to its own background compares them with `rgba(0,0,0,0)`.
It also owns the **tap-to-open composer**: an empty bar nobody is in stays the short capsule,
tapping it opens the tall two-row box, and `AC._barWrapped` proves it was the tap rather than
a phantom wrap. The check that earned its keep is the last one — tapping the **+** must not
collapse the bar out from under the finger. It failed on the first implementation, which
decided at `pointerup`, before the click that opens the menu had run.
Self-tested: restoring the blue disc, the bigger dots and the capsule fails 7 of its checks.

The clearance figure is worth knowing before changing it: the mask is `center/contain` over
the whole 512px logo file, whose artwork fills only **0.8945** of it, so a fraction measured
off the PNG must be scaled by that before it means anything about the rendered box. The
usable band is `0.465 × 0.8945 = 0.416` of the button's mark. Skipping the scale over-stated
the room by 12%, which is why the dots once touched the swirl's arms with the arithmetic
insisting they had space.

## Hiding your last seen from one person (`lastseen.js`)

Pure HTTP, three accounts. Presence leaves the server by **three** doors — the live SSE
fan-out, the `presence-init` snapshot handed out on connect, and the poll — so the probe
checks all three, because a privacy setting that holds on two of them is worse than none:
the member believes they are hidden. Every check is a PAIR, since the rule is reciprocal,
and a third account is present throughout to prove the block is per-person rather than the
broadcast being quietly switched off. The check that matters most is that the other side is
**never told** they were hidden from — that would hand back the exact fact being concealed.

Two traps it hit. Closing the hider's stream before opening the observers' made the
control account's snapshot empty too, so the check passed for the wrong reason. And the
poll withholds presence by returning a **null `last_seen`**, not by omitting the key — so
"can they see it" has to test the value, not `key in obj`.

## The chat's top edge and the presence dot (`chatedge.js`)

Two things the owner caught on a real phone: a green "they're online" dot flashing for the
first second of every chat open, and a top fade that read as a dark bar rather than glass.

**The dot checks sample THROUGHOUT the open, not after it** — the whole complaint is about
the second in between — and the probe **holds the thread fetch back by 700ms**. That delay
is load-bearing: locally the server answers in ~10ms, so the flash is shorter than one
sample and the check goes green on the very bug it exists to catch. Verified by removing
the fix: with no delay it passed, with the delay it fails.

**The edge is checked from the real gradient stops, not a screenshot** — a dark gradient
over dark content cannot be sampled honestly — and the assertion is on the largest single
STEP in the ramp, which is what "a big shift" actually means. The blur is proved by painting
a hard-edged black-and-white stripe into the thread and reading how much contrast survives
under the band (107 against 255 below it). Those stripes must go INSIDE `#acThreadScreen`:
a body-level element cannot be behind the glass at all, since `#app` is its own stacking
context — the first version painted them on top of everything and the control read a flat
zero, which is what a probe measuring nothing looks like.

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
