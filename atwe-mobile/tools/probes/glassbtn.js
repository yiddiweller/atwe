const { chromium } = require(process.env.PW + '/node_modules/playwright-core');
const CHROME = process.env.CHROME
  || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:4399';
const fs = require('fs');
const OUT = process.env.OUT;
(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([t, u]) => {
    localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_user', u);
  }, [process.env.TOK, process.env.UN]);

  const routes = ['/', '/beam', '/engine', '/jobs', '/marketplace', '/events',
                  '/services', '/workers', '/cart', '/notifications', '/post-job',
                  '/add-story', '/compose', '/orders', '/wallet'];
  let fail = 0;
  for (const r of routes) {
    await page.goto(BASE + r, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3200);
    const txt = await page.evaluate(() => document.body.innerText.slice(0, 60));
    const blank = txt.trim().length === 0;
    if (blank) fail++;
    console.log(`  ${blank ? 'BLANK' : 'ok   '} ${r.padEnd(16)} ${txt.replace(/\n/g, ' ').slice(0, 44)}`);
    if (OUT) await page.screenshot({ path: `${OUT}/${r.replace(/\W/g, '_') || 'home'}.png` });
  }
  console.log('page errors:', errs.length);
  errs.slice(0, 6).forEach((e) => console.log('   ', e.slice(0, 120)));
  await b.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
