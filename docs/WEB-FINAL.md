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

**ALL THREE ARE NOW DONE** — pass 1 clean over 18 deeper states, pass 2 found and fixed a
real one-directional block plus two touch targets, pass 3 measured every long surface under
a throttled CPU and found nothing to fix. **My side of this list is at zero.** What is left
before the web app is locked in is item 2: the founder's team's own list, which has not been
sent yet.

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
| T4 | **Posting was impossible.** *"I still can't send posts... I cannot click the post button. It doesn't go anywhere."* | The ✕'s invisible 44pt tap target sat on a `position:static` host, so it resolved against the header instead of the button and rendered 370x68: a transparent slab over Post | **fixed**, build 1854, guarded by `tapown.js` |
| T3 | **Calls and video calls did not work.** *"when I'm trying to call someone the other person doesn't even get a call, and if they do they can't pick up"* | One request every call waits on, with no time limit on either side, plus no error handling on the answer path | **fixed**, build 1852, guarded by `callpath.js` |
| T2 | **Some Atwe AI questions were never answered, and pressing Post froze the button.** *"I wanted to post a message and I am clicking post but it doesn't get sent. It's like frozen... there is probably more stuff that doesn't work"* | One cause behind both: `API.req` had no deadline, so a stalled mobile connection left `fetch` pending for ever | **fixed**, build 1851, guarded by `nohang.js` |
| T1 | **The em dash.** The founder had asked once, it was half-done, and they still kept meeting them: *"all AI sites and stuff comes a lot with this line and I don't see it unprofessional apps"* | 1,175 lines of copy across 15 files, plus the AI itself, plus 20 more written as `\u2014` that the first sweep could not see | **done**, build 1850, guarded by `nodash.js` |
| P3-1 | **Nothing.** Every long surface scrolls with its ordinary frame on time, nothing stalls, and the app's own code is ~1ms of the 16.7ms budget. One no-op tidy shipped with it (cached per-frame lookups) | `_onWinScroll` · `_onListScroll` | **measured clean**, build 1848, guarded by `motion.js` |
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

## THE TEAM'S LIST

### T4 — the Post button was not frozen, it was covered

The founder sent a screenshot of the composer with one word typed and said the Post button
did nothing. It was not the request and not the handler: **the button could not be pressed at
all.** `elementFromPoint` at its own centre returned the ✕ next to it.

The ✕ carries the app's invisible 44pt touch target as an `::after` with `inset:-6px`. An
inset overlay resolves against the nearest POSITIONED ancestor, and the ✕ is
`position:static`, so it resolved against the sticky header and rendered **370 x 68** instead
of 44 x 44: a transparent slab across the whole header, sitting over Post. Four more controls
were built the same way and are fixed with it. The Post button was also only **30pt tall**,
under the touch floor, and now has a full-size target of its own.

**Two touch guards were green the whole time.** One measures whether a tap target CLEARS
44pt, and an escaped overlay is enormous, so it passed. The other does check whether a
control steals its neighbour's taps, but it ran nine screens and the composer was not among
them, so it had never once looked at the button the whole app funnels into. `tapown.js` now
asks the question neither asked, over fourteen screens in both themes: does a control's own
centre belong to it? It fails by name when the old behaviour is put back.

### T2 — nothing in the app waits for ever

> *"some questions doesn't get answered by the Atwe AI and some stuff doesn't even work. For
> example I wanted to post a message and I am clicking post but it doesn't get sent. It's like
> frozen. I can't stand that, I must go back and cancel it... there is probably more stuff that
> doesn't work."*

**Two reports, one cause, and the cause was in the one function every write in the app passes
through.**

**`fetch` DOES NOT REJECT WHEN A PHONE LOSES SIGNAL MID-REQUEST. It stays PENDING.** A lift, a
tunnel, a 5G-to-LTE handover: no error, no event, nothing settles, for minutes. `API.req` had no
`AbortController` and no timeout, so every `await API.req(...)` in the app could simply stop —
and with it every `catch` and every `finally` written behind it, because a promise that never
settles never reaches them. The button stays disabled, no toast appears, and the only way out is
the back arrow. That is exactly what the founder described.

**It was found by reproduction, not by reading.** Three attempts to reproduce a frozen Post on
this machine all succeeded normally — the local server answers instantly, so the missing deadline
never mattered. What unlocked it was that the founder is on a real phone on a real network, and
that the AI error was a *timeout*. Stalling the route in a real browser reproduced it exactly:
`{"label":"Posting…","disabled":true,"open":true,"toast":""}` at 3s, 10s, 20s, 30s and 45s.

**A static sweep of button-restore patterns produced a false picture and is recorded here so
nobody repeats it.** It reported 67 "at risk" buttons and four "never re-enabled"; inspected with
a wide enough window, all four were fine. The restore patterns were mostly correct all along —
they were simply unreachable.

| what was wrong | what happens now |
|---|---|
| `API.req` had no deadline at all | every request carries one, **sized to the payload**: a floor of 40s plus 40ms per KB, capped at four minutes. A tap gives up quickly; a photo on a weak signal is not cancelled halfway |
| a stalled write was lost | a write that is safe to repeat goes to the **outbox** and leaves with the next good connection |
| a queued write said "Posted!" | it says *"Saved. It will send as soon as your connection is back."* Nothing in the app had ever checked `.queued` |
| Atwe AI gave up at **30s** | `AI_REPLY_TIMEOUT_MS` is **120s**. `/api/chat` runs a tool loop of up to three model passes so the assistant can look things up, and a broad question is precisely the one that uses all three — 30s was cutting off its own design |
| an abort read as **"Fetch is aborted"** | *"That took longer than expected, so Atwe AI stopped waiting."* The browser's wording blamed the member for our own deadline, and an `AbortError` carries no status, so it fell through to the network branch and blamed their connection too |
| the Post button was restored only in `catch` | a `finally`, so it always comes back |

**Guarded by `scratchpad/nohang.js`** (10 checks). It asserts the deadline at source, that it
still grows with the payload, and that the AI's 30s is gone — then **stalls a real route in a
real browser** (`p.route(..., () => {})`: never respond, never abort) and drives a real Post. The
button must say so while sending, be released after the stall, return to its label, and the post
must be in the outbox with the pill on screen saying so. A stalled *read* must fail in plain
words, never "aborted". **A probe that only tests a request that FAILS proves nothing** — an
instant failure was always handled correctly; the stall was the broken case.

### T1 — the em dash, everywhere, and never again

> *"I want you should make sure that this is not possible and none of the users should ever
> see this AI mark again... Except if someone posted, but from our side there's no such thing."*

**They were right that it had been half-done, and right about why it matters.** The long dash
is the most recognisable tell of machine-written text, so a product wearing 1,201 of them reads
as generated rather than made. It is a brand decision, not a style one.

**THE HALF THAT MATTERED MOST WAS NOT THE CLEANUP.** Atwe AI writes NEW text on every reply,
so sweeping the app's own copy would have been undone by tea time. There are forty separate AI
calls in `server.js` and a forty-first will be written by somebody who has not read any of
this, so both halves live on the ONE client wrapper every call already passes through: the
instruction that stops it happening, and a net under it that catches a model doing it anyway.
Proved end to end with a scripted model that answers with a dash **every single time** — better
than a real model for this, which might simply not use one that day and leave the hole untested.

**THE FOUNDER'S OWN EXCEPTION IS ENFORCED, NOT ASSUMED.** *"Except if someone posted."*
Proofread hands a member their exact words back, so it is passed `atweOwnWords` and is left
alone completely, instruction and net both. Every other writing task — improve, rephrase, a
drafted reply — DOES follow the rule, because that is Atwe writing prose on somebody's behalf,
and putting a machine tell into a member's own message is the worse version of this fault.

### THE TWENTY THAT SURVIVED, AND WHY NO CHECK COULD SEE THEM

The founder asked, after the first pass shipped, to *"confirm and make sure"* it was clean
everywhere including an AI reply and a notification. It was not, and the reason is worth
writing down: **a dash can be written without being a dash.** `'\u2014'` in a source file is
six plain ASCII bytes, so a `/[—–]/` search reads straight past it, and the browser turns it
back into a real em dash on screen. Twenty were hiding that way, with every check green:

| where | what a member saw |
|---|---|
| the **offline screen** (both copies) | *"Check your connection — we'll pick up right where you left off"* |
| the **stranger-guard** before sending money | *"Scammers often ask strangers for money — and money sent on Atwe usually can't be brought back"* |
| four confirm buttons | *"I know them — send $20"*, *"— pay it"*, *"— pay my share"*, *"— send the gift card"* |
| the gift-card waiting list | *"It's ready for you — check your messages from Atwe"* |
| two empty table cells | a bare `—` |
| two admin toasts | *"ready to spend — or to move into their wallet balance"* |
| **six Atwe AI system prompts** | nothing, but the model was being SHOWN em dashes in the same breath as being told never to write one |

The offline one is the worst of them: the app spoke in exactly the generated voice this whole
rule exists to remove, at the one moment a member is already annoyed. All twenty are gone, and
the guard now matches the character, both escape forms and the HTML entities, and **self-tests
that detector on every run** — a sweep that cannot fail proves nothing, and this one was green
on twenty of them.

### NOTIFICATIONS ARE CLEAN BY CONSTRUCTION, NOT BY SWEEPING

Worth knowing because it is a stronger guarantee than a sweep: a `notifications` row stores a
TYPE and some ids and **no free text at all**. The in-app wording comes from the client's own
`verbs` dictionary and the push wording from `PUSH_VERBS`, both swept and both guarded. The
only free text in a notification is the actor's own name, which is a member's own words and so
the founder's own exception. There is nowhere for a dash to hide.

### CAN THE ONES LEFT IN THE CODE JUST BE TAKEN OFF? TRIED. NO.

The honest answer to the founder's question. About 3,900 dashes live in code comments and the
notes inside SQL queries. **None of them has to be there** and nobody can see one: a comment is
not sent to the model, not rendered by the browser, not read by Postgres. So removing them was
actually built — a comment-only rewrite, verified not to change a single byte of real code nor
move a single line — and then thrown away, because **the output was worse than the input**. A
dash standing in front of a class name or a selector is not punctuation a machine can replace:
`as — .pf-top-save` became `as.pf-top-save`, `than — .overlay` became `than.overlay`, and
`and — :root is a different element` became `and:root`, which reads as a selector. These
comments are the only written record of why half this app is built the way it is, and about a
twentieth came back damaged or misleading. The guard is what makes the rule stick; sweeping
the margin notes was never what was protecting anybody.

**A latent bug fell out of that attempt and was kept.** Two paragraphs of a comment about the
Home scroll-cover were separated by a stray `*/`, leaving the second at CSS top level, where it
cannot begin a selector — so the browser read it as the prelude of the next rule, found it
invalid and **dropped `.tb-hairline{display:none;}` entirely**. Nothing showed, because that
div has no other styling and an empty div is invisible, which is exactly why it survived; the
only cost was that the next rule added there would have gone with it.

### THE COUNT, AND WHY THE FIRST ONE WAS WRONG

A first pass reported ~1,600 to fix. It was inflated by about four hundred: the hand-rolled
comment stripper behind it broke on three things this codebase is full of — **a regex literal
containing a slash** (`/https?:\/\//` is not a comment), **a template literal with `${...}`
in it** (inside the braces it is code again, and almost every screen is built that way), and
**an apostrophe in a comment** ("doesn't" ends the comment as far as a quote-counter is
concerned). So it reported real comments as user-facing copy. `tools/jstext.js` is a proper
tokeniser written for this and kept because the guard needs the same answer forever. The true
number was **1,201**.

### THE RULE IS NOT "REPLACE IT WITH A HYPHEN"

That would read as a typo rather than as a sentence, and would look worse than the dash did.
`tools/nodash.js` does what a person editing the line would do, which depends on the job the
dash was doing: a **pair** inside one sentence is an aside and becomes two commas; a **lone**
dash joins a statement to its elaboration and becomes a full stop and a capital; a dash before
a **list** becomes a colon; an **unspaced** dash is a range and becomes the word "to"; a
**joining word** after it ("and", "which", "so") takes a comma, because those cannot open a
sentence; a run that is **nothing but a dash** is a table's empty cell and becomes a hyphen.
1,175 lines were rewritten this way and every one was spot-read or reviewed.

### TWO THINGS IT NEARLY BROKE, BOTH CAUGHT BEFORE ANYTHING WAS WRITTEN

- **IT WAS REFORMATTING SQL.** An innocent-looking "collapse runs of spaces" tidy at the end
  of the rule rewrote every multi-line query in the file into one flat line, because a query
  is a string like any other. Queries are now skipped outright — a dash inside one reaches
  nobody — and the rule never touches a character that was not beside a dash.
- **IT TURNED A RANGE INTO A COMMA.** "canvas chart (1D–ALL), inline cards — optional data"
  read as one parenthetical pair spanning the bracket, giving "(1D, ALL)". An aside's middle
  contains no bracket, and an unspaced dash is never prose.

### WHAT IS LEFT, HONESTLY

**Seven runs, all of them SQL** — invisible to everybody, deliberately skipped. And the app's
own **code comments keep theirs**: nobody reads them, and rewriting two thousand of them would
be a large diff with no reader.

**One thing the founder should know rather than discover.** The sweep fixes the CODE. Rows
already in the DATABASE keep whatever they were written with — which is right for member posts
(their words, their punctuation) and worth knowing for **demo mode**: any sample posts seeded
before this build still carry the old copy. Switching demo mode off and on reseeds them with
the corrected lines.

---

## Pass 3 of 3 — speed and motion, measured · DONE, NOTHING TO FIX

> *"Speed and motion. How it actually feels to scroll and animate, measured rather than felt."*

**Eight surfaces, three flings each, at a 6x CPU throttle, on a 390x844 phone viewport.**
The throttle is not decoration: an unthrottled headless desktop renders every screen in
this app at a clean 60fps whether or not a phone would, and the first version of the
`notifscroll` check passed on genuinely broken code for exactly that reason.

### THE RESULT

| surface | what actually scrolls | ordinary frame | worst frame | frames over 32ms |
|---|---|---|---|---|
| the Home feed | the page | **16.7ms** | 33ms | 5 of 41 |
| an open conversation | `acThreadVP` | **16.7ms** | 33ms | 1 of 41 |
| Notifications | `notifList` | **16.7ms** | 33ms | 3 of 41 |
| the marketplace | its own card | **16.7ms** | 33ms | 8 of 41 |
| your orders | the page | **16.7ms** | 50ms | 1 of 41 |
| the Account page · Engine | — | *434px and 553px of room: too short to fling, skipped by name* | | |
| the Beam chat list | — | *one conversation on a test account: nothing to scroll* | | |

**The ordinary frame is a single vsync on every surface without exception.** That is what
"smooth" means — not that no frame is ever long, but that the normal frame arrives on time.
Nothing stalls anywhere: the worst single frame in the whole sweep is 50ms, and a hitch you
would actually see starts well above that.

**And the app's own code is not the cost.** A CPU profile of a Home fling puts **57-78% of
samples in `(program)`** — the browser rasterising real photographs — against **~1ms per
frame in all of Atwe's own scroll handling put together**, out of a 16.7ms budget. There is
no scroll fault here to fix, and the measurement says where the time genuinely goes if the
question is ever asked again.

### THE ONE CHANGE THAT SHIPPED, AND THE HONEST NOTE ON IT

`_onWinScroll` computed `atBottom` — a `scrollHeight` read — AFTER writing the top bar's
transform and `--tb-hide`, three lines above its own comment forbidding exactly that
("never read layout on scroll (a per-frame reflow stalls scroll)"). It looked like a
textbook per-frame forced reflow.

**It was not, and the A/B is written into the code so nobody spends the afternoon on it
twice.** Measured with Chrome's own `LayoutCount` over a fixed 60-frame fling: **24 layouts
and 3.3ms either way.** A transform and a custom property dirty compositing and style, not
layout, so the later read was already free. The reordering shipped anyway, with a comment
that says all of this, because it makes the invariant real — the day someone adds a write
above that line which DOES dirty layout, it cannot silently become a reflow. What it
genuinely saves is small and real: the `.topbar` lookup and a `getElementById` that ran on
every frame of every fling are cached, and a `style.opacity` that was rewritten every frame
on every tab now writes only on a change.

### THE PROBE WAS MEASURING THE PAGE BEHIND THE OVERLAY

The first run of `motion.js` reported Notifications and the marketplace as materially worse
than everything else. They were not. It took the first candidate with room to move and
`document.scrollingElement` was at the head of that list — so on every surface that is an
**overlay over a world** it measured the **Home feed sitting behind the overlay**, three
separate times, and returned three separate verdicts about it. Proved by printing all of
them: the document had 6404px of room while `#notifList` had 3545 and the marketplace's own
card had 23996.

**That is the fifth time this repo has recorded a check confidently measuring the wrong
subject** — after a scope that excluded most of it, a probe missing from the runner, a probe
that could only ever skip, and a control that was absent from the data. An overlay covers
the page, so it owns the gesture: look inside the topmost open overlay first, and fall back
to the world underneath only when nothing in there scrolls.

### THREE MORE PROBE FAULTS, EVERY ONE OF WHICH REPORTED A FAILURE ON WORKING CODE

- **A signed-out app is a broken app.** The very first run said "nothing long enough to
  scroll" on all eight surfaces — the tell that the CHECK is wrong, not the app. Postgres
  had gone down underneath it, so the page painted a signed-out shell and every scroller
  really was empty. It now refuses to measure until `S.user.id` exists.
- **A conversation opens at the BOTTOM.** Deliberately — the app spends a watchdog keeping
  it there — so flinging it further down moves nothing, and the probe reported "0px of room"
  about the one surface in the app with eighty-odd messages in it. It asks which way there
  is room now, instead of assuming.
- **`AC._chats` does not exist.** The probe fed `acOpenChat(undefined)`, the thread screen
  opened EMPTY, and that empty screen was then reported as a conversation that would not
  scroll. The peer comes from the server now, not from a guess at the client's own state.

### THE BAR, AND WHY ONE HALF OF IT IS DELIBERATELY LOOSE

Flung hard at a 6x throttle, a surface with real photographs in it drops somewhere between
5 and 15 of 41 moving frames — **and it disagrees with itself**: the same surface, same
build, measured twice in a row, gave 5 then 11, and 2 then 15. A dropped-frame bar tight
enough to catch a six-frame regression would go red on noise several times a week and be
switched off within a fortnight, which is worth less than a loose bar that is believed.

So the loose checks (nothing stalls, no surface is an outlier) sit beside one with real
teeth: **the milliseconds of Atwe's own JavaScript per moving frame**, taken from the
sampling profiler, which does not vary with what the browser happens to be rasterising.
It measures **~1ms**; the bar is 3. Self-tested by injecting a deliberate 14ms of work per
scroll event: that takes it to **4.82ms and fails by name**, while leaving the dropped-frame
count inside its own noise — which is precisely why the profile-based check exists.

### WHAT THIS PASS DID NOT LOOK AT

- **A real phone.** A CPU throttle does not throttle the GPU, and `backdrop-filter` is
  GPU-bound, so this bounds the CPU cost of scrolling, not an iPhone's rasterisation. That
  caveat is already recorded against the chat glass and the world bars.
- **The Beam chat list and two short pages**, which have too little on a test account to
  fling. They skip by name in the output rather than silently.
- **Opening time and animation shape**, which already have their own guards and were not
  re-done here: `bootspeed.js`, `settle.js`, `engsettle.js`, `feedskel.js`, `smooth.js`,
  `notifscroll.js`.

---

## The rules for this pass, same as the last two

- **Measure, never assume.** Every item is something observed, not suspected.
- **Every fix gets a guard** in `scratchpad/run-all.sh`, self-tested in both directions,
  in the same commit.
- **Record what is NOT covered** when this pass closes, exactly as the first one did.
- **`node tools/features.js add`** in the commit that ships a change, so the two numbers
  stay true.
