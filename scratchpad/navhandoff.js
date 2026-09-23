/* A ROUTED PANEL HANDING OFF TO A SCREEN MUST ACTUALLY LAND THERE.
 *
 * Nine controls read `closeOverlay('<routed panel>'); ... acGoProfile()/acOpenChat()`.
 * Closing a panel that owns a route makes closeOverlay walk history back; the popstate
 * that schedules lands AFTER the screen has been shown, and _navApplyUrl then honours
 * the RESTORED address - re-opening whatever that route names and throwing the member
 * off the profile or conversation they just asked for. The screen is opened and then
 * navigated away from, so the control reads as dead.
 *
 * THE CODEBASE ALREADY CONTAINS THE FIX. Two sibling sites - `closeNotifToHome()` and
 * the notification detail's "See your profile" - pass `closeOverlay(id, true)`, the
 * documented opt-out that skips the history branch entirely. They are the control group
 * in this probe: they must stay green before and after.
 *
 * SIGNING IN TAKES A SINGLE NAVIGATION. The shared QA.signIn helper navigates twice, and
 * the first (signed-out) load lands on the guest /ai peek - leaving two extra history
 * entries that make every Back-depth measurement meaningless. The audit chased that as a
 * defect before proving it was the harness. Here the token is injected with
 * addInitScript so the measured page is the member's first navigation.
 *
 * Run:  DATABASE_URL=... JWT_SECRET=... node navhandoff.js [--break]
 *       --break serves the shipped bug (drops the noHistory opt-out again).
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

/* --break puts the shipped bug back: the nine handoffs lose the noHistory opt-out. */
async function serveOld(ctx) {
  await ctx.route('**/', async (route) => {
    const res = await route.fetch();
    let html = await res.text();
    html = html.split("closeOverlay('bizDirectory', true)").join("closeOverlay('bizDirectory')")
               .split("closeOverlay('walletView', true)").join("closeOverlay('walletView')")
               .split("closeOverlay('marketplaceView', true)").join("closeOverlay('marketplaceView')")
               .split("closeOverlay('servicesView', true)").join("closeOverlay('servicesView')")
               .split("closeOverlay('ordersView', true)").join("closeOverlay('ordersView')")
               .split("closeOverlay('connList', true)").join("closeOverlay('connList')");
    await route.fulfill({ response: res, body: html, headers: { ...res.headers(), 'content-length': undefined } });
  });
}

const SCR = ['acHomeScreen','acSearchScreen','acListScreen','acProfileScreen','acMeScreen','acPostViewScreen','acThreadScreen','acGroupsScreen'];
const state = (p) => p.evaluate((SCR) => {
  const open = [...document.querySelectorAll('.overlay:not(.hidden):not(.closing)')].map((o) => o.id);
  const seen = {}, dupes = [];
  document.querySelectorAll('.overlay:not(.hidden)').forEach((o) => { if (seen[o.id]) dupes.push(o.id); seen[o.id] = 1; });
  // an overlay that is invisible but still eating taps is worse than a visible one
  const trapping = [...document.querySelectorAll('.overlay:not(.hidden)')].filter((o) => {
    const cs = getComputedStyle(o);
    return (cs.opacity === '0' || cs.visibility === 'hidden') && cs.pointerEvents !== 'none';
  }).map((o) => o.id);
  return { path: location.pathname, hist: history.length, open, dupes, trapping,
           screen: SCR.find((id) => { const s = document.getElementById(id); return s && !s.classList.contains('hidden'); }) || null };
}, SCR);

/* sign in with ONE navigation - see the header */
async function freshPage(browser, u, viewport) {
  const ctx = await browser.newContext({ viewport });
  if (BREAK) await serveOld(ctx);
  const p = await ctx.newPage();
  await p.addInitScript((t) => {
    try { localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_intro_seen', JSON.stringify(['beam','circles','ai','wallet'])); } catch (e) {}
  }, u.token);
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await QA.waitUntil(p, () => !!(window.S && S.user && S.user.id), null, 25000);
  await p.waitForTimeout(1200);
  return { ctx, p };
}

const tapInAppBack = (p) => p.evaluate(() => {
  const SEL = '.sheet-close, .msg-back, .iset-back, .me-secback, [aria-label^="Back"], [aria-label^="Close"]';
  const vis = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const ovs = [...document.querySelectorAll('.overlay:not(.hidden):not(.closing)')];
  const top = ovs[ovs.length - 1];
  if (top) { const b = [...top.querySelectorAll(SEL)].find(vis); if (b) { b.click(); return 'overlay:' + top.id; } }
  for (const id of ['acProfileScreen','acThreadScreen','acPostViewScreen']) {
    const s = document.getElementById(id);
    if (s && !s.classList.contains('hidden')) { const b = [...s.querySelectorAll(SEL)].find(vis); if (b) { b.click(); return 'screen:' + id; } }
  }
  const tb = document.getElementById('tbBack');
  if (tb && tb.offsetParent !== null) { tb.click(); return 'topbar'; }
  return null;
});

/* ── the nine handoffs ──────────────────────────────────────────────────────
   EVERY CASE DRIVES ITS REAL CONTROL. Two earlier versions of this probe were not
   worth running: the first drove the chains without opening the source panel, so
   closeOverlay found a hidden element and returned at its first line (six cases passed
   for a reason unrelated to the bug); the second RECONSTRUCTED each chain inside
   evaluate(), so it tested the probe's own copy of the call site rather than the page's.
   Clicking the shipped element is the only version that measures the product. Each case
   also asserts its source is open ON ITS OWN ROUTE first, or closeOverlay never takes
   the history branch and the case is vacuous. */
function cases(F) {
  const openMarket = async (p) => {
    await p.evaluate(() => acOpenMarketplace());
    await QA.waitUntil(p, () => { const b = document.getElementById('marketplaceBody'); return !!b && /mkt-head|ac-listing/.test(b.innerHTML); }, null, 20000);
  };
  // marketplace -> a listing's own detail sheet (the source stays marketplaceView)
  const openListing = async (p) => {
    await openMarket(p);
    await p.evaluate((id) => acOpenListing(id), F.product);
    await QA.waitUntil(p, () => { const v = document.getElementById('listingView'); return !!v && !v.classList.contains('hidden') && /mkt-detail-head/.test(v.innerHTML); }, null, 20000);
  };
  const openWalletTx = async (p) => {
    await p.evaluate(() => acOpenWallet());
    await QA.waitUntil(p, () => { const b = document.getElementById('walletBody'); return !!b && /wtx|ac-item|wallet-row/.test(b.innerHTML); }, null, 20000);
    await p.evaluate(() => { const r = document.querySelector('#walletView [onclick*="acOpenWalletTx"]'); if (r) r.click(); });
    await QA.waitUntil(p, () => { const v = document.getElementById('walletTxView'); return !!v && !v.classList.contains('hidden') && /wtxd-peer/.test(v.innerHTML); }, null, 20000);
  };
  const openOrder = async (p) => {
    await p.evaluate(() => acOpenOrders('buyer'));
    await QA.waitUntil(p, () => { const b = document.getElementById('ordersBody'); return !!b && /ac-item|ord-/.test(b.innerHTML); }, null, 20000);
    await p.evaluate((id) => acOpenOrder(id), F.order);
    await QA.waitUntil(p, () => { const v = document.getElementById('orderView'); return !!v && !v.classList.contains('hidden') && /Message/.test(v.innerHTML); }, null, 20000);
  };
  const openConns = async (p) => {
    await p.evaluate(() => acOpenConnections());
    await QA.waitUntil(p, () => { const b = document.getElementById('connListBody'); return !!b && /ac-conn-item/.test(b.innerHTML); }, null, 20000);
  };
  const openDirectory = async (p) => {
    await p.evaluate(() => acOpenDirectory());
    await QA.waitUntil(p, () => { const b = document.getElementById('bizDirectoryBody'); return !!b && /ac-item/.test(b.innerHTML); }, null, 20000);
  };
  const openServices = async (p) => { await p.evaluate(() => acOpenServices()); await p.waitForTimeout(1800); };

  // click a real element, and say so if it is not on screen
  const click = (sel, within) => (p) => p.evaluate(([s, w]) => {
    const root = w ? document.querySelector(w) : document;
    const el = root && root.querySelector(s);
    if (!el) return false;
    el.click(); return true;
  }, [sel, within || null]);

  return [
    ['1. Business directory -> seller profile', 'bizDirectory', '/businesses', openDirectory,
      click('.ac-item', '#bizDirectoryBody'), 'acProfileScreen'],
    ['2. Wallet -> transaction -> peer profile', 'walletView', '/wallet', openWalletTx,
      click('.wtxd-peer', '#walletTxView'), 'acProfileScreen'],
    ['3. Marketplace card head -> seller profile', 'marketplaceView', '/marketplace', openMarket,
      click('.mkt-head', '#marketplaceView'), 'acProfileScreen'],
    ['4. Listing "Visit store" -> seller profile', 'marketplaceView', '/marketplace', openListing,
      // selected by its VISIBLE TEXT, not by its onclick: an onclick selector stops
      // matching under --break and the case would report "could not drive" instead of
      // failing, which is the difference between a self-test and a blind spot.
      (p) => p.evaluate(() => {
        const b = [...document.querySelectorAll('#listingView .ac-pill-btn')].find((x) => /^Visit\b/.test((x.textContent || '').trim()));
        if (!b) return false; b.click(); return true;
      }), 'acProfileScreen'],
    ['5. Listing detail head -> seller profile', 'marketplaceView', '/marketplace', openListing,
      (p) => p.evaluate(() => {
        const v = document.getElementById('listingView');
        const h = v && v.querySelector('.mkt-detail-head');
        if (!h || v.classList.contains('hidden')) return false;
        h.click(); return true;
      }), 'acProfileScreen'],
    ['6. Services -> message the provider', 'servicesView', '/services', openServices,
      (p) => p.evaluate((id) => { acMessageProvider(id); return true; }, F.peer.id), 'acThreadScreen'],
    ['7. Order -> message the other party', 'ordersView', '/orders', openOrder,
      click('[onclick*="acOpenChat"]', '#orderView'), 'acThreadScreen'],
    ['8. Connections -> Message', 'connList', '/network', openConns,
      click('.ac-conn-item .ac-pill-btn', '#connListBody'), 'acThreadScreen'],
    ['9. Connections row -> profile', 'connList', '/network', openConns,
      click('.ac-conn-item', '#connListBody'), 'acProfileScreen'],
  ];
}

/* the CONTROL GROUP: two sibling sites that already pass noHistory and must never regress */
function controls(F) {
  return [
    ['C1. Notifications -> Home (closeNotifToHome)', async (p) => p.evaluate(() => { acNavNotifs(); }), async (p) => p.evaluate(() => closeNotifToHome()), 'acHomeScreen'],
    ['C2. Notification detail -> your profile', async (p) => p.evaluate(() => { acNavNotifs(); }), async (p) => p.evaluate(() => { closeOverlay('notifOverlay', true); acGoProfile(); }), 'acProfileScreen'],
  ];
}

async function drive(browser, u, viewport, F, tag) {
  const { ctx, p } = await freshPage(browser, u, viewport);
  const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 90)));

  for (const [name, source, route, openSrc, go, wantScreen] of cases(F)) {
    await p.evaluate(() => { [...document.querySelectorAll('.overlay:not(.hidden)')].forEach((o) => { try { closeOverlay(o.id, true); } catch (e) {} }); });
    await p.waitForTimeout(400);
    await p.evaluate(() => appTab('home'));
    await p.waitForTimeout(700);
    try { await openSrc(p); } catch (e) {}
    await p.waitForTimeout(600);
    const before = await state(p);
    // THE SETUP IS PART OF THE TEST: the source must be open AND the address must be its
    // own route, or closeOverlay never takes the history branch and the case is vacuous.
    const armed = before.open.includes(source) && before.path === route;
    say(armed, `${tag} ${name}: source is open on ${route} before the handoff`, JSON.stringify(before));
    if (!armed) continue;
    let drove = true;
    try { drove = (await go(p)) !== false; } catch (e) { drove = false; }
    if (!drove) { say(false, `${tag} ${name}: could not drive its real control`, 'source ' + source); continue; }
    // long enough for the popstate that used to kill the destination to have landed
    await p.waitForTimeout(2400);
    const after = await state(p);
    say(after.screen === wantScreen, `${tag} ${name}: lands on ${wantScreen} and STAYS`, JSON.stringify(after));
    say(!after.open.includes(source), `${tag} ${name}: the source panel is gone`, after.open.join(',') || 'nothing open');
    say(after.dupes.length === 0, `${tag} ${name}: no duplicate overlay`, JSON.stringify(after.dupes));
    say(after.trapping.length === 0, `${tag} ${name}: no invisible overlay trapping input`, JSON.stringify(after.trapping));
    say(after.hist - before.hist <= 2, `${tag} ${name}: history did not grow wrongly`, 'grew ' + (after.hist - before.hist));
  }

  for (const [name, open, go, wantScreen] of controls(F)) {
    await p.evaluate(() => { [...document.querySelectorAll('.overlay:not(.hidden)')].forEach((o) => { try { closeOverlay(o.id, true); } catch (e) {} }); });
    await p.waitForTimeout(400);
    await p.evaluate(() => appTab('home')); await p.waitForTimeout(700);
    await open(p); await p.waitForTimeout(1500);
    await go(p); await p.waitForTimeout(2200);
    const s = await state(p);
    say(s.screen === wantScreen, `${tag} ${name} [control, already correct]`, JSON.stringify(s));
  }

  say(errs.length === 0, `${tag} no JS errors across the family`, errs.join(' | ') || '0');
  await ctx.close();
}

/* ── Back / Forward semantics on one representative handoff ────────────────── */
async function backForward(browser, u, F) {
  for (const [how, act] of [
    ['in-app Back', async (p) => tapInAppBack(p)],
    ['browser Back', async (p) => { await p.goBack().catch(() => {}); return 'browserBack'; }],
    ['device Back (appGoBack)', async (p) => p.evaluate(() => { try { return appGoBack(); } catch (e) { return 'threw'; } })],
  ]) {
    const { ctx, p } = await freshPage(browser, u, { width: 390, height: 844 });
    await p.evaluate(() => appTab('home')); await p.waitForTimeout(700);
    await p.evaluate(() => acOpenMarketplace());
    await QA.waitUntil(p, () => { const b = document.getElementById('marketplaceBody'); return !!b && /mkt-head|ac-listing/.test(b.innerHTML); }, null, 20000);
    await p.evaluate(() => { const h = document.querySelector('#marketplaceView .mkt-head'); if (h) h.click(); });
    await p.waitForTimeout(2400);
    const at = await state(p);
    say(at.screen === 'acProfileScreen', `B. [${how}] reached the profile first`, JSON.stringify(at));
    const did = await act(p);
    await p.waitForTimeout(2000);
    const back = await state(p);
    // ONE meaningful level: back onto the marketplace, or the world it sat on - never
    // stranded on an unrelated screen with a stale overlay on top.
    const okBack = back.screen !== 'acProfileScreen' && back.dupes.length === 0 && back.trapping.length === 0;
    say(okBack, `B. [${how}] leaves the profile cleanly (${did})`, JSON.stringify(back));
    if (how === 'browser Back') {
      await p.goForward().catch(() => {});
      await p.waitForTimeout(2000);
      const f = await state(p);
      say(f.dupes.length === 0 && f.trapping.length === 0, 'B. Forward reconstructs without duplicates', JSON.stringify(f));
    }
    await ctx.close();
  }
}

(async () => {
  const pool = QA.newPool();
  const seller = await QA.seedAccount(pool, { business: true, prefix: 'nhs', balanceCents: 30000 });
  const peer = await QA.seedAccount(pool, { prefix: 'nhp' });
  await pool.query("UPDATE users SET name='QA Bakery', headline='Bread, daily', categories='[\"Food\"]'::jsonb WHERE id=$1", [seller.id]);
  await pool.query(`INSERT INTO products (business_id,name,description,price_cents,kind,active,stock,ship_free) VALUES ($1,'Sourdough','A loaf',800,'physical',true,20,true)`, [seller.id]);
  await pool.query(`INSERT INTO at_messages (sender_id, recipient_id, body) VALUES ($1,$2,'hello from the audit')`, [peer.id, seller.id]);
  const product = (await pool.query('SELECT id FROM products WHERE business_id = $1 LIMIT 1', [seller.id])).rows[0].id;
  /* The six controls that were previously reconstructed need REAL rows behind them:
     a wallet transaction with a peer, an order with another party, and an accepted
     connection. Without these the elements simply are not on the page and the case
     cannot be driven - which is a probe failure, not a product one, so it is reported
     as "could not drive its real control" rather than as a broken handoff. */
  await pool.query(
    `INSERT INTO wallet_tx (user_id, peer_id, kind, delta_cents, balance_after, note)
     VALUES ($1,$2,'send',-500,29500,'audit tx')`, [seller.id, peer.id]);
  const order = (await pool.query(
    `INSERT INTO orders (buyer_id, seller_id, status, total_cents, shipping_cents)
     VALUES ($1,$2,'paid',800,0) RETURNING id`, [seller.id, peer.id])).rows[0].id;
  await pool.query(
    `INSERT INTO order_items (order_id, product_id, name, price_cents, qty) VALUES ($1,$2,'Sourdough',800,1)`,
    [order, product]);
  await pool.query(
    `INSERT INTO connections (requester_id, addressee_id, status) VALUES ($1,$2,'accepted')`, [seller.id, peer.id]);
  await QA.assertServerSees(seller.token, seller.username);
  const F = { seller, peer, product, order };

  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  try {
    await drive(browser, seller, { width: 390, height: 844 }, F, '[mobile]');
    await drive(browser, seller, { width: 1440, height: 900 }, F, '[desktop]');
    await backForward(browser, seller, F);
  } finally {
    await browser.close();
    await pool.end().catch(() => {});
  }
  console.log('\n' + pass + ' passed, ' + fail + ' FAILED');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
