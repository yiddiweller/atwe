/* THE MONEY AND COMMERCE HALF OF THE BETA WORLD.
 *
 * demo.js already builds the social world (posts, stories, Beam, jobs, courses,
 * events, reviews). It writes nothing to the money tables, so Wallet, Orders,
 * Cart, Offers, Invoices, Gift cards, Loyalty, Saved and Appointments all open
 * empty. This fills exactly those.
 *
 * Every column used here was read out of db.js rather than remembered -- this
 * repo has three recorded incidents of a guessed column name shipping inside a
 * try/catch and silently doing nothing.
 *
 * NOTHING here is real money. The beta service has no Stripe key, so the whole
 * payment layer is inert; these rows are ledger history, not transactions.
 *
 * Idempotent: it looks for its own marker row and returns early if the account
 * has already been seeded, so `seed` can be re-run safely.
 */
'use strict';

const MARK = 'beta-seed';           // note text on the opening ledger row
const cents = (d) => Math.round(d * 100);

/* Products for the beta sellers. Deliberately NOT owned by is_demo accounts:
   /api/orders/buy refuses any listing whose seller is_demo, so a demo-owned shop
   cannot be checked out and the whole commerce journey would be untestable. */
const CATALOG = [
  { name: 'Walnut desk riser',      price: cents(89),  kind: 'physical', stock: 12, desc: 'Solid walnut, two heights, flat-packed.' },
  { name: 'Linen apron',            price: cents(38),  kind: 'physical', stock: 40, desc: 'Heavyweight linen with a deep front pocket.' },
  { name: 'Cold brew starter kit',  price: cents(54),  kind: 'physical', stock: 7,  desc: 'Filter, carafe and a first bag of beans.' },
  { name: 'Brand audit, 60 minutes',price: cents(150), kind: 'service',  stock: null, desc: 'A live call and a written summary after.' },
  { name: 'Lightroom preset pack',  price: cents(24),  kind: 'digital',  stock: null, desc: 'Twelve presets, instant download.' },
  { name: 'Studio day rate',        price: cents(320), kind: 'service',  stock: null, desc: 'Full day, lighting and backdrops included.' },
];

async function alreadySeeded(client, meId) {
  const r = await client.query(
    `SELECT 1 FROM wallet_tx WHERE user_id = $1 AND note = $2 LIMIT 1`, [meId, MARK]);
  return r.rowCount > 0;
}

/* One ledger writer so balance_after can never disagree with the balance. The
   app's own walletCredit does this inside a transaction; we are building history
   from nothing, so the running total is carried here. */
function ledger(client, userId) {
  let bal = 0;
  return {
    get balance() { return bal; },
    async row(kind, deltaCents, { peer = null, note = null, hoursAgo = 0 } = {}) {
      bal += deltaCents;
      await client.query(
        `INSERT INTO wallet_tx (user_id, peer_id, kind, delta_cents, balance_after, note, created_at)
         VALUES ($1,$2,$3,$4,$5,$6, now() - make_interval(hours => $7))`,
        [userId, peer, kind, deltaCents, bal, note, hoursAgo]);
    },
  };
}

/* sellers: [{ id, name }] -- real, non-demo, seed_tag'd accounts made by the caller. */
async function seedCommerce(client, { meId, sellers, tag }) {
  if (!meId || !Array.isArray(sellers) || sellers.length < 2) {
    throw new Error('seedCommerce needs meId and at least two beta sellers');
  }
  if (await alreadySeeded(client, meId)) return { skipped: true };

  const counts = {};
  const bump = (k, n = 1) => { counts[k] = (counts[k] || 0) + n; };

  /* ---- the sellers' catalogue ---------------------------------------- */
  const products = [];
  for (let i = 0; i < CATALOG.length; i++) {
    const c = CATALOG[i];
    const owner = sellers[i % sellers.length];
    const r = await client.query(
      `INSERT INTO products (business_id, name, description, price_cents, kind, stock, active)
       VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING id`,
      [owner.id, c.name, c.desc, c.price, c.kind, c.stock]);
    products.push({ id: r.rows[0].id, sellerId: owner.id, ...c });
    bump('products');
  }

  /* ---- a ship-to, so checkout has an address to pick ------------------ */
  await client.query(
    `INSERT INTO addresses (user_id, full_name, phone, line1, city, region, postal, country, is_default)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'US',true)`,
    [meId, 'Beta Tester', '+1 555 0142', '14 Sandbox Lane', 'Springfield', 'NY', '11224']);
  bump('addresses');

  /* ---- wallet: a believable history, ending on a spendable balance ---- */
  const L = ledger(client, meId);
  await L.row('topup',   cents(500), { note: MARK,                         hoursAgo: 720 });
  await L.row('receive', cents(150), { note: 'Brand audit, 60 minutes',    hoursAgo: 640, peer: sellers[0].id });
  await L.row('send',   -cents(45),  { note: 'Split: team lunch',          hoursAgo: 520, peer: sellers[1].id });
  await L.row('topup',   cents(200), { note: 'Top up',                     hoursAgo: 400 });
  await L.row('order',  -cents(89),  { note: 'Walnut desk riser',          hoursAgo: 300, peer: sellers[0].id });
  await L.row('receive', cents(320), { note: 'Studio day rate',            hoursAgo: 260, peer: sellers[1].id });
  await L.row('pot_in', -cents(250), { note: 'Rainy day',                  hoursAgo: 200 });
  await L.row('order',  -cents(54),  { note: 'Cold brew starter kit',      hoursAgo: 150, peer: sellers[1].id });
  await L.row('escrow_hold', -cents(38), { note: 'Linen apron (protected)', hoursAgo: 40, peer: sellers[0].id });
  await L.row('receive', cents(24),  { note: 'Lightroom preset pack',      hoursAgo: 20, peer: sellers[0].id });
  bump('wallet_tx', 10);

  await client.query('UPDATE users SET balance_cents = $2 WHERE id = $1', [meId, L.balance]);

  await client.query(
    `INSERT INTO wallet_pots (user_id, name, target_cents, balance_cents) VALUES ($1,$2,$3,$4),($1,$5,$6,$7)`,
    [meId, 'Rainy day', cents(1000), cents(250), 'New camera', cents(1800), cents(0)]);
  bump('wallet_pots', 2);

  /* ---- orders, as the BUYER, in three different live states ----------- */
  const order = async (sellerId, items, status, extra = {}) => {
    const total = items.reduce((n, it) => n + it.price * (it.qty || 1), 0);
    const r = await client.query(
      `INSERT INTO orders (buyer_id, seller_id, total_cents, status, created_at, paid_at,
                           shipping_cents, carrier, tracking, shipped_at, delivered_at, auto_release_at)
       VALUES ($1,$2,$3,$4, now() - make_interval(days => $5), now() - make_interval(days => $5),
               $6,$7,$8,$9,$10,$11) RETURNING id`,
      [meId, sellerId, total, status, extra.daysAgo || 1, extra.shipping || 0,
       extra.carrier || null, extra.tracking || null,
       extra.shippedDaysAgo != null ? new Date(Date.now() - extra.shippedDaysAgo * 864e5) : null,
       extra.deliveredDaysAgo != null ? new Date(Date.now() - extra.deliveredDaysAgo * 864e5) : null,
       extra.autoRelease || null]);
    for (const it of items) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, name, price_cents, qty) VALUES ($1,$2,$3,$4,$5)`,
        [r.rows[0].id, it.id, it.name, it.price, it.qty || 1]);
      bump('order_items');
    }
    bump('orders');
    return r.rows[0].id;
  };

  const oDelivered = await order(products[0].sellerId, [products[0]], 'delivered',
    { daysAgo: 12, shipping: cents(6), carrier: 'USPS', tracking: '9400111899223197428490', shippedDaysAgo: 10, deliveredDaysAgo: 7 });
  await order(products[2].sellerId, [products[2]], 'shipped',
    { daysAgo: 4, shipping: cents(6), carrier: 'UPS', tracking: '1Z999AA10123456784', shippedDaysAgo: 2 });
  await order(products[1].sellerId, [products[1]], 'escrow',
    { daysAgo: 1, shipping: cents(5), autoRelease: new Date(Date.now() + 6 * 864e5) });

  /* ---- orders, as the SELLER, so the Sales side is not empty ---------- */
  for (const buyer of sellers.slice(0, 2)) {
    const r = await client.query(
      `INSERT INTO orders (buyer_id, seller_id, total_cents, status, created_at, paid_at)
       VALUES ($1,$2,$3,'paid', now() - make_interval(days => 2), now() - make_interval(days => 2)) RETURNING id`,
      [buyer.id, meId, cents(150)]);
    await client.query(
      `INSERT INTO order_items (order_id, name, price_cents, qty) VALUES ($1,'Consulting hour',$2,1)`,
      [r.rows[0].id, cents(150)]);
    bump('orders'); bump('order_items');
  }

  /* ---- cart, saved, offers, invoices, gift card, loyalty, bookings ---- */
  for (const p of [products[3], products[4]]) {
    await client.query(
      `INSERT INTO cart_items (user_id, product_id, qty) VALUES ($1,$2,1) ON CONFLICT DO NOTHING`, [meId, p.id]);
    bump('cart_items');
  }
  for (const p of products.slice(0, 4)) {
    await client.query(
      `INSERT INTO saved_products (user_id, product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [meId, p.id]);
    bump('saved_products');
  }

  // one I made (waiting on them), one they made (waiting on me)
  await client.query(
    `INSERT INTO offers (product_id, buyer_id, seller_id, amount_cents, status, turn)
     VALUES ($1,$2,$3,$4,'pending','seller')`,
    [products[5].id, meId, products[5].sellerId, cents(275)]);
  await client.query(
    `INSERT INTO offers (product_id, buyer_id, seller_id, amount_cents, status, turn)
     VALUES ($1,$2,$3,$4,'pending','seller')`,
    [products[3].id, sellers[0].id, meId, cents(120)]);
  bump('offers', 2);

  await client.query(
    `INSERT INTO invoices (issuer_id, customer_id, title, items, amount_cents, note, due_at, status)
     VALUES ($1,$2,'Brand audit and written summary',$3,$4,'Thanks again.', now() + interval '10 days','sent')`,
    [meId, sellers[0].id, JSON.stringify([{ name: 'Brand audit', qty: 1, priceCents: cents(150) }]), cents(150)]);
  await client.query(
    `INSERT INTO invoices (issuer_id, customer_id, title, items, amount_cents, due_at, status)
     VALUES ($1,$2,'Studio hire, two days',$3,$4, now() + interval '5 days','sent')`,
    [sellers[1].id, meId, JSON.stringify([{ name: 'Studio day', qty: 2, priceCents: cents(320) }]), cents(640)]);
  bump('invoices', 2);

  await client.query(
    `INSERT INTO gift_cards (code, buyer_id, recipient_id, owner_id, amount_cents, balance_cents,
                             message, status, seed_tag)
     VALUES ($1,$2,$3,$3,$4,$4,'Happy birthday','active',$5)`,
    [`BETA-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, sellers[0].id, meId, cents(50), tag]);
  bump('gift_cards');

  let pts = 0;
  for (const [delta, reason, oid] of [[89, 'order', oDelivered], [54, 'order', null], [200, 'bonus', null]]) {
    pts += delta;
    await client.query(
      `INSERT INTO loyalty_tx (user_id, delta, reason, order_id, balance_after) VALUES ($1,$2,$3,$4,$5)`,
      [meId, delta, reason, oid, pts]);
    bump('loyalty_tx');
  }
  await client.query(
    'UPDATE users SET points_balance = $2, points_lifetime = $2 WHERE id = $1', [meId, pts]);

  await client.query(
    `INSERT INTO appointments (business_id, customer_id, service, when_at, note, status)
     VALUES ($1,$2,'Brand audit', now() + interval '3 days','First session','confirmed'),
            ($3,$2,'Studio walkthrough', now() + interval '9 days', null,'requested')`,
    [sellers[0].id, meId, sellers[1].id]);
  bump('appointments', 2);

  return { skipped: false, counts, balanceCents: L.balance };
}

module.exports = { seedCommerce, CATALOG };
