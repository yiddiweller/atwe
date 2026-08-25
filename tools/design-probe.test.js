#!/usr/bin/env node
/* Proves tools/design-probe.js can actually FAIL.
 *
 * The probe once silently stopped working — its file was overwritten and every
 * run afterwards reported a clean bill of health for a sweep that was not
 * running at all. A check that cannot fail is worse than no check, so this
 * plants a known defect of each kind, confirms the probe finds it, removes it,
 * and confirms the probe goes quiet again.
 *
 * No server, no database, no login — it builds its own tiny page.
 *
 *   node tools/design-probe.test.js
 */
const PROBE = require('./design-probe.js');

const PLANTS = [
  ['contrast', 'grey text on a dark background',
   '<div style="background:#111;padding:20px"><p style="color:#333;font-size:14px">Barely readable warning text</p></div>',
   (r) => r.contrast.some((c) => /Barely readable/.test(c.t))],
  ['targets', 'a 14px icon button',
   '<div style="background:#111;padding:20px"><button aria-label="Tiny" style="width:14px;height:14px;background:#444;border:none">x</button></div>',
   (r) => r.targets.some((t) => t.w <= 20 && t.h <= 20)],
  ['clipped', 'a heading cut off with no ellipsis',
   '<div style="background:#111;padding:20px"><div style="width:60px;overflow:hidden;white-space:nowrap;color:#fff">A headline far too long for its box</div></div>',
   (r) => r.clipped.some((c) => /headline far too long/.test(c.t))],
  ['overflow', 'something wider than the window',
   '<div style="width:3000px;height:8px;background:#222"></div>',
   (r) => r.overflow.length > 0],
  ['unnamed', 'an icon button with no name',
   '<div style="background:#111;padding:20px"><button id="plantnameless" style="width:44px;height:44px;background:#444;border:none"><svg width="20" height="20"></svg></button></div>',
   (r) => r.unnamed.some((u) => /plantnameless/.test(u.t))],
];

(async () => {
  let chromium;
  for (const p of ['playwright-core', 'playwright', '@playwright/test']) {
    try { chromium = require(p).chromium; break; } catch (_) {}
  }
  if (!chromium) { console.log('playwright not installed — skipping (install it to run this check)'); process.exit(0); }
  const exe = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent('<body style="margin:0;background:#000"><div id="host"></div></body>');

  let pass = 0, fail = 0;
  const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
  console.log('does the probe catch a planted defect of each kind?');
  for (const [kind, what, html, found] of PLANTS) {
    await page.evaluate((h) => { document.getElementById('host').innerHTML = h; }, html);
    await page.waitForTimeout(120);
    ok(found(await page.evaluate(PROBE)), kind.padEnd(9) + ' — ' + what);
    await page.evaluate(() => { document.getElementById('host').innerHTML = ''; });
    await page.waitForTimeout(120);
    ok(!found(await page.evaluate(PROBE)), kind.padEnd(9) + ' — and says nothing once it is removed');
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await page.close(); await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
