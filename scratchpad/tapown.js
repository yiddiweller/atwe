/* EVERY CONTROL GETS ITS OWN TAP.
 *
 * The founder could not post. Not a frozen request, not a dead handler: the Post button
 * was UNREACHABLE. `.msg-back` (the x on the composer and on ~30 sheets) carries the
 * invisible 44pt touch overlay as an `::after` with `inset:-6px` -- and `.msg-back` is
 * `position:static`, so that overlay resolved against the nearest POSITIONED ancestor
 * instead of the button. It rendered 370x68: a transparent slab across the whole header,
 * and every tap on Post landed on it. Four more classes were static the same way
 * (`.mkt-cart`, `.feed-im-btn`, `.frail-btn`, `.pf-top-x`).
 *
 * WHY NOTHING CAUGHT IT. `touchsize.js` measures the overlay's used size and asks whether
 * it CLEARS 44 -- an escaped overlay is enormous, so it sails through. `touchwide.js` does
 * hit-test neighbours, but its nine surfaces do not include the composer or any sheet
 * header, so it never once looked at the most-pressed button in the app. Fifth route in
 * this repo to the same lesson: a check that never sees a control reports a clean result.
 *
 * So this probe asks the one question those two do not: does a control's own centre
 * actually belong to it? Plus a source check, because a class added to the overlay block
 * without a `position` of its own is the bug, and that holds for screens no probe opens.
 */
const SP = '/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const { chromium } = require(SP + 'node_modules/playwright-core');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const BASE = 'http://localhost:3262';
const TOK = process.env.TOK || (fs.existsSync('/tmp/tok.txt') ? fs.readFileSync('/tmp/tok.txt', 'utf8').trim() : '');

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (x ? ('  ' + JSON.stringify(x)) : '')); } };

/* ── 1. SOURCE: every class carrying the touch overlay must be a containing block ── */
function sourceCheck() {
  const src = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  /* The app's stylesheet ends at the FIRST </style>: six later ones live inside JS
     template literals that build print windows. */
  const css = src.slice(src.indexOf('<style>') + 7, src.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
  /* There is MORE THAN ONE of these blocks -- one for ::after, one for ::before -- and
     indexOf with no offset finds only the first. Collect every rule that declares the
     invisible overlay, whichever pseudo it uses. */
  const hosts = new Set();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1], body = m[2];
    if (!/content:\s*''/.test(body) || !/position:\s*absolute/.test(body)) continue;
    /* Only a SIMPLE `.class::pseudo`. A compound like `.msg-bubble.sending::after` would
       otherwise be recorded as a host called `sending`, which is not a class anybody
       positions. */
    for (const h of sel.matchAll(/(^|[,\s>+~])\.([a-z0-9-]+)::(?:before|after)/g)) hosts.add(h[2]);
  }
  ok(hosts.size >= 20, 'the invisible 44pt overlay is declared on ' + hosts.size + ' classes', { found: hosts.size });
  const bad = [];
  for (const c of hosts) {
    const re = new RegExp('(^|[,\\s>])\\.' + c + '\\s*(,[^{]*)?\\{[^}]*position:\\s*(relative|absolute|fixed|sticky)', 'm');
    if (!re.test(css)) bad.push(c);
  }
  /* A STATIC HOST IS THE BUG. An inset overlay resolves against the nearest POSITIONED
     ancestor, so on a static host it does not merely sit wrong, it grows to the size of
     that ancestor -- 370x68 across the composer header, in the case that shipped. */
  ok(bad.length === 0, 'every host is positioned, so no overlay can escape and cover the screen', { static: bad });
}

/* ── 2. MEASURED: a control's own centre must land on the control ── */
const SURF = [
  ['the post composer', 'acOpenPost()'],
  ['the profile editor', 'openProfileEdit()'],
  ['Marketplace', 'acOpenMarketplace()'],
  ['Wallet', 'acOpenWallet()'],
  ['Settings', 'openSettings()'],
  ['Orders', "acOpenOrders('buyer')"],
  ['Gift cards', 'acOpenGiftCards()'],
  ['Events', 'acOpenEvents()'],
  ['Courses', 'acOpenCourses()'],
  ['Invoices', 'acOpenInvoices()'],
  ['Quotes', 'acOpenQuotes()'],
  ['Sell', 'acOpenSell()'],
  ['Bookings', 'acOpenBookings()'],
  ['Notifications', 'openNotifications()'],
];

const SCAN = () => {
  /* An overlay covers the page, so it OWNS the screen: look inside the topmost open one.
     checkVisibility() says nothing about being COVERED, so an unscoped sweep reports every
     control on the page underneath as stolen -- the trap motion.js already recorded. */
  const open = [...document.querySelectorAll('.overlay')].filter(o => !o.classList.contains('hidden') && getComputedStyle(o).display !== 'none');
  const root = open.length ? open[open.length - 1] : document.body;
  const out = [];
  for (const el of root.querySelectorAll('button,[role=button],a[onclick],input,select,textarea')) {
    if (!el.checkVisibility || !el.checkVisibility()) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) continue;
    if (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) continue;   // off screen or clipped
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit || hit === el || el.contains(hit)) continue;
    if (hit.contains(el)) continue;                                 // an ancestor's own padding, not theft
    let why = '';
    for (const ps of ['::before', '::after']) {
      const s = getComputedStyle(hit, ps);
      if (s.content && s.content !== 'none' && s.position === 'absolute') {
        const hr = hit.getBoundingClientRect();
        const pw = parseFloat(s.width), ph = parseFloat(s.height);
        if (pw > hr.width + 24 || ph > hr.height + 24) why = ps + ' ' + Math.round(pw) + 'x' + Math.round(ph) + ' on a ' + Math.round(hr.width) + 'x' + Math.round(hr.height) + ' host';
      }
    }
    out.push({ control: el.id || el.className.toString().slice(0, 34), stolenBy: hit.id || hit.className.toString().slice(0, 34), why });
  }
  return out;
};

(async () => {
  sourceCheck();
  if (!TOK) { console.log('  (no TOK — skipping the measured half)'); console.log('\n' + pass + ' passed, ' + fail + ' FAILED'); process.exit(fail ? 1 : 0); }

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  for (const theme of ['black', 'light']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.evaluate(([t, th]) => { localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_theme', th); }, [TOK, theme]);
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => typeof S !== 'undefined' && S.user && S.user.id, { timeout: 40000 });
    await p.waitForTimeout(1500);
    for (const [name, fn] of SURF) {
      try { await p.evaluate(f => eval(f), fn); } catch (e) { ok(false, theme + ': ' + name + ' opens', { err: e.message.slice(0, 70) }); continue; }
      await p.waitForTimeout(1300);
      /* TYPE SOMETHING FIRST. An empty composer leaves Post DISABLED, and a disabled
         button hit-tests differently: measured empty, this very bug reported a clean
         result. The state worth checking is the one a person is actually in. */
      if (fn === 'acOpenPost()') { try { await p.fill('#acPostText', 'Hi'); await p.evaluate(() => acPostInput()); await p.waitForTimeout(350); } catch (e) {} }
      let r; try { r = await p.evaluate(SCAN); } catch (e) { ok(false, theme + ': ' + name + ' could be scanned'); continue; }
      ok(r.length === 0, theme + ': every control on ' + name + ' gets its own tap', r.slice(0, 4));
      await p.evaluate(() => { [...document.querySelectorAll('.overlay')].reverse().forEach(o => { try { closeOverlay(o.id, true); } catch (e) {} }); });
      await p.waitForTimeout(450);
    }

    if (theme === 'black') {
      /* SELF-TEST. Put the bug back -- make the x static again -- and the composer check
         must go red. A sweep that cannot fail proves nothing. */
      /* Reproduce the SHIPPED bug exactly: take `.msg-back` out of the position:relative
         list as the page is SERVED, so the page lays out the way it really did. Two
         near-misses to avoid, both of which made this self-test pass on broken code:
         removing the whole tail of the rule leaves a dangling selector list that swallows
         the NEXT rule, and measuring an EMPTY composer leaves Post disabled, which hit-
         tests differently. Remove one class, and type something. */
      /* Its OWN context: a page in the context that already loaded the shell can be served
         from the browser's cache, and a cached navigation never reaches the route. */
      const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await ctx2.addInitScript((t) => { try { localStorage.setItem('atwe_token', t); } catch (e) {} }, TOK);
      const p2 = await ctx2.newPage();
      await p2.route('**/*', async (route) => {
        if (route.request().resourceType() !== 'document') return route.continue();
        const res = await route.fetch();
        let body = await res.text();
        /* Put the page back in the exact state that SHIPPED: none of the five hosts
           positioned, and no overlay on the Post button either. Two near-misses, both of
           which made this self-test pass on broken code: deleting the tail of the rule
           leaves a dangling selector list that swallows the NEXT rule whole, and leaving
           the button positioned (or giving it an overlay of its own) is enough on its own
           to keep it above the escaped one. Rename the tail, drop the button's overlay. */
        body = body.replace('.msg-back,.mkt-cart,.feed-im-btn,.frail-btn,.pf-top-x,.ac-post-btn{position:relative;}', '.zz-not-a-class{position:relative;}')
                   .replace('.mkt-card-save::after,.ac-post-btn::after,', '.mkt-card-save::after,');
        const h = { ...res.headers() }; delete h['content-encoding']; delete h['content-length'];
        route.fulfill({ status: res.status(), headers: h, body });
      });
      await p2.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await p2.waitForFunction(() => typeof S !== 'undefined' && S.user && S.user.id, { timeout: 40000 });
      await p2.waitForTimeout(1500);
      await p2.evaluate(() => acOpenPost());
      await p2.waitForTimeout(900);
      await p2.fill('#acPostText', 'Hi');
      await p2.evaluate(() => acPostInput());
      await p2.waitForTimeout(400);
      const broken = await p2.evaluate(SCAN);
      ok(broken.some((x) => x.control === 'acPostBtn' && x.why),
        'self-test: with the x back to static, Post is stolen by its escaped overlay',
        { found: broken.slice(0, 3) });
      await ctx2.close();
      await p.evaluate(() => { [...document.querySelectorAll('.overlay')].reverse().forEach(o => { try { closeOverlay(o.id, true); } catch (e) {} }); });
    }
    await ctx.close();
  }
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' FAILED' + (fail ? '' : ' — no control is covered by another'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
