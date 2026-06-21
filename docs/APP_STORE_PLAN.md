# Atwe → App Store: the plain-English plan

**Goal:** Atwe live on the Apple App Store within ~3 months.
**Short version:** this is very doable, because the hard part (the actual Atwe
product) is already built. What's left is *packaging* it for the iPhone and
passing Apple's review — not rebuilding anything.

---

## 1. The big picture (read this first)

Right now Atwe is a **website** (`atwe.com`) that runs in a browser.

The **App Store app** is the *same Atwe*, wrapped in a thin native "shell" so it
becomes an app people **download onto their iPhone**.

> Think of the website as the **engine**, and the App Store app as a **car body**
> we bolt around that same engine so it can be sold at the dealership (the App
> Store). We are **not** building a second Atwe.

**Why this is good news:**
- **One codebase.** The app *is* the website running inside an app shell. Every
  improvement to the website automatically shows up in the app.
- We've spent our time building the **engine** (chat, accounts, social, Google +
  Apple sign-in, calls). That was the right order. The "car body" is the smaller,
  final step.

The tool we'll use to do the wrapping is called **Capacitor** — the standard way
to turn a web app into a native iOS app while keeping one codebase.

---

## 2. What you'll have at the end

- Atwe in the **App Store**, downloadable on iPhone (and easily iPad/Android later).
- An **app icon** on the home screen.
- **Push notifications** (a real app can ping users; a plain website can't).
- The exact same Atwe experience — same login, same data, same everything.

---

## 3. The plan, in 5 phases (~12 weeks)

| Phase | Weeks | What happens | Who |
|-------|-------|--------------|-----|
| **0. Accounts** | Now | Enroll in Apple Developer ($99/yr). Finish the Apple sign-in setup (Services ID + domain) we already coded. | **You** (I guide every click) |
| **1. Wrap it** | 1–3 | I add Capacitor and produce the iOS project. You build it on a Mac → Atwe runs on a real iPhone via **TestFlight** (Apple's beta tool). | Me + you (Mac/Xcode steps) |
| **2. Make it "app-like"** | 3–6 | I add **push notifications** and tidy the mobile UI. Decide the **Pro-on-iPhone** question (see §4). | Me |
| **3. Compliance** | 6–9 | I add content **reporting** (Apple requires it for social apps), a **privacy policy**, and prep the **App Store listing** (screenshots, description, age rating). | Me + you (text/legal) |
| **4. Submit** | 9–12 | Beta test on TestFlight, fix anything Apple flags, **submit for review** (review is usually ~1–2 days). | You submit; I fix |

There's comfortable slack in 12 weeks. A first version could realistically be
submitted sooner.

---

## 4. Three things we need to decide (with my recommendations)

### A. How to handle **Pro** inside the iPhone app  ⚠️ *most important*
Apple requires **their** payment system for anything bought **inside** the app,
and takes **15–30%**. You can't use Stripe for that in-app.

- ✅ **My recommendation for v1: don't sell Pro inside the iPhone app.** Hide the
  "Upgrade to Pro" button on iOS; people upgrade on the **website** (where you
  keep ~97% via Stripe). Simplest, fastest, fully allowed, no Apple cut.
- *Later option:* add Apple's in-app purchase if iPhone upgrades become worth the
  cut. We can always add it after launch.

### B. **Push notifications**
- ✅ **Recommendation: yes, add them.** They make it feel like a real app (Apple
  partly judges on this) and bring users back. Modest work.

### C. **Content reporting** (because Atwe is social)
- ✅ **Recommendation: yes, required.** Apple mandates a way to **report** posts
  and **block** users for any social app. We already have blocking/muting; I'll
  add reporting. Non-negotiable for approval.

---

## 5. What it costs

| Item | Cost |
|------|------|
| Apple Developer Program | **$99 / year** (required) |
| A Mac to build/submit | Needed for Xcode. Options: your own Mac, a borrowed one, or a cloud Mac service (~$20–50/mo, cancel after launch) |
| Apple's cut on in-app sales | **0%** if we hide Pro on iOS (recommended); 15–30% only if we add in-app purchase later |
| My work | Included — I do the code |

---

## 6. Who does what

**I do (code):** Capacitor setup, push notifications, hide-Pro-on-iOS logic,
content reporting, mobile UI polish, privacy policy draft, App Store listing prep.

**Only you can do (accounts/Apple):** pay the $99, click through Apple Developer
+ App Store Connect, run the build in Xcode on a Mac, and press "Submit." I'll
give you **exact, click-by-click** instructions for each — no guesswork.

> Honest note: I can't run Xcode or an iPhone in my environment, so the final
> on-device build and submission happen on your Mac. I'll prepare everything so
> those steps are as close to copy-paste as possible.

---

## 7. Apple's approval checklist (so there are no surprises)

- [x] **Sign in with Apple** — required because we offer Google login. *(Built.)*
- [x] **Delete your account** in-app — required. *(Built.)*
- [x] **Block users** — required for social apps. *(Built.)*
- [ ] **Report content** — required for social apps. *(To build.)*
- [ ] **Push notifications / native feel** — clears the "it's just a website" bar.
- [ ] **No Stripe for in-app digital sales** — hide Pro on iOS (recommended).
- [ ] **Privacy policy URL + privacy labels** — required.
- [ ] **App icon + screenshots + description + age rating** — the store listing.

---

## 8. The very next step

**Phase 0:** enroll in the **Apple Developer Program** ($99/yr) at
<https://developer.apple.com/programs/>. Enrollment can take a day or two to
approve, so starting it early unblocks everything else.

While that's pending, I can start **Phase 1** (the Capacitor wrapper) right away —
none of it needs the paid account until you actually build on a Mac.

*Just say the word and I'll begin the wrapper.*
