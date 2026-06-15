# Atwe — Full Application Overview

*Prepared for professional / legal review. This document describes the product,
its features, the data it collects, how that data is stored and shared, and the
points most relevant to privacy, safety, and compliance. It reflects the app as
currently built.*

Last updated: June 15, 2026

---

## 1. What Atwe is

**Atwe** is a single web application (an installable Progressive Web App, with
native iOS/Android wrappers planned) that combines four products in one:

1. **A social network** — public posts, profiles, follows, comments, likes, polls, communities ("Circles"), and broadcast channels ("Feeds").
2. **A messaging app** — 1:1 direct messages and group chats, with photo/video sharing.
3. **Real-time calling & live streaming** — 1:1 audio/video calls and one-to-many live video broadcasts.
4. **An AI assistant** — a conversational assistant branded as "Atwe AI."

The AI assistant is powered by a third-party large-language-model provider
(Anthropic's Claude API). For branding reasons the assistant is presented to
users as "Atwe AI"; the underlying provider is not named in the user interface.
**For legal/subprocessor purposes, Anthropic is a data processor** (see §6).

---

## 2. Technical architecture

| Layer | Technology |
|---|---|
| Frontend | One self-contained HTML/CSS/JS file (no framework); installable PWA with service worker |
| Backend | Node.js + Express |
| Database | PostgreSQL |
| Authentication | bcrypt password hashing + JSON Web Tokens (JWT) |
| Email | SMTP via Nodemailer (transactional only) |
| Payments | Stripe (Checkout + webhooks) |
| Real-time | Server-Sent Events (SSE) for presence/signaling; WebRTC for calls & live video |
| NAT traversal / relay | STUN + TURN (Cloudflare Realtime TURN) |
| Hosting | Railway (application server + managed PostgreSQL) |

All traffic is served over HTTPS. The application degrades gracefully if an
optional dependency (email, payments, TURN) is not configured.

---

## 3. Feature inventory

### Accounts & identity
- Sign up with **full name, email, password, date of birth, and an optional username** (auto-generated if omitted).
- **Age gate: users must be 18 or older** (date-of-birth check, enforced on both client and server).
- **Consent gate: before an account is created, the user must scroll through a Privacy & Terms summary and tap "I agree."**
- **Email verification** via a 6-digit code sent to the user's email.
- Login with email **or** username + password.
- **Password reset** via a single-use emailed link.
- **Multiple accounts** can be added and switched on one device.
- Profile: display name, @username, avatar photo, banner image, bio, and a private date of birth.

### Social
- **Posts**: text, images, video, and polls. Optional location label. Optional scheduling.
- **Comments/replies**, **likes**, **follows**.
- **Feeds**: "For you" (public) and "Following."
- **Circles**: user-created communities anyone can join and post into.
- **Feeds (broadcast channels)**: like a circle, but only the creator/admin posts; others follow to watch. Two join modes — open (anyone joins instantly) or request-to-join (admin approves).
- **Search** across people, posts, circles, feeds, chats, and groups.

### Messaging
- **1:1 direct messages** and **group chats**, including photo/video attachments.
- A personal **contacts** list.

### Calls & live streaming
- **1:1 audio and video calls** (WebRTC, peer-to-peer, encrypted in transit).
- A **call log** of recent calls.
- **Live streaming**: a user broadcasts video to viewers (WebRTC). The broadcaster can see who is watching.

### AI assistant
- A conversational assistant ("Atwe AI"). The user's messages are sent to a third-party LLM provider to generate responses. Conversations are saved to the user's account.

### Notifications
- In-app notifications for: likes, replies, follows, contact adds, new posts from followed accounts, feed join requests/approvals, **new sign-ins to the account** (security alert), **incoming calls/video calls**, and **new direct messages**.

### Plans & billing
- **Free** and **Pro** plans. Pro is purchased through **Stripe Checkout**; a Stripe webhook activates the plan. Atwe does **not** store full card details.

---

## 4. Data we collect (full inventory)

### Account data
- Name, email address, username
- **Password — stored only as a bcrypt hash** (never in plaintext)
- Optional profile photo (avatar) and banner image
- Date of birth
- Plan (free/pro), admin flag, email-verified flag
- Stripe customer ID (if they purchase Pro)
- Timestamps: account creation, last login, last seen

### Content data
- Posts (text, images, video, polls, optional location)
- Comments/replies and likes
- Direct messages and group messages (text + media)
- AI assistant conversations
- Circle and Feed membership, and join requests

### Safety / preference data
- Blocks (who a user has blocked)
- Reports (user-submitted reports of others)
- Contact-allow lists and contact-privacy settings
- Notification subscriptions

### Technical/auth data
- Authentication tokens: JWTs (30-day expiry) for sessions; **single-use, SHA-256-hashed tokens** for email verification and password reset (the raw token only ever exists inside the emailed link)
- Basic operational data needed to run and secure the service

---

## 5. How data is stored & secured

- **Passwords**: hashed with bcrypt; plaintext passwords are never stored or logged.
- **Email verification & password-reset tokens**: stored only as SHA-256 hashes; single-use; the raw value lives only in the emailed link.
- **Sessions**: stateless JWTs (30-day expiry) carrying the user ID, email, and admin flag, sent as Bearer tokens.
- **Transport security**: all traffic over HTTPS; database connections use SSL.
- **Media storage**: images, video, avatars, and banners are currently stored **inside the PostgreSQL database** (as encoded data), rather than a separate file/CDN store. *(This is a scaling consideration noted in §15; relevant to data-location questions.)*
- **AI conversations**: stored in the database, associated with the user's account.
- **Access control**: privacy/block rules are enforced server-side; administrative endpoints require an admin check on every request; sensitive endpoints are rate-limited; the JSON request size is capped.
- **Data location**: application and database are hosted on Railway; real-time relay uses Cloudflare; AI, email, and payments use their respective providers (see §6). Data may be processed in the regions those providers operate.

---

## 6. Third-party providers (subprocessors) and what is shared

| Provider | Purpose | Data shared with them |
|---|---|---|
| **Railway** | Hosting + managed PostgreSQL | All application and database data |
| **Anthropic (Claude API)** | Generates AI assistant responses | The messages (text and any images) a user sends to the AI assistant |
| **Cloudflare (Realtime TURN/STUN)** | Relays call/live-stream media when a direct connection isn't possible | Encrypted real-time media packets; connection metadata |
| **Stripe** | Processes Pro subscription payments | Payment and billing details (card data handled by Stripe; not stored by Atwe) |
| **SMTP email provider** *(to be finalized)* | Sends verification & password-reset emails | Recipient email address and email content (links/codes) |
| **Google / Cloudflare STUN servers** | NAT traversal for WebRTC | Network connection metadata only |

**Atwe does not sell personal information.** Data is shared only with these
providers, only to operate the service.

---

## 7. Communications & encryption status *(important for the lawyer)*

- **Calls and live streams** use WebRTC, which is **encrypted in transit** (DTLS/SRTP), peer-to-peer. They are **not recorded or stored**.
- **Direct messages and group messages** are **stored in the database** and are **not end-to-end encrypted**. They are visible to their participants and are technically accessible to Atwe's operators/administrators (see §8). This should be clearly disclosed; Atwe does not market messages as end-to-end encrypted.
- **AI assistant messages** are transmitted to the third-party LLM provider to generate responses (see §6).

---

## 8. Content moderation & administrative capabilities

- Users can **report** and **block** other users.
- An **admin dashboard** (separate, password-protected) allows administrators to: view platform statistics; view, search, and delete posts; review reports; manage reserved usernames; delete user accounts; and send broadcast messages.
- **Administrators can view user direct messages and AI conversations** through admin endpoints (for safety/abuse handling). This operator-access capability should be disclosed in the Privacy Policy and considered in the lawyer's review.

---

## 9. Age, consent & verification

- **18+ only**, enforced via a date-of-birth check at sign-up (client and server).
- **Affirmative consent** to the Privacy Policy and Terms is required at sign-up, behind a scroll-to-the-bottom gate, before the account is created.
- **Email verification** confirms the address via a 6-digit code.

---

## 10. Privacy & safety controls available to users

- **Who can contact/call you**: everyone, only people you follow, only people who follow you, and/or a specific allow-list of usernames.
- **Block** any account (removes follows and prevents contact; enforced server-side and fails closed).
- **Report** any account.
- **Delete full history**: erases the user's posts, comments, direct messages, group messages, AI chats, and notifications, while keeping the account.

---

## 11. Data retention & deletion

- Data is retained while the account is active.
- Users can delete individual content, or use **"Delete full history"** to erase their content in bulk.
- Deleting a user account cascades to remove that user's posts, chats, messages, memberships, and tokens.
- Account-deletion requests can be honored by administrators.

---

## 12. Payments

- Pro subscriptions are processed by **Stripe Checkout**; plan status is updated by a Stripe webhook. Atwe stores only a Stripe customer reference, not card numbers. Stripe's own terms and privacy policy govern payment processing.

---

## 13. Cookies & tracking

- Atwe uses **browser local storage** and a **JWT** to keep users signed in. It does **not** currently use third-party advertising or analytics trackers. (A short cookie/storage notice may still be advisable for some jurisdictions — a point for the lawyer.)

---

## 14. Existing legal documents

- **Privacy Policy** — published at `/privacy.html`
- **Terms of Service** — published at `/terms.html`
- Both are linked from the in-app Settings and from the sign-up consent screen.

---

## 15. Items to flag for professional/legal review

These are the points we specifically recommend a lawyer (and your team) review:

1. **Subprocessor disclosure** — the Privacy Policy currently refers to providers by category ("AI provider," "hosting," "email," "payments"). Some laws/regulators prefer they be **named**. Decide whether to name Anthropic, Railway, Cloudflare, Stripe, etc.
2. **Messages are not end-to-end encrypted**, and **administrators can access messages and AI chats** for safety. Confirm this is clearly and accurately disclosed.
3. **AI data flow** — that user prompts are sent to a third-party LLM provider, and how that provider may use/retain them, should be reflected accurately.
4. **International data transfers** — hosting/AI/relay/payment providers may process data outside the user's country; GDPR/UK/EU users may require specific disclosures and safeguards.
5. **Minors** — the app is 18+; confirm the age-gate language and the children's-data section are consistent and adequate for your markets.
6. **User-generated content & DMCA/takedown** — consider adding a formal copyright/abuse takedown process and contact.
7. **Cookie/local-storage notice** — confirm whether a banner/notice is required for your target jurisdictions.
8. **Legal contact addresses** — `privacy@atwe.com` and `support@atwe.com` must be live and monitored once the domain is active.
9. **Jurisdiction, governing law, dispute resolution, and limitation-of-liability** clauses in the Terms should be tailored to your business entity and location.
10. **Data-location / residency** — media and content are stored in the hosting provider's region; confirm this meets your obligations.

---

*This document is a factual description of the application to support professional
and legal review. It is not itself legal advice.*
