# Atwe — Roadmap / Captured feature requests

Features the owner wants built, captured so they aren't lost between sessions.

- ✅ **Shipped:** #1 request-to-chat, #2 group Go Live.

---

## 1. "Who can message you" privacy + request-to-chat  ✅ SHIPPED

**Goal:** let a user control who is allowed to start a direct chat/call with
them, and give everyone else a way to *request* one.

**Settings option — "Who can chat with you":**
- **Everyone** (default) — anyone can message/call directly.
- **People I follow / followers** — only people in that relationship can message
  directly.
- **Only selected usernames** — the user hand-picks specific accounts that may
  message directly.
- **Nobody** — no one may message directly.

**Behavior:**
- People who fall inside the allowed set can DM / call as normal.
- **Everyone else cannot DM directly** — instead they see a **"Request to chat"**
  action.
- The recipient receives a **chat request** (in notifications / a requests
  inbox) and can **Allow** (or decline) it.
- When allowed, the requester gets a **notification: "Your chat request was
  allowed"**, and from then on the two can text, message, and call each other.

**Likely touch points:**
- New per-user setting column (e.g. `chat_privacy` enum + an allowlist of user
  ids) — wire it in the DB, a `Sync.*`/settings route, and the guest path per
  the persistence-parity rule.
- New `chat_requests` table (requester, recipient, status, created_at).
- Endpoints: send request, list incoming requests, allow/decline; gate the DM
  send endpoint on the privacy rule.
- Notifications: "chat request received" → recipient; "request allowed" →
  requester.
- UI: Settings control; "Request to chat" state on a profile / new-chat screen;
  a requests list; allow/decline; the allowed-state transition.

---

## 2. "Go Live" inside a group chat (one-to-many broadcast)  ✅ SHIPPED

**Goal:** anyone in a group chat can **Go Live** as a broadcaster. This is **not**
a normal group video call where everyone joins — it's a **one-to-many
livestream**: one person broadcasts, everyone else can **watch only** and cannot
enter the call.

**Behavior:**
- A **Go Live** action is available to any member from inside the group chat.
- When someone goes live, **every group member is notified "<name> is live now"**.
- Members can **tap to watch** the broadcast (view-only audience) — they cannot
  join/share their own camera/mic into it.
- Design the UI + icons: the Go Live entry point, a "LIVE" indicator on the
  group, the viewer screen, and a live viewer count.

**Likely touch points:**
- Reuse/extend the existing live/RT plumbing (`/api/live/*`, `rt*` signaling) but
  in a broadcast (single publisher, many subscribers) shape rather than a mesh
  call.
- Group-scoped "live now" state + notification fan-out to group members.
- UI: Go Live button + icon in the group thread, live badge, watch screen.

---

> When picking these up, follow the repo conventions in `CLAUDE.md`
> (persistence parity across DB/Sync/guest, brand-safe copy, graceful
> degradation, bump `sw.js` CACHE on deploy).
