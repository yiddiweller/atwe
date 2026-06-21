# Email setup (sending) — Atwe

**Goal:** let the app *send* email as `support@`, `alerts@`, `no-reply@`, and
`team@atwe.com`, with all replies landing in your existing **Google Workspace**
inbox for `team@atwe.com`.

**Status of the two halves:**
- **Receiving** at `team@atwe.com` → ✅ already done (Google Workspace).
- **Sending** from the app → ⏳ the steps below (a sending provider + DNS).

This does **not** change your Google MX records, so the team@ inbox keeps
working exactly as it does now.

---

## How it fits together

| Address | Real mailbox? | Who handles it |
|---|---|---|
| `team@atwe.com` | **Yes** — you read/write here | **Google Workspace** (already set up) |
| `support@`, `alerts@`, `no-reply@` | No — send-only display labels | Resend (the app's outbound) |

- **Receiving** uses **MX** records → stays pointed at Google. Untouched.
- **Sending** uses **SPF/DKIM** records on a `send.` subdomain → added for Resend.
- They live side by side on the same domain. Replies to anything the app sends
  go to `team@atwe.com` (via `MAIL_REPLY_TO`) → your Google inbox.

---

## Step 1 — Create a Resend account & add the domain
1. Sign up at <https://resend.com> (free tier ~3,000 emails/month).
2. **Domains → Add Domain →** enter `atwe.com`.
3. Resend shows a handful of DNS records to add (next step). These are for a
   `send.atwe.com` subdomain plus a DKIM key — **none of them touch your root
   MX**, so Google Workspace is unaffected.

## Step 2 — Add the DNS records (at your domain registrar / DNS host)
Resend gives you the exact values; they look like this:

| Type | Name/Host | Value | Note |
|---|---|---|---|
| MX | `send` | `feedback-smtp.<region>.amazonses.com` (priority 10) | bounce handling — on the **subdomain**, not root |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | SPF for the send subdomain |
| TXT | `resend._domainkey` | `p=...` (long key Resend provides) | DKIM — this is what authenticates your mail |

> ⚠️ Do **not** change or remove your existing root `MX` records (Google:
> `aspmx.l.google.com`, etc.). The Resend MX above is on the `send` subdomain
> only. Your team@ inbox is safe.

Optional but recommended — a DMARC policy (helps deliverability):

| Type | Name/Host | Value |
|---|---|---|
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:team@atwe.com` |

Back in Resend, click **Verify** once the records propagate (minutes to a few
hours).

## Step 3 — Get an API key
Resend → **API Keys → Create** → copy the key (starts with `re_...`).

## Step 4 — Set the env vars in Railway
On the Atwe service → **Variables**, set:

```
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASS=<your Resend API key>

MAIL_FROM=Atwe AI <no-reply@atwe.com>
MAIL_REPLY_TO=team@atwe.com

SUPPORT_FROM=Atwe Support <support@atwe.com>
TEAM_EMAIL=team@atwe.com
TEAM_FROM=Atwe Team <team@atwe.com>
```

Railway redeploys automatically. That's it — sending is now live.

---

## What goes out from where (once live)

| Trigger | From | Replies go to |
|---|---|---|
| Verification / password reset / login alerts | `no-reply@` (`MAIL_FROM`) | team@ |
| Help-center acknowledgement (on form submit) | **support@** | team@ |
| Admin reply to a user's thread | **support@** | team@ |
| "Email everyone" broadcast (admin dashboard) | **team@** | team@ |

All replies land in your **Google Workspace team@ inbox**, and you can send to
people directly from there whenever you want — Resend only handles the app's
automated/marketing sends, not your personal mail.

---

## How to verify it works
1. After Railway redeploys, sign up a test account → you should receive the
   verification email (check it's from `no-reply@atwe.com`).
2. Submit the **Help Center** form → you should get the *"We got your message"*
   email from **support@atwe.com**.
3. Reply to that email → it should arrive in your **team@** Google inbox.
4. From the admin dashboard → **Email everyone** → send a test → confirm it
   arrives as **team@atwe.com**.

If emails don't arrive: check Resend's **Logs** tab (it shows delivered/bounced
per message), and confirm the domain shows **Verified** in Resend.
