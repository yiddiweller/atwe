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

### 1. Two secondary greys, and the DARKER one does 87% of the work

| token | value | on black | instances |
|---|---|---|---|
| `--t2` | `#8E8E93` | 6.44:1 | **6** |
| `--t3` | `#7E7E83` | 5.20:1 | **41** |

The app's real secondary text — usernames, timestamps, repost labels, the exact
things section 7B calls "overly dim metadata" — is painted with `--t3`, the dimmer
of the two, while the brighter sibling is nearly unused.

**Both clear the 4.5:1 floor, so this is not an accessibility failure.** It is a
hierarchy decision, and section 3 explicitly warns against simply making everything
brighter. **This needs your call, not mine** — see the questions at the end.

### 2. Two white alphas that are not tokens

`rgba(255,255,255,.88)` on `.xp-ai-s` and `rgba(255,255,255,.92)` on
`.wallet-cashout`: three instances between them, both one-offs sitting beside a
perfectly good `--t1`. Textbook "duplicated styling rules". Safe to fold in.

### 3. Settings rows disagree with each other by a pixel

`.iset-row` renders at **64.6px** and **63.6px** on the same screen. A row with a
subtitle is legitimately taller than one without (that is iPhone Settings and it is
deliberate), but two subtitle rows differing from each other is drift.

`--row-h` is 55 and `.me-row` honours it exactly, 60 instances. `.ac-item` at 72 in
Beam and Notifications is its own signed-off design (full-bleed conversation rows),
not drift.

### 4. Four card radii where the rule says one

30px is the system and carries 22 instances. Alongside it: **18px**
(`.job-card-modal`, `.wallet-card`), **16px** (`.mkt-card`), **14px**
(`.wallet-cardrow`). The existing guard `evencards.js` only polices blocks wider
than 200px, which is why these sit under it.

### 5. Three border alphas on chrome

`--b1` .05, `--b2` .08 and `--b3` .12 are all in use on adjacent chrome
(`.bottom-nav`, `.sb-user`, `.sb-btn`). Having three is not wrong in itself; having
three *on neighbouring elements* is what reads as unfinished.

### 6. Icon sizes: 23 distinct, but most are deliberate

The raw number looks alarming and mostly is not. `tb-brand-act` at 29 and 22.9 is
the +/... glyph drawn as a ratio of its 44px circle; `sb-settings` at 16.1 and 19.1
is the footer set scaled to equalise INK rather than boxes, which this repo measured
and documented. **Separating the deliberate from the drift is the work**, and it has
to be done per family rather than by flattening the list.

### 7. Avatars: 9 distinct sizes

34, 36, 42, 44, 46, 48, 52, 54, 62. Some are certain (36 feed, 62 profile hero).
**42 against 44 against 46 is the suspicious cluster** and is where to look first.

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

## Questions that are yours, not mine

1. **The secondary grey.** Move the app's main secondary text from `--t3` (5.20:1)
   to `--t2` (6.44:1), or leave it? It touches usernames, timestamps and metadata
   everywhere at once. It is one token, one line, and reversible.
2. **Card radii.** Fold 14/16/18 into the 30 system, or are the sheet family and the
   wallet rows deliberately their own shapes?
