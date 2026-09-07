/* NOTHING HERE YET, SAID PROPERLY — AND THE MARKETPLACE'S OWN CONTROLS.
 *
 * Seven screens had a real empty state (a glyph, a headline, a sentence, a way out) and
 * dozens had a bare grey line — "You haven't ordered anything yet." — which tells a person
 * nothing about what the screen is for or what to do next. The money and shop screens now
 * share ONE component, `acEmpty`, so they cannot drift apart again.
 *
 * And the marketplace's filter row answered with a native OS dropdown and native square
 * checkboxes — the only unstyled system controls left in the app, sitting directly under a
 * row of full pills. They are the app's own controls now, with the BEHAVIOUR untouched:
 * still a real <select> and real checkboxes, so keyboard and screen reader work as before.
 */
const { chromium } = require(process.env.PW ? process.env.PW + '/node_modules/playwright-core' : __dirname + '/node_modules/playwright-core');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:3262';
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (x !== undefined ? ' :: ' + String(x).slice(0, 160) : '')); } };

/* screen, how to open it, and whether it should offer a way out */
const SCREENS = [
  ['Orders',              'acOpenOrders("buyer")',  true],
  ['Sales',               'acOpenOrders("seller")', true],
  ['Saved items',         'acOpenSaved()',          true],
  ['Invoices',            'acOpenInvoices()',       false],
  ['Quotes',              'acOpenQuotes()',         false],
  ['Splits',              'acOpenSplits()',         false],
  ['Pools',               'acOpenPools()',          false],
  ['Scheduled payments',  'acOpenSchedPays()',      false],
  /* Second pass: the rest of the app. A screen only asks for a way out when there is
     somewhere honest to send someone — "nobody blocked" has nowhere to go. */
  ['Notifications',       'openNotifications()',    false],
  ['Starred messages',    'acOpenStarred()',        false],
  ['Drafts',              'acOpenDrafts()',         false],
  ['Scheduled posts',     'acOpenScheduledPosts()', false],
  ['Lists',               'acOpenLists()',          false],
  ['Courses',             'acOpenCourses("teaching")', false],
  ['Communities',         'acOpenCommunities(); acCommTab("mine")',  true],
  ['Events',              'acOpenEvents(); acEventsTab("mine")',     false],
  ['Newsletters',         'acOpenNewsletters(); acNlTab("mine")',    false],
  ['Showcase',            'acOpenShowcaseDiscover()', false],
  ['Business directory',  'acOpenDirectory()',      false],
  ['Saved searches',      'acOpenSavedSearches()',  false],
  ['Saved candidates',    'acOpenSavedCandidates()', true],
  ['Blocked',             'openBlockedAccounts()',  false],
  ['Muted accounts',      'acOpenMutedAccounts()',  false],
  ['Muted words',         'acOpenMutedWords()',     false],
  ['Hidden last seen',    'acOpenLastSeenHidden()', false],
  /* Third pass: the selling and money screens a business account lands on. */
  ['Offers',              'acOpenOffers()',         true],
  ['Bookings',            'acOpenBookings()',       true],
  ['Affiliate links',     'acOpenAffiliate()',      true],
  ['Sell / listings',     'acOpenSell()',           false],
  ['Gift cards',          'acOpenGiftCards()',      false],
  ['Addresses',           'acOpenAddresses()',      false],
  ['Sponsored ads',       'acOpenProductAds()',     true],
  ['Ads manager',         'acOpenAds()',            false],
  ['Coupons',             'acOpenCoupons()',        false],
  ['Customers',           'acOpenCustomers()',      false],
  ['Bundles',             'acOpenBundles()',        false],
  ['Subscriptions',       'acOpenSubs()',           true],
  ['Appointments',        'acOpenAppointments()',   false],
  ['Profile viewers',     'acOpenProfileViewers()', false],
];

(async () => {
  if (!process.env.TOK) { console.error('export TOK first'); process.exit(2); }
  const b = await chromium.launch({ executablePath: CHROME });
  for (const theme of ['black', 'light']) {
    const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.evaluate(([t, th]) => { localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_theme', th); }, [process.env.TOK, theme]);
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(5200);
    await p.evaluate(() => { const s = document.querySelector('#introSheet:not(.hidden)');
      if (s && typeof introDismiss === 'function') introDismiss(); });

    for (const [name, open, wantsCta] of SCREENS) {
      try { await p.evaluate((f) => eval(f), open); } catch (e) { ok(false, theme + ': ' + name + ' opens', String(e).slice(0, 80)); continue; }
      await p.waitForTimeout(1500);
      const r = await p.evaluate(() => {
        const e = document.querySelector('.overlay:not(.hidden) .ac-feed-empty');
        if (!e) {
          /* Not empty is fine — this account may genuinely have rows. Say which, so a
             failure is never mistaken for "the empty state is missing". */
          const any = document.querySelector('.overlay:not(.hidden)');
          /* Every surface names its rows differently (a card grid has no .ac-item at
             all), so fall back to asking whether there is any real content at all. */
          const rows = any ? any.querySelectorAll('.ac-item,.ac-job-card,.ord-card,.inv-row,.ev-card,.crs-card,.sc-card,.ac-post,.comm-card').length : 0;
          const text = any ? (any.innerText || '').trim().length : 0;
          return { none: true, hasRows: rows > 0 || text > 140 };
        }
        const cta = e.querySelector('.ac-feed-empty-cta');
        const ic = e.querySelector('.ac-feed-empty-ic svg');
        const line = e.querySelector('.ac-feed-empty-line');
        const sub = e.querySelector('.ac-feed-empty-sub');
        const cs = cta ? getComputedStyle(cta) : null;
        return { line: line && line.textContent.trim(), sub: sub && sub.textContent.trim().length,
          hasIcon: !!ic && ic.getBoundingClientRect().width > 8, cta: cta && cta.textContent.trim(),
          ctaRuns: cta ? (cta.getAttribute('onclick') || '') : '', ctaRadius: cs && cs.borderRadius };
      });
      if (r.none) { ok(r.hasRows, theme + ': ' + name + ' has rows, so no empty state to check', 'neither rows nor an empty state'); continue; }
      ok(!!r.line && r.line.length > 3 && !/\.$/.test(r.line), theme + ': ' + name + ' says what is empty ("' + r.line + '")');
      ok(r.hasIcon, theme + ': ' + name + ' shows a glyph, not just a line of text');
      ok(r.sub > 20, theme + ': ' + name + ' explains what the screen is for');
      if (wantsCta) {
        ok(!!r.cta, theme + ': ' + name + ' offers a way out ("' + r.cta + '")');
        /* A button that does nothing is worse than no button: the function must exist. */
        const fn = (r.ctaRuns.match(/([A-Za-z_$][\w$]*)\s*\(/g) || []).map(x => x.replace(/\s*\($/, ''));
        const missing = await p.evaluate((names) => names.filter(n => typeof window[n] !== 'function'), fn);
        ok(missing.length === 0, theme + ': ' + name + '’s button goes somewhere real', 'missing: ' + missing.join(','));
      }
      /* closeOverlay walks history BACK for a route-owning panel, so closing twenty of
         them in a row leaves the router somewhere unpredictable. Pass noHistory. */
      /* THE RULE THIS PASS ADDED, and the one it is easiest to break again: a screen may
         not show TWO white pills that do the same job. The empty state explains and offers
         a way forward; if the header already carries that exact action in white, the empty
         state states the case and does not repeat the button. (A CTA that goes somewhere
         DIFFERENT — "Browse the marketplace" beside "＋ New listing" — is not a duplicate.)
         Nine screens broke this when the empty states were written, one of them before. */
      const dup = await p.evaluate(() => {
        const ov = [...document.querySelectorAll('.overlay:not(.hidden)')].pop();
        if (!ov) return null;
        const fnOf = (el) => (el.getAttribute('onclick') || '')
          .replace(/closeOverlay\([^)]*\);?/g, '').replace(/\s+/g, '');
        /* "Primary" is the theme's own --primary token, NOT the colour white: on Light it
           is near-black, and hardcoding white matched Light's pale unselected TABS instead
           (two of them, reported as a duplicate on correct code). */
        const probe = document.createElement('span');
        probe.style.cssText = 'position:fixed;left:-9999px;background:var(--primary)';
        document.body.appendChild(probe);
        const primary = getComputedStyle(probe).backgroundColor;
        probe.remove();
        const whites = [...ov.querySelectorAll('button,a')].filter((el) => {
          const r = el.getBoundingClientRect(); if (r.width < 40 || r.height < 20) return false;
          const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') return false;
          return cs.backgroundColor === primary;
        });
        const seen = {}, clash = [];
        for (const el of whites) {
          const f = fnOf(el); if (!f) continue;                 // a selected TAB has no action
          if (seen[f]) clash.push(f + ': "' + seen[f] + '" and "' + el.textContent.trim().slice(0, 24) + '"');
          else seen[f] = el.textContent.trim().slice(0, 24);
        }
        return clash;
      });
      if (dup) ok(dup.length === 0, theme + ': ' + name + ' has only one white button per action', dup.join(' / '));
      await p.evaluate(() => { document.querySelectorAll('.overlay:not(.hidden)').forEach(o => closeOverlay(o.id, true)); });
      await p.waitForTimeout(500);
    }

    /* The marketplace filters: the app's own controls, not the browser's. */
    await p.evaluate(() => acOpenMarketplace());
    await p.waitForTimeout(1600);
    const f = await p.evaluate(() => {
      const sel = document.getElementById('mktSort'), lab = document.querySelector('.mkt-fstock');
      const box = lab && lab.querySelector('input[type=checkbox]');
      const cs = getComputedStyle(sel), cl = getComputedStyle(lab);
      const before = cl.backgroundColor;
      box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true }));
      return { selAppearance: cs.appearance, selRadius: cs.borderRadius, selTag: sel.tagName,
        pillRadius: cl.borderRadius, before, isCheckbox: box.type === 'checkbox' };
    });
    /* The fill is read a FRAME after the tick: getComputedStyle in the same tick as the
       property change can hand back the value from before it. */
    await p.waitForTimeout(300);
    f.after = await p.evaluate(() => getComputedStyle(document.querySelector('.mkt-fstock')).backgroundColor);
    ok(f.selTag === 'SELECT' && f.isCheckbox, theme + ': they are still a real select and real checkboxes');
    ok(f.selAppearance === 'none', theme + ': the OS dropdown chrome is gone');
    ok(parseFloat(f.selRadius) > 100, theme + ': the sort control is a pill like everything around it (' + f.selRadius + ')');
    ok(parseFloat(f.pillRadius) > 100, theme + ': and so is each tick (' + f.pillRadius + ')');
    ok(f.before !== f.after, theme + ': ticking one fills it in, the way the chips above do');
    ok(errs.length === 0, theme + ': no JS errors' + (errs.length ? ' — ' + errs[0] : ''));
  }
  await b.close();
  console.log(fail ? `\n${fail} FAILED` : '\nEvery empty screen says what it is for, and the filters are the app’s own');
  process.exit(fail ? 1 : 0);
})();
