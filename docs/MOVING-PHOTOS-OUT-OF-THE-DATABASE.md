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

## Step 3 — Get the keys

1. On the R2 page find **Manage R2 API Tokens** (usually top right).
2. Click **Create API token**.
3. Permission: **Object Read & Write**.
4. Scope it to the `atwe-media` bucket.
5. Create it, and **copy the three things it shows you now** — it will never show
   the secret again:
   - Access Key ID
   - Secret Access Key
   - the S3 endpoint (looks like `https://<something>.r2.cloudflarestorage.com`)

> Keep these private. Anyone holding them can read and write your members' files.
> Paste them only into Railway, never into a chat, an email or a document.

## Step 4 — Tell Atwe about it

1. Open **railway.com** → the **Atwe** project → the **atwe** service (not Postgres).
2. Open the **Variables** tab.
3. Add these five, one at a time:

```
S3_BUCKET      = atwe-media
S3_ACCESS_KEY  = (the Access Key ID from step 3)
S3_SECRET_KEY  = (the Secret Access Key from step 3)
S3_ENDPOINT    = (the endpoint from step 3)
S3_REGION      = auto
```

4. Railway will redeploy on its own. Give it a minute or two.

## Step 5 — Prove it works before trusting it

1. Open **admin.atwe.com** and sign in.
2. Go to the **Storage** tab in the left-hand menu.
3. It should now say storage is configured. Press the **test** button.

That uploads a tiny file, reads it back, and tells you plainly whether the keys
are right. **If it fails, nothing is broken** — the app carries on storing photos
in the database exactly as before, and we fix the settings.

---

## Optional, later: a tidier address

Photos will be served from a long Cloudflare address. If you would rather they came
from `media.atwe.com`, that is a domain setting in Cloudflare plus one more
variable (`CDN_URL`). Purely cosmetic. It can wait.

---

## Has any of this been tested?

The signing — the part that proves to Cloudflare that an upload really came from
Atwe — **has been verified**, offline, against an independently written
implementation of the same standard. Uploads, deletes, the large-file path used
for long videos, and the self-test button were all checked, and every signature
matched byte for byte. See `scratchpad/storagesign.js`.

What has *not* been tested is a real Cloudflare account, because that needs your
credentials. That is what step 5 is for.
