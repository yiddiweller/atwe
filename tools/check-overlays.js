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
  const page = await browser.newPage();
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  const r = await page.evaluate(() => {
    const all = [...document.querySelectorAll('.overlay')];
    const stray = all.filter((o) => o.parentElement !== document.body).map((o) => ({
      id: o.id || o.className.slice(0, 30),
      parent: o.parentElement.tagName + (o.parentElement.id ? '#' + o.parentElement.id : '.' + String(o.parentElement.className).split(' ')[0]),
    }));
    const screens = [...document.querySelectorAll('.ac-screen')].filter((s) => s.closest('.overlay')).map((s) => s.id);
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
