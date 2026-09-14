/* SECTION 13 of the polish brief: "error states are clear, calm and recoverable".

   EMPTY states already have a guard (emptystates.js, 38 screens) and it is not
   duplicated here. What nobody had ever driven is the FAILURE state: the app has
   one designed error state, acErr(), with a satellite, an explanation and a Try
   again button - and it is used in 23 places, while roughly a hundred others print
   a bare grey line with no way to try again at all.

   Measured by failing the surface's own route with a 500, which is what a flaky
   connection actually looks like, and reading what a person is left with. */
process.env.JWT_SECRET = 'scoresecret';
const SP = '/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const { chromium } = require(SP + 'node_modules/playwright-core');
const TOK = require('fs').readFileSync('/tmp/tok.txt', 'utf8').trim();

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); }
  else { fail++; console.log('  FAIL ' + m + (x !== undefined ? '\n         ' + String(x).slice(0, 240) : '')); } };

const CASES = [
  ['Home feed',      '**/api/social/feed**',          `acSetFeed('foryou')`,      2600],
  ['Beam chat list', '**/api/atchat/conversations**', `appTab('chat')`,           2400],
  ['Jobs board',     '**/api/jobs**',                 `acGoJobsBoard('jobs'); setTimeout(()=>{try{acLoadJobs('')}catch(e){}},600)`, 3200],
  ['Notifications',  '**/api/notifications**',        `acNavNotifs()`,            2400],
  ['Orders',         '**/api/orders**',               `acOpenOrders('buyer')`,    2200],
  ['Marketplace',    '**/api/marketplace**',          `acOpenMarketplace()`,      2400],
  ['Wallet',         '**/api/wallet**',               `acOpenWallet()`,           2400],
  ['Saved',          '**/api/saved-products**',       `acOpenSaved&&acOpenSaved()`, 2000],
];

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await p.goto('http://localhost:3262', { waitUntil: 'domcontentloaded' });
  await p.evaluate((t) => { localStorage.clear(); localStorage.setItem('atwe_token', t);
    localStorage.setItem('atwe_intro_seen', JSON.stringify(['beam', 'circles', 'ai', 'wallet'])); }, TOK);
  await p.goto('http://localhost:3262', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(6000);
  /* SELF-TEST: put the old behaviour back - a bare grey line with no way to try
     again - which is exactly what every one of these surfaces did before. */
  if (process.argv.includes('--break')) {
    console.log('  [--break: acErr replaced with the old bare line]');
    await p.evaluate(() => { window.acErr = (el) => { if (el) el.innerHTML = '<div class="ac-empty">Could not load.</div>'; }; });
  }

  for (const [name, route, opener, wait] of CASES) {
    await p.evaluate(() => { try {
      [...document.querySelectorAll('.overlay:not(.hidden)')].reverse().forEach(o => { if (o.id) closeOverlay(o.id, true); });
      if (typeof closeSettings === 'function') closeSettings(true);
    } catch (e) {} });
    await p.waitForTimeout(600);
    await p.route(route, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }));
    await p.evaluate((o) => { try { eval(o); } catch (e) {} }, opener);
    await p.waitForTimeout(wait);

    const r = await p.evaluate(() => {
      const vis = (e) => { const b2 = e.getBoundingClientRect(); const cs = getComputedStyle(e);
        return b2.width > 2 && b2.height > 2 && b2.top < innerHeight && b2.bottom > 0
               && cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > .05; };
      const designed = [...document.querySelectorAll('.ac-err')].filter(vis);
      /* DO NOT FILTER BY WORDING. The first version of this looked for "could not" /
         "failed" and reported "nothing at all" on six surfaces that were in fact
         rendering the SERVER'S OWN error string raw - the marketplace showed the single
         word "boom", which is the 500's message field. A test that only recognises the
         wording it expected cannot see the state that is actually there. */
      const bare = [...document.querySelectorAll('.ac-empty')].filter(vis)
        .map(e => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
      // a way to try again: the designed button, OR any visible control saying "try again"/"retry"
      const retry = [...document.querySelectorAll('button,[role="button"],a')].filter(vis)
        .some(e => /try again|retry|reload/i.test((e.textContent || '') + ' ' + (e.getAttribute('aria-label') || '')));
      /* A FAILED REFRESH THAT KEEPS THE ROWS IS CORRECT, NOT A FAULT. Replacing a
         list somebody is reading with an error screen because a background refresh
         blipped is worse than saying nothing. So a surface that still shows real
         content is skipped rather than graded. */
      const kept = document.querySelectorAll('.ac-item,.ac-post,.ord-row,.mkt-card,.wal-row').length;
      return { designed: designed.length, designedText: designed[0] ? (designed[0].innerText || '').replace(/\s+/g, ' ').trim().slice(0, 90) : null,
               bare, retry, kept };
    });

    if (!r.designed && !r.bare.length && r.kept) {
      console.log('  --   skipped ' + name + ' (the failed refresh kept ' + r.kept + ' rows on screen, which is the right answer)');
    } else if (r.designed) {
      ok(r.retry, name + ' — the designed error state, with a way to try again',
         'designed state shown but no Try again control: "' + r.designedText + '"');
      console.log('         "' + r.designedText + '"');
    } else if (r.bare.length) {
      ok(false, name + ' — a failed load explains itself and offers a way back',
         'bare line, no retry: "' + r.bare[0].replace(/\s+/g, ' ').slice(0, 90) + '"');
    } else {
      /* NOTHING AT ALL is the worst outcome and must not read as a pass: a surface
         that swallows a 500 leaves a blank panel with no explanation. */
      ok(false, name + ' — a failed load says something',
         'no error state of any kind on screen after a 500');
    }
    await p.unroute(route);
    await p.waitForTimeout(300);
  }

  await p.close(); await b.close();
  console.log('\n═══ ' + pass + ' passed, ' + fail + ' failed ═══');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
