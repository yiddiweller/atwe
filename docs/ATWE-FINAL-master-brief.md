# ATWE — THE FINAL MASTER BRIEF (complete · top to bottom · launch-ready)

Read this entire document, then read the whole repository, before changing anything. This document supersedes all previous polish briefs. You are working on Atwe, a finished full-stack web app: all features are built. Your mission is to take it from "feature-complete" to "launch-ready" — a product real people can start using today that feels like a real Apple-grade app: instantly understandable, visually flawless in both themes, functionally solid with zero broken interactions, and unmistakably Atwe. You will work in two stages: AUDIT first (no product-code changes), then EXECUTE phase by phase after my approval. The one exception: the navigation restructure in Section 3 is a pre-approved directive, not a proposal — plan it in the audit, execute it as its own early phase.

---

## 1. WHAT ATWE IS (ground truth — never re-architect)

Atwe is the app where a business lives online. Not a messaging app with business features bolted on — the actual home base for running a business day to day: talking to customers and staff, posting and getting discovered, hiring and getting hired, selling and getting paid, all in one place, with Atwe AI woven through every part of it. Every account is personal or business; a business account IS the storefront and the employer surface (no separate "company page"). User-facing copy is branded entirely as "Atwe" and never names the AI vendor or model.

The feature surface (all built; judge design/UX/quality, not scope): Atwe AI everywhere (assistant with guest mode, writing assistant, Fix with AI, network digest, job matchmaker, resume builder, applicant ranking, interview prep, cover notes, shopping concierge, business description writer, CS answer drafts, moderation, translation, voice transcription, agentic "do it for me" with confirmation, graceful degradation); AtChat messaging (DMs with full message actions, multi-thread per person, disappearing/view-once/locked chats, scheduled messages, broadcast lists, quick replies, groups/channels/communities, group Cloud, WebRTC calls, Go Live, Spaces, stories with highlights, wallpapers, global message search, realtime presence/receipts over SSE, web push, QR device link); the social feed (For You + Following, posts/polls/threads/reels, reposts/quotes/bookmarks/hashtags/lists, Postshot, Explore, trending, who-to-follow, Circles and Feeds, personalization engine, mute/block/report); professional networking and jobs (connections + follow, two-sided marketplace, hiring pipeline with analytics and salary insight, Easy Apply with AI, skills/endorsements/assessments, experience/education/certs/recommendations, profile-strength meter, events, newsletters, business Q&A/hours/reviews, booking with escrow deposits, business directory, near-me, verification, team seats with roles, unified calendar with ICS, courses/LMS, showcase); full commerce (anyone sells, business storefronts with Manage store, variants/bundles/Subscribe & Save, cart/checkout/shipping/tax/pickup, fulfillment/tracking/packing slips, escrow buyer protection with disputes and SLA, offers, coupons, digital auto-delivery, live shopping, in-chat checkout, verified reviews, trust score, two-way reviews, returns/RMA, wishlists and alerts, seller dashboard, catalog categories, amenities/specs layer, rentals, promoted posts and Ads Manager); wallet and money (balance + append-only ledger, send to @username, add funds, pay-with-balance, Stripe Connect cash-out, tips, invoices, splits, payment links, gift cards, Atwe Card waitlist, recurring payments, pots, pools, affiliate commissions, referrals, pay-per-view, deposits, loyalty points — all idempotent with anti-fraud caps); creator monetization (tiered subscriptions, paid newsletters, ticketed events, PPV, tips); trust and safety (unified reporting, moderation queue, AI flagging that never scans private DMs, disputes with SLA countdown, verification, wallet freeze, suspend/ban/appeals); platform-wide i18n with RTL, accessibility baseline, complete admin back-office (dashboards, RBAC, audit log, activity feed, analytics, feature flags, job health, GDPR tracking, refunds, investigations, view-as-user, branded secret sign-in gate with device lock), and an installable PWA (offline shell, push, install prompt, safe-area chrome, OG previews).

My design documents live in /docs (the Phase 1 color brief, the Phase 2 Living Light brief, and the v25 reference HTML). Read them all; they are law.

---

## 2. THE DESIGN LAW

### 2.1 Colors — few, used perfectly
The entire app is BLACK, WHITE, and BLUE, with GREY supporting. Tonal shades of those are expected (darker blue for pressed, lighter blue for edges/tints, off-whites for fills, near-blacks for panels) — but they are shades, never new colors. Green, red, yellow exist ONLY as functional signals (success/call, destructive/error, warning), never as design. Any other hue anywhere in the UI is a bug.

Black-theme tokens: page #000000 · panels #0B0B0D · elevated/inputs #141416 · hairlines #3A3A3C · text #FFFFFF / #8E8E93 / #6E6E73 · on-light-or-yellow #1D1D1F · blue #0A84FF (tint text on blue #DBE9FF; pressed via brightness .85) · light family for glow: white → #DBE9FF → rgb(56,86,255) → rgb(26,38,220) · semantic #30D158 / #FF453A / #FFCC00 with lighter hairline edges and tinted text (dark #1D1D1F on yellow).

### 2.2 Two themes. Not three.
BLACK (flagship, default): true #000000 with the Living Light system active. LIGHT: white with X-style exact hairline-gray dividers (never filled gray panels), blue #007AFF, text #1D1D1F/#6E6E73, no glow effects — quiet, sharp, still unmistakably Atwe through structure and the blue. SYSTEM follows the device between these two. There is NO Dim mode — if one exists in code, removing it is an audit task. Every surface is verified in BOTH themes; a design that only works in one is not finished.

### 2.3 Structure — X's skeleton, Apple's finish
X-style structure: hairline dividers instead of boxed cards for list-like content (feed, chats, notifications, results); generous whitespace; bold names + muted metadata; word-only tabs (no pills, no underlines) with a left-edge fade on scroll; a floating rounded bottom nav; engagement rows of small outline icons, evenly spaced, counts beside them; full-width media with rounded corners; one consistent verified-check treatment everywhere.
Apple-style polish: pill buttons with Apple anatomy (vibrant fill, hairline lighter edge on grey/semantic, tinted text, hover 1.05 / pressed .85 / disabled 40% on elevated); native-passcode-style lock screens (rounded-square glyph, centered dots, iOS keypad); frosted blurred sheets that respect the theme's material; purposeful micro-motion only, all respecting reduced-motion; sharp high-contrast typography (Inter; headlines 700–800 at −0.04 to −0.05em).
No clutter: two features share one menu instead of two buttons; secondary options live behind a clean "⋯". Consistency over novelty: reuse the app's card, button, sheet, and menu patterns — never invent a new pattern for one screen. Containers have NO visible borders in Black theme; darkness and spacing separate, light is the only edge.

### 2.4 The Living Light system (Black-theme signature)
Fully specified in /docs (Phase 2 brief; match the v25 reference HTML exactly). Laws: pure black at rest, zero visible borders; lightbulb model — mouse movement creates a dark-indigo pool under the cursor and burns the nearest edges of major boxes with ONE thick white-to-electric-blue line that melts away over ~3.5s; scrolling lights nothing; an opening lap (~2.5 decelerating laps around major boxes) on every page load including login; buttons flare softly in their own color on movement; reveal-by-light on sections; AI comets appear ONLY during AI operations — orbiting the answer box for box-scope jobs, orbiting the whole screen (twin comets) for page/chat-scope jobs, thinking → streaming → final lap → gone. In Light theme all effects are OFF except AI state, shown as a subtle blue shimmer border on the working element — AI must be visibly "thinking" in both themes. Never use @property with inherits:false for the light variables (it freezes the light).

---

## 3. NAVIGATION & INFORMATION ARCHITECTURE (pre-approved directive — execute, don't debate)

The bottom navigation bar has EXACTLY FIVE tabs, in this order, left to right:

1. HOME — the public world. The social feed (For You + Following), posting, stories/reels entry, follows. This is where people and businesses post — updates, products, sales, offers — and get discovered by followers. Public by nature.

2. TALK — the private world. Everything person-to-person and group: DMs, group chats, channels, communities, voice/video calls, Go Live, Spaces, contacts. The name is TALK — one word, covers messages AND calls (which "Chat" doesn't), and it's already Atwe's own vocabulary from the product guide. Do not label this tab "Chat" or "Messages" anywhere. (If I later choose an alternate, the fallback names are "Atline" or "Reach" — but build with TALK unless I say otherwise.)

3. ENGINE — the center tab, the heart of the app. This is the discovery engine for EVERYTHING external: universal search across people, businesses, posts, jobs, products, services; the marketplace; services & local; the business directory; near-me; events; newsletters; communities; showcase; jobs board; trending. The name is exactly ENGINE — never "Search," never "Explore." Design it to feel like the main thing: one powerful input plus clean discovery tiles beneath.

4. ATWE AI — the assistant tab. The full Atwe AI chat experience with saved conversations, plus entry points to its agentic abilities. (The ✨ AI touchpoints stay woven throughout every other tab as they are today.)

5. PROFILE — the self. Identity, posts, professional history, storefront/Manage store for businesses — AND every personal-control surface in the app. THE MIGRATION RULE: anything that is about managing YOUR OWN stuff moves OUT of Engine (or anywhere else it hides) INTO Profile. That includes at minimum: Wallet and every money surface (balance, send/request, split, payment links, gift cards, pots, pools, recurring payments, transactions, cash-out), orders and purchases, my listings/products, bookmarks, my resumes and job preferences, my applications, appointments and the unified calendar, my events/tickets, subscriptions, drafts and scheduled posts, invite friends/referrals, saved addresses, and Settings (all of it — account, privacy, security, notifications, display/theme, data). Engine discovers the world; Profile manages you. No personal-management feature may remain inside Engine after this restructure.

Migration requirements: preserve every old route with redirects to the new home so no link, notification, or bookmark ever 404s; update every internal link, menu, empty state, and onboarding mention; Profile must present the migrated surfaces in a clean, Apple-Settings-like organization (grouped sections, one clear hierarchy — not a dumping ground); the bottom nav is a floating rounded bar per 2.3, five icons with word labels, active state in blue, identical behavior in both themes; Talk shows an unread badge, Home a new-posts indicator, and badges follow the color law.

---

## 4. INSTANT CLARITY (people should know what it is and what to do)

A brand-new user must understand each tab's purpose within seconds of opening it. Verify and fix: first-run onboarding is short, beautiful, and matches the new five-tab IA (it must not reference old names or locations); every empty state TEACHES — it says what this place is for and offers the one obvious next action as a blue pill (empty Home explains following and posting with a "Create your first post" action; empty Talk invites starting a conversation or inviting contacts; Engine's empty query state showcases what it can find; empty Wallet in Profile explains adding funds and getting paid); every screen has one clear primary action, and labels say what things do in plain words — no mystery icons without labels in primary positions; destructive actions always confirm; nothing important is more than two taps from its tab. If a flow needs a paragraph to explain, the flow is wrong — flag it.

FEATURE INTRO SHEETS (build this component; reference implementation in /docs/atwe-feature-intro.html — match it): the first time a user opens a major tab or a newly shipped feature, an Apple-style sheet rises from the bottom (spring ease, transform/opacity only, 60fps) while the app behind dims and slightly scales back. Anatomy, top to bottom: grab handle · an animated glyph in a rounded square with a breathing blue halo (pops in) · a bold 2–3 word title ("Meet Engine") · one lead line · at most THREE icon rows, each one bold phrase + one short sentence, staggering in · one blue pill CTA. Rules: shown ONCE per feature per user (persisted server-side, not just localStorage); dismissible by the CTA, swipe-down, backdrop tap, or Escape; back/dismiss never loses the underlying page; never show two sheets in one session and never stack it with any other modal; copy is teaching, not marketing; in the Black theme the Living Light runs ~1.5 decelerating laps around the sheet's edge as it opens, then fades; in Light theme the sheet is clean with no lap; reduced-motion shows everything static with a faint rim. Wire it initially for: first open of each of the five tabs, first open of Wallet, and any future feature launch — driven by a simple per-user "seen" registry so new intros can be added without redesign.

---

## 5. THE QA SWEEP (mandatory; equal in weight to the design audit)

On every route, in both themes, desktop and mobile viewport, verify functionally:
- Every interactive element (button, link, icon, tab, menu item, card, swipe action) works and does exactly what its label promises. No dead buttons, no wrong destinations.
- BACK BEHAVIOR: from every page, browser/system back returns to the PREVIOUS page (correct history state) — never dumps to the homepage, never traps, never double-fires. Modals and sheets close on back without losing the underlying page. Deep links open the right screen directly. Scroll position restores when navigating back.
- No random or unexpected UI: no popups, toasts, tooltips, or modals without a user action or clear cause; no layout shift or jank while loading; no flash of the wrong theme; nothing rendering behind or on top of what it shouldn't.
- Zero console errors or warnings on any route; no failed network call surfaces a raw error; every failure path shows a designed error state with a way out.
- Forms: inline validation, submit disabled while pending, double-submit impossible, success confirmed, nothing silently fails.
- States: designed empty state for every list, loading state for every async surface, on-brand 404 and error pages, graceful slow-network behavior.
- Realtime and PWA: presence/receipts/push don't misfire; the installed PWA opens to the right place; the offline shell behaves; notifications deep-link correctly into the NEW navigation.
- Mobile: tap targets adequate, nothing clipped by safe areas, keyboard never covers the focused input, gestures don't conflict with system gestures.

Log every functional problem with severity BUG (its own tier, above P0).

---

## 6. THE WORKFLOW — two stages

### STAGE 1 — AUDIT (no product-code changes)
Map the repo, read /docs, then go through the ENTIRE app: every route, screen, modal, sheet, empty/loading/error state, email template, and the admin back-office — against Sections 2–5, in both themes, desktop and mobile. Produce one committed file, /docs/POLISH.md, organized page by page:
- [ ] (PAGE · BUG/P0/P1/P2) Problem → Proposed fix → Files involved
BUG = functionally broken. P0 = breaks the design law or a broken/confusing flow. P1 = inconsistency or below-the-bar polish. P2 = refinement or feature-tweak suggestion.
POLISH.md must also contain: the NAVIGATION RESTRUCTURE PLAN (full mapping of what moves where per Section 3, redirect table, affected files); REMOVE candidates (clutter, including the Dim theme if present); ADD/TWEAK ideas (suggestions only); QUESTIONS FOR YIDDI (anything ambiguous — never guess); and a proposed phase plan: Phase 0 = all BUGs; Phase 1 = the Section 3 navigation restructure; then grouped design phases (global tokens/themes, Home, Talk, Engine, Atwe AI, Profile + migrated surfaces, commerce flows, admin), each independently reviewable. STOP after committing POLISH.md and give me a summary.

### STAGE 2 — EXECUTION (after my approval, one phase at a time)
I review POLISH.md, cross off what I reject, approve phases. Execute exactly one approved phase at a time; verify in BOTH themes; re-run the Section 5 QA checks on every screen touched; check items off in POLISH.md with a one-line note; show before/after screenshots for every screen touched. Never start the next phase without my go. Small, phase-scoped, well-messaged commits. POLISH.md is the single source of truth for progress and your memory across sessions.

---

## 7. HARD RULES

1. Fixing BUGs is in scope: broken wiring, navigation/history handling, event handlers, state management, error handling — anything needed to make existing features work as intended. NOT in scope: changing what features do, data models, external APIs, or business rules. The Section 3 restructure is the one pre-approved product change. All other adds/removals are POLISH.md proposals only.
2. Two themes only; every change verified and screenshotted in both.
3. No color outside Section 2.1 anywhere — including SVGs, charts, shadows, gradients, and third-party overrides.
4. Living Light must match /docs and the v25 reference exactly; AI comets only during AI operations; in Light theme only the AI shimmer.
5. Accessibility (focus rings, aria, alt text, reduced-motion) and i18n/RTL may never regress; the new nav labels (Home, Talk, Engine, Atwe AI, Profile) must be translatable strings, not hardcoded.
6. Consistency beats taste: when unsure between two treatments, use the one dominant in the app or the one X/Apple uses.
7. Performance: animate only transform/opacity/filter/CSS variables; passive listeners; no layout thrash; 60fps on a mid-range phone; route changes rebind the light engine cleanly with no leaks.
8. Never break a URL: every moved surface gets a redirect; notifications and emails deep-link correctly post-restructure.

---

## 8. THE LAUNCH-READY DEFINITION OF DONE

The project is finished only when ALL of these hold: the five-tab navigation (Home · Talk · Engine · Atwe AI · Profile) is live with every personal-control surface inside Profile and Engine purely about discovery; both themes are flawless on every screen with zero colors outside the law and zero visible borders in Black; the Living Light behaves exactly like the v25 reference, opening lap included, on every page including login; every empty state teaches, feature intro sheets greet the first visit to each major surface exactly once, and every screen has one obvious primary action; a stranger can sign up and, without help, post, message someone, find a product in Engine, ask Atwe AI something, and check their wallet in Profile; the entire QA sweep passes — every click lands, back always goes back, nothing unexpected ever appears, zero console errors, mobile solid, PWA solid; and POLISH.md shows every BUG and P0 closed with nothing left unchecked except items I explicitly rejected. Apple-solid, inside and out — a product people can start using today.

Begin Stage 1 now: map the repository, read /docs, then start the audit.
