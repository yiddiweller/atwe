# THE POLISH PASS — what the audit actually measured

Section 1 of the brief says: audit before changing code, and understand which
components are shared before touching screens. This is that audit. **No product
code was changed to produce it.**

Method: `scratchpad/polishaudit.js` walks ten real surfaces (Home, Beam, Engine,
Notifications, Account, Settings, Wallet, Orders, Marketplace, Jobs) signed in, at
390x844, Black theme, and records every DISTINCT rendered value per family plus who
uses it. Measured, not read off the stylesheet: this repo has recorded six times
that reading rules tells you what the CSS says and never what a person sees.

## The system that already exists

122 tokens on `:root`, in real families: `--t1..--t4` text, `--s1..--s4` surfaces,
`--b1..--b4` borders, `--r-xs..--r-xl` + `--r-pill`, `--t-fast/base/slow` motion,
`--row-h`, and four component recipes (`--post-*`, `--tab-*`, `--ctl-*`, `--menu-*`).

**So the pass is not about building a design system. It is about the places that do
not use the one that is already here.**

## What is already consistent (leave alone)

| family | result |
|---|---|
| **Chevrons** | **1 distinct size**, 16x16, 64 instances across four surfaces. Nothing to do. |
| **World tab pills** | 44px tall with 13/16 padding, 34 instances, identical across Home, Beam, Engine and Notifications. This is the Apple Fitness+ measurement taken in build 1857 and it held. |
| **Primary text** | One value, `--t1` white, 90 instances. |
| **Blue** | One value, `#0088FF`, 14 instances, identity only. |

## What the numbers say is adrift

### 1. Two secondary greys, and the DARKER one does 87% of the work  [DECIDED: KEEP]

| token | value | on black | instances |
|---|---|---|---|
| `--t2` | `#8E8E93` | 6.44:1 | **6** |
| `--t3` | `#7E7E83` | 5.20:1 | **41** |

The app's real secondary text — usernames, timestamps, repost labels, the exact
things section 7B calls "overly dim metadata" — is painted with `--t3`, the dimmer
of the two, while the brighter sibling is nearly unused.

**Both clear the 4.5:1 floor, so this is not an accessibility failure.** It is a
hierarchy decision, and section 3 explicitly warns against simply making everything
brighter. **The founder was asked and said keep it** - see the decision below.

### 2. Two white alphas that are not tokens  [CHECKED: NOT DRIFT, and this line was wrong]

`rgba(255,255,255,.88)` on `.xp-ai-s` and `rgba(255,255,255,.92)` on
`.wallet-cashout`. This section originally read *"both one-offs sitting beside a
perfectly good `--t1`. Textbook duplicated styling. Safe to fold in."* **That was
written from the token list without looking at what they sit on, which is the exact
mistake this repo has recorded six times.**

Both sit on a **blue gradient**: `.xp-ai` is `linear-gradient(...var(--accent-fill)...)`
with `color:#fff`, and `.wallet-card` is `linear-gradient(--accent-fill, --violet)`
with `color:#fff`. The app's secondary greys are tuned against the black and the white
PAGE; a grey on a blue card reads as muddy, which is why an alpha-white is the right
tool for "one step quieter than the white above it" — and why `.wallet-bal-label`, two
lines further up, already does the same job a third way with `opacity:.85`.

**Folding them into `--t1` would make each the same brightness as the heading it sits
under and flatten the hierarchy on two cards.** Left alone, and the original line is
kept above so the reasoning is not repeated by a later pass.

### 3. Settings rows disagree with each other by a pixel  [CHASED DOWN: NOT DRIFT]

`.iset-row` renders at **64.6px** and **63.6px** on the same screen, and that looked
like textbook drift. It is not. Decomposed, every one of those rows is identical
inside: `.iset-main` is **39.64px** in all of them, the label is 20.14 at a 20.15px
line-height, the subtitle 17.5 at 17.5, and the padding is 12/12 everywhere. 39.64 +
24 = **63.64** exactly.

The extra pixel on the taller ones is the **divider**, and the rows that lack it are
exactly the LAST row of each card - `.iset-group > .iset-row:last-child
{border-bottom:none}`. That rule is the founder's own decision from the "a card's own
edges are curves, no hairline across them" pass. So the two heights are one row shape
plus or minus a line that is deliberately absent where a card curves.

**Nothing to fix, and equalising it would put back a hairline the founder had
removed.** Recorded here so a later pass does not rediscover the pixel and "correct"
it.

`--row-h` is 55 and `.me-row` honours it exactly, 60 instances. `.ac-item` at 72 in
Beam and Notifications is its own signed-off design (full-bleed conversation rows),
not drift.

### 4. Four card radii where the rule says one  [DECIDED: KEEP]

30px is the system and carries 22 instances. Alongside it: **18px**
(`.job-card-modal`, `.wallet-card`), **16px** (`.mkt-card`), **14px**
(`.wallet-cardrow`). The existing guard `evencards.js` only polices blocks wider
than 200px, which is why these sit under it.

### 5. Three border alphas on chrome  [LEFT: no verified defect, and the bar is founder-locked]

`--b1` .05, `--b2` .08 and `--b3` .12 are all in use on adjacent chrome
(`.bottom-nav`, `.sb-user`, `.sb-btn`). Having three is not wrong in itself; having
three *on neighbouring elements* is what reads as unfinished.

**Not acted on, deliberately.** `--b1..--b4` is a declared four-step family, so three
of them in use is the system working rather than drift; the three elements are three
different KINDS of thing (a floating bar, a card, a row); and the floating bar's own
material is a decision the founder took by name and re-took twice. There is no
measured fault here - nothing fails a contrast floor and nothing is unreachable - so
under this pass's own rule (do not make a consistency change without proving the
difference is accidental) it stays. If it is ever wanted, it is a look decision for
the founder, not a fix.

### 6. Icon sizes: 23 distinct, but most are deliberate  [LEFT: needs a per-family pass, not a sweep]

The raw number looks alarming and mostly is not. `tb-brand-act` at 29 and 22.9 is
the +/... glyph drawn as a ratio of its 44px circle; `sb-settings` at 16.1 and 19.1
is the footer set scaled to equalise INK rather than boxes, which this repo measured
and documented. **Separating the deliberate from the drift is the work**, and it has
to be done per family rather than by flattening the list.

**Not acted on in this pass, and said plainly rather than quietly dropped.** Every
one spot-checked traced back to a recorded decision (a glyph sized as a ratio of its
own circle, or a set equalised by ink). Sweeping 23 values to one number would undo
those, and doing it honestly means measuring each family's ink the way `sbfoot.js`
already does for the three footer icons. That is its own pass with its own guard; it
is not a line-count fix.

### 7. Avatars: 9 distinct sizes  [CHASED DOWN: NOT DRIFT]

34, 36, 42, 44, 46, 48, 52, 54, 62. The suspicious cluster was **42 / 44 / 46**, and
measuring where each one lives settles all three:

| size | where | verdict |
|---|---|---|
| **42** | inside `.tb-brand-act.prof`, the top bar's profile circle | a CONSEQUENCE, not a choice. That circle is 44 and keeps a real 1px `border` (documented: an inset shadow would be painted over by the avatar). With `box-sizing:border-box` a `width:100%` avatar fills the content box, so 44 - 2 = 42. |
| **44** | `.sb-btn`, the sidebar/drawer row | the nav button's own size |
| **46** | `.notif-ava-wrap`, a notification row | that list's own design |

The 42 and the 44 are the same control measured inside and outside its ring, and 46
belongs to a different list. **Never on screen as a mismatched pair**, either: the
drawer is off-canvas on a phone. Making them equal would mean deleting a documented
border or redesigning the notification row, so the brief's own rule applies - do not
make a consistency change without proving the difference is accidental. It is not.

## What this audit did NOT cover yet

Said plainly so the coverage is not overstated:

- **Light theme.** Every number above is Black only.
- **Other widths.** 390 only; the brief asks for small iPhone, large iPhone, tablet,
  narrow and wide desktop, and installed PWA.
- **Loading and empty states** (sections 4 and 13) — a separate pass, because they
  need each surface driven into that state rather than observed in passing.
- **The money flows** (section 14), **onboarding** (15) and **connected workflows**
  (17) — these are journeys, not screens, and a surface sweep cannot see them.
- **Anything behind data this account does not have.** A check that never sees a
  control reports a clean result; this repo has recorded that four separate ways.

## DECIDED BY THE FOUNDER - both stay exactly as they are

Asked, answered, and written down so it is not re-opened by a later pass:

1. **The secondary grey STAYS `--t3`** (`#7E7E83`, 5.20:1). It was offered against
   `--t2` (6.44:1) because 41 instances against 6 looked like drift. It is not
   drift, it is the intended weight. **Do not "fix" the metadata colour**, and do
   not read section 7B's "avoid overly dim metadata" as licence to move this token.
   Both values clear the 4.5:1 floor, so nothing here is an accessibility fault.
2. **The card radii STAY as they are.** 30 is the system; the sheet family at 18,
   `.mkt-card` at 16 and `.wallet-cardrow` at 14 are their own deliberate shapes.
   **Do not fold them into `--post-card-r`.**

Both were one-line changes and both were declined. That is the founder's call and
it is the end of it.

## What the LATER passes found, and fixed

The audit above is surfaces observed in passing. Sections 4 and 13 needed each screen
driven into a state it does not normally sit in, and that is where the real faults
were. All of these are measured, and each has a guard that fails without the fix.

### Loading (section 4) - the page skeleton was fainter than the founder's own

`.skel` sat on `--s2` and measured **1.14:1 on Black and 1.09:1 on Light** against
what is behind it. The comment above it claimed `--s2` "is already the step up and is
correct", which was true on Black and **flatly wrong on Light, where `--s1` and `--s2`
are both `#F5F5F7`** - on a card there is no step at all.

The reference is not a number somebody liked: it is `--post-skel`, the post-card
skeleton the founder drove darker three separate times, which measures **1.24:1 on
Black and 1.17:1 on Light** against its own card. The page skeleton now reads at the
same strength (**1.23 / 1.19**) through its own token, `--skel-fill`, so `--s2` - every
input and half the cards in the app - was not dragged around to tune a loading state.
`--post-skel` is untouched.

### Errors (section 13) - six of eight main surfaces had no way back

`emptystates.js` already covers 38 EMPTY screens. Nobody had ever failed a surface's
own request and looked. Driven with a 500, of eight main surfaces:

| surface | what a person got |
|---|---|
| Home, Notifications | the designed state, with Try again |
| Orders, Marketplace, Wallet, Saved | **the server's raw error string** - the marketplace printed the single word `boom` - and no retry |
| Jobs | "Could not load jobs." and no retry |
| **Beam** | **nothing at all, for ever** |

Beam was the worst and had two causes. `acLoadChats`'s error branch was gated on
`firstLoad`, and a boot restore into Beam is the only call on that path and passes
`{silent:true}` - so a failed cold load showed no rows, no message, nothing to press.
And even once that fired, the very next `acRenderChats` painted the shimmer straight
back over it, because its guard asked for `.ac-skel`, **a class that has never existed
in this app** (`acSkelRows` emits `.skel-row`), so the test was always true. Beam
loaded for ever.

All six now go through the app's own `acErr`. One more fault came out of proving it:
on the Wallet the Try again button landed at **y 879 on an 844px phone** - a retry
nobody can see. `acErr` now sizes its illustration to the room the container actually
has (168 / 96 / none) instead of a fixed 168.

**A failed REFRESH still changes nothing on screen**, deliberately: replacing a list
somebody is reading because a background fetch blipped is worse than saying nothing.
The guard skips that case by name rather than grading it.

## Section 5: nothing is trapped behind the floating bar

Nine surfaces, three phone widths (320 / 390 / 430), each scrolled to its genuine
end with the bar put back the way a person has it when they stop and reach: **28
checks, 0 failures, 3 skipped by name**. Home is skipped because an endless feed has
no last thing to clear - whatever sits under the floating pill at any moment is the
next card passing beneath it, which is what a floating bar is for. It becomes
answerable the day `#acFeedEnd` renders.

Two of that probe's own bugs are worth keeping, because each produced a false bug
report before it was caught: **surfaces STACK unless you close what is open**, so the
first run blamed Orders and Marketplace on a "New pot" button that belongs to the
Wallet; and the endless feed above, which failed Home at all three widths on a feed
that was simply still loading.

## What that leaves

With the two colour and shape questions closed, and the two remaining "drift"
findings chased down to deliberate decisions, the pass is not restyling at all - it
is finding things that are actually WRONG: content a finger cannot reach, states
that read as broken, values that disagree with themselves. That is the right shape
for "more finished, not redesigned".

## Still NOT covered, said plainly

- **Wider viewports.** Everything measured here is 320-430 phone widths. Tablet,
  narrow desktop and wide desktop have not been driven for this pass.
- **The money JOURNEYS** (section 14) and **onboarding** (15). `journeys.js` and
  `twoperson.js` already cover the transactions end to end; nobody has walked them
  looking for polish.
- **Anything behind data this account does not have.** A check that never sees a
  control reports a clean result, and this repo has recorded that five ways.
