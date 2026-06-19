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

## Open product decisions (need owner input before building)

1. **Ephemeral vs permanent** — WhatsApp status disappears after 24h; TikTok/Reels
   persist. Which model? (Could be: text statuses ephemeral, videos/photos
   permanent — or a single rule.)
2. **Video hosting** — this is the big technical one. Today the app stores images
   as **base64 inside Postgres JSONB**; that does **not** scale to video. Video
   needs real object storage + a CDN (e.g. S3/Cloudflare R2 + signed uploads) and
   probably a size/length cap. This requires new infra + env config and is the
   main thing that gates a real build.
3. **Discovery** — is the Feeds tab only people you follow, or also a "For you"
   style discovery of feeds from non-followed accounts?
4. **Interactions** — likes / replies / views on feed posts? Same as regular
   posts, or lighter?

## Suggested build phases

1. **Schema + API** — `feed_posts` table (author_id, kind: video|photo|text,
   media_url|bg_color|text, created_at, expires_at?), follower-gated read
   endpoints, create endpoint. Retire/migrate the old channel-style feeds.
2. **Text-status MVP first** (no infra needed) — post words on a colour, vertical
   swipe viewer, follower-gated. Proves the UX without the video-hosting blocker.
3. **Photos** — reuse existing image handling (with a size cap).
4. **Video** — only after object storage + CDN is set up (decision #2).
5. **Profile entry point + Feeds-tab aggregation + composer.**
