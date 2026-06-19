# Feeds — product spec (planned rebuild)

> Status: **planned**. This replaces the current "Feeds" feature (community
> channels with `feed@username` handles + members), which is being retired in
> favour of the concept below. The home tab order is now: **For you · Following ·
> Feeds · Circles**. Circles stays exactly as-is (the groups feature).

## The idea

"Feeds" becomes a short-form, vertical, swipeable media surface — a mix of
**TikTok / YouTube Shorts / Instagram Reels** and **WhatsApp Status**. It is tied
to **every member's profile**: anyone who **follows** a profile can open that
person's feed and scroll their short posts.

A feed post is one of:
- a **short video**,
- a **photo**, or
- a **text status** — words typed over a solid background colour (WhatsApp-status
  style, no media needed).

Posts are deliberately **small / lightweight** ("two or more small videos and
small posts" — i.e. a compact, fast, scrollable strip rather than long content).

## Access / privacy

- **Follower-gated.** To view someone's feed you must follow them. (Open question:
  do private accounts require approval, matching the existing request-to-chat /
  block model? Default assumption: respect the existing follow + block rules —
  blocked users never see a feed; following is the gate.)
- From any profile there's an entry point into that person's feed.
- The **Feeds tab** on home aggregates feeds from people you follow into a
  scrollable experience (vertical, full-screen, swipe up for next).

## Composition

- Create: pick **video**, **photo**, or **text status** (choose a background
  colour + type text, like WhatsApp status).
- Keep it quick and minimal — match the Anchored design language.

## Decisions (confirmed by owner)

1. **Lifespan — MIXED.** Text statuses expire after **24h**; photos and videos are
   **permanent** (until deleted). Implemented via `feed_posts.expires_at` (set for
   text, null for media); reads filter out expired rows.
2. **Access — followers view only.** Anyone posts to their own feed; only their
   **followers** can view it, and **blocks** deny on either side. (Enforced in
   `/api/feedposts/timeline` and `/api/feedposts/u/:username`.)
3. **Video** — *small* status-style clips work **now** via base64 data URLs (the
   same mechanism existing post videos already use, within the JSON size limit).
   Larger/HD video later needs real object storage + CDN (Cloudflare **R2** is the
   natural fit — needs a bucket + credentials/env from the owner).

## Still open

- **Discovery** — Feeds tab currently aggregates only people you follow; a "For
  you" discovery layer is a possible later add.
- **Interactions** — likes / replies / views on feed posts: TBD (start with none).

## Backend (built — Phase 1)

- Table `feed_posts(id, user_id, kind['text'|'photo'|'video'], text, bg, media,
  created_at, expires_at)`.
- `POST /api/feedposts` — create (text/photo/video), follower-gated reads.
- `GET /api/feedposts/timeline` — active posts from people I follow + my own.
- `GET /api/feedposts/u/:username` — one member's active feed (must follow / not blocked).
- `DELETE /api/feedposts/:id` — delete own.

## Next: frontend (Phase 2)

- Repoint the **Feeds** home tab to a vertical, swipeable viewer of the timeline.
- A **composer**: text status (words on a colour) / photo / small video.
- Profile entry point into a member's feed. Retire the legacy channel UI.

## Suggested build phases

1. **Schema + API** — `feed_posts` table (author_id, kind: video|photo|text,
   media_url|bg_color|text, created_at, expires_at?), follower-gated read
   endpoints, create endpoint. Retire/migrate the old channel-style feeds.
2. **Text-status MVP first** (no infra needed) — post words on a colour, vertical
   swipe viewer, follower-gated. Proves the UX without the video-hosting blocker.
3. **Photos** — reuse existing image handling (with a size cap).
4. **Video** — only after object storage + CDN is set up (decision #2).
5. **Profile entry point + Feeds-tab aggregation + composer.**
