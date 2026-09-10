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

*(empty — the founder's team's items go here first, then the three passes above)*

| # | what | where | state |
|---|---|---|---|

---

## The rules for this pass, same as the last two

- **Measure, never assume.** Every item is something observed, not suspected.
- **Every fix gets a guard** in `scratchpad/run-all.sh`, self-tested in both directions,
  in the same commit.
- **Record what is NOT covered** when this pass closes, exactly as the first one did.
- **`node tools/features.js add`** in the commit that ships a change, so the two numbers
  stay true.
