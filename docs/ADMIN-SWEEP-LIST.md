# The admin dashboard sweep

**This is step 2 of the founder's own order**, and it is deliberately small. Their words,
9 Sep 2026: *"once the web app is finished, I would like to go over a little bit to
finalize and make sure the admin dashboard app is perfect as well… just a small sweep
over, make sure everything is perfect there as well."*

It is `public/admin.html` — staff only, one page, its own sign-in. It is **not** a fifth
platform, and nothing here is a redesign. It matters because the owner and their team live
in it daily and it is where money, moderation and members are actually handled.

**Every item is MEASURED, not judged**, exactly as the web list was. Each entry says the
screen, the exact fault, the number, and what "done" looks like.

---

## How this pass was made

The dashboard names its own views — `NAV_TITLES`, **68 of them** — so that list was used as
the checklist rather than a hand-written one. Every view was opened in a real browser at a
**desktop width (1280×900)** and again at a **phone width (390×780)**, scrolled from top to
bottom, and asked the same objective questions:

- does it open without throwing, and without a console error;
- is it showing its own failure line (*"Could not load."* / *"Could not check."*);
- did it **actually ask the server** — a data view that makes no request is broken however
  it happens to fail;
- does the page spill sideways;
- is any text below the legibility floor, scored against a **composited** background;
- and, separately and mechanically: does every control lead somewhere.

**The phone width earned its place.** Everything the desktop pass found, the phone pass
found too — and it found two things of its own that a desktop width cannot see (B3). The
dashboard is a laptop tool, but it is served on a phone the moment somebody opens it there,
and a page that scrolls sideways is the most obvious kind of broken.

**The dashboard has no light theme**, so unlike the app this is one theme, not two. That is
not a fault — it is a staff tool that lives on a dark screen — but it is worth writing down
so nobody looks for a Light pass that does not exist.

### Three times the CHECK was wrong, not the dashboard

Recorded because the next person to write one will hit the same traps.

| what it flagged | why it was wrong |
|---|---|
| **five tabs "empty"** (Finance, Site, Cards, Features, Churn) | the probe waited ~1 second. Every one of them paints a spinner and then fills in from its own fetch; against a big database that takes longer. Opened one at a time with a real wait, all five are fine — and **Features is an embedded page**, so its container legitimately has no text of its own. A wait that is too short reports a fault on working code just as surely as one that is too long hides one. |
| **the Wording tab spilling sideways** | its row of 14 languages is inside `.tf-ranges`, which **scrolls its own row**. The buttons' boxes really do reach past the screen — that is the box scrolling, not the page spilling. Only a PAGE that scrolls sideways is a fault; the check now ignores anything inside a horizontal scroller. |
| **a JavaScript error on Affiliations** | the probe itself caused it, by clicking to the next tab before the previous one's data arrived. It is a real (if invisible) race and it is fixed below — but it was not what the sweep thought it had found. |

### And the first version of the check reported a clean result by looking at a tenth of the page

It scored only the content column. Scoped to the **whole page**, it immediately found that
every field placeholder in the dashboard and the sidebar's own group labels were painted
with the icon tint. *A check that excludes most of its subject reports a clean result* —
the same lesson the app's touch-target check taught two builds ago.

---

## A · Text a person cannot read

The floor is **4.5:1** for normal text (3:1 once it is 24px, or 18.7px bold).

### A1 — `--t4` was carrying text in thirteen places ✅ DONE
`--t4` (`#48484A`) is the **icon tint**. It measures **2.30:1 on black, 2.16:1 on `--s1`,
2.02:1 on `--s2`** — under the 4.5 floor for words and under the 3 floor even for a UI mark.
Thirteen rules were painting real text with it:

- **every field placeholder in the dashboard** — the search boxes, the username lock forms,
  the announcement and broadcast composers, the support chat box. A placeholder is text
  somebody has to read to know what the field is for, and nothing had ever looked at them;
- **the sidebar's own group labels** — `MONEY`, `PEOPLE`, `TRUST & SAFETY`, `CONTENT`,
  `INSIGHTS`, `SYSTEM` (`.nav-label`, 10px uppercase);
- **the support and disputes timestamps** (`.sup-date`, 11.5px) — the one the sweep caught
  first, on 35 rows of the Support inbox;
- **the day markers in the support chat** (`.dm-time`);
- **the hint under the sign-in gate** (`.gate-hint`);
- the row chevrons and the vault separator.

*Done when:* nothing in the dashboard paints text with `--t4` and every word clears 4.5:1.
**Fixed:** all thirteen are `--t3` (`#7E7E83`) — **4.87:1 on `--s1`, 5.20:1 on black** — which
is the token the app already uses for exactly this job, so the two are in lockstep again.
`--t4` stays declared, with a comment above it saying why nothing may read it.

### A2 — most placeholders had no colour at all ✅ DONE
Fixing A1 uncovered this: only a handful of fields had a placeholder rule, and **every other
one in the dashboard fell back to the browser's own `#757575`** — **3.99:1** on an `--s2`
field, **4.27:1** on `--s1`. Both under the floor, and a placeholder is text somebody has to
read to know what the field is for.

*Done when:* every placeholder in the dashboard clears 4.5:1, whichever field it sits in.
**Fixed:** one rule — `input::placeholder,textarea::placeholder{color:var(--t3)}` — so it
covers fields nobody thought about as well as the ones that had rules. Re-measured on real
screens: **4.56:1** on `--s2`, **4.87:1** on `--s1`.

**This is why A1 alone was not enough, and it is worth naming.** A1 changed thirteen rules
that were WRONG; A2 was about the fields that had no rule to be wrong. The standing guard
scores `::placeholder` separately from an element's own text for exactly this reason —
scoring only element text, it saw nothing here at all.

---

## B · Things that were broken rather than ugly

### B1 — a view could write into a box that had already gone ✅ DONE
Every view fetches its own data, so a render — or the error message for a failed one — can
land **after** a staffer has clicked another tab and the content column has been replaced.
`document.getElementById('adsBody').innerHTML = …` then throws. Nothing visible goes wrong
(the view really did change), but it is a genuine JavaScript error, and the dashboard now
reports its own errors, so it would arrive in the owner's own Site tab as news.

Four views were exposed: **Setup, Ads, Affiliations, Retention** (nine write sites).
Finance and Cards already guarded, which is how the pattern was recognised.

*Done when:* a fast click between tabs throws nothing.
**Fixed:** `box(id)` returns the element, or a stand-in that swallows the write. It is
deliberately shaped like an element so the call sites stay plain assignments — rewriting
them as `setBody(id, …)` means finding the end of each statement to close the call, and two
of them are multi-line template literals, where a bracket in the wrong place is a silent
syntax error in an 8,700-line file. (That was tried first, and it broke the file.)

**It is `liveBox`, not `box`, and that is not fussiness.** `box` is already a local `const`
inside about thirty functions here; a global function of the same name is simply SHADOWED
inside any of them, and the call would have thrown *"box is not a function"* on exactly the
paths this was meant to make safe. Caught before shipping by grepping the name first — the
same rule this repo already has for CSS classes and custom properties, applied to a
function.

### B2 — when the dashboard broke, nobody heard ✅ DONE
The app has reported its own faults since build 1830 — one row per distinct fault, shown on
**this dashboard's own Site tab**. The dashboard itself reported nothing, which is the wrong
way round: this is where money and moderation are handled, and a staffer is *less* likely
than a member to mention that a screen misbehaved.

*Done when:* a fault in the dashboard lands in the same place a fault in the app does.
**Fixed:** the same reporter, same route, same rules — once per session per distinct fault,
at most eight in a session, wrapped so the reporter can never be the thing that breaks. It
sends the **tab name, not the URL**, and `platform: 'admin'`, so a row now reads
*"on admin / refunds"*. The Site tab's own wording says so.

### B3 — on a phone, two tabs scrolled sideways ✅ DONE
Measured at 390×780. Two rows hold a cluster of items that refuses to shrink beside text
that does, so they pushed the whole page out:

- **Users** — a member carrying several status pills at once (`.u-pills`, `flex-shrink:0`)
  shoved the row's own chevron **27px past the screen**: page 417 against a 390 viewport;
- **Support** — a support item's action buttons (`.sup-acts`). There are **seven** of them,
  and at 390 they measured **739px** of buttons in a row that could not wrap: page **615**
  against 390, i.e. you had to scroll the whole page sideways to reach the last action.

*Done when:* the page's own scroll width equals the viewport at 390.
**Fixed:** both rows wrap. It costs nothing at a desktop width, where neither has ever come
close to filling its row. Re-measured: **417 → 390** and **615 → 390**.

---

## C · Checked and clean

Written down so the next pass does not redo them.

- **Every control leads somewhere.** All **321 distinct handler names** in the file resolve
  to a real function in the running page (resolved in page scope, because the dashboard
  declares plenty of them as top-level `const`, which are not `window` properties). Every
  one of the 68 views has a sidebar button, and every sidebar button names a view with a
  branch in the router. `scratchpad/admindead.js`.
- **No tab passes its path where the method goes.** `api(method, path, body)` — the argument
  swap that left five tabs unable to reach their routes for months does not recur; a first
  argument beginning with `/` is now a failing check, not a thing somebody has to notice.
- **Every icon-only button has a name.** Nothing in the file is a button with no text and no
  `aria-label`.
- **No CSS custom property is declared twice with two different values** in either file.
- **Duplicate class declarations: 28** (it was 29 — retiring `--t4` from text made one
  pair agree). Nothing renders wrong today, because the later copy wins consistently, but
  always `grep -n` for every definition of a class before editing one. The same rule now
  covers function names too — see B1.

---

## D · Waiting on the founder — not bugs, decisions

### D1 · (the app's) white on the accent blue — still open
Unchanged from `docs/WEB-FINISH-LIST.md`. Listed here only so the two lists agree.

### D2 · the red destructive button reads at 3.22:1
`--red-tint` (`#FFE0E6`) on `--red` (`#FF0033`) measures **3.22:1**, under the 4.5 floor.
It is **four places**: the dashboard's *Remove lock* and *Cancel it* buttons, its unread
badge on a user card, and the app's own *Delete account* button — so it is one pairing
shared by both codebases, not an admin quirk.

**The arithmetic is what makes this a decision rather than a fix.** On `#FF0033` nothing
light clears the floor: white itself is only **3.96:1**. The three ways out are genuinely
different:

| | |
|---|---|
| **dark ink on the red** | the colour law's own answer for bright fills, and what `--green-ink` already does for lime. Pure black reaches **5.30:1**; `--text-black` gets **4.25** and still misses. A destructive button then reads as a warning label rather than a clean button. |
| **darken the red** | clears the floor with the light ink it already has — and Atwe no longer has one red. `--red` is a named brand colour used across both codebases. |
| **accept it** | it is a button label at 15px, on a control people press deliberately, and it is legible in practice — it just does not clear the written floor. |

Nothing has been changed. `scratchpad/adminsweep.js` carries it as **one exact-string
exception on one selector**, so the guard is not permanently red on a call nobody has made.
**Delete that exception the day it is decided.**

---

## E · Measured, and waiting on one fact only the team has

### E1 · about fifty small controls are 24–31px tall
Measured across seven representative tabs, at both widths. The dashboard's main button
(`.act`) is **40px** on a desktop and taller still on a phone, and the sidebar rows are
**34px** — comfortable. Underneath that, one group is smaller:

| control | height | where |
|---|---|---|
| `.fc-catbtn` | **24px** | the category buttons on Feature controls |
| `.bc-aud` | **28px** | the audience chips on Users, Orders, Support, Catalog |
| `.mod-scope` | **29px** | the scope pills on the AI content scan |
| `.switch` | **30px** (50 wide) | every on/off toggle |
| `.copy` | **30px** | copy-to-clipboard |
| `.tf-r`, `.vt-tbtn` | **31px** | the date-range and vault segments |

**On a laptop, with a mouse, this is fine** — a mouse is a single pixel and 24px is a big
target for it. It is only short for a finger: the touch floor is **44pt**, which the app
itself now meets everywhere.

**Whether it matters depends on something only the team can say: is the dashboard ever
used from a phone?** If it is, the fix is contained and cannot change how anything looks —
an invisible overlay on each of those seven classes, **inside the phone media query only**,
growing the hit area vertically (their widths are already 42px or more, so nothing has to
grow sideways into its neighbour). It is the same technique the app uses, and all seven
classes were checked and carry no pseudo-element of their own, so there is nothing for it
to collide with. **Nothing has been changed** — say the word and it is one block of CSS.

---

## What this pass did NOT look at

Said plainly, so "the dashboard is swept" is not read as more than it is:

- **deeper states** — the sweep opens each view and reads it. It does not fill in every form,
  approve every queue item, or drive the flows that move real money;
- **anything that needs a second person or a real payment** — a live refund, a real Stripe
  payout, a genuine dispute;
- **the signed-in PIN lock beyond its first screen**, and the impersonation flow, which
  leaves the dashboard for the app;
- **speed** — how the heavy tabs behave against a database far bigger than today's;
- **the app itself**, which has its own list.

Each of those is a further pass that ADDS to this list.
