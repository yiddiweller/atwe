# Moving photos and videos out of the database

**Who this is for:** the owner. No technical knowledge assumed.
**How long:** about 15 minutes, mostly making an account.
**What it changes:** nothing anyone can see, immediately. Everything that already
works keeps working. But from that moment on the app stops swelling, backups stay
small forever, and members can post real videos instead of two-minute clips.

---

## Why

Right now every photo, voice note and video anyone posts is stored **inside the
database**, converted into text. That is why Atwe runs on nothing but a database
with no other services to pay for — a good decision to start with, and the reason
the whole thing has been so simple to keep alive.

But it means:

- the database carries every byte anybody ever uploaded
- **every backup copies every photo again** — ten backups, ten copies
- a single file cannot sensibly be bigger than about 16 MB, which is roughly two
  minutes of video

A *bucket* is storage built for exactly this: cheap, endless, and delivered to
people from wherever in the world they happen to be.

| | roughly |
|---|---|
| Database storage | premium — it is fast storage, priced accordingly |
| A bucket (Cloudflare R2) | **about 1.5¢ per GB per month** |
| People *viewing* those files on R2 | **free** — no charge for traffic |

That last line is the one that matters most. Amazon's equivalent charges for every
view, and that is the bill that surprises people when something goes viral.
Cloudflare does not.

**One hundred thousand members' photos would cost roughly $18 a month.**

---

## What happens to the photos already stored

**Nothing. They keep working exactly as they do today.**

Only *new* uploads go to the bucket. Old ones stay where they are and are served
the same way they always were. Moving them across later is a separate, optional
job that can be done carefully at any time — there is no rush and nothing breaks
if it never happens.

---

## What gets better immediately

| | now | after |
|---|---|---|
| Photos | 16 MB | 25 MB |
| Video | ~2 minutes | **up to 3 hours** |
| Voice notes | 16 MB | 200 MB |
| Documents | 16 MB | 100 MB |
| Where photos load from | your one server | the nearest Cloudflare location |

That last row is a real speed gain for anyone far away from the server.

---

## Step 1 — Make a Cloudflare account

1. Go to **cloudflare.com** and sign up (free).
2. In the left-hand menu find **R2**.
3. It will ask for a payment card even though the first 10 GB each month are free.
   That is normal — it is how they stop people abusing it.

## Step 2 — Make the bucket

1. Click **Create bucket**.
2. Name it **`atwe-media`**.
3. Leave every other setting alone. Create it.

## Step 3 — Give it your own address

This step is **not optional**, and it is the one that is easy to skip. Atwe puts
the bucket's address into the post, and the member's phone fetches it directly.
If the bucket is private, the upload succeeds and the photo shows as a broken
image — the worst kind of failure, because it looks like it is working.

Cloudflare offers two ways to make the files readable, and **only one of them is
right for a live app**:

| | `pub-….r2.dev` | a custom domain |
|---|---|---|
| Cloudflare's own words | *"rate-limited and not recommended for production"* | *"recommended for production use"* |
| Caching | **unavailable** | yes — faster, and fewer billable reads |
| Whose address is it | Cloudflare's | **yours** |

Use the custom domain. Every large platform serves photos from its own name —
`pbs.twimg.com`, `scontent.cdninstagram.com` — for exactly these reasons.

**And there is one more reason it has to be decided now rather than later: the
address is written into each post, permanently.** Start on `pub-….r2.dev` and
switch six months later, and every photo posted in between still points at the
old address until somebody rewrites them all in the database.

1. Open the `atwe-media` bucket → **Settings** → **Custom Domains** → **Add**.
2. Enter `media.atwe.com`.
3. Because `atwe.com` is already on Cloudflare, it sets up the DNS itself —
   accept what it offers. It goes green in a minute or two.
4. **Copy the address** (`https://media.atwe.com`) — you need it in step 6.

> This makes the *files* readable by anyone who has the link, which is what a
> photo in a post needs to be. It does **not** let anyone list what is in the
> bucket, and it does not let anyone upload. Only the keys in step 5 can write.

> **No domain on Cloudflare?** Then the `pub-….r2.dev` address is the fallback:
> Settings → **Public Development URL** → **Enable** → type `allow`. It works,
> and it is rate-limited, so treat it as temporary and read the paragraph above
> about the address being baked into every post.

## Step 4 — Let the app talk to it

A browser refuses to let one website read another's files unless that other site
says it is allowed. Two things in Atwe depend on it, and both fail **silently**
without this — no error, just a missing picture:

- **Long videos and big files**, which the browser sends straight to the bucket
  rather than through the server (that is what lifts the ceiling to 3 hours).
- **Postshot**, which paints a post onto a canvas to make a shareable picture.

1. On the bucket's **Settings** page, find **CORS Policy** → **Add**.
2. Paste this exactly:

```json
[
  {
    "AllowedOrigins": ["https://atwe.com", "https://www.atwe.com"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

3. Save.

> This names the only websites allowed to talk to the bucket from a browser.
> It is not what makes the photos readable — step 3 did that. Add a line to
> `AllowedOrigins` if Atwe ever answers on another address.

## Step 5 — Get the keys

1. Go back to the main **R2 Object Storage** page. On the right, under **Account
   Details**, click **Manage API Tokens**.
2. Click **Create API token**.
3. Permission: **Object Read & Write**.
4. Scope it to the `atwe-media` bucket.
5. Create it, and **copy the three things it shows you now** — it will never show
   the secret again:
   - Access Key ID
   - Secret Access Key
   - the S3 endpoint (looks like `https://<a long code>.r2.cloudflarestorage.com`)

> **The endpoint must NOT have the bucket name on the end.** The bucket's own
> Settings page shows an "S3 API" address ending in `/atwe-media` — that is not
> what goes in `S3_ENDPOINT`. Atwe adds the bucket name itself, so pasting that
> longer version asks Cloudflare for `atwe-media/atwe-media/…` and every upload
> fails. Cut everything from the `/` onwards, so it ends in
> `.r2.cloudflarestorage.com` and nothing more.

> Keep these private. Anyone holding them can read and write your members' files.
> Paste them only into Railway, never into a chat, an email or a document.

> **Two addresses, and they are not interchangeable.** The `r2.cloudflarestorage.com`
> endpoint is the private one Atwe writes through — it only answers requests signed
> with the keys above. `media.atwe.com` from step 3 is the public one members read
> from. Both are needed, and putting one where the other belongs is the single most
> likely way for this to go wrong.

## Step 6 — Tell Atwe about it

1. Open **railway.com** → the **Atwe** project → the **atwe** service (not Postgres).
2. Open the **Variables** tab.
3. Add these six, one at a time:

```
S3_BUCKET      = atwe-media
S3_ACCESS_KEY  = (the Access Key ID from step 5)
S3_SECRET_KEY  = (the Secret Access Key from step 5)
S3_ENDPOINT    = (the endpoint from step 5)
S3_REGION      = auto
CDN_URL        = https://media.atwe.com   (the address from step 3)
```

4. Railway will redeploy on its own. Give it a minute or two.

## Step 7 — Prove it works before trusting it

1. Open **admin.atwe.com** and sign in.
2. Go to the **Storage** tab in the left-hand menu.
3. It should now say storage is switched on. Press **Test it**.

That uploads a tiny file, reads it back over the public address, and deletes it.
There are three possible answers:

- **It works** — everything is right. Nothing else to do.
- **Photos would be broken** — the keys are right and the file went up, but it
  could not be read back. That means step 3 or `CDN_URL` is wrong (or the custom
  domain has not gone green yet — give it a minute and press it again). New photos
  would upload and then show as broken images, so this must be fixed before
  relying on it.
- **It did not work** — the keys, the bucket name or the endpoint are wrong.

**In every failing case nothing is broken** — the app carries on storing photos
in the database exactly as before, and we fix the settings.

---

## What is genuinely optional

Nothing above. Every step is needed for a live app.

The one thing you can leave alone is the **default `pub-….r2.dev` address** — if
you did step 3 with a custom domain, you never need to turn that on at all.

---

## Has any of this been tested?

The signing — the part that proves to Cloudflare that an upload really came from
Atwe — **has been verified**, offline, against an independently written
implementation of the same standard. Uploads, deletes, the large-file path used
for long videos, and the self-test button were all checked, and every signature
matched byte for byte. See `scratchpad/storagesign.js`.

What has *not* been tested is a real Cloudflare account, because that needs your
credentials. That is what step 7 is for.
