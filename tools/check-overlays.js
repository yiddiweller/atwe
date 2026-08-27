#!/usr/bin/env node
/* Every .overlay in public/index.html must be a direct child of <body>.
 *
 * One missing </div> silently nests every overlay after it inside whichever
 * container was left open. When that container is hidden (a call overlay, say),
 * the buttons inside those overlays stop working with NO console error and NO
 * clue in a screenshot — the surfaces simply never appear. That happened once
 * (build 1694) and trapped 353 overlays: notifications, settings, wallet,
 * orders, marketplace, the lot.
 *
 * This loads the file with a real HTML parser, so it sees exactly the nesting
 * the browser will build. No server and no login needed.
 *
 *   node tools/check-overlays.js
 *
 * Run it after ANY edit that adds or removes markup in index.html.
 */
const path = require('path');
const FILE = 'file://' + path.join(__dirname, '..', 'public', 'index.html');

(async () => {
  let chromium;
  for (const p of ['playwright-core', 'playwright', '@playwright/test']) {
    try { chromium = require(p).chromium; break; } catch (_) {}
  }
  if (!chromium) { console.log('playwright not installed — skipping (install it to run this check)'); process.exit(0); }
  const exe = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  /* SCRIPTS OFF. This tool checks how the file PARSES, and nothing else — but the app's
     own boot code moves elements around (showOverlay reparents an overlay to <body>,
     acShow swaps screens), so reading the DOM after scripts ran made the result depend on
     how far boot happened to get. It reported 17 screens "trapped" on a file whose markup
     was byte-identical to a passing one, which is a false alarm that would block every
     future edit. With JS disabled the DOM is exactly what the parser built. */
  const page = await browser.newPage({ javaScriptEnabled: false });
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  const r = await page.evaluate(() => {
    const all = [...document.querySelectorAll('.overlay')];
    const stray = all.filter((o) => o.parentElement !== document.body).map((o) => ({
      id: o.id || o.className.slice(0, 30),
      parent: o.parentElement.tagName + (o.parentElement.id ? '#' + o.parentElement.id : '.' + String(o.parentElement.className).split(' ')[0]),
    }));
    /* AtChat's screens LIVE inside #atchatOverlay — that is the real structure, not a
       trap. This check exists to catch a screen swallowed by an UNRELATED overlay after
       a lost </div> (build 1694 put 353 of them inside #groupCallOverlay), so it asks
       which overlay, not whether. It used to flag all 17 of AtChat's own screens and
       only ever passed because the app's boot JS moved them before the check looked —
       with scripts off it failed on a file with byte-identical markup to a passing one. */
    const HOME_OVERLAY = 'atchatOverlay';
    const screens = [...document.querySelectorAll('.ac-screen')]
      .filter((s) => { const o = s.closest('.overlay'); return o && o.id !== HOME_OVERLAY; })
      .map((s) => s.id + ' (in #' + (s.closest('.overlay').id || '?') + ')');
    return { total: all.length, stray, screens };
  });
  await browser.close();

  console.log(`checked ${r.total} overlays`);
  let bad = false;
  if (r.stray.length) {
    bad = true;
    console.log(`\n${r.stray.length} overlay(s) are NOT a direct child of <body> — a closing </div> is missing above the first one:`);
    r.stray.slice(0, 15).forEach((s) => console.log(`  ${s.id.padEnd(28)} nested inside ${s.parent}`));
    if (r.stray.length > 15) console.log(`  …and ${r.stray.length - 15} more`);
  }
  if (r.screens.length) {
    bad = true;
    console.log(`\n${r.screens.length} app screen(s) are trapped inside an overlay: ${r.screens.slice(0, 10).join(', ')}`);
  }
  if (bad) process.exit(1);
  console.log('every overlay is a top-level child of <body> — good');
})().catch((e) => { console.error(e); process.exit(2); });
