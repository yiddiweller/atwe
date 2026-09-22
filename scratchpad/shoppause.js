/* A PAUSED SHOP MUST LOOK PAUSED, AND MUST NOT TAKE AN ORDER.
 *
 * `users.shop_paused` is vacation mode: the seller's own switch, and its documented
 * intent is "listings stay visible but can't be bought until they're back".
 *
 * TWO THINGS WERE WRONG AND THEY ARE DIFFERENT KINDS OF WRONG.
 *
 * (1) PRESENTATION. `acOpenStorefront(biz)` read `biz.shopPaused`, `biz.shopPauseMessage`
 *     and `biz.storeBanner` off the object its CALLER built. All three call sites build
 *     a five-key literal {id, name, username, avatar, headline}, so all three were always
 *     undefined: the amber pause line never rendered for anybody, and the pinned store
 *     announcement never rendered for a shopper. A seller could switch vacation mode on
 *     and shoppers would browse and fill a cart with no hint. `S.user` carries no
 *     shopPaused at all, so the owner's own preview could not show it either.
 *     The fix is not "pass more keys". A screen must not depend on whichever other screen
 *     opened it having remembered to carry the state: /api/businesses/:id/products now
 *     answers with the shop's own paused/banner state, and both the storefront and the
 *     profile's Shop section render from THAT.
 *
 * (2) ENFORCEMENT. Four purchase mutations already called shopPausedMessage(); two that
 *     also create real orders did not - POST /api/offers/:id/checkout and
 *     POST /api/product-subscriptions. A buyer holding an accepted offer, or anyone
 *     starting a Subscribe & Save, could buy from a shop that was explicitly closed.
 *
 * (3) THE SELLER'S OWN DOOR. Account -> Manage store -> View storefront is the route a
 *     seller actually takes, and it did not work at all: the row opened the storefront
 *     and something closed it again a moment later, bouncing them back to the Account
 *     page. Nothing to do with the shop's state - `closeOverlay('storeManageView')`
 *     walks history back for a panel that owns a route, and the popstate that schedules
 *     lands AFTER the opener that follows it on the same line has opened its panel, so
 *     the popstate handler tears that panel down. The probe drove `acOpenMyStorefront()`
 *     directly and therefore never saw it: a check scoped to part of its subject reports
 *     a clean result. It drives the REAL ROW now, in both shop states.
 *
 * So this probe asks all three questions, and asks them of a REAL browser and the REAL
 * API: does a shopper SEE the pause, does the server REFUSE the sale, and can the seller
 * GET THERE.
 *
 * Run:  DATABASE_URL=... JWT_SECRET=... node shoppause.js [--break]
 *       --break serves the OLD client (state read from the caller's object) to prove
 *       these checks can fail.
 */
'use strict';
const path = require('path');
const QA = require(path.join(__dirname, 'qa-fixture.js'));
const { chromium } = require(process.env.PW_SCRATCH
  ? path.join(process.env.PW_SCRATCH, 'node_modules/playwright-core')
  : path.join(__dirname, 'node_modules/playwright-core'));

const BREAK = process.argv.includes('--break');
const BASE = QA.base();
let pass = 0, fail = 0;
const say = (ok, what, extra) => { ok ? pass++ : fail++; console.log((ok ? '  ok   ' : '  FAIL ') + what + (extra ? '   ' + extra : '')); };

const PAUSE_MSG = 'Back on the 5th. Nothing ships until then.';
const BANNER = 'Twenty per cent off everything this week';

/* ── fixtures: a business with a shop, and a shopper with money ─────────────── */
async function seed(pool) {
  const seller = await QA.seedAccount(pool, { business: true, prefix: 'shopsel' });
  const buyer = await QA.seedAccount(pool, { prefix: 'shopbuy', balanceCents: 500000 });
  await pool.query('UPDATE users SET name = $2, store_banner = $3, headline = $4 WHERE id = $1',
    [seller.id, 'QA Bakery', BANNER, 'Bread, daily']);
  const prod = async (name, cents, sub) => (await pool.query(
    `INSERT INTO products (business_id, name, description, price_cents, kind, active, stock, ship_free, sub_enabled, sub_discount_pct)
     VALUES ($1,$2,'A thing',$3,'physical',true,50,true,$4,$5) RETURNING id`,
    [seller.id, name, cents, !!sub, sub ? 10 : 0])).rows[0].id;
  const p1 = await prod('Sourdough', 800, false);
  const p2 = await prod('Rye', 900, false);
  const p3 = await prod('Weekly loaf', 1000, true);          // Subscribe & Save
  const bundle = (await pool.query(
    `INSERT INTO bundles (seller_id, name, price_cents, active) VALUES ($1,'Two loaves',1500,true) RETURNING id`,
    [seller.id])).rows[0].id;
  await pool.query('INSERT INTO bundle_items (bundle_id, product_id, qty) VALUES ($1,$2,1),($1,$3,1)', [bundle, p1, p2]);
  // An offer the seller already accepted. This is the state the gap lived in: the
  // deal was struck while the shop was open, and paid for after it closed.
  const offer = (await pool.query(
    `INSERT INTO offers (product_id, buyer_id, seller_id, amount_cents, status, turn)
     VALUES ($1,$2,$3,700,'accepted','buyer') RETURNING id`, [p1, buyer.id, seller.id])).rows[0].id;
  await QA.assertServerSees(seller.token, seller.username);
  await QA.assertServerSees(buyer.token, buyer.username);
  return { seller, buyer, p1, p3, bundle, offer };
}

const setPaused = (pool, id, on) =>
  pool.query('UPDATE users SET shop_paused = $2, shop_pause_message = $3 WHERE id = $1', [id, on, on ? PAUSE_MSG : null]);

/* ── the API half: six purchase mutations, one question each ────────────────── */
async function post(token, url, body) {
  const r = await fetch(BASE + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
}

function purchaseRoutes(F) {
  return [
    ['buy now',            '/api/orders/buy',                    { productId: F.p1, qty: 1, payWith: 'balance' }],
    ['cart checkout',      '/api/orders',                        { sellerId: F.seller.id, payWith: 'balance' }],
    ['bundle buy',         '/api/bundles/' + F.bundle + '/buy',  { payWith: 'balance' }],
    ['make an offer',      '/api/offers',                        { productId: F.p1, amountCents: 600 }],
    ['offer checkout',     '/api/offers/' + F.offer + '/checkout', { payWith: 'balance' }],
    ['subscribe & save',   '/api/product-subscriptions',         { productId: F.p3, qty: 1, intervalDays: 30 }],
  ];
}

/* ── the browser half ───────────────────────────────────────────────────────── */
/* --break rewrites the SERVED page back to the shipped bug: the storefront and the
   Shop section read the state off the caller's object again. Rewriting what the
   server sends (rather than poking the live page) is the only version that really
   reproduces it, because the bug is in what the page was built to trust. */
async function serveOldClient(ctx) {
  await ctx.route('**/', async (route) => {
    const res = await route.fetch();
    let html = await res.text();
    html = html
      .replace('const vac = store.shopPaused', 'const vac = biz.shopPaused')
      .replace('escHtml(store.shopPauseMessage ||', 'escHtml(biz.shopPauseMessage ||')
      .replace('const ann = acStoreBannerHtml(store.storeBanner);',
               'const ann = acStoreBannerHtml(isOwner ? (S.user && S.user.storeBanner) : biz.storeBanner);')
      .replace('const vac = store.shopPaused\n      ? `<div class="sf-vac">', 'const vac = false\n      ? `<div class="sf-vac">')
      .replace(/\$\{acStoreBannerHtml\(store\.storeBanner\)\}\$\{vac\}/, '${acStoreBannerHtml(null)}')
      // ...and restores the SYNCHRONOUS history walk, so the E checks below fail the way
      // the seller reported: the row opens the storefront and a popstate closes it again.
      .replace('Promise.resolve().then(() => {\n      if (_ovShows > shownBefore)', '(() => {\n      if (_ovShows > shownBefore)')
      .replace('      try { history.back(); } catch (e) { acSyncPath(); }\n    });', '      try { history.back(); } catch (e) { acSyncPath(); }\n    })();');
    await route.fulfill({ response: res, body: html, headers: { ...res.headers(), 'content-length': undefined } });
  });
}

async function readStore(p) {
  return p.evaluate(() => {
    const box = document.getElementById('storefrontBody');
    const vis = (el) => !!el && el.offsetParent !== null;
    const vac = box && box.querySelector('.sf-vac');
    const ann = box && box.querySelector('.store-announce');
    return {
      open: !!document.getElementById('storefrontView') && !document.getElementById('storefrontView').classList.contains('hidden'),
      vac: vac && vis(vac) ? vac.textContent.trim() : null,
      ann: ann && vis(ann) ? ann.textContent.trim() : null,
    };
  });
}

async function openStorefrontFromProfile(p, username) {
  await p.evaluate((u) => acGoProfile(u), username);
  await QA.waitUntil(p, () => {
    const s = document.getElementById('acProfileScreen');
    return !!s && !s.classList.contains('hidden') && !!document.querySelector('.ac-ptab');
  }, null, 20000);
  // The Business pane is built lazily on first tap - the same path a person takes.
  await p.evaluate(() => acProfTab('business'));
  await QA.waitUntil(p, () => !!document.querySelector('#acProfileScreen .ac-section-row'), null, 20000);
  const clicked = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('#acProfileScreen .ac-section-row')];
    const row = rows.find((r) => /Storefront/.test(r.textContent || ''));
    const btn = row && row.querySelector('button');
    if (!btn) return false;
    btn.click(); return true;
  });
  if (!clicked) return { clicked: false };
  await QA.waitUntil(p, () => {
    const b = document.getElementById('storefrontBody');
    return !!b && !/skel/.test(b.innerHTML) && b.innerHTML.length > 40;
  }, null, 20000);
  return Object.assign({ clicked: true }, await readStore(p));
}

/* THE SELLER'S OWN ROUTE: Account -> Manage store -> View storefront.
   Driven as a real tap on the real row, because the bug lived in the navigation the row
   performs, not in the opener it calls - calling acOpenMyStorefront() by hand passes on
   a build where the row is dead. */
async function openStorefrontFromManageStore(p) {
  await p.evaluate(() => acOpenStoreManage());
  await QA.waitUntil(p, () => {
    const b = document.getElementById('storeManageBody');
    return !!b && /View storefront/.test(b.innerHTML);
  }, null, 20000);
  const clicked = await p.evaluate(() => {
    const row = [...document.querySelectorAll('#storeManageBody .iset-row')]
      .find((r) => /View storefront/.test(r.textContent || ''));
    if (!row) return false;
    row.click(); return true;
  });
  if (!clicked) return { clicked: false, stayed: false };
  // Long enough for the popstate that used to kill it to have landed and for the
  // close animation to finish - a storefront that is .closing is a bounce, not a page.
  await p.waitForTimeout(1600);
  const stayed = await p.evaluate(() => {
    const sf = document.getElementById('storefrontView');
    const mg = document.getElementById('storeManageView');
    return {
      open: !!sf && !sf.classList.contains('hidden') && !sf.classList.contains('closing'),
      manageGone: !mg || mg.classList.contains('hidden') || mg.classList.contains('closing'),
    };
  });
  if (!stayed.open) return Object.assign({ clicked: true, stayed: false }, stayed);
  await QA.waitUntil(p, () => {
    const b = document.getElementById('storefrontBody');
    return !!b && !/skel/.test(b.innerHTML) && b.innerHTML.length > 40;
  }, null, 20000);
  return Object.assign({ clicked: true, stayed: true }, stayed, await readStore(p));
}

async function run() {
  const pool = QA.newPool();
  let F;
  try {
    F = await seed(pool);
  } catch (e) {
    console.log('shoppause could not seed its own fixture: ' + e.message);
    console.log('DATABASE_URL must be the database the server on ' + BASE + ' was started with.');
    console.log('\n1 FAILED'); process.exit(1);
  }

  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  try {
    /* ══ A. THE SHOP IS OPEN ══ nothing about an active shop may change ══ */
    const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 } });
    if (BREAK) await serveOldClient(ctxA);
    const pa = await ctxA.newPage();
    await QA.signIn(pa, F.buyer);
    const openA = await openStorefrontFromProfile(pa, F.seller.username);
    say(openA.clicked, 'A1. a shopper can reach the storefront from the profile');
    say(openA.open === true, 'A2. the storefront opens');
    say(openA.vac === null, 'A3. an OPEN shop shows no pause line', openA.vac ? 'saw: ' + openA.vac : '');
    say(!!openA.ann && openA.ann.includes(BANNER), 'A4. an OPEN shop shows its pinned announcement', 'saw: ' + JSON.stringify(openA.ann));
    for (const [what, url, body] of purchaseRoutes(F)) {
      const r = await post(F.buyer.token, url, body);
      say(r.body.shopPaused !== true, 'A5. ' + what + ' is not refused as paused while the shop is open', 'status ' + r.status + ' ' + String(r.body.error || '').slice(0, 44));
    }
    await ctxA.close();

    /* ══ B. THE SHOP IS PAUSED ══ */
    await setPaused(pool, F.seller.id, true);

    // B-i. the shopper's view, entered from the profile
    const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } });
    if (BREAK) await serveOldClient(ctxB);
    const pb = await ctxB.newPage();
    await QA.signIn(pb, F.buyer);
    const openB = await openStorefrontFromProfile(pb, F.seller.username);
    say(!!openB.vac, 'B1. profile -> storefront: a shopper SEES the pause', openB.vac ? '' : 'no .sf-vac rendered');
    say(!!openB.vac && openB.vac.includes(PAUSE_MSG), "B2. it is the seller's own message", 'saw: ' + JSON.stringify(openB.vac));
    say(!!openB.ann && openB.ann.includes(BANNER), 'B3. the announcement survives the same entry path', 'saw: ' + JSON.stringify(openB.ann));

    // B-ii. the Shop section on the profile tells the same story
    await pb.evaluate(() => closeOverlay('storefrontView', true));
    await pb.waitForTimeout(400);
    const shopSec = await pb.evaluate(() => {
      const box = document.getElementById('acShopBox');
      const vac = box && box.querySelector('.sf-vac');
      const ann = box && box.querySelector('.store-announce');
      return { vac: vac ? vac.textContent.trim() : null, ann: ann ? ann.textContent.trim() : null };
    });
    say(!!shopSec.vac, "B4. the profile's Shop section says the shop is paused too", shopSec.vac ? '' : 'no .sf-vac in #acShopBox');
    say(!!shopSec.ann && shopSec.ann.includes(BANNER), 'B5. and still shows the announcement');
    await ctxB.close();

    // B-iii. a SECOND entry path, and the owner's own view
    const ctxC = await browser.newContext({ viewport: { width: 390, height: 844 } });
    if (BREAK) await serveOldClient(ctxC);
    const pc = await ctxC.newPage();
    await QA.signIn(pc, F.seller);
    await pc.evaluate(() => acOpenMyStorefront());
    await QA.waitUntil(pc, () => {
      const b = document.getElementById('storefrontBody');
      return !!b && !/skel/.test(b.innerHTML) && b.innerHTML.length > 40;
    }, null, 20000);
    const ownerView = await readStore(pc);
    say(!!ownerView.vac, 'B6. owner preview (a second entry path) shows the pause', ownerView.vac ? '' : 'no .sf-vac rendered');
    say(!!ownerView.ann && ownerView.ann.includes(BANNER), 'B7. the owner sees the same announcement a shopper does');

    // The one visual thing to get right: the pause must not overlap or clip anything.
    const geom = await pc.evaluate(() => {
      const v = document.querySelector('#storefrontBody .sf-vac');
      const g = document.getElementById('sfGrid');
      if (!v || !g) return null;
      const a = v.getBoundingClientRect(), b = g.getBoundingClientRect();
      return { w: Math.round(a.width), h: Math.round(a.height), clipped: v.scrollHeight > v.clientHeight + 1, above: a.bottom <= b.top + 1 };
    });
    say(!!geom && geom.w > 200 && geom.h > 20, 'B8. the pause line is laid out, not collapsed', geom ? geom.w + 'x' + geom.h : 'not found');
    say(!!geom && !geom.clipped, 'B9. its text is not clipped');
    say(!!geom && geom.above, 'B10. it sits above the products, not over them');

    // B-v. THE SELLER'S OWN ROUTE, on the same paused shop. Same page, same account -
    // the row is the only thing new. `acOpenMyStorefront()` above is the opener; this
    // is the DOOR, and the door was the broken half.
    await pc.evaluate(() => { [...document.querySelectorAll('.overlay:not(.hidden)')].forEach((o) => { try { closeOverlay(o.id, true); } catch (e) {} }); });
    await pc.waitForTimeout(500);
    const mgB = await openStorefrontFromManageStore(pc);
    say(mgB.clicked, 'B14. Manage store offers a View storefront row');
    say(mgB.stayed, 'B15. tapping it OPENS the storefront and stays there', mgB.clicked ? 'manageGone ' + mgB.manageGone : 'row not found');
    say(mgB.stayed && !!mgB.vac && mgB.vac.includes(PAUSE_MSG), 'B16. and a paused shop still says so on that route', 'saw: ' + JSON.stringify(mgB.vac));
    say(mgB.stayed && !!mgB.ann && mgB.ann.includes(BANNER), 'B17. the announcement survives it too', 'saw: ' + JSON.stringify(mgB.ann));
    await ctxC.close();

    // B-iv. the server refuses every purchase, whatever the screen says
    for (const [what, url, body] of purchaseRoutes(F)) {
      const r = await post(F.buyer.token, url, body);
      say(r.status === 400 && r.body.shopPaused === true && String(r.body.error || '').includes(PAUSE_MSG),
        'B11. ' + what + ' is refused while paused', 'status ' + r.status + ' ' + JSON.stringify(r.body.error || r.body).slice(0, 70));
    }
    // ...and nothing was created behind our back.
    const made = (await pool.query('SELECT COUNT(*)::int AS n FROM orders WHERE seller_id = $1', [F.seller.id])).rows[0].n;
    say(made === 0, 'B12. no order exists for the paused shop', 'orders: ' + made);
    const offSt = (await pool.query('SELECT status FROM offers WHERE id = $1', [F.offer])).rows[0].status;
    say(offSt === 'accepted', 'B13. the refused offer checkout left the offer alone', 'status: ' + offSt);

    /* ══ C. BACK FROM HOLIDAY ══ the pause must be reversible ══ */
    await setPaused(pool, F.seller.id, false);
    const ctxD = await browser.newContext({ viewport: { width: 390, height: 844 } });
    if (BREAK) await serveOldClient(ctxD);
    const pd = await ctxD.newPage();
    await QA.signIn(pd, F.buyer);
    const openD = await openStorefrontFromProfile(pd, F.seller.username);
    say(openD.vac === null, 'C1. un-pausing removes the line again', openD.vac ? 'saw: ' + openD.vac : '');
    say(!!openD.ann && openD.ann.includes(BANNER), 'C2. the announcement is still there');
    const r2 = await post(F.buyer.token, '/api/orders/buy', { productId: F.p1, qty: 1, payWith: 'balance' });
    say(r2.body.shopPaused !== true, 'C3. buying is no longer refused as paused', 'status ' + r2.status);
    await ctxD.close();

    // C-ii. the seller's own route works on an ACTIVE shop too - the fix must not be
    // something only a paused shop happens to survive.
    const ctxE = await browser.newContext({ viewport: { width: 390, height: 844 } });
    if (BREAK) await serveOldClient(ctxE);
    const pe = await ctxE.newPage();
    await QA.signIn(pe, F.seller);
    const mgC = await openStorefrontFromManageStore(pe);
    say(mgC.stayed, 'C4. Manage store -> View storefront opens an ACTIVE shop and stays', mgC.clicked ? 'manageGone ' + mgC.manageGone : 'row not found');
    say(mgC.stayed && mgC.vac === null, 'C5. with no pause line on it', mgC.vac ? 'saw: ' + mgC.vac : '');
    say(mgC.stayed && !!mgC.ann && mgC.ann.includes(BANNER), 'C6. and the announcement present');
    say(mgC.stayed && !!(await pe.evaluate(() => { const b = document.getElementById('storefrontBody'); return b && b.querySelector('.sf-head'); })),
        'C7. the storefront really rendered, not an empty shell');
    await ctxE.close();

    /* ══ D. the two new guards are IN THE SOURCE, so a screen nobody drives is covered ══ */
    const fs = require('fs');
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    for (const [what, marker] of [
      ['offer checkout', "app.post('/api/offers/:id/checkout'"],
      ['subscribe & save', "app.post('/api/product-subscriptions'"],
    ]) {
      const i = src.indexOf(marker);
      const body = i < 0 ? '' : src.slice(i, i + 4000);
      say(body.includes('shopPausedMessage('), 'D1. ' + what + ' calls shopPausedMessage in the source');
    }
  } finally {
    await browser.close();
    await pool.end().catch(() => {});
  }

  console.log('\n' + pass + ' passed, ' + fail + ' FAILED');
  process.exit(fail ? 1 : 0);
}

run().catch((e) => { console.log('CRASH: ' + (e && e.stack || e)); process.exit(1); });
