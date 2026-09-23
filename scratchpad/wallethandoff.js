/* A SUB-SHEET OF THE WALLET MUST NOT CLOSE THE WALLET.
 *
 * Reported live on build 1869: Account -> Selling -> Manage store -> Wallet & payouts
 * opened the wallet correctly at /wallet, the Request-money sheet opened correctly, and
 * pressing that sheet's own back arrow landed the member on the Selling screen instead
 * of back on the wallet.
 *
 * WHY. `acOpenRequestMoney` and `acOpenSendMoneyByUsername` each ran
 * `closeOverlay('walletView'); showOverlay('<sheet>')`. Those two sheets own NO route, so
 * their own close takes no history branch - it simply closes. With the wallet already
 * gone there is nothing underneath, so the member falls through to the Account page.
 * `acOpenMoneyRequests` looked identical and WORKED, because moneyRequestsView DOES own a
 * route (/money-requests): its close walks back to the /wallet entry and _navApplyUrl
 * re-opens the wallet. One line of difference between two adjacent buttons.
 *
 * NOT A 1869 REGRESSION. Measured against the pre-fix client: on 1868 the Request button
 * opened nothing at all (the sheet was killed by the popstate the moment it appeared), so
 * the stranding was simply unreachable. 1869 made the sheet open; this is the second half
 * of the same pre-existing defect.
 *
 * THE FIX IS AT THE CALL SITES, NOT IN THE SHARED PRIMITIVE. `acSendMoney`'s success path
 * has always read "if walletView is still on screen, refresh it" - it was written for a
 * sheet that opens OVER the wallet, and `acOpenSendMoney` (the same sheet, opened from a
 * profile) already behaves that way. The two wallet wrappers simply should not have been
 * closing their own parent.
 *
 * WHY NO PROBE CAUGHT IT. The handover audit drove BROWSER Back, which walks the history
 * entry and does re-open the wallet. The member pressed the sheet's OWN back arrow, which
 * for an unrouted sheet never touches history. Two different controls; only one was ever
 * tested. This probe presses the real in-app control.
 *
 * Run:  DATABASE_URL=... JWT_SECRET=... node wallethandoff.js [--break]
 *       --break puts the two closeOverlay('walletView') lines back.
 */
'use strict';
const path = require('path');
const QA = require(path.join(__dirname, 'qa-fixture.js'));
const { chromium } = require(process.env.PW_SCRATCH
  ? path.join(process.env.PW_SCRATCH, 'node_modules/playwright-core')
  : path.join(__dirname, 'node_modules/playwright-core'));

const BREAK = process.argv.includes('--break');
let pass = 0, fail = 0;
const say = (ok, what, extra) => { ok ? pass++ : fail++; console.log((ok ? '  ok   ' : '  FAIL ') + what + (extra ? '   ' + extra : '')); };

/* --break serves the shipped bug: both wallet sub-sheets close their own parent again. */
async function serveOldClient(ctx) {
  await ctx.route('**/', async (route) => {
    const res = await route.fetch();
    let html = await res.text();
    html = html
      .replace("  showOverlay('requestMoneyView');", "  closeOverlay('walletView');\n  showOverlay('requestMoneyView');")
      .replace("  showOverlay('sendMoneyView');   // over the wallet, never instead of it - see acOpenRequestMoney",
               "  closeOverlay('walletView');\n  showOverlay('sendMoneyView');");
    await route.fulfill({ response: res, body: html, headers: { ...res.headers(), 'content-length': undefined } });
  });
}

const look = (p) => p.evaluate(() => ({
  path: location.pathname,
  hist: history.length,
  open: [...document.querySelectorAll('.overlay:not(.hidden):not(.closing)')].map((o) => o.id),
}));

/* THE LIVE CHAIN, as real taps on the real rows: Account -> Selling -> Manage store
   -> Wallet & payouts. Reaching the wallet THIS way is the reported sequence, and it is
   also what proves the storefront hotfix's own chain is still intact. */
async function toWalletViaManageStore(p) {
  await p.evaluate(() => { [...document.querySelectorAll('.overlay:not(.hidden)')].forEach((o) => { try { closeOverlay(o.id, true); } catch (e) {} }); });
  await p.waitForTimeout(500);
  await p.evaluate(() => appTab('profile'));
  await p.waitForTimeout(900);
  await p.evaluate(() => { const r = [...document.querySelectorAll('#acMeBody .me-row.me-sec')].find((x) => /Selling/.test(x.textContent || '')); if (r) r.click(); else acMeSection('selling'); });
  await p.waitForTimeout(1000);
  const sellingOk = await p.evaluate(() => [...document.querySelectorAll('#acMeBody .me-row')].some((x) => /Manage store/.test(x.textContent || '')));
  await p.evaluate(() => { const r = [...document.querySelectorAll('#acMeBody .me-row')].find((x) => /Manage store/.test(x.textContent || '')); if (r) r.click(); else acOpenStoreManage(); });
  await QA.waitUntil(p, () => { const b = document.getElementById('storeManageBody'); return !!b && /Wallet & payouts/.test(b.innerHTML); }, null, 20000);
  await p.evaluate(() => { const r = [...document.querySelectorAll('#storeManageBody .iset-row')].find((x) => ((x.querySelector('.iset-label') || {}).textContent || '') === 'Wallet & payouts'); if (r) r.click(); });
  await p.waitForTimeout(2300);
  return { sellingOk, state: await look(p) };
}

/* open a sub-sheet from the wallet, press ITS OWN back arrow, and say where we land */
async function subSheet(p, label, openIt, sheetId) {
  const before = await look(p);
  const control = await p.evaluate(openIt);
  await p.waitForTimeout(2200);
  const opened = await look(p);
  say(opened.open.includes(sheetId), `${label}: the sheet opens`, JSON.stringify(opened) + '  via ' + control);
  if (!opened.open.includes(sheetId)) return;
  const tapped = await p.evaluate((id) => {
    const b = document.querySelector('#' + id + ' .sheet-close');
    if (!b) return false;
    b.click(); return true;
  }, sheetId);
  say(tapped, `${label}: the sheet has its own back control`);
  await p.waitForTimeout(2300);
  const back = await look(p);
  say(back.open.includes('walletView'), `${label}: its BACK ARROW returns to the WALLET`, JSON.stringify(back));
  say(!back.open.includes(sheetId), `${label}: and the sheet is gone`);
  say(back.hist - before.hist <= 1, `${label}: history did not grow wrongly`, 'grew ' + (back.hist - before.hist));
}

(async () => {
  const pool = QA.newPool();
  const u = await QA.seedAccount(pool, { business: true, prefix: 'wlh', balanceCents: 25000 });
  await pool.query("UPDATE users SET name='QA Bakery' WHERE id=$1", [u.id]);
  await pool.query(`INSERT INTO products (business_id,name,description,price_cents,kind,active,stock,ship_free) VALUES ($1,'Sourdough','A loaf',800,'physical',true,20,true)`, [u.id]);
  await QA.assertServerSees(u.token, u.username);

  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    if (BREAK) await serveOldClient(ctx);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 110)));
    await QA.signIn(p, u);

    /* ══ A. the reported chain reaches the wallet at all ══ */
    const chain = await toWalletViaManageStore(p);
    say(chain.sellingOk, 'A1. Account -> Selling lists Manage store');
    say(chain.state.open.includes('walletView'), 'A2. Manage store -> Wallet & payouts opens the wallet', JSON.stringify(chain.state));
    say(chain.state.path === '/wallet', 'A3. and the address is /wallet', chain.state.path);

    /* ══ B. the top "Request" button - the one that was reported ══ */
    await subSheet(p, 'B. Request money', () => {
      const b = [...document.querySelectorAll('#walletView .ac-pill-btn')].find((x) => (x.textContent || '').trim() === 'Request');
      if (b) { b.click(); return 'wallet card "Request"'; }
      acOpenRequestMoney(); return 'acOpenRequestMoney()';
    }, 'requestMoneyView');

    /* ══ C. the "Money requests" row - a DIFFERENT function, tested separately ══ */
    await subSheet(p, 'C. Money requests', () => {
      const b = document.querySelector('#walletView .wallet-cardrow');
      if (b) { b.click(); return '.wallet-cardrow'; }
      acOpenMoneyRequests(); return 'acOpenMoneyRequests()';
    }, 'moneyRequestsView');

    /* ══ D. Send money, the third sub-sheet ══ */
    await subSheet(p, 'D. Send money', () => {
      const b = [...document.querySelectorAll('#walletView .ac-pill-btn')].find((x) => (x.textContent || '').trim() === 'Send');
      if (b) { b.click(); return 'wallet card "Send"'; }
      acOpenSendMoneyByUsername(); return 'acOpenSendMoneyByUsername()';
    }, 'sendMoneyView');

    /* ══ E. BROWSER Back must agree with the in-app arrow ══ */
    await p.evaluate(() => { const b = [...document.querySelectorAll('#walletView .ac-pill-btn')].find((x) => (x.textContent || '').trim() === 'Request'); if (b) b.click(); else acOpenRequestMoney(); });
    await p.waitForTimeout(2000);
    say((await look(p)).open.includes('requestMoneyView'), 'E1. the sheet is open again');
    await p.goBack();
    await p.waitForTimeout(1800);
    const e = await look(p);
    say(e.open.includes('walletView'), 'E2. browser Back ALSO returns to the wallet', JSON.stringify(e));
    say(!e.open.includes('requestMoneyView'), 'E3. and closes the sheet');

    /* ══ F. the sheet really sits ON TOP and is readable ══ */
    await p.evaluate(() => { const b = [...document.querySelectorAll('#walletView .ac-pill-btn')].find((x) => (x.textContent || '').trim() === 'Request'); if (b) b.click(); else acOpenRequestMoney(); });
    await p.waitForTimeout(1800);
    const paint = await p.evaluate(() => {
      const sheet = document.querySelector('#requestMoneyView .job-card-modal');
      if (!sheet) return null;
      const r = sheet.getBoundingClientRect();
      const top = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + 12));
      const title = document.querySelector('#requestMoneyView .jp-title');
      const cs = title ? getComputedStyle(title) : null;
      return { inSheet: !!(top && top.closest('#requestMoneyView')), w: Math.round(r.width), h: Math.round(r.height), title: title ? title.textContent.trim() : null, op: cs ? cs.opacity : null };
    });
    say(!!paint && paint.inSheet, 'F1. the sheet is the top thing under the finger, not the wallet', JSON.stringify(paint));
    say(!!paint && paint.w > 200 && paint.h > 120, 'F2. it is laid out, not collapsed', paint ? paint.w + 'x' + paint.h : 'n/a');
    say(!!paint && paint.title === 'Request money' && paint.op === '1', 'F3. and its title is fully painted', JSON.stringify(paint));

    /* ══ G. the storefront hotfix on the same chain is untouched ══ */
    await p.evaluate(() => { [...document.querySelectorAll('.overlay:not(.hidden)')].forEach((o) => { try { closeOverlay(o.id, true); } catch (e) {} }); });
    await p.waitForTimeout(500);
    await p.evaluate(() => acOpenStoreManage());
    await QA.waitUntil(p, () => { const b = document.getElementById('storeManageBody'); return !!b && /View storefront/.test(b.innerHTML); }, null, 20000);
    await p.evaluate(() => { const r = [...document.querySelectorAll('#storeManageBody .iset-row')].find((x) => ((x.querySelector('.iset-label') || {}).textContent || '') === 'View storefront'); if (r) r.click(); });
    await p.waitForTimeout(2400);
    const sf = await look(p);
    say(sf.open.includes('storefrontView'), 'G1. Manage store -> View storefront still opens and stays', JSON.stringify(sf));

    say(errs.length === 0, 'H1. no JS errors anywhere in the sweep', errs.join(' | ') || '0');
    await ctx.close();
  } finally {
    await browser.close();
    await pool.end().catch(() => {});
  }

  console.log('\n' + pass + ' passed, ' + fail + ' FAILED');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
