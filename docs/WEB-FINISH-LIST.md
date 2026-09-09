# The web app finish list

**This list is what "the web app is finished" means.** Step 1 of the platform plan has no
feature checklist left to burn down — what remains is refinement, which never ends by
itself — so the owner and this file agreed a definition: **one honest full pass over the
whole site, written up as a real list; finished means this list is at zero.**

**Every item here is MEASURED, not judged.** A list built on taste can never reach zero.
Each entry says the screen, the exact fault, the number, and what "done" looks like.

Progress: **12 of 13 done.**  ·  The one left is **D1**, and it is not a bug — it is a
design decision about the brand's blue that only the owner can make. Everything this pass
found and could fix, is fixed, measured on real screens in both themes, and guarded by a
probe that fails if it comes back.

---

## How this pass was made

The app already keeps an index of every place it can go — the one that powers the search
bar — so that index was used as the checklist rather than a hand-written one. **154
destinations**, opened one at a time in a real browser at 390×844, **in both themes**, each
asked the same battery of objective questions: does it open, does it throw, does anything
spill sideways, is any text cut off, is any text below the legibility floor, is any control
below the touch floor, are there two primary buttons doing one job, has any value leaked
onto the screen as a word.

**Six times the sweep lit up and the CHECK was wrong, not the app.** They are recorded here
because the next person to write one will hit the same traps:

| what it flagged | why it was wrong |
|---|---|
| content spilling sideways on nearly every screen | it was reporting the mobile drawer, which is *parked* off-screen on purpose. Replaced with the honest question — can the page actually scroll sideways? Noise went to zero. |
| two white primaries on nine screens | selected **tabs** (white by design — a state, not an action) and per-card Buy buttons. Narrowed to a real fault: two white buttons running the *same* function. |
| "this screen shows a failure message" | matched Help & refunds' own copy, *"Charged by mistake or something went wrong?"*. A failure must be a whole line, not a phrase. |
| 34 settings rows all throwing | `openAdmin()` navigates the browser to the admin dashboard, so everything after it ran on the wrong page. The sweep now notices it has been navigated away and boots the app back. |
| six screens of "invisible" text at exactly 1.00:1 | the **gradient** cards (wallet, AI hero, Atwe Card, Rewards, Affiliate, studio). A gradient cannot be read out of CSS, so the walk-up found the page behind the card. Gradient-backed text is now skipped and counted, never scored. |
| "Edit profile" invisible in Light | a real-pixel check said **15.13:1**. Dropped. |
| the same "Edit profile" fault again, from the standing guard | **this one had a real cause and it took a diagnosis, not a dismissal.** The guard walked up for the first ancestor opaque *enough* — alpha > .85 — and the profile editor's own title bar is exactly `rgba(0,0,0,.85)`, which is not greater than .85. So the walk sailed past it to the white overlay behind and scored white-on-white. Any threshold has that failure somewhere; the guard now **composites** the alpha layers instead, and .85 black over white gives 38, which is the `[38,38,38]` the screenshot reads, to the byte. |

**And a grep would have put eight fake items on this list.** Eight CSS rules *say* they
paint text with the icon-tint token; measuring showed a later rule wins and they render at
5.2:1. Only the two that genuinely render at the icon tint are here. **Measure, never grep.**

---

## A · Text a person cannot read

The floor is **4.5:1** for normal text (3:1 once it is 24px, or 18.7px bold). These are all
below it.

### A1 — "Your studio": three labels are invisible in Light theme ✅ DONE (build 1830)
**The worst item on this list.** `.dev-name` (index.html:851) hardcodes `color:#fff`, so
**"Money", "Reach" and "What you have made" are white text on a white page.** Confirmed by
reading real pixels, not CSS: the whole band is `255,255,255` — lightest and darkest pixel
identical, i.e. nothing is drawn. Black theme is fine (white on black).
*Done when:* the labels use a theme token and measure ≥4.5:1 in **both** themes.
**Fixed:** `.dev-name` now uses `--t1`. Re-measured on the real screen — Black **21:1**, Light **16.83:1** (was 1:1, i.e. invisible).

### A2 — "Message insights": the summary line is at 2.02:1 ✅ DONE (build 1830)
`.ci-note` (index.html:11944) paints text with **`--t4`**, the icon-tint token. The design
law names this exact misuse twice — it fails both the 4.5:1 floor for text and the 3:1
floor for a control. "Last 30 days · 5 in, 37 out · 0 new" measures **2.02:1 on Black** and
**1.86:1 on Light** at 12px: under half the floor.
*Done when:* it uses a text token (`--t3` measures 5.2:1) in both themes.
*Note:* this is the **third** time `--t4` has been used for words. Worth a sweep of its own.
**Fixed:** `.ci-note` and the `.ci-yr` year label beside it (same fault, same block) use `--t3`. Re-measured: Black **4.56:1**, Light **4.66:1**.

### A3 — "Deliver for others": the three waiting lines are at 1.56:1 ✅ DONE (build 1830)
"Waiting on the seller to agree…", "Waiting for a courier", "Waiting on the buyer to
agree…" — 12px, **1.56:1 in Light**. These are status lines; they are the whole point of
the screen.
*Done when:* ≥4.5:1 in both themes.
**Fixed:** `.dlv-state.wait` used raw `--amber`; it now uses **`--amber-txt`**, the token that exists for a coloured word and whose own declaration says "use these — never raw --green/--amber". Re-measured: Black **11.57:1**, Light **6.11:1**.

### A4 — "The till": the payment-method labels ⚠️ PART DONE — the rest became D1
**I aimed the first fix at the wrong rule, and the re-measurement caught it.** The
UNSELECTED labels were changed from `--t2` to `--t1` (Black 6.03 → **19.66:1**) and that
stands. But the 3.52:1 the sweep reported was the **selected** pill — white text on the
accent blue — which is a different rule and turns out not to be a till problem at all.
See **D1**.
*Done when:* D1 is decided; the unselected half is already done.

### A5 — the "Log out" row is at 3.99:1 in Light ✅ DONE (build 1830)
Measured from real pixels: red `245,0,51` on near-white. Red is required here by the colour
law (destructive), so the fix is the shade, not the colour.
*Done when:* ≥4.5:1 in Light without ceasing to read as red.
**Fixed:** the LABEL uses `--red-txt` (#C00020 on Light); the ICON keeps the raw hue, since a glyph is a graphic with a 3:1 floor and the brighter red is what makes the row read as destructive. Re-measured: Black **4.64:1**, Light **5.91:1**.

---

## B · Controls too small to press

Apple's floor is **44×44pt**, and the app already carries invisible `::before` overlays
elsewhere to meet it without making a control look heavy — so the pattern exists. These
were measured **including** any such overlay.

### B1 — the tab row's "Add" is 29×30, on six screens ✅ DONE (build 1831)
**Fixed:** an invisible `::before` overlay — the app's own pattern from the post action
pills — so the word looks identical and nothing moves. Measured hit box **41×44**.
*The width is deliberately 41, not 44*: "Add" is the row's last child so growing right is
free, but growing left further would eat the tab beside it. Stealing a neighbour's tap is
a worse fault than the one being fixed.

### B2 — Home's "+" is 20×20 ✅ DONE (build 1831) — with a recorded shortfall
The smallest control found anywhere, and the one that **cannot simply be inflated**: it
sits ON the 54px ring of your own Daily, whose own tap *views* it while this one *adds* to
it — two actions in one tile. Centring a 44px target would swallow the ring's middle and
steal the view tap, which is a worse fault than the one being fixed.
**Fixed:** it grows only DOWN and OUT, away from the ring's centre and into the tray's 12px
gap — **36×36**, not 44. Instagram makes the same compromise for the same reason. The
shortfall is written into the CSS beside the rule and is **recorded here rather than
claimed as 44**, which is the only honest way to leave it.

### B3 — the filter tabs are ~41×27, on six screens ✅ DONE (build 1831)
**Fixed:** overlays, so the rows' rhythm is untouched — the design decision is preserved
rather than overridden. Services **49×45**, Collections **47×45**, and the same for
Businesses' and the other chip rows. Horizontal growth held to ±3 (half the 7px row gap).

### B4 — the composer's B and I are 42×42 ✅ DONE (build 1831)
**Fixed:** now **44×44**. Scoped to `.ac-post-toolbar` on purpose — `.msg-attach` is shared
with the CHAT composer, whose bar is measured to ChatGPT's own 49px and would have grown.

### B5 — Help's close "×" is 32×32 ✅ DONE (build 1832)
**It was never a dead route — the dead name was mine.** The first pass parked this because
`acOpenHelp()` "does not exist", and it does not: I invented it. The real opener is
`openHelp()`, which has always worked. Worth recording, because parking an item on a
misremembered function name is how a real fault gets left standing on a false alibi.
**Fixed:** the button is `.modal-x`, now carrying the same overlay as the rest — measured
**44×44** on the real screen, stealing nothing.

### B6 — Push notifications' "1h" and "8h" are 41×29 ✅ DONE (build 1831) · now **47×45**.

### B7 — the check had been ignoring every ICON-ONLY button ✅ DONE (build 1832)
**Not a screen, a hole in the method — and it is the reason B1–B6 were only six items.**
The first touch-target check required a control to have TEXT, so it never once looked at a
button whose whole content is a glyph. That excluded **the two most-pressed controls in the
app**: the sheet close, which appears on about 90 screens, and the Settings back arrow, on
about 35. Six controls became **nineteen** the moment the check stopped excluding most of
its own subject.
**Fixed:** the same invisible-overlay pattern across all of them — sheet close, Settings and
Alerts back, the top-bar circles, the post ⋯, the accent swatches, the Account hero chevron,
the conversation back, the marketplace cart and save, the profile ✕ and both cameras, the
modal ✕, the immersive rail and its buttons, the industry chips. Nothing moved a pixel;
every one measures ≥44 in both directions and hit-tests clean against its neighbour.
*The rail is the one exception, and deliberately:* it stacks vertically with a small gap, so
it grows **sideways only** — 44 tall would overlap the button above and below it.
*The lesson, which this repo keeps relearning:* **a check that quietly excludes most of its
subject reports a clean result.**

---

## D · One for the owner to decide

### D1 — white text on the accent blue is 3.52:1, in 17 places ⬜ **NEEDS A DECISION**
White on `--accent` (#0088FF) measures **3.52:1** — under the 4.5 floor for normal text.
It is **not one screen**: `background:var(--accent);color:#fff` appears in **17 rules**, so
every selected blue control in the app is the same. Fixing one and not the rest would leave
the app inconsistent, which is worse than the fault.

Three ways out, and they are genuinely different products, not one right answer:
1. **Make a selected choice the WHITE pill**, which is already the app's own law for a row
   of choices (`--tab-fill-on` / `--tab-ink-on`) and passes easily. Cost: the colour law
   says white is *the one primary action per screen*, and on a screen that already has a
   real primary (a Charge button) this spends it twice.
2. **Darken the blue** behind white text until it passes. Cost: the accent is the brand's
   identity colour and would no longer be one blue.
3. **Accept it for large/bold text only.** At 18.66px bold or 24px the floor drops to 3:1
   and 3.52 passes. Cost: it does not help the 13–14px labels, which are most of them.

*Done when:* the owner picks one and it is applied to all 17 consistently.

---

## C · A standing risk, not yet a fault

### C1 — 94 rules hardcode white text ✅ DONE (build 1832) — closed by a guard, not by an audit
The colour law says reference colours **only** via variables, so a theme can flip in one
place. 94 rules set `color:#fff` directly. Most are legitimate (white on a gradient card,
white on a blue fill, the always-black sign-in screen) — but **A1 proves at least one is
invisible in Light**, and nothing stops the next one.

**Auditing 94 rules by hand is the wrong tool, and this list already has the proof:** a
grep of exactly that kind reported eight rules painting text with the icon tint, and
measuring showed a later rule wins in six of them. Reading rules tells you what the CSS
says; it cannot tell you what a person sees.

**Fixed:** `scratchpad/legible.js` opens **30 surfaces in both themes** — 60 in all — walks
every leaf of text, composites the real background, skips only text on a gradient (which
cannot be read out of CSS at all) and fails anything under its floor. It scores nothing the
browser would not actually paint at that point, so words sitting behind an open panel are
never counted. It names any surface it could not open, because a surface that silently
fails to open is uncovered — the same quiet gap as a probe that prints "skipped" and
exits 0. **All 60 open.**

*Self-tested:* putting A1's `color:#fff` back makes it fail Your studio by name, on all
three labels, at 1.00:1.

*It carries exactly one exception, D1, matched by exact string on one surface* — so the
guard is not permanently red on a decision nobody has made, and anything else still fails.
Delete the exception the day D1 is decided.

---

## What this pass did NOT look at

The list is only honest if it says where it stops. **None of this is claimed as clean:**

- **Deeper states.** Every screen was opened in its resting state. An open conversation, a
  post detail, a listing, a half-filled form, a long list, an error state — not covered.
- **Other widths.** 390×844 only. Desktop, tablet and phone-landscape are not in this pass.
- **The admin dashboard.** It has its own short pass, by the owner's decision, after this one.
- **Anything needing a second person or real money** — a real purchase, a call, an upload.
- **Speed and motion.** How it feels to scroll and animate is not measured here.

Each of those is a further pass that **adds** to this list. The list is not final until they
are done; it is honest about being the first pass.

---

## Tools

`scratchpad/sweep.js` is the pass, and re-runnable:

```
node scratchpad/sweep.js <from> <to> <black|light>
```

It enumerates from the app's own index (`scratchpad/enum.js` writes `destinations.json`),
and skips the two destinations that end the session (Log out, Delete account) — they are
covered by `journeys.js`, which signs out for real.

Three guards keep the fixed items fixed, all in `run-all.sh`:

- **`scratchpad/contrastfix.js`** — A1–A5, re-measured on the real screens in both themes.
- **`scratchpad/touchsize.js`** — B1–B7. It measures the box the BROWSER would hit, overlay
  included, **and** hit-tests each neighbour's centre, because the cheap way to pass a
  touch-target check is to grow sideways over the control next door. It also reads the CSS
  block itself and fails if any class it names has been renamed out from under it — driving
  screens can only cover the controls those screens happen to hold, which is exactly how
  this probe under-covered itself the first time.
- **`scratchpad/legible.js`** — C1's standing guard, 60 surfaces, both themes.

**Two probe bugs found while writing these, both of which reported a fault on working code**
— worth knowing before writing a similar check:

- **Poll, don't snapshot.** A screen that fetches can be a frame behind a fixed wait, and
  "not found" then reads as a fault on a control that is plainly there. `.ac-post-more`
  failed exactly that way over 24 real posts.
- **A probe's own earlier step can change what a later one sees.** One case switches the
  home feed to Collections, and going back to Home does not put the scope back — so a later
  case measured an empty feed. Set the state you need; do not assume navigating resets it.
