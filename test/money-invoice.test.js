// A card-paid invoice must reach the issuer's wallet. Run with:
//   TEST_DATABASE_URL=postgres://user:pass@host/db npm test
// (skips cleanly when no database is configured — see helpers.js).
//
// WHY THIS FILE EXISTS. For a long time paying an invoice by card charged the
// customer, marked the invoice paid and notified the issuer — and moved no money.
// The member who had done the work saw "Paid" against a balance that had not
// changed, while the payment sat in Atwe's own Stripe account. The order path ten
// lines away in the same webhook did the very thing this one omitted, and that
// asymmetry is what gave it away.
//
// It drives the REAL Stripe webhook route rather than calling a helper, because the
// bug was never in the arithmetic — it was in what the route did and did not call.
// Stripe's signature is a documented HMAC over `timestamp.body`, so a test can mint
// a valid one and the real `stripe` package verifies it for real.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const H = require('./helpers');

const opts = { skip: H.SKIP ? 'no TEST_DATABASE_URL/DATABASE_URL set' : false };

// Any non-empty pair makes billing.isConfigured() true; nothing in the webhook path
// ever calls out to Stripe (constructEvent is pure crypto), so no key is used.
const WH_SECRET = 'whsec_test_invoice_settlement';
before(async () => {
  if (H.SKIP) return;
  await H.startServer({
    STRIPE_SECRET_KEY: 'sk_test_not_used', STRIPE_PRICE_ID: 'price_not_used',
    STRIPE_WEBHOOK_SECRET: WH_SECRET,
    WALLET_DAILY_CAP_CENTS: '100000000', WALLET_WEEKLY_CAP_CENTS: '100000000',
  });
});
after(async () => { await H.stopServer(); });

// The fee is taken fire-and-forget so a hiccup can never unwind a real payment —
// settle before counting, exactly as the refund suite does.
const settle = () => new Promise((r) => setTimeout(r, 1500));

async function balance(id) {
  const { rows } = await H.getPool().query('SELECT balance_cents FROM users WHERE id = $1', [id]);
  return rows[0] ? rows[0].balance_cents : 0;
}
// What Atwe took from this member, by reference. Reading the ref matters: it is what
// proves the invoice's fee is booked under its own namespace and cannot be handed
// back by an unrelated order's refund.
async function feeTaken(userId, ref) {
  const { rows } = await H.getPool().query(
    `SELECT COALESCE(SUM(amount_cents),0)::int n FROM company_revenue
      WHERE source = 'fee' AND payer_id = $1 AND ref_id = $2`, [userId, String(ref)]);
  return rows[0].n;
}

// Stripe's own scheme: v1 = HMAC-SHA256 of `${timestamp}.${rawBody}` with the secret.
function stripeSigned(body) {
  const raw = JSON.stringify(body);
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', WH_SECRET).update(`${t}.${raw}`).digest('hex');
  return { raw, sig: `t=${t},v1=${v1}` };
}
// The shared bounded poller (helpers.js). A money side-effect that is deliberately
// fire-and-forget must be waited FOR, not slept past.
const waitFor = H.waitFor;

async function fireWebhookFull(body) {
  const { raw, sig } = stripeSigned(body);
  const res = await fetch(`http://127.0.0.1:${H.port()}/api/billing/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': sig },
    body: raw,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
// The webhook's own answer says whether it CLAIMED the event or recognised a
// duplicate, which is the difference between "the guard fired" and "the balance
// happened not to move". Most callers only want the status.
async function fireWebhook(body) {
  return (await fireWebhookFull(body)).status;
}
function invoicePaidEvent(invoiceId, eventId) {
  return {
    id: eventId, type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_' + eventId, object: 'checkout.session', metadata: { type: 'invoice', invoice_id: String(invoiceId) } } },
  };
}

async function anInvoice(amountCents) {
  const issuer = await H.seedUser();
  const customer = await H.seedUser();
  const token = await H.login(issuer);
  const r = await H.api('POST', '/api/invoices', { token, body: {
    customerId: customer.id, title: 'Invoice settlement test', amountCents } });
  const inv = r.body.invoice || r.body;
  assert.ok(inv && inv.id, 'the invoice was created: ' + JSON.stringify(r.body).slice(0, 200));
  return { issuer, customer, token, id: inv.id };
}

/* ─────────── the money actually arrives ─────────── */

test('a card-paid invoice credits the issuer, less Atwe\'s fee', opts, async () => {
  const AMOUNT = 25_000; // $250
  const { issuer, customer, id } = await anInvoice(AMOUNT);
  assert.equal(await balance(issuer.id), 0, 'the issuer starts with nothing');

  assert.equal(await fireWebhook(invoicePaidEvent(id, 'evt_inv_' + id)), 200);
  await settle();

  const got = await balance(issuer.id);
  const fee = await feeTaken(issuer.id, `inv${id}`);

  // The whole payment is accounted for: what the issuer can spend plus what Atwe
  // kept is exactly what the customer was charged. Nothing lost, nothing invented.
  assert.equal(got + fee, AMOUNT, `issuer ${got} + fee ${fee} must equal the ${AMOUNT} charged`);
  assert.ok(got > 0, 'the issuer was actually paid — this is the bug this file exists for');
  // The customer paid by card, so their Atwe balance is untouched.
  assert.equal(await balance(customer.id), 0, 'the customer\'s wallet is not involved');

  const { rows } = await H.getPool().query('SELECT status FROM invoices WHERE id = $1', [id]);
  assert.equal(rows[0].status, 'paid');
});

test('the fee is booked under the invoice\'s own reference, never an order\'s', opts, async () => {
  const AMOUNT = 10_000;
  const { issuer, id } = await anInvoice(AMOUNT);
  assert.equal(await fireWebhook(invoicePaidEvent(id, 'evt_ref_' + id)), 200);
  await settle();

  assert.ok(await feeTaken(issuer.id, `inv${id}`) >= 0, 'booked under inv<id>');
  // The bare id is what an ORDER's fee uses. If an invoice ever booked its fee there,
  // refundPlatformFee would hand it back when an order of the same id was refunded.
  assert.equal(await feeTaken(issuer.id, id), 0, `nothing booked under the bare id ${id}`);
});

/* ─────────── it can never pay twice ─────────── */

test('a re-delivered webhook does not pay the issuer again', opts, async () => {
  const AMOUNT = 8_000;
  const { issuer, id } = await anInvoice(AMOUNT);
  // A Stripe event id is globally unique in processed_stripe_events, and `npm test`
  // runs its FILES concurrently against ONE database. This used to be
  // 'evt_dup_' + id keyed on an INVOICE id, and money-cardflows.test.js minted the
  // same string keyed on an EVENT id — so invoice #7 and event #7 collided, whichever
  // file fired second was answered {duplicate:true}, nobody was paid, and this test
  // failed on "paid the first time". Nothing was wrong with the app. Mint an id that
  // cannot collide; firing the SAME one twice is still what proves idempotency.
  const evt = invoicePaidEvent(id, H.uniq('evt_inv_dup'));

  assert.equal(await fireWebhook(evt), 200, 'the first delivery was accepted');
  // The webhook awaits recordInvoicePaid and settleInvoiceToIssuer (which awaits both
  // the credit and the fee) before it answers, so the money is durable by the time
  // this resolves. Poll anyway rather than sleep: it returns on the first tick when
  // all is well, and it fails in bounded time rather than passing on a guess.
  await waitFor(async () => (await balance(issuer.id)) > 0, 15000);
  const once = await balance(issuer.id);
  assert.ok(once > 0, 'paid the first time');

  // Stripe delivers at-least-once: the very same event id arriving again. The claim
  // is refused inside the request, so nothing is left in flight to wait for -- and
  // asserting the refusal is stronger than watching a balance fail to move.
  const again = await fireWebhookFull(evt);
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true, 'the second delivery was recognised as a duplicate');
  assert.equal(await balance(issuer.id), once, 'the same event twice pays once');

  // And a DIFFERENT event pointing at the same, already-paid invoice — the second
  // guard, recordInvoicePaid's own status check, which is what makes the settle safe.
  // That guard also runs inside the request, so there is nothing to wait for here.
  const fresh = await fireWebhookFull(invoicePaidEvent(id, H.uniq('evt_inv_dup2')));
  assert.equal(fresh.status, 200);
  assert.ok(!fresh.body.duplicate, 'a new event id really was claimed, so the status guard is what stopped it');
  assert.equal(await balance(issuer.id), once, 'a fresh event on a paid invoice pays once');
});

/* ─────────── the two paths that must move no money ─────────── */

test('"settled outside Atwe" moves no wallet money', opts, async () => {
  const AMOUNT = 15_000;
  const { issuer, token, id } = await anInvoice(AMOUNT);

  const r = await H.api('POST', `/api/invoices/${id}/mark-paid`, { token });
  assert.equal(r.status, 200, 'the issuer can mark it settled outside');
  await settle();

  // They were paid in cash or by bank transfer. Crediting an Atwe balance here would
  // invent money that nobody put in.
  assert.equal(await balance(issuer.id), 0, 'no wallet money moves');
  assert.equal(await feeTaken(issuer.id, `inv${id}`), 0, 'and Atwe takes no fee on it');

  // A stale Stripe session completing afterwards must not then credit it either.
  await fireWebhook(invoicePaidEvent(id, 'evt_outside_' + id));
  await settle();
  assert.equal(await balance(issuer.id), 0, 'a late webhook on an outside-settled invoice pays nothing');
});

// The demo path (no card processor) charges nobody, so crediting the issuer there
// would mint money — the same rule the order path follows, and the reason
// settleCardOrderToSeller is called from the webhook only. A running server has
// billing configured, so this one is asserted where it lives: in the source.
test('the demo path never credits — nobody was charged', opts, async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const i = src.indexOf('await recordInvoicePaid(id); // demo');
  assert.ok(i > 0, 'the demo path is still recognisable');
  const around = src.slice(i - 600, i + 600);
  assert.ok(!around.includes('settleInvoiceToIssuer'),
    'the demo invoice path must not settle: no card processor means nobody paid');

  // And the webhook must settle only on a real flip, never unconditionally.
  assert.ok(/if \(await recordInvoicePaid\(invId\)\) await settleInvoiceToIssuer\(invId\);/.test(src),
    'the webhook settles only when recordInvoicePaid actually flipped the invoice');
});
