// Money conservation across every refund door, plus the two guards that keep a
// wallet-spending route honest. Run with:
//   TEST_DATABASE_URL=postgres://user:pass@host/db npm test
// (skips cleanly when no database is configured — see helpers.js).
//
// The single rule these tests exist to defend: money is never CREATED. Everything
// spendable in the system — members' balances, their savings pots, anything sitting
// in escrow, and Atwe's own take — must add up to what was ever actually deposited.
// A refund that "makes the buyer whole" with a bare credit breaks that rule, and
// the invented balance is real enough to cash out to a bank.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const opts = { skip: H.SKIP ? 'no TEST_DATABASE_URL/DATABASE_URL set' : false };

/* The shared harness pins a deliberately tiny $5 daily velocity cap so that the cap
   itself is testable. These tests move real sale-sized amounts, so they need their own
   ceiling — each test FILE gets its own server process and its own port, so raising it
   here cannot affect the cap test in money-auth.test.js. */
before(async () => { if (!H.SKIP) await H.startServer({ WALLET_DAILY_CAP_CENTS: '100000000', WALLET_WEEKLY_CAP_CENTS: '100000000' }); });
after(async () => { await H.stopServer(); });

// Some money side-effects (the platform fee, the fee reversal) are deliberately
// fire-and-forget so a hiccup can never unwind a real sale — settle before counting.
const settle = () => new Promise((r) => setTimeout(r, 1500));

async function balance(id) {
  const { rows } = await H.getPool().query('SELECT balance_cents FROM users WHERE id = $1', [id]);
  return rows[0] ? rows[0].balance_cents : 0;
}

/* Everything spendable that belongs to these accounts, plus what Atwe took from
   them. `escrow_hold` parks money off every balance, so it has to be counted back
   in or a protected order looks like money that vanished. */
async function inTheSystem(ids) {
  const pool = H.getPool();
  const bal = (await pool.query('SELECT COALESCE(SUM(balance_cents),0)::int n FROM users WHERE id = ANY($1)', [ids])).rows[0].n;
  const pots = (await pool.query('SELECT COALESCE(SUM(balance_cents),0)::int n FROM wallet_pots WHERE user_id = ANY($1)', [ids])).rows[0].n;
  const escrow = (await pool.query(
    `SELECT COALESCE(SUM(-delta_cents),0)::int n FROM wallet_tx
      WHERE user_id = ANY($1) AND kind IN ('escrow_hold','escrow_release','escrow_refund')`, [ids])).rows[0].n;
  const revenue = (await pool.query('SELECT COALESCE(SUM(amount_cents),0)::int n FROM company_revenue WHERE payer_id = ANY($1)', [ids])).rows[0].n;
  return bal + pots + escrow + revenue;
}

async function sellerWithListing(priceCents) {
  const seller = await H.seedUser();
  const token = await H.login(seller);
  // Digital, so no shipping address is needed to buy it.
  const r = await H.api('POST', '/api/products', { token, body: {
    name: 'Refund test ' + seller.username, priceCents, kind: 'digital', digitalContent: 'thanks' } });
  const id = r.body.product ? r.body.product.id : r.body.id;
  return { seller, token, productId: id };
}

async function buyerWith(cents) {
  const buyer = await H.seedUser();
  const token = await H.login(buyer);
  await H.api('POST', '/api/wallet/topup', { token, body: { amount: cents / 100, clientId: H.uniq('top') } });
  return { buyer, token };
}

async function buy(token, productId, extra = {}) {
  const r = await H.api('POST', '/api/orders/buy', { token, body: {
    productId, qty: 1, payWith: 'balance', clientId: H.uniq('buy'), ...extra } });
  return r.body.order ? r.body.order.id : (r.body.orderId || r.body.id);
}

/* ─────────────── conservation, door by door ─────────────── */

test('a seller-approved return does not invent money', opts, async () => {
  const DEPOSIT = 50000;
  const { seller, token: sToken, productId } = await sellerWithListing(10000);
  const { buyer, token: bToken } = await buyerWith(DEPOSIT);
  const orderId = await buy(bToken, productId);
  assert.ok(orderId, 'the order was created');
  await settle();

  await H.api('POST', `/api/orders/${orderId}/return`, { token: bToken, body: { reason: 'changed my mind' } });
  const r = await H.api('PATCH', `/api/orders/${orderId}/return`, { token: sToken, body: { action: 'approve' } });
  assert.equal(r.status, 200, 'the seller could approve the return');
  await settle();

  assert.equal(await balance(buyer.id), DEPOSIT, 'the buyer is made whole');
  assert.equal(await inTheSystem([buyer.id, seller.id]), DEPOSIT,
    'nothing was created: the refund came OUT of the seller, not out of nowhere');
});

test('a seller can refund a sale in full without topping up out of pocket', opts, async () => {
  const DEPOSIT = 50000;
  const { seller, token: sToken, productId } = await sellerWithListing(10000);
  const { buyer, token: bToken } = await buyerWith(DEPOSIT);
  const orderId = await buy(bToken, productId);
  await settle();

  // The Atwe fee already left the seller's balance, so without giving it back this
  // refund is refused for being one percent short of a sale they were fully paid for.
  const r = await H.api('POST', `/api/orders/${orderId}/refund`, { token: sToken, body: {} });
  assert.equal(r.status, 200, 'the full refund goes through: ' + JSON.stringify(r.body));
  await settle();
  assert.equal(await balance(buyer.id), DEPOSIT, 'the buyer got it all back');
  assert.equal(await inTheSystem([buyer.id, seller.id]), DEPOSIT, 'money conserved');
});

test('a partial refund keeps the fee on the part of the sale that still stands', opts, async () => {
  const DEPOSIT = 50000;
  const { seller, token: sToken, productId } = await sellerWithListing(10000);
  const { buyer, token: bToken } = await buyerWith(DEPOSIT);
  const orderId = await buy(bToken, productId);
  await settle();
  const r = await H.api('POST', `/api/orders/${orderId}/refund`, { token: sToken, body: { amountCents: 5000 } });
  assert.equal(r.status, 200, 'the half refund goes through');
  await settle();
  assert.equal(await inTheSystem([buyer.id, seller.id]), DEPOSIT, 'money conserved');
});

test('the refunds desk does not invent money either', opts, async () => {
  const DEPOSIT = 50000;
  const { seller, productId } = await sellerWithListing(10000);
  const { buyer, token: bToken } = await buyerWith(DEPOSIT);
  const orderId = await buy(bToken, productId);
  await settle();

  const staff = await H.seedUser();
  await H.getPool().query('UPDATE users SET is_admin = true WHERE id = $1', [staff.id]);
  const aToken = await H.login(staff);

  const filed = await H.api('POST', '/api/refunds', { token: bToken, body: {
    kind: 'order', refId: String(orderId), reason: 'not as described' } });
  const reqId = filed.body.request ? filed.body.request.id : filed.body.id;
  assert.ok(reqId, 'the member could file a refund request: ' + JSON.stringify(filed.body));
  const resolved = await H.api('POST', `/api/admin/refunds/${reqId}/resolve`, { token: aToken, body: { action: 'approve' } });
  assert.equal(resolved.status, 200, 'staff approved it');
  await settle();
  assert.equal(await inTheSystem([buyer.id, seller.id]), DEPOSIT, 'money conserved');
});

test('refunding the same sale five times over does not drift', opts, async () => {
  const DEPOSIT = 50000;
  const { seller, token: sToken } = await sellerWithListing(10000);
  const { buyer, token: bToken } = await buyerWith(DEPOSIT);
  for (let i = 0; i < 5; i++) {
    const p = await H.api('POST', '/api/products', { token: sToken, body: {
      name: 'Loop ' + i, priceCents: 10000, kind: 'digital', digitalContent: 'x' } });
    const pid = p.body.product ? p.body.product.id : p.body.id;
    const orderId = await buy(bToken, pid);
    if (!orderId) break;
    await H.api('POST', `/api/orders/${orderId}/return`, { token: bToken, body: { reason: 'r' } });
    await H.api('PATCH', `/api/orders/${orderId}/return`, { token: sToken, body: { action: 'approve' } });
    await settle();
  }
  assert.equal(await inTheSystem([buyer.id, seller.id]), DEPOSIT,
    'five buy-and-refund rounds recycle the same money instead of multiplying it');
});

/* ─────────────── the guards on a wallet-spending route ─────────────── */

test('a retried gift-card purchase charges once and replays the first card', opts, async () => {
  const { buyer, token } = await buyerWith(30000);
  const before = await balance(buyer.id);
  const clientId = H.uniq('gc');
  const body = { amountCents: 10000, clientId };
  const first = await H.api('POST', '/api/gift-cards', { token, body });
  const retry = await H.api('POST', '/api/gift-cards', { token, body });

  assert.equal(before - (await balance(buyer.id)), 10000, 'charged exactly once');
  const { rows } = await H.getPool().query('SELECT COUNT(*)::int n FROM gift_cards WHERE buyer_id = $1', [buyer.id]);
  assert.equal(rows[0].n, 1, 'exactly one card was minted');
  // Compare the card, not the raw JSON: the stored copy round-trips through JSONB,
  // which does not preserve key order.
  assert.ok(first.body.card && retry.body.card, 'both replies carry the card');
  assert.equal(retry.body.card.code, first.body.card.code, 'the retry replays the first card, so the buyer still sees their code');

  // A genuinely different purchase must still go through.
  const other = await H.api('POST', '/api/gift-cards', { token, body: { amountCents: 5000, clientId: H.uniq('gc') } });
  assert.ok(other.status < 300, 'a different purchase is not blocked by the claim');
});
