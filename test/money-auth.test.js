// Automated tests for the security-critical money + auth flows. Run with:
//   TEST_DATABASE_URL=postgres://user:pass@host/db npm test
// (skips cleanly when no database is configured — see helpers.js).
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const opts = { skip: H.SKIP ? 'no TEST_DATABASE_URL/DATABASE_URL set' : false };

before(async () => { if (!H.SKIP) await H.startServer(); });
after(async () => { await H.stopServer(); });

/* ───────────────────────── AUTH ───────────────────────── */

test('login with correct credentials returns a token + user', opts, async () => {
  const u = await H.seedUser();
  const r = await H.api('POST', '/api/auth/login', { body: { email: u.email, password: u.password } });
  assert.equal(r.status, 200);
  assert.ok(r.body.token, 'token present');
  assert.equal(r.body.user.id, u.id);
});

test('login with a wrong password is rejected (401)', opts, async () => {
  const u = await H.seedUser();
  const r = await H.api('POST', '/api/auth/login', { body: { email: u.email, password: 'wrongwrong' } });
  assert.equal(r.status, 401);
  assert.ok(!r.body.token);
});

test('a protected route requires a valid token', opts, async () => {
  const anon = await H.api('GET', '/api/auth/me');
  assert.equal(anon.status, 401);
  const bad = await H.api('GET', '/api/auth/me', { token: 'not.a.jwt' });
  assert.equal(bad.status, 401);
  const u = await H.seedUser();
  const token = await H.login(u);
  const ok = await H.api('GET', '/api/auth/me', { token });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.id, u.id);
});

/* ───────────────────────── WALLET ───────────────────────── */

test('demo top-up credits the wallet balance', opts, async () => {
  const u = await H.seedUser();
  const token = await H.login(u);
  const r = await H.api('POST', '/api/wallet/topup', { token, body: { amount: 10, clientId: H.uniq('cid') } });
  assert.equal(r.status, 200);
  assert.equal(r.body.balanceCents, 1000);
});

test('sending money debits sender, credits recipient, and is zero-sum', opts, async () => {
  const a = await H.seedUser({ balanceCents: 1000 });
  const b = await H.seedUser();
  const ta = await H.login(a);
  const r = await H.api('POST', '/api/wallet/send', { token: ta, body: { to: b.username, amount: 4, clientId: H.uniq('cid') } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.balanceCents, 600, 'sender left with $6');
  const pool = H.getPool();
  const bal = await pool.query('SELECT balance_cents FROM users WHERE id = ANY($1)', [[a.id, b.id]]);
  const sum = bal.rows.reduce((s, x) => s + x.balance_cents, 0);
  assert.equal(sum, 1000, 'total balance conserved (zero-sum transfer)');
  const rb = await pool.query('SELECT balance_cents FROM users WHERE id = $1', [b.id]);
  assert.equal(rb.rows[0].balance_cents, 400, 'recipient credited $4');
});

test('you cannot send money to yourself', opts, async () => {
  const u = await H.seedUser({ balanceCents: 1000 });
  const token = await H.login(u);
  const r = await H.api('POST', '/api/wallet/send', { token, body: { to: u.username, amount: 2, clientId: H.uniq('cid') } });
  assert.equal(r.status, 400);
});

test('sending to an unknown username 404s', opts, async () => {
  const u = await H.seedUser({ balanceCents: 1000 });
  const token = await H.login(u);
  const r = await H.api('POST', '/api/wallet/send', { token, body: { to: H.uniq('nope'), amount: 2, clientId: H.uniq('cid') } });
  assert.equal(r.status, 404);
});

/* ─────────────────── IDEMPOTENCY (double-tap safe) ─────────────────── */

test('two top-ups with the same clientId credit only once', opts, async () => {
  const u = await H.seedUser();
  const token = await H.login(u);
  const cid = H.uniq('cid');
  await H.api('POST', '/api/wallet/topup', { token, body: { amount: 10, clientId: cid } });
  await H.api('POST', '/api/wallet/topup', { token, body: { amount: 10, clientId: cid } });
  const me = await H.api('GET', '/api/auth/me', { token });
  assert.equal(me.body.user.balanceCents, 1000, 'credited once, not twice');
});

test('concurrent sends with the same clientId credit the recipient only once', opts, async () => {
  const a = await H.seedUser({ balanceCents: 2000 });
  const b = await H.seedUser();
  const ta = await H.login(a);
  const cid = H.uniq('cid');
  const send = () => H.api('POST', '/api/wallet/send', { token: ta, body: { to: b.username, amount: 5, clientId: cid } });
  await Promise.all([send(), send()]);
  const pool = H.getPool();
  const rb = await pool.query('SELECT balance_cents FROM users WHERE id = $1', [b.id]);
  assert.equal(rb.rows[0].balance_cents, 500, 'recipient credited exactly once');
  const ra = await pool.query('SELECT balance_cents FROM users WHERE id = $1', [a.id]);
  assert.equal(ra.rows[0].balance_cents, 1500, 'sender debited exactly once');
});

/* ─────────────────── VELOCITY CAP (anti-fraud) ─────────────────── */

test('outgoing sends past the daily cap are rejected (429)', opts, async () => {
  // Boot env sets WALLET_DAILY_CAP_CENTS=500 ($5). A $6 send must be capped.
  const a = await H.seedUser({ balanceCents: 5000 });
  const b = await H.seedUser();
  const ta = await H.login(a);
  const r = await H.api('POST', '/api/wallet/send', { token: ta, body: { to: b.username, amount: 6, clientId: H.uniq('cid') } });
  assert.equal(r.status, 429);
  assert.ok(r.body.velocityLimited, 'velocity flag set');
});

/* ─────────────────── PPV UNLOCK (claim-before-charge race) ─────────────────── */

test('concurrent PPV unlocks charge the buyer only once', opts, async () => {
  const author = await H.seedUser();
  const buyer = await H.seedUser({ balanceCents: 1000 });
  const pool = H.getPool();
  const { rows } = await pool.query(
    'INSERT INTO posts (user_id, body, ppv_cents) VALUES ($1,$2,$3) RETURNING id',
    [author.id, 'locked content', 300]
  );
  const postId = rows[0].id;
  const tb = await H.login(buyer);
  const unlock = () => H.api('POST', `/api/social/posts/${postId}/unlock`, { token: tb, body: {} });
  await Promise.all([unlock(), unlock()]);
  const bal = await pool.query('SELECT balance_cents FROM users WHERE id = $1', [buyer.id]);
  assert.equal(bal.rows[0].balance_cents, 700, 'buyer charged exactly one $3 unlock');
  const unlocks = await pool.query('SELECT count(*)::int AS n FROM post_unlocks WHERE post_id = $1 AND user_id = $2', [postId, buyer.id]);
  assert.equal(unlocks.rows[0].n, 1, 'exactly one unlock row');
  const ra = await pool.query('SELECT balance_cents FROM users WHERE id = $1', [author.id]);
  assert.equal(ra.rows[0].balance_cents, 300, 'author credited exactly once');
});

/* ─────────────────── OFFER CHECKOUT (claim-before-charge race) ─────────────────── */

// Seed a digital product (no shipping/address) + an accepted offer on it.
async function seedAcceptedOffer(pool, sellerId, buyerId, priceCents, offerCents) {
  const p = await pool.query(
    "INSERT INTO products (business_id, name, price_cents, kind) VALUES ($1,$2,$3,'digital') RETURNING id",
    [sellerId, 'Digital thing', priceCents]
  );
  const productId = p.rows[0].id;
  const o = await pool.query(
    "INSERT INTO offers (product_id, buyer_id, seller_id, amount_cents, status, turn) VALUES ($1,$2,$3,$4,'accepted','buyer') RETURNING id",
    [productId, buyerId, sellerId, offerCents]
  );
  return { productId, offerId: o.rows[0].id };
}

test('two concurrent offer checkouts create exactly one order', opts, async () => {
  // Amounts stay under the $5 daily velocity cap the suite boots with (each test
  // uses fresh users, so the per-user cumulative cap resets).
  const seller = await H.seedUser();
  const buyer = await H.seedUser({ balanceCents: 5000 });
  const pool = H.getPool();
  const { offerId } = await seedAcceptedOffer(pool, seller.id, buyer.id, 400, 300);
  const tb = await H.login(buyer);
  // Distinct clientIds so the wallet idempotency layer does NOT dedupe them — the
  // offer 'paying' claim is the only thing preventing two orders (today's fix).
  const pay = () => H.api('POST', `/api/offers/${offerId}/checkout`, { token: tb, body: { payWith: 'balance', clientId: H.uniq('cid') } });
  await Promise.all([pay(), pay()]);
  const orders = await pool.query('SELECT count(*)::int AS n FROM orders WHERE buyer_id = $1 AND seller_id = $2', [buyer.id, seller.id]);
  assert.equal(orders.rows[0].n, 1, 'exactly one order created for the offer');
  const bal = await pool.query('SELECT balance_cents FROM users WHERE id = $1', [buyer.id]);
  assert.equal(bal.rows[0].balance_cents, 4700, 'buyer charged the $3 agreed price exactly once');
  const off = await pool.query('SELECT status FROM offers WHERE id = $1', [offerId]);
  assert.equal(off.rows[0].status, 'paid', 'offer settled to paid');
});

/* ─────────────────── ESCROW (fund → confirm → release) ─────────────────── */

test('a protected order holds funds in escrow then releases to the seller on confirm', opts, async () => {
  const seller = await H.seedUser();
  const buyer = await H.seedUser({ balanceCents: 5000 });
  const pool = H.getPool();
  const p = await pool.query(
    "INSERT INTO products (business_id, name, price_cents, kind) VALUES ($1,$2,$3,'digital') RETURNING id",
    [seller.id, 'Escrowed thing', 400] // under the $5 velocity cap the suite boots with
  );
  const productId = p.rows[0].id;
  const tb = await H.login(buyer);
  const buy = await H.api('POST', '/api/orders/buy', { token: tb, body: { productId, qty: 1, protected: true, clientId: H.uniq('cid') } });
  assert.equal(buy.status, 200, JSON.stringify(buy.body));
  const orderId = buy.body.orderId;
  // Funds are held: buyer debited now, seller NOT yet credited, status = escrow.
  let bb = await pool.query('SELECT balance_cents FROM users WHERE id = $1', [buyer.id]);
  let sb = await pool.query('SELECT balance_cents FROM users WHERE id = $1', [seller.id]);
  let st = await pool.query('SELECT status FROM orders WHERE id = $1', [orderId]);
  assert.equal(bb.rows[0].balance_cents, 4600, 'buyer debited into escrow');
  assert.equal(sb.rows[0].balance_cents, 0, 'seller not yet paid while held');
  assert.equal(st.rows[0].status, 'escrow', 'order held in escrow');
  // Buyer confirms receipt → escrow releases to the seller.
  const conf = await H.api('POST', `/api/orders/${orderId}/confirm`, { token: tb, body: {} });
  assert.equal(conf.status, 200, JSON.stringify(conf.body));
  sb = await pool.query('SELECT balance_cents FROM users WHERE id = $1', [seller.id]);
  st = await pool.query('SELECT status FROM orders WHERE id = $1', [orderId]);
  assert.equal(sb.rows[0].balance_cents, 400, 'seller credited on release');
  assert.equal(st.rows[0].status, 'released', 'order released');
});

/* ─────────────────── SPLIT PAYMENTS (claim-first share) ─────────────────── */

test('a split share is charged at most once, even under concurrent pays', opts, async () => {
  const creator = await H.seedUser();
  const payer = await H.seedUser({ balanceCents: 5000 });
  const tc = await H.login(creator);
  const tp = await H.login(payer);
  const mk = await H.api('POST', '/api/splits', { token: tc, body: { title: 'Dinner', participants: [{ userId: payer.id, amountCents: 300 }] } });
  assert.equal(mk.status, 201, JSON.stringify(mk.body));
  const splitId = mk.body.id;
  // Two concurrent pays of the same share — the claim-first UPDATE ... WHERE
  // paid=false RETURNING must let only one move money.
  const pay = () => H.api('POST', `/api/splits/${splitId}/pay`, { token: tp, body: {} });
  await Promise.all([pay(), pay()]);
  const pool = H.getPool();
  const cb = await pool.query('SELECT balance_cents FROM users WHERE id = $1', [creator.id]);
  assert.equal(cb.rows[0].balance_cents, 300, 'creator credited exactly one share');
  const pb = await pool.query('SELECT balance_cents FROM users WHERE id = $1', [payer.id]);
  assert.equal(pb.rows[0].balance_cents, 4700, 'payer debited exactly once');
  // A later pay is a no-op that reports alreadyPaid (no extra charge).
  const again = await H.api('POST', `/api/splits/${splitId}/pay`, { token: tp, body: {} });
  assert.equal(again.status, 200);
  assert.ok(again.body.alreadyPaid);
});

/* ─────────────────── GIFT CARDS (single-use redeem) ─────────────────── */

test('gift card: claim owns a separate balance; second claim rejected', opts, async () => {
  const buyer = await H.seedUser({ balanceCents: 5000 });
  const redeemer = await H.seedUser();
  const tb = await H.login(buyer);
  const tr = await H.login(redeemer);
  const mk = await H.api('POST', '/api/gift-cards', { token: tb, body: { amountCents: 400 } });
  assert.equal(mk.status, 201, JSON.stringify(mk.body));
  const code = mk.body.card.code;
  const pool = H.getPool();
  const bb = await pool.query('SELECT balance_cents FROM users WHERE id = $1', [buyer.id]);
  assert.equal(bb.rows[0].balance_cents, 4600, 'buyer debited on purchase');
  // Claiming OWNS the card (separate balance) — it does NOT credit the wallet balance.
  const r1 = await H.api('POST', '/api/gift-cards/redeem', { token: tr, body: { code } });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.equal(r1.body.card.balanceCents, 400, 'card carries its own $4 balance');
  const rb = await pool.query('SELECT balance_cents FROM users WHERE id = $1', [redeemer.id]);
  assert.equal(rb.rows[0].balance_cents, 0, 'claiming does NOT touch the wallet balance');
  // The same owner re-submitting is a harmless no-op (already yours) — no double-own.
  const r2 = await H.api('POST', '/api/gift-cards/redeem', { token: tr, body: { code } });
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  assert.ok(r2.body.alreadyYours, 'same owner re-claim is a no-op');
  // A DIFFERENT user cannot steal an already-claimed card.
  const other = await H.seedUser();
  const tOther = await H.login(other);
  const r3 = await H.api('POST', '/api/gift-cards/redeem', { token: tOther, body: { code } });
  assert.equal(r3.status, 400, 'a different user cannot claim an owned card');
});

test('gift card: move to wallet is zero-sum (card −X, wallet +X)', opts, async () => {
  const buyer = await H.seedUser({ balanceCents: 5000 });
  const owner = await H.seedUser();
  const tb = await H.login(buyer);
  const to = await H.login(owner);
  const pool = H.getPool();
  const mk = await H.api('POST', '/api/gift-cards', { token: tb, body: { amountCents: 1000 } });
  const code = mk.body.card.code;
  const claim = await H.api('POST', '/api/gift-cards/redeem', { token: to, body: { code } });
  const cardId = claim.body.card.id;
  // Move $6 of the $10 into the wallet.
  const mv = await H.api('POST', `/api/gift-cards/${cardId}/to-wallet`, { token: to, body: { amountCents: 600 } });
  assert.equal(mv.status, 200, JSON.stringify(mv.body));
  assert.equal(mv.body.movedCents, 600);
  assert.equal(mv.body.balanceCents, 400, 'gift card now holds $4');
  const wb = await pool.query('SELECT balance_cents FROM users WHERE id = $1', [owner.id]);
  assert.equal(wb.rows[0].balance_cents, 600, 'wallet credited exactly $6');
  const gc = await pool.query('SELECT balance_cents FROM gift_cards WHERE id = $1', [cardId]);
  assert.equal(gc.rows[0].balance_cents, 400, 'gift card debited exactly $6');
  // Move the rest (default = all).
  const mv2 = await H.api('POST', `/api/gift-cards/${cardId}/to-wallet`, { token: to, body: {} });
  assert.equal(mv2.body.movedCents, 400);
  const wb2 = await pool.query('SELECT balance_cents FROM users WHERE id = $1', [owner.id]);
  assert.equal(wb2.rows[0].balance_cents, 1000, 'wallet now $10');
  const mv3 = await H.api('POST', `/api/gift-cards/${cardId}/to-wallet`, { token: to, body: {} });
  assert.equal(mv3.status, 400, 'moving from an empty gift card rejected');
});

/* ─────────────────── PAID HANDLE CLAIM (buy a premium @handle) ─────────────────── */

test('claiming a paid handle debits the buyer and switches their username', opts, async () => {
  const buyer = await H.seedUser({ balanceCents: 2000 });
  const pool = H.getPool();
  const handle = H.uniq('vip');
  await pool.query('INSERT INTO reserved_usernames (username, price_cents) VALUES ($1, $2)', [handle, 500]);
  const t = await H.login(buyer);
  const chk = await H.api('GET', `/api/handles/${handle}`, { token: t });
  assert.equal(chk.body.claimable, true);
  assert.equal(chk.body.priceCents, 500);
  const r = await H.api('POST', '/api/handles/claim', { token: t, body: { username: handle, priceCents: 500, clientId: H.uniq('cid') } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const u = await pool.query('SELECT username, balance_cents FROM users WHERE id = $1', [buyer.id]);
  assert.equal(u.rows[0].username, handle, 'username switched to the claimed handle');
  assert.equal(u.rows[0].balance_cents, 1500, 'buyer charged the $5 price');
  const gone = await pool.query('SELECT 1 FROM reserved_usernames WHERE username = $1', [handle]);
  assert.equal(gone.rowCount, 0, 'reservation removed after claim');
});

test('a handle not on sale cannot be claimed', opts, async () => {
  const buyer = await H.seedUser({ balanceCents: 2000 });
  const pool = H.getPool();
  const handle = H.uniq('locked');
  await pool.query('INSERT INTO reserved_usernames (username, price_cents) VALUES ($1, NULL)', [handle]); // reserved, no price
  const t = await H.login(buyer);
  const chk = await H.api('GET', `/api/handles/${handle}`, { token: t });
  assert.equal(chk.body.claimable, false);
  const r = await H.api('POST', '/api/handles/claim', { token: t, body: { username: handle, clientId: H.uniq('cid') } });
  assert.equal(r.status, 400, 'not-for-sale claim rejected');
});

test('a handle priced over the daily velocity cap is rejected (429)', opts, async () => {
  const buyer = await H.seedUser({ balanceCents: 5000 });
  const pool = H.getPool();
  const handle = H.uniq('big');
  await pool.query('INSERT INTO reserved_usernames (username, price_cents) VALUES ($1, $2)', [handle, 600]); // > $5 test cap
  const t = await H.login(buyer);
  const r = await H.api('POST', '/api/handles/claim', { token: t, body: { username: handle, clientId: H.uniq('cid') } });
  assert.equal(r.status, 429, 'over-cap handle buy velocity-limited');
  assert.ok(r.body.velocityLimited);
  const u = await pool.query('SELECT username FROM users WHERE id = $1', [buyer.id]);
  assert.notEqual(u.rows[0].username, handle, 'username unchanged (not charged/claimed)');
});

test('two concurrent claims of one handle: exactly one wins and is charged once', opts, async () => {
  const a = await H.seedUser({ balanceCents: 2000 });
  const b = await H.seedUser({ balanceCents: 2000 });
  const pool = H.getPool();
  const handle = H.uniq('rare');
  // Price stays under the $5 daily velocity cap the suite boots with.
  await pool.query('INSERT INTO reserved_usernames (username, price_cents) VALUES ($1, $2)', [handle, 400]);
  const [ta, tb] = [await H.login(a), await H.login(b)];
  const results = await Promise.all([
    H.api('POST', '/api/handles/claim', { token: ta, body: { username: handle, clientId: H.uniq('cid') } }),
    H.api('POST', '/api/handles/claim', { token: tb, body: { username: handle, clientId: H.uniq('cid') } }),
  ]);
  const wins = results.filter((r) => r.status === 200).length;
  assert.equal(wins, 1, 'exactly one claim succeeds');
  // exactly one account holds the handle; only the winner was charged.
  const holder = await pool.query('SELECT id, balance_cents FROM users WHERE lower(username) = lower($1)', [handle]);
  assert.equal(holder.rowCount, 1, 'exactly one holder');
  assert.equal(holder.rows[0].balance_cents, 1600, 'winner charged the $4 once');
  const other = await pool.query('SELECT balance_cents FROM users WHERE id = ANY($1) AND id <> $2', [[a.id, b.id], holder.rows[0].id]);
  assert.equal(other.rows[0].balance_cents, 2000, 'loser not charged');
});

/* ─────────────────── DB BACKSTOP (balance never negative) ─────────────────── */

test('the database rejects a negative wallet balance', opts, async () => {
  const u = await H.seedUser({ balanceCents: 100 });
  const pool = H.getPool();
  await assert.rejects(
    () => pool.query('UPDATE users SET balance_cents = -1 WHERE id = $1', [u.id]),
    (e) => e.code === '23514', // check_violation
    'users_balance_nonneg CHECK fires'
  );
});
