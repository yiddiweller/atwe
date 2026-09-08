/* A BUTTON THAT DOES NOTHING IS THE SAME BUG AS A BUTTON THAT ISN'T THERE.
 *
 * Two whole features were found unreachable in one week — a group's Cloud (hidden by a
 * CSS rule) and creating an account (a route that said "sent" when nothing was sent).
 * Both had the same shape: the app believed the door was open and the person found a
 * wall. Every probe in this repo drove screens or called openers by hand; not one asked
 * the mechanical question "does every control in this file actually lead somewhere?"
 *
 * This asks it, three ways, over the WHOLE of index.html rather than over one screen:
 *
 *   1. DEAD HANDLER — every onclick/onchange/oninput/onsubmit in the source names a
 *      function. If that name does not exist in the running page, the control is dead.
 *      Reading the SOURCE (not the DOM) is what makes this cover the ~90% of the app
 *      that is rendered from template literals and only exists once a screen is open.
 *
 *   2. ORPHAN OVERLAY — an .overlay whose id nothing anywhere opens. A surface with no
 *      door is a feature that shipped and cannot be seen.
 *
 *   3. HIDDEN-BY-A-RULE — the reachable.js fingerprint (inline display visible, computed
 *      display none) over many more surfaces than reachable.js walks.
 *
 * Self-test: rename any function referenced by an onclick and check 1 goes red by name.
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const PORT = process.env.PORT || 3262;
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let ok = 0; const fails = [];
const chk = (c, m) => { if (c) ok++; else fails.push(m); };

/* Comments are stripped FIRST. A `//` line explaining the pattern — the app has one
   documenting jsAttr as `onclick="fn(${jsAttr(name)})"` — is not a control, and reading
   it as one reports a dead function on perfectly good code (it did, first run). */
const RAW = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const SRC = RAW.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

/* ── 1. every handler names a function ─────────────────────────────────────
   Handlers are written inline in markup AND inside template literals, in three
   quoting styles (", ', and none inside a `...` template). Pull the leading call
   out of each and keep the bare identifier — `acFoo(1)` -> acFoo. Skip anything
   that starts from an expression rather than a name (this., event., a chained
   call), which is a legitimate pattern this check has nothing to say about. */
const names = new Set();
const HANDLER = /\bon(?:click|change|input|submit|focus|blur|keydown|keyup)\s*=\s*(["'])([\s\S]*?)\1/g;
let m;
while ((m = HANDLER.exec(SRC))) {
  const body = m[2];
  // every `name(` at the start of a statement in this handler
  const CALL = /(?:^|[;{}]\s*|\breturn\s+|&&\s*|\|\|\s*|\?\s*|:\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  let c;
  while ((c = CALL.exec(body))) names.add(c[1]);
}
/* Language + browser built-ins, and the few DOM globals the app calls straight from a
   handler. These are not app functions and their absence would not be a dead control. */
const BUILTIN = new Set(['if','for','while','switch','catch','function','typeof','return','new','this','event','alert','confirm','prompt','setTimeout','setInterval','requestAnimationFrame','parseInt','parseFloat','String','Number','Boolean','Array','Object','JSON','Math','Date','fetch','encodeURIComponent','decodeURIComponent','open','print','eval','void','delete','await','async','try','else','do','in','of','let','const','var','class','super','import','export','yield','throw','case','default','break','continue','with','debugger','instanceof']);

(async () => {
  const tok = fs.readFileSync('/tmp/tok.txt', 'utf8').trim();
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.addInitScript((t) => localStorage.setItem('atwe_token', t), tok);
  await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(5000);
  await p.evaluate(async () => {
    if (typeof API !== 'undefined') { try { await API.req('POST', '/api/onboarding/finish', { intent: 'explore' }); } catch (e) {} }
    document.getElementById('onboardingFlow')?.classList.add('hidden');
    const s = document.querySelector('#introSheet:not(.hidden)');
    if (s && typeof introDismiss === 'function') introDismiss();
  });
  await p.waitForTimeout(600);

  const missing = await p.evaluate((list) => {
    return list.filter((n) => typeof window[n] !== 'function');
  }, [...names].filter((n) => !BUILTIN.has(n)));
  chk(missing.length === 0, `every inline handler names a real function (${missing.length} dead: ${missing.slice(0, 14).join(', ')})`);
  console.log(`   handlers checked: ${names.size} distinct function names`);

  /* ── 2. every overlay has a door ────────────────────────────────────────
     An id that appears ONLY on its own element and nowhere else in the file is a
     surface nothing can open. Count occurrences of the bare id: the definition is
     one, so anything that is opened has at least two. */
  const overlayIds = [];
  const OV = /<div[^>]*\bid=["']([A-Za-z0-9_]+)["'][^>]*\bclass=["'][^"']*\boverlay\b/g;
  const OV2 = /<div[^>]*\bclass=["'][^"']*\boverlay\b[^"']*["'][^>]*\bid=["']([A-Za-z0-9_]+)["']/g;
  while ((m = OV.exec(SRC))) overlayIds.push(m[1]);
  while ((m = OV2.exec(SRC))) overlayIds.push(m[1]);
  const orphans = [...new Set(overlayIds)].filter((id) => {
    const hits = SRC.split(id).length - 1;
    return hits < 2;
  });
  chk(orphans.length === 0, `every overlay has something that opens it (${orphans.length} orphaned: ${orphans.join(', ')})`);
  console.log(`   overlays checked: ${new Set(overlayIds).size}`);

  /* ── 3. nothing the app shows is hidden by a rule, over many surfaces ──── */
  const SCAN = () => {
    const bad = [];
    document.querySelectorAll('[style*="display"]').forEach((el) => {
      const want = el.style.display;
      if (!want || want === 'none') return;
      if (getComputedStyle(el).display !== 'none') return;
      let q = el.parentElement, hiddenParent = false;
      while (q) { if (getComputedStyle(q).display === 'none') { hiddenParent = true; break; } q = q.parentElement; }
      if (hiddenParent) return;
      bad.push((el.id || el.className || el.tagName) + ' wants ' + want);
    });
    return bad;
  };

  const SURFACES = [
    ['Home', "appTab('home')"],
    ['Beam', "appTab('chat')"],
    ['Engine', "appTab('search')"],
    ['Account', "appTab('profile')"],
    ['Atwe AI', "appTab('ai')"],
    ['Notifications', 'acNavNotifs()'],
    ['Settings', 'openSettings()'],
    ['Wallet', 'acOpenWallet()'],
    ['Orders', "acOpenOrders('buyer')"],
    ['Marketplace', 'acOpenMarketplace()'],
    ['Jobs', "acSetJobBoard('jobs')"],
    ['own profile', 'acGoProfile()'],
    ['the composer', 'acOpenPost()'],
    ['Gift cards', 'acOpenGiftCards()'],
    ['Invoices', 'acOpenInvoices()'],
    ['Events', 'acOpenEvents()'],
    ['Courses', 'acOpenCourses()'],
    ['Sell', 'acOpenSell()'],
    ['Cart', 'acOpenCart()'],
    ['Bookings', 'acOpenBookings()'],
  ];
  for (const [name, go] of SURFACES) {
    const ran = await p.evaluate((g) => { try { eval(g); return true; } catch (e) { return String(e); } }, go);
    if (ran !== true) { chk(false, `${name}: its opener threw — ${ran}`); continue; }
    await p.waitForTimeout(1300);
    const bad = await p.evaluate(SCAN);
    chk(bad.length === 0, `${name}: nothing it shows is hidden by a rule (${bad.join(' | ')})`);
    await p.evaluate(() => { try { closeOverlay(document.querySelector('.overlay:not(.hidden)')?.id, true); } catch (e) {} });
    await p.waitForTimeout(250);
  }

  /* AND POSITIVELY: the door that was missing really opens. "Explain with Atwe AI" was a
     complete feature — endpoint, overlay, card — with no menu row anywhere, so nothing
     failed and nobody could reach it. A scan proves an absence; only pressing it proves
     the presence. */
  await p.evaluate(() => { try { appTab('home'); } catch (e) {} });
  await p.waitForTimeout(2200);
  const ex = await p.evaluate(async () => {
    const card = [...document.querySelectorAll('#acFeed .ac-post[data-postid]')]
      .find((c) => (c.querySelector('.ac-post-body')?.textContent || '').trim().length > 5);
    if (!card) return { skip: 'no post with words in the feed' };
    const dots = card.querySelector('.ac-post-more');
    if (!dots) return { skip: 'no ⋯ on the card' };
    dots.click();
    await new Promise((r) => setTimeout(r, 900));
    const btn = document.getElementById('paExplainBtn');
    const shown = !!(btn && btn.offsetParent && getComputedStyle(btn).display !== 'none');
    if (!shown) return { shown: false };
    btn.click();
    await new Promise((r) => setTimeout(r, 1400));
    const o = document.getElementById('acExplainOverlay');
    return { shown: true, opened: !!(o && !o.classList.contains('hidden')) };
  });
  if (ex.skip) console.log('   (explain check skipped: ' + ex.skip + ')');
  else {
    chk(ex.shown, 'a post\'s ⋯ menu offers "Explain with Atwe AI"');
    chk(ex.opened, 'and tapping it really opens the explanation');
  }
  await p.evaluate(() => { try { acCloseExplain(); } catch (e) {} });
  await p.waitForTimeout(400);

  /* THE SAME SCAN AT A DESKTOP WIDTH AND IN LIGHT. A rule inside a @media block or a
     `body.light` block can hide a control at ONE size or ONE theme only — the group
     Cloud happened to be hidden everywhere, which is the easy case. This is the hard one. */
  await ctx.close();
  for (const [label, opts, theme] of [
    ['desktop', { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 }, 'black'],
    ['Light', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, 'light'],
  ]) {
    const c2 = await b.newContext(opts);
    const p2 = await c2.newPage();
    p2.on('pageerror', (e) => errs.push(label + ': ' + String(e)));
    await p2.addInitScript(([t, th]) => { localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_theme', th); }, [tok, theme]);
    await p2.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await p2.waitForTimeout(5000);
    await p2.evaluate(() => {
      document.getElementById('onboardingFlow')?.classList.add('hidden');
      const s2 = document.querySelector('#introSheet:not(.hidden)');
      if (s2 && typeof introDismiss === 'function') introDismiss();
    });
    for (const [name, go] of SURFACES.slice(0, 12)) {
      const ran = await p2.evaluate((g) => { try { eval(g); return true; } catch (e) { return String(e); } }, go);
      if (ran !== true) { chk(false, `${label} ${name}: its opener threw — ${ran}`); continue; }
      await p2.waitForTimeout(1100);
      const bad = await p2.evaluate(SCAN);
      chk(bad.length === 0, `${label} · ${name}: nothing it shows is hidden by a rule (${bad.join(' | ')})`);
      await p2.evaluate(() => { try { closeOverlay(document.querySelector('.overlay:not(.hidden)')?.id, true); } catch (e) {} });
      await p2.waitForTimeout(200);
    }
    await c2.close();
  }

  chk(errs.length === 0, `no JS errors (${errs.slice(0, 3).join(' | ')})`);
  await b.close();
  if (fails.length) console.log('== FAILS ==\n' + fails.map((f) => '  FAIL ' + f).join('\n'));
  console.log(`ok checks: ${ok}`);
  console.log(fails.length ? `${fails.length} FAILED` : 'every control leads somewhere');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
