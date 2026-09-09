# The web app finish list

**This list is what "the web app is finished" means.** Step 1 of the platform plan has no
feature checklist left to burn down — what remains is refinement, which never ends by
itself — so the owner and this file agreed a definition: **one honest full pass over the
whole site, written up as a real list; finished means this list is at zero.**

**Every item here is MEASURED, not judged.** A list built on taste can never reach zero.
Each entry says the screen, the exact fault, the number, and what "done" looks like.

Progress: **4 of 13 done.**  ·  1 item turned out to be bigger than it looked and is now D1.

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

### B1 — the tab row's "Add" is 29×30, on six screens ⬜
Home, Circles, Collections, Get verified, Export your customers, Help & feedback.
*Done when:* the tap target is ≥44 in both directions while the word looks unchanged.

### B2 — Home's "+" is 20×20 ⬜  · the smallest control found anywhere.

### B3 — the filter tabs are ~41×27, on six screens ⬜
"All" on Services (43×27), Businesses (40×26), Collections, Get verified, Export your
customers, Help & feedback (41×27).
*Done when:* ≥44 tall, or an overlay supplies it. **NB** a taller pill changes the tab
row's rhythm — this one is a design decision, not just a number.

### B4 — the composer's B and I are 42×42 ⬜ · two short. The cheapest item here.

### B5 — Help's close "×" is 32×32 ⬜

### B6 — Push notifications' "1h" and "8h" are 41×29 ⬜

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

### C1 — 94 rules hardcode white text ⬜
The colour law says reference colours **only** via variables, so a theme can flip in one
place. 94 rules set `color:#fff` directly. Most are legitimate (white on a gradient card,
white on a blue fill, the always-black sign-in screen) — but **A1 proves at least one is
invisible in Light**, and nothing stops the next one.
*Done when:* each of the 94 is either confirmed to sit on a permanently dark ground, or
moved onto a token — and a check exists so a new one cannot be added blind.

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
