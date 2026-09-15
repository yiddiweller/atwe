# Seeding the beta world

`beta.atwe.com` is where the app is tested before it reaches anybody. An empty
database is useless for that: half the screens in Atwe only show their real
design once there is a feed to scroll, a conversation with history, an order
that has shipped and a wallet with a past. This is how that world is built, and
how it is taken away again.

**No production data is ever read.** Every row is generated. There is no export,
no sanitise step and no import, so the question "did we leak a real member?"
cannot be answered wrongly.

---

## The five commands

```bash
node tools/seed-beta.js check     # what would happen, and whether it is allowed
node tools/seed-beta.js status    # what this database currently holds that is tagged beta
node tools/seed-beta.js seed      # build the world (once)
node tools/seed-beta.js add-account <file.json>
                                  # add ONE account to the world already there
node tools/seed-beta.js reset     # remove exactly what this tool created
```

`check` is not a dress rehearsal of `seed` -- it is the same code path. There is
no flag that skips it.

Options: `--yes` skips the typed confirmation (for CI only), and
`--identity=<path>` points at a different identity file.

---

## How this reaches beta

The permanent flow is **`development` -> `beta` -> `main`**, and it does not
bend for this. Railway's beta environment is connected to the **`beta` branch**
and stays that way; production deploys from `main`. See
`docs/BRANCHES-AND-RELEASES.md`.

So the seeding tool reaches beta the same way every other change does: it is
built on `development`, promoted to `beta` when it is approved, and Railway
deploys `beta` normally -- which is also what applies the `seed_tag` columns,
since `db.init()` runs at boot. **Never point the beta Railway environment at
`development`.**

---

## Before you can run it

**1. `ATWE_ENV=beta` on the beta service, and nowhere else.** Nothing inherits
it. Production must never have it.

**2. `APP_URL` must be the beta host.** `https://beta.atwe.com`. Every
production spelling -- `atwe.com`, `atwe.ai`, `atwe.app`, `atwe.co`, each with
`www.` and `admin.` -- is refused as a whole host, so `beta.atwe.com` is never
mistaken for `atwe.com`.

**3. Remove every real-world credential from the beta service.** The beta
environment was duplicated from production, so assume each of these is present
until you have checked:

| refused while set | why |
|---|---|
| `STRIPE_*` | can charge a real card and fire real webhooks |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | can deliver mail to a real inbox from an address your members trust |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | can send a notification to a real phone |
| `TWILIO_*` / `SMS_API_KEY` | can send a real text message and bill for it |
| `SHIPPO_API_KEY` / `SHIPPO_WEBHOOK_SECRET` | buys real, non-refundable carrier labels |
| `S3_*` / `CDN_URL` | beta writes and deletes could land in the production media bucket |
| `TAX_API_KEY` / `SHIPPING_API_KEY` | calls a billable third-party pricing API |

Storage is the one that can be approved rather than removed: point `S3_BUCKET`
at a **separate** beta bucket with its own token, then set `BETA_S3_APPROVED=1`.
Nothing else has an approval switch, and a credential is never treated as safe
merely because it sits in the beta project.

`CLOUDFLARE_TURN_*` and `ANTHROPIC_API_KEY` are reported but do not block --
they spend an allowance, they do not reach a member.

**4. Optional, and worth doing: `PROD_DATABASE_URL_FINGERPRINT`.** Set it on the
beta service to the SHA-256 of the production connection string:

```bash
node -e "console.log(require('crypto').createHash('sha256').update(process.env.DATABASE_URL).digest('hex'))"
```

Run that **in the production shell**, copy the hash, and set it as a variable on
**beta**. The seeder then refuses outright if the database it is pointed at is
the production one. The hash cannot be reversed, so the variable is not a
secret.

**5. This work must be on the `beta` branch and deployed.** Promote it
`development` -> `beta` and let Railway deploy `beta` as it always does;
`db.init()` adds the `seed_tag` columns at boot. The seeder will call
`db.init()` itself if the columns are missing, but it is not a substitute for
the deploy, and it is never a reason to point beta at `development`.

**6. `BETA_SEED_PASSWORD` in the shell you run the command from.** Not in a
file, not in the repo, not committed. If it is unset and you are at a terminal
you will be prompted for it; the prompt does not echo. It is never printed and
never appears in any report.

`RAILWAY_ENVIRONMENT_NAME` is read as corroboration when it exists. It only
exists when the process runs on Railway, so its absence proves nothing and is
never a failure -- but if Railway says this is `production`, the seed refuses.

---

## The account

`seed/beta-identity.example.json` is the template. Copy it to
`seed/beta-identity.json` (gitignored) and edit it. It holds the email, the
@username, the display name, the headline, the bio, the account type and the
role -- and **no credential of any kind**. The seeder refuses a file containing
a `password`, `passwordHash`, `password_hash` or `secret` field.

`role` is explicit and must be `member` or `admin`. **The default is `member`,
deliberately.** An admin account does not see the app a member sees: it gets
moderation queues, revenue, every member's detail and the staff dashboard. Use
`admin` only when you specifically need that, and know that you are then testing
a different product.

The account is **seeded, not registered**, and that is not a shortcut. Signup
sends a six-digit code, and `mailCanDeliver()` refuses to claim a code was sent
when no mail transport exists -- `beta.atwe.com` is not a local host, so signup
correctly returns 503 on a beta service with no SMTP. Creating the account
directly is the only honest way in.

Two ordinary business accounts are created alongside it -- **@harbourgoods** and
**@northlightstudio** -- because `/api/orders/buy` refuses any listing whose
seller is `is_demo`. A demo-owned shop cannot be checked out, so without real
sellers the entire commerce journey is untestable.

---

## What it will and will not claim

The accounts a seed run creates are captured as an **exact set of ids** -- the
set of user ids before, the set after, and the difference. Nothing is inferred
from an id ordering, and `is_demo` is never a reason to claim a row.

**A demo account that already exists is not ours.** If this database holds demo
accounts with no `seed_tag`, the seed **refuses** rather than adopting them:
claiming them would quietly place somebody else's rows inside reset's reach.
The refusal names the count and the two ways out -- remove them first (the admin
dashboard's demo switch, turned off, does exactly that), or, if they came from an
interrupted run of this same tool, tag them by hand and re-run:

```sql
UPDATE users SET seed_tag = 'beta' WHERE is_demo = true AND seed_tag IS NULL;
```

That statement is yours to run deliberately. The tool will never run it for you.

---

## What gets built

| | |
|---|---|
| your account | tagged, email-verified, with a password only you know |
| 2 beta shops | real (non-demo) sellers, 6 products between them |
| ~100 discovery accounts | `demo.js` -- people and businesses with posts, replies, stories, jobs, events, courses, reviews, group chats, communities and ads |
| your feed | ~40 of them followed, so Home, stories and Who-to-follow are all live |
| Beam | five conversations with history, two of them unread, plus one group |
| Wallet | a ten-row ledger with a real balance, two savings pots |
| Orders | three as a buyer (delivered, shipped with tracking, one held in escrow) and two as a seller |
| Cart, Saved, Offers, Invoices, Gift card, Loyalty, Appointments | all non-empty |

None of it is real money. The beta service has no Stripe key, so the payment
layer is inert and these rows are ledger history rather than transactions. It
also means `POST /api/wallet/topup` credits instantly: **anyone signed in to
beta can give themselves money.** That is correct for a test environment and
must never be true of production.

`seed` is idempotent. The commerce half looks for its own marker row and skips
if it is already there; the discovery half only seeds when the population is
empty.

---

## Adding ONE account later

The full `seed` builds a world. Once that world exists you almost never want it
again -- what you want is to let one more person in. That is a separate command
and it shares nothing with the seeder except the guards:

```bash
node tools/seed-beta.js add-account seed/atwe-beta.json
```

Flags: `--commerce` (off by default), `--no-immerse`, `--claim-reserved`,
`--yes` for CI.

**It adds one account and nothing else.** It never calls `seedDemo`, never
recreates the discovery population, never creates a shop or a commerce fixture,
never deletes anything, and never updates a row it did not just insert. The
tests assert each of those against the comment-free source, so it cannot drift.

**It refuses rather than overwriting.** An existing username, an existing email,
or a file carrying a credential all stop it before the password is even asked
for -- so nobody types a secret into a run that was never going to happen.

**The identity file is public profile text only**, exactly like the founder's:
email, username, name, headline, bio, accountType, role, categories. A file
containing `password`, `passwordHash`, `secret`, `token`, `stripe*`, `oauth*`,
`totp*`, `session*`, `isAdmin` or `adminPerms` is refused **by name**, because
silently ignoring a `password` field would leave somebody believing they had set
one. `seed/atwe-beta.example.json` is the template.

**A RESERVED username needs `--claim-reserved`.** Atwe locks a list of names
(`routes.js` `SYSTEM_ROUTES`, seeded into `reserved_usernames` on every boot) so
nobody can impersonate the company or shadow a route, and `usernameReserved()`
refuses them at signup and at username-change. **`atwe` is on that list.** This
tool writes a row directly and therefore bypasses that gate, so it asks the
question itself and refuses until you say plainly that this is the legitimate
owner claiming its own name. The reservation row is **left in place**: a name
somebody already holds is unaffected by it, so the name stays locked against
everyone else.

**Joining the world that is already there** is on by default and is
`demo.js`'s own `immerseInDemo`, reused after a line-by-line audit. It makes
four writes and they are all additive rows belonging to, or addressed to, the
one new account:

| | |
|---|---|
| `INSERT follows` | follower is the new account |
| `INSERT at_messages` | recipient is the new account |
| `INSERT notifications` | owner is the new account |
| `INSERT at_group_members` | the new account joins one existing group |

There is no `UPDATE`, no `DELETE` and no `seedDemo` call anywhere in it, so it
cannot duplicate or mutate the global beta world -- only attach somebody to it.
Every row cascades away with the account, so reset stays complete. `--no-immerse`
skips it.

**Commerce is opt-in.** A new beta account gets no wallet money, orders or
invoices unless you pass `--commerce`, and that needs two existing beta shops to
buy from or it skips rather than inventing them.

**The reusable half lives in `seed/beta-account.js`** -- no CLI, no prompts, no
`console`, no `process.exit`. It takes a db handle and plain values and returns
plain objects, so a future **Admin -> Beta Access** screen can call
`createBetaAccount` / `immerseAccount` / `findByUsername` directly without
shelling out. Removing a beta account is deliberately NOT implemented; `reset`
remains the only delete path.

---

## Reset, and why it is safe

```bash
node tools/seed-beta.js reset
```

Every row this tool creates is tagged `seed_tag = 'beta'` first, and **only**
what it created -- see "What it will and will not claim" above. Reset then
deletes:

```sql
DELETE FROM at_groups    WHERE seed_tag = 'beta';
DELETE FROM communities  WHERE seed_tag = 'beta';
DELETE FROM ad_campaigns WHERE seed_tag = 'beta';
DELETE FROM gift_cards   WHERE seed_tag = 'beta';
DELETE FROM users        WHERE seed_tag = 'beta';
```

in one transaction, and nothing else. Everything those users own goes with them
through the database's own foreign keys.

**There is no `is_demo` clause anywhere in the reset path, and that is the
point.** A reset that reasoned about `is_demo` would delete demo accounts this
tool never created. On a database somebody else had already been using, those
are somebody's work. What is not tagged is not ours: `status` reports untagged
demo accounts so you can see them, and reset leaves them exactly where they are.

The whole tool contains exactly one `DELETE`, parameterised by `seed_tag` and
run over a hardcoded table list.

The four tables beside `users` are there because their owner column is
`ON DELETE SET NULL` rather than `ON DELETE CASCADE` -- `at_groups.created_by`,
`communities.created_by`, `ad_campaigns.advertiser_id`, `gift_cards.buyer_id`.
Those rows outlive the user they belong to, so deleting the users alone would
strand them. That list came out of an audit of every `users` foreign key in
`db.js`. **Add a fifth such table and it must be tagged and listed here too.**

There is no `DROP` and no `TRUNCATE` in this tool.

---

## The pieces

| file | what it is |
|---|---|
| `tools/seed-guard.js` | every refusal, as pure functions over an env object -- no database, no network |
| `test/seed-guard.test.js` | 17 tests over those functions, including one asserting a credential never reaches a printed report |
| `tools/seed-beta.js` | the four commands |
| `seed/beta-commerce.js` | the money and commerce rows |
| `seed/beta-account.js` | adding ONE account: reusable, no CLI, ready for an admin screen |
| `test/beta-account.test.js` | 20 tests over that, self-tested against five real breaks |
| `seed/beta-identity.example.json` | the founder's template, with no password field |
| `seed/atwe-beta.example.json` | the @atwe company template, likewise |
| `demo.js` | unchanged -- the discovery population, the same code the admin dashboard's demo switch runs |

`users.seed_tag` and the four other `seed_tag` columns are nullable, indexed
where the tag is not null, and added idempotently in `db.init()` like every
other column in this app. They are inert for any row that does not carry one.

Run the guard tests with `node --test test/seed-guard.test.js`. They need no
database.
