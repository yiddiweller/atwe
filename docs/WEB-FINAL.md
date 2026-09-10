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

**1. Everything the founder's team raises.** Their words, their screenshots. This is the
first source and the most important one: they use it daily and they see what a probe
cannot.

**2. The three passes the first sweep explicitly said it had NOT done.** That list closed
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

**3. Anything found along the way.** Recorded here rather than fixed silently, so the
list stays the honest measure of what is left.

---

## The list

*(the founder's team's items go in first, above the pass results)*

| # | what | where | state |
|---|---|---|---|

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

## The rules for this pass, same as the last two

- **Measure, never assume.** Every item is something observed, not suspected.
- **Every fix gets a guard** in `scratchpad/run-all.sh`, self-tested in both directions,
  in the same commit.
- **Record what is NOT covered** when this pass closes, exactly as the first one did.
- **`node tools/features.js add`** in the commit that ships a change, so the two numbers
  stay true.
