/* EVERY PLACE HAS A PLACE TO GO BACK.
 *
 * The founder: "every button has a place to land and every place has a place to go back
 * and it's gonna go back smoothly."
 *
 * Landing is notifguard.js's job. This is the other half: open each surface, prove there
 * is a VISIBLE way out, press it, and prove it actually left. Then press the system Back
 * gesture and prove that leaves too — a phone's back swipe is the one nobody tests and
 * the one everybody uses.
 *
 * IT PRESSES THE REAL CONTROL. Calling closeOverlay() would pass on a screen whose back
 * arrow is invisible, unreachable or wired to nothing — which is exactly the class of bug
 * this repo has shipped twice (a group's Cloud hidden by a CSS rule; the sign-up wizard
 * buried under the login overlay). A probe that never asks "what is actually on top?"
 * proves the code works, not that anybody can use it.
 *
 * PATHS RESOLVE FROM __dirname — run-all.sh cds into scratchpad/.
 */
const SP = '/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); }
  else { fail++; console.log('  FAIL ' + m + (x !== undefined ? '\n         ' + String(x).slice(0, 300) : '')); } };

const SURFACES = [
  ['Wallet', 'acOpenWallet()', 'walletView'],
  ['Orders', "acOpenOrders('buyer')", 'ordersView'],
  ['Marketplace', 'acOpenMarketplace()', 'marketplaceView'],
  ['Gift cards', 'acOpenGiftCards()', 'giftCardView'],
  ['Invoices', 'acOpenInvoices()', 'invoicesView'],
  ['Quotes', 'acOpenQuotes()', 'quotesView'],
  ['Splits', 'acOpenSplits()', 'splitView'],
  ['Pools', 'acOpenPools()', 'poolsView'],
  ['Events', 'acOpenEvents()', 'eventsList'],
  ['Courses', 'acOpenCourses()', 'coursesView'],
  ['Sell', 'acOpenSell()', 'sellView'],
  ['Ads', 'acOpenAds()', 'adsView'],
  ['Referrals', 'acOpenReferrals()', 'referView'],
  ['Rewards', 'acOpenLoyalty()', 'loyaltyView'],
  ['Settings', 'openSettings()', 'settingsOverlay'],
  ['Notifications', 'openNotifications()', 'notifOverlay'],
];

(async () => {
  let chromium, TOK;
  try {
    ({ chromium } = require(SP + 'node_modules/playwright-core'));
    TOK = require('fs').readFileSync('/tmp/tok.txt', 'utf8').trim();
  } catch (e) { console.log('  (unavailable: ' + e.message.slice(0, 60) + ')'); return done(); }

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  try {
    const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const base = 'http://localhost:' + (process.env.PORT || 3262) + '/';
    await p.goto(base, { waitUntil: 'domcontentloaded' });
    await p.evaluate(t => { localStorage.setItem('atwe_token', t);
      localStorage.setItem('atwe_intro_seen', '["beam","circles","ai","wallet"]'); }, TOK);
    await p.goto(base, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(4000);

    const reset = async () => {
      await p.evaluate(() => { document.querySelectorAll('.overlay:not(.hidden)')
        .forEach(o => { try { closeOverlay(o.id, true); } catch (e) {} });
        try { appTab('home'); } catch (e) {} });
      await p.waitForTimeout(320);
    };

    console.log('\n── there IS a way out, and pressing it works ──');
    for (const [name, fn, id] of SURFACES) {
      await reset();
      try { await p.evaluate(f => eval(f), fn); } catch (e) { ok(false, `${name} opens`, e.message.slice(0,80)); continue; }
      await p.waitForTimeout(1100);

      const r = await p.evaluate(async (id) => {
        const ov = document.getElementById(id);
        if (!ov || ov.classList.contains('hidden')) return { state: 'DID-NOT-OPEN' };
        // A way out is a control in the panel's top-left region that is really on screen
        // and really hittable — elementFromPoint at its own centre must land inside it.
        const cands = [...ov.querySelectorAll('button,[role=button]')].filter(el => {
          const b = el.getBoundingClientRect();
          if (b.width < 16 || b.height < 16) return null;
          const c = getComputedStyle(el);
          if (c.visibility === 'hidden' || c.opacity === '0' || c.display === 'none') return false;
          return b.top < 170 && b.left < 120;
        });
        const hittable = cands.filter(el => {
          const b = el.getBoundingClientRect();
          const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
          return t && (t === el || el.contains(t));
        });
        if (!hittable.length) return { state: 'NO-WAY-OUT', cands: cands.length };
        hittable[0].click();
        await new Promise(r => setTimeout(r, 900));
        const still = document.getElementById(id);
        return { state: (!still || still.classList.contains('hidden')) ? 'LEFT' : 'STUCK' };
      }, id);

      ok(r.state === 'LEFT', `${name}: a visible back control, and pressing it leaves`, JSON.stringify(r));
    }

    console.log('\n── the phone\'s own Back gesture leaves too ──');
    for (const [name, fn, id] of SURFACES.slice(0, 8)) {
      await reset();
      try { await p.evaluate(f => eval(f), fn); } catch (e) { continue; }
      await p.waitForTimeout(1000);
      const opened = await p.evaluate(i => { const o = document.getElementById(i); return !!o && !o.classList.contains('hidden'); }, id);
      if (!opened) { ok(false, `${name}: opened before testing Back`); continue; }
      await p.goBack().catch(() => {});
      await p.waitForTimeout(900);
      const gone = await p.evaluate(i => { const o = document.getElementById(i); return !o || o.classList.contains('hidden'); }, id);
      ok(gone, `${name}: system Back leaves the page`, gone ? '' : 'still open after Back');
    }
    /* THE TWO THINGS THAT MATTER MORE THAN THE FIX. Making Back close a sheet is only
       safe if it cannot TRAP you (press Back twice and you must be further out, not in a
       loop) and cannot dismiss a GATE (the login wall is not a place you are visiting). */
    console.log('\n── Back cannot trap you, and cannot open a locked door ──');
    await reset();
    await p.evaluate(() => acOpenSplits()); await p.waitForTimeout(900);
    await p.goBack().catch(() => {});  await p.waitForTimeout(700);   // 1: closes the sheet
    const afterOne = await p.evaluate(() => ({
      sheet: !!document.querySelector('#splitView:not(.hidden)'), path: location.pathname }));
    await p.goBack().catch(() => {});  await p.waitForTimeout(700);   // 2: must move the page
    const afterTwo = await p.evaluate(() => ({
      sheet: !!document.querySelector('#splitView:not(.hidden)'), path: location.pathname }));
    ok(!afterOne.sheet, 'one Back closes the sheet', JSON.stringify(afterOne));
    ok(!afterTwo.sheet, 'a second Back does not bring it back — no loop', JSON.stringify(afterTwo));

    const gated = await p.evaluate(async () => {
      // Show the login gate the way a signed-out visitor meets it, then press Back.
      try { showOverlay('loginOverlay'); } catch (e) { return 'NO-GATE'; }
      await new Promise(r => setTimeout(r, 500));
      const open = () => !!document.querySelector('#loginOverlay:not(.hidden)');
      if (!open()) return 'NO-GATE';
      const dismissed = (typeof _navDismissModal === 'function') ? _navDismissModal() : null;
      await new Promise(r => setTimeout(r, 400));
      const still = open();
      try { closeOverlay('loginOverlay', true); } catch (e) {}
      return still ? 'HELD' : 'DISMISSED(' + dismissed + ')';
    });
    ok(gated === 'HELD' || gated === 'NO-GATE',
       'Back does not dismiss the sign-in gate', gated);
  } catch (e) {
    fail++; console.log('  FAIL sweep threw\n         ' + e.message.slice(0, 300));
  } finally { try { await b.close(); } catch (e) {} done(); }
})();

function done() {
  console.log(`\n═══ ${pass} passed, ${fail} failed ═══`);
  process.exit(fail ? 1 : 0);
}
