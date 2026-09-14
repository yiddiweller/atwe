// The four card-paid flows that never reached the member's wallet. Run with:
//   TEST_DATABASE_URL=postgres://user:pass@host/db npm test
// (skips cleanly when no database is configured — see helpers.js).
//
// WHY THIS FILE EXISTS. The Stripe webhook has six money branches. Two of them
// paid the member (an order, and an invoice from build 1860) and four did not: a
// TIP, an EVENT TICKET, a PAID NEWSLETTER and a CREATOR SUBSCRIPTION each charged
// the buyer, granted the entitlement, notified the earner, and moved no money.
// It sat in Atwe's own Stripe account.
//
// Like money-invoice.test.js this drives the REAL webhook rather than calling the
// helpers, because the bug was never in the arithmetic: it was in what the route
// did and did not call. Stripe's signature is a documented HMAC over
// `timestamp.body`, so a valid one can be minted here and the real `stripe`
// package verifies it. No key and no network are involved.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const H = require('./helpers');

const opts = { skip: H.SKIP ? 'no TEST_DATABASE_URL/DATABASE_URL set' : false };
const WH_SECRET = 'whsec_test_card_flows';

before(async () => {
  if (H.SKIP) return;
  await H.startServer({
    STRIPE_SECRET_KEY: 'sk_test_not_used', STRIPE_PRICE_ID: 'price_not_used',
    STRIPE_WEBHOOK_SECRET: WH_SECRET,
    WALLET_DAILY_CAP_CENTS: '100000000', WALLET_WEEKLY_CAP_CENTS: '100000000',
  });
});
after(async () => { await H.stopServer(); });

// The platform fee is taken fire-and-forget so a hiccup can never unwind a real
// payment — settle before counting, exactly as the refund suite does.
const settle = () => new Promise((r) => setTimeout(r, 1500));

async function balance(id) {
  const { rows } = await H.getPool().query('SELECT balance_cents FROM users WHERE id = $1', [id]);
  return rows[0] ? rows[0].balance_cents : 0;
}
// What Atwe took from this member, by reference. Reading the ref is what proves
// each payment books its fee under its own namespace and cannot be handed back
// by an unrelated refund.
async function feeTaken(userId, ref) {
  const { rows } = await H.getPool().query(
    `SELECT COALESCE(SUM(amount_cents),0)::int n FROM company_revenue
      WHERE source = 'fee' AND payer_id = $1 AND ref_id = $2`, [userId, String(ref)]);
  return rows[0].n;
}
async function allFees(userId) {
  const { rows } = await H.getPool().query(
    `SELECT COALESCE(SUM(amount_cents),0)::int n FROM company_revenue WHERE source = 'fee' AND payer_id = $1`, [userId]);
  return rows[0].n;
}

function signed(body) {
  const raw = JSON.stringify(body);
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', WH_SECRET).update(`${t}.${raw}`).digest('hex');
  return { raw, sig: `t=${t},v1=${v1}` };
}
async function fire(body) {
  const { raw, sig } = signed(body);
  const res = await fetch(`http://127.0.0.1:${H.port()}/api/billing/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': sig },
    body: raw,
  });
  return res.status;
}
const session = (eventId, type, metadata, amountTotal) => ({
  id: eventId, type: 'checkout.session.completed',
  data: { object: { id: 'cs_' + eventId, object: 'checkout.session', amount_total: amountTotal, metadata: { type, ...metadata } } },
});

/* ─────────── a tip reaches the person, in full ─────────── */

test('a card-paid tip credits the recipient, and takes NO fee', opts, async () => {
  const AMOUNT = 5_000; // $50
  const from = await H.seedUser();
  const to = await H.seedUser();
  assert.equal(await balance(to.id), 0);

  assert.equal(await fire(session('evt_tip_' + to.id, 'tip',
    { user_id: String(from.id), to_id: String(to.id), amount_cents: String(AMOUNT) }, AMOUNT)), 200);
  await settle();

  // A tip is a gift between two people. The BALANCE path moves it with
  // walletTransfer and charges nothing, so charging here would make the same $50
  // pay out differently depending on how full the sender's wallet happened to be.
  assert.equal(await balance(to.id), AMOUNT, 'the recipient got the whole tip');
  assert.equal(await allFees(to.id), 0, 'and Atwe took nothing from a gift');
  assert.equal(await balance(from.id), 0, 'the sender paid by card, so their wallet is untouched');

  const { rows } = await H.getPool().query('SELECT COUNT(*)::int n FROM tips WHERE to_id = $1', [to.id]);
  assert.equal(rows[0].n, 1, 'exactly one tip was recorded');
});

/* ─────────── a ticket reaches the host, less Atwe's cut ─────────── */

async function anEvent(priceCents) {
  const host = await H.seedUser();
  const { rows } = await H.getPool().query(
    `INSERT INTO events (host_id, title, starts_at, price_cents) VALUES ($1,$2, now() + interval '7 days', $3) RETURNING id`,
    [host.id, 'Ticket settlement test', priceCents]);
  return { host, id: rows[0].id };
}

test('a card-paid ticket credits the host, less Atwe\'s fee', opts, async () => {
  const PRICE = 12_000;
  const { host, id } = await anEvent(PRICE);
  const buyer = await H.seedUser();

  assert.equal(await fire(session('evt_tkt_' + id, 'event_ticket',
    { user_id: String(buyer.id), event_id: String(id) }, PRICE)), 200);
  await settle();

  const got = await balance(host.id);
  const fee = await feeTaken(host.id, `evt${id}-${buyer.id}`);
  assert.equal(got + fee, PRICE, `host ${got} + fee ${fee} must equal the ${PRICE} charged`);
  assert.ok(got > 0, 'the host was actually paid — the bug this file exists for');
  assert.equal(await balance(buyer.id), 0, 'the buyer paid by card');

  // The fee must NOT be booked under the bare event id: two buyers of one event
  // would share that ref, and refundPlatformFee sums by ref.
  assert.equal(await feeTaken(host.id, id), 0, 'nothing booked under the bare event id');

  const { rows } = await H.getPool().query('SELECT paid FROM event_rsvps WHERE event_id = $1 AND user_id = $2', [id, buyer.id]);
  assert.equal(rows[0].paid, true, 'and they are going');
});

test('two buyers of one event each book their fee separately', opts, async () => {
  const PRICE = 4_000;
  const { host, id } = await anEvent(PRICE);
  const a = await H.seedUser(), b = await H.seedUser();
  await fire(session('evt_tkt2a_' + id, 'event_ticket', { user_id: String(a.id), event_id: String(id) }, PRICE));
  await fire(session('evt_tkt2b_' + id, 'event_ticket', { user_id: String(b.id), event_id: String(id) }, PRICE));
  await settle();
  assert.equal(await balance(host.id) + await allFees(host.id), PRICE * 2, 'both tickets accounted for');
  assert.notEqual(await feeTaken(host.id, `evt${id}-${a.id}`), 0);
  assert.notEqual(await feeTaken(host.id, `evt${id}-${b.id}`), 0);
});

test('a re-delivered ticket event does not pay the host twice', opts, async () => {
  const PRICE = 9_000;
  const { host, id } = await anEvent(PRICE);
  const buyer = await H.seedUser();
  await fire(session('evt_dup_' + id, 'event_ticket', { user_id: String(buyer.id), event_id: String(id) }, PRICE));
  await settle();
  const once = await balance(host.id);
  assert.ok(once > 0, 'paid the first time');

  // The same event id again (Stripe is at-least-once) AND a fresh event pointing
  // at the same, already-paid RSVP — the upsert's own guard covers the second.
  await fire(session('evt_dup_' + id, 'event_ticket', { user_id: String(buyer.id), event_id: String(id) }, PRICE));
  await fire(session('evt_dup2_' + id, 'event_ticket', { user_id: String(buyer.id), event_id: String(id) }, PRICE));
  await settle();
  assert.equal(await balance(host.id), once, 'still paid exactly once');
});

/* ─────────── a newsletter reaches its author ─────────── */

test('a card-paid newsletter credits the author, less Atwe\'s fee', opts, async () => {
  const PRICE = 800;
  const author = await H.seedUser();
  const reader = await H.seedUser();
  const { rows } = await H.getPool().query(
    'INSERT INTO newsletters (owner_id, title, price_cents) VALUES ($1,$2,$3) RETURNING id',
    [author.id, 'Settlement weekly', PRICE]);
  const nid = rows[0].id;

  assert.equal(await fire(session('evt_nl_' + nid, 'newsletter_sub',
    { user_id: String(reader.id), newsletter_id: String(nid) }, PRICE)), 200);
  await settle();

  const got = await balance(author.id);
  const fee = await feeTaken(author.id, `nl${nid}-${reader.id}`);
  assert.equal(got + fee, PRICE, `author ${got} + fee ${fee} must equal the ${PRICE} charged`);
  assert.ok(got > 0, 'the author was actually paid');

  await fire(session('evt_nl2_' + nid, 'newsletter_sub',
    { user_id: String(reader.id), newsletter_id: String(nid) }, PRICE));
  await settle();
  assert.equal(await balance(author.id), got, 'a second event on a paid subscription pays once');
});

/* ─────────── a subscription pays on the first charge AND every renewal ─────────── */

test('a creator subscription credits the creator, and renews', opts, async () => {
  const PRICE = 1_000;
  const creator = await H.seedUser();
  const fan = await H.seedUser();

  assert.equal(await fire(session('evt_cs_' + creator.id, 'creator_sub',
    { user_id: String(fan.id), creator_id: String(creator.id) }, PRICE)), 200);
  await settle();
  const first = await balance(creator.id);
  const fee1 = await allFees(creator.id);
  assert.equal(first + fee1, PRICE, 'the first month is fully accounted for');
  assert.ok(first > 0, 'the creator was actually paid');

  // A month later Stripe sends invoice.paid. That is a NEW payment, so it must
  // pay again — a "already paid" guard here would be wrong, and the event claim is
  // what stops a redelivery.
  assert.equal(await fire({
    id: 'evt_cs_renew_' + creator.id, type: 'invoice.paid',
    data: { object: { object: 'invoice', subscription: 'sub_test_' + creator.id, amount_paid: PRICE,
      lines: { data: [{ metadata: { type: 'creator_sub', user_id: String(fan.id), creator_id: String(creator.id) } }] } } },
  }), 200);
  await settle();
  const after = await balance(creator.id);
  assert.ok(after > first, 'the renewal paid the creator again');
  assert.equal(after + await allFees(creator.id), PRICE * 2, 'two months, both accounted for');
});

/* ─────────── the demo paths must never settle ─────────── */

// With no card processor nobody was charged, so crediting would mint money — the
// rule the refund helpers exist to protect. A running server has billing
// configured, so this one is asserted where it lives: in the source.
test('no demo path settles, and every settle is guarded', opts, async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  for (const [label, marker] of [
    ['tip', 'await recordTip(req.user.id, to, amountCents, message); // demo: instant tip'],
    ['newsletter', 'demo: instant paid sub'],
    ['ticket', 'demo: instant ticket'],
  ]) {
    const i = src.indexOf(marker);
    assert.ok(i > 0, `the ${label} demo path is still recognisable`);
    const around = src.slice(i - 700, i + 400);
    assert.ok(!/settle(Tip|EventTicket|Newsletter|CreatorSub)/.test(around),
      `the ${label} demo path must not settle: no card processor means nobody paid`);
  }

  // The two upserts that carry their own guard must keep it.
  assert.ok(/event_rsvps\.paid IS NOT TRUE/.test(src), 'the ticket upsert only pays on a real flip');
  assert.ok(/newsletter_subs\.paid IS NOT TRUE/.test(src), 'the newsletter upsert only pays on a real flip');

  // A tip takes no fee anywhere. This is the decision most likely to be undone by
  // accident, and it is what keeps card and balance tips paying out the same.
  const tipFn = src.slice(src.indexOf('async function settleTipToRecipient'), src.indexOf('async function settleEventTicketToHost'));
  assert.ok(tipFn.length > 40, 'the tip settle helper is there');
  assert.ok(!/chargePlatformFee/.test(tipFn), 'a tip must never carry a platform fee');
});
