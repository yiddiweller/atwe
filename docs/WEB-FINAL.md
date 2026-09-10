# The final web pass — the last list before the web app is locked

**The founder's decision, 10 Sep 2026.** The iPhone app is blocked for about ten days:
Expo's build credits ran out and reset on their own, and paying to skip the wait is not
worth it. So the ten days go to the web app — *"this will be the final stage of the Web
app and then we'll continue to the iOS app."*

**That is the right call**, and not only because iOS is blocked. Web is step 1 in the
founder's own order for a reason: it has no gatekeeper, it goes live the moment it is
pushed, and every later platform is slower and more expensive to ship. Spending a
blocked window on the cheap, fast, ungated thing is exactly right.

---

## What "finished" has to mean, or ten days will not produce it

The web app has **no feature finish line left** — `node tools/features.js` shows all but
one of the remaining to-dos are the phone app, and the last (Atwe Card) is blocked on a
card-issuing partner rather than on code. What is left is **refinement, which never ends
by itself**. That is why the last two passes were run as LISTS, and why both are now at
zero: `docs/WEB-FINISH-LIST.md` (13 of 13) and `docs/DESIGN-UNIFICATION.md`.

So the same rule applies to this pass, and it is the whole reason this file exists:

> **Locked in means THIS LIST is at zero.** Not "it feels done" — a list, written down,
> that anyone can check.

## What goes on the list

**THE ORDER, and it is the founder's own (10 Sep 2026):** *"we should do your stuff first
when you are completely done with everything. We will go forward with my teams stuff."* So
the three passes run to completion FIRST, and the team's list goes in after them. An
earlier version of this file had it the other way round, which is why it is written out
here rather than left implied.

**1. The three passes the first sweep explicitly said it had NOT done.** That list closed
by naming where it stopped, and being honest about that is what makes the remaining scope
real rather than invented. Of the five it named, two have since been done (other widths →
the tablet/touch pass; the admin dashboard → its own sweep). **Three genuinely remain:**

- **Deeper states.** Every screen was opened in its RESTING state only. An open
  conversation, a post detail, a listing, a half-filled form, a long list, an error
  state — none of it has been through the objective battery.
- **Anything needing a second person or real money.** A real purchase end to end, a real
  call, a real upload. These are the paths that matter most and are hardest to fake.
- **Speed and motion.** How it actually feels to scroll and animate, measured rather
  than felt.

**2. Everything the founder's team raises.** Their words, their screenshots — the source
a probe can never replace, because they use it daily. It goes in once the passes are done,
and nothing is locked in until it is at zero too.

**3. Anything found along the way.** Recorded here rather than fixed silently, so the
list stays the honest measure of what is left.

---

## The list

*(pass results first — the founder's team's items are added below them once sent)*

| # | what | where | state |
|---|---|---|---|
| P2-2 | **Two touch controls under the 44pt floor** — the Recent-searches chips (93x29) and the Translate-post line (92x19). Both only render once the account HAS the data, so no sweep had ever seen them | `public/index.html` `pointer:coarse` block | **fixed**, build 1847, guarded by `touchwide.js` |
| P2-1 | **A block only worked in one direction** — the blocker could keep messaging AND calling the person they had blocked, while that person could not answer | `server.js` `canContact` + `dmAllowed` | **fixed**, build 1846, guarded by `twoperson.js` |

---

## Pass 1 of 3 — deeper states · DONE, nothing found

`scratchpad/deepstates.js`, both themes, 390×844. **18 states, 18 clean, in Black and in
Light.** These are the states a screen is in once somebody is USING it, which is exactly
what the first sweep said it had not looked at: a conversation with 80 messages open, the
attach tray up, a long message typed, in-chat search open, the chat list scrolled, the
feed scrolled six screens down, a post open, a half-filled composer, a menu over a post,
notifications scrolled, a leaf sheet over Settings, an Account section open, a profile
open, the profile editor filled, a search typed into Engine, the wallet, orders, the
marketplace. Same battery as the first sweep so the answers are comparable: sideways
slide, clipped text, two white pills doing one job, anything thrown.

**THREE FALSE ALARMS BEFORE IT WAS TRUSTWORTHY, and every one was the check, not the app:**

- **A selected tab is white and is not an action** — the colour law's own carve-out, since
  white there is a STATE. The first run reported a second white primary on Home, Beam,
  Engine and the marketplace at once, which is the tell that the CHECK is wrong. Tabs are
  now identified structurally, as `sweep.js` already does.
- **A COUNT of white pills is not a fault.** Three Buy-now pills on three listing cards is
  deliberate. The fault is a DUPLICATE — two white pills running the same function on one
  screen.
- **`checkVisibility()` says nothing about OPACITY.** The jump-to-latest pill's "New
  Message" label sits at `opacity:0; width:0` until there IS a new message, and reported
  as clipped text on all four conversation states. The repo already knew that method says
  nothing about clipping; it says nothing about fading either.

**SELF-TESTED IN BOTH DIRECTIONS, and the first attempt did not work — worth recording.**
Injecting a 520px-wide post card did NOT trip the sideways check, and that is the app
being right rather than the probe being wrong: `.ac-list` carries `overflow-x:hidden`
precisely so an over-wide child cannot drag the surface sideways, so `scrollingElement`
stayed at 390 and there was no sideways scroll to find. Proving the check needed the real
symptom — `body{min-width:520px}` — which trips it on every state with `HTML +130px`. A
clipped-name injection trips the text check by name. **An injection that the app already
defends against proves nothing; pick one that produces the symptom being measured.**

---

## Pass 2 of 3 — a second person, or real money · DONE, ONE REAL FAULT FOUND AND FIXED

`scratchpad/twoperson.js`, **67 checks**. Every other probe in this repo drives ONE
browser as ONE account — which is most of the app and not the part that matters most: a
sale has a seller, a call has somebody to answer it, a photo is posted so that SOMEBODY
ELSE can see it. Those are exactly the paths where "it worked for me" and "it worked for
them" can diverge, and none of them had a guard.

So it seeds **two real accounts** and, for the call, opens **two real browsers**.

| | what it proves |
|---|---|
| **a real sale** | one lists, the other buys with real wallet money, the seller ships it, **the buyer's OPEN tab is told without reloading**, the buyer marks it arrived, and the pennies are conserved across buyer, seller and Atwe's own cut |
| **buyer protection** | the money leaves the buyer and **the seller is NOT paid** — that gap is the entire product — the confirm is what releases it, a protected order cannot be cancelled out from under it, and a dispute reaches the person on the other side of it |
| **a real message** | it lands in the other person's open app live; a retry does not deliver it twice; typing and read receipts reach the other side |
| **a real call** | it RINGS; they answer; **two real browsers with real microphones negotiate a real connection and reach `connected` with each other's live track**; a stranger's call is silenced when asked and still lands in Recent; someone they know still rings through |
| **a real upload** | the OTHER person is handed a signed URL, that URL really answers with a real picture, and a made-up one is refused — in a post AND in a conversation |

### THE FAULT: A BLOCK ONLY WORKED IN ONE DIRECTION

**Blocking somebody left you able to keep messaging AND calling them, while they could
not answer.** `canContact` asked only *"did the target block the caller"*, so the BLOCKER
still got through — a one-way channel built out of the block feature. Measured: B blocks
A; A is refused; **B's message lands in A's inbox and B's call rings A's phone.**

Both directions now, via the `blockedEither` helper that already existed for exactly this
— in `canContact` AND in `dmAllowed`, because `dmAllowed`'s prior-history fallback would
otherwise have handed the channel straight back. **This repo's own written rule already
said blocks are enforced both ways; it simply was not true of the code**, and one browser
can never see that.

### FOUR FALSE ALARMS, AND THE SELF-TEST IS WHAT FOUND THE WORST ONE

- **ATWE'S CUT IS TAKEN FIRE-AND-FORGET.** `chargePlatformFee(...).catch(...)` is not
  awaited, so the route answers before the fee has left the seller. Read the three
  balances the instant it returns and 25 cents have apparently vaporised on a working
  sale. Settle before judging money.
- **"an order event arrived" is not "the ship event arrived".** The buy pushes an `order`
  event of its own moments earlier, and the waiter deliberately checks what has ALREADY
  landed — so a bare `type === 'order'` **passed with the ship push commented out**. Only
  the deliberate self-test caught it; match the event, not its type.
- **the signature is not at the end of the URL** — a `?v=` cache stamp follows it, so an
  anchored `/[0-9a-f]{20}$/` tampered with nothing and reported the resulting 200 as a
  security hole.
- **`rtSource` is a top-level `let`, not a window property** (the third time in this repo:
  `S`, `_caps`, now this), and **the call screen shrinks away over .36s** — reading
  `.hidden` in the same tick calls a screen on its way out one that never left.

Self-tested three ways: reverting the block fix fails it by name, commenting out the
ship push fails it by name, and the whole call section fails if the two browsers never
connect.

### AND TWO MORE, FOUND BY THE REGRESSION RUN ITSELF

`touchwide.js` had been green for builds and went red the first time it ran against an
account with a REAL HISTORY behind it. Two controls sat under the 44pt touch floor:

- **the Recent-searches chips on Engine — 93x29.** They only render for somebody who has
  searched before. A fresh test account has no history, so the row is not on screen.
- **the Translate-post line — 92x19.** It only renders under a post that is not in the
  reader's language.

Neither was ever reachable by a sweep on a clean account, and **a check that never sees a
control reports a clean result** — the same lesson this file has now recorded four times,
arriving by a fourth route: not scope, not a missing probe, not a skip, but ABSENT DATA.
Both are in the app's own `pointer:coarse` block now, growing vertically only (each is
already past 44 wide, and vertical is the safe axis for a chip row and for a line sitting
between a post's words and its pills). Both pseudo-element slots were checked free first —
the trap that shipped a visible bug on ~90 screens in build 1832.

---

## The rules for this pass, same as the last two

- **Measure, never assume.** Every item is something observed, not suspected.
- **Every fix gets a guard** in `scratchpad/run-all.sh`, self-tested in both directions,
  in the same commit.
- **Record what is NOT covered** when this pass closes, exactly as the first one did.
- **`node tools/features.js add`** in the commit that ships a change, so the two numbers
  stay true.
