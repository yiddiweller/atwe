const { chromium } = require(process.env.PW + '/node_modules/playwright-core');
const CHROME = process.env.CHROME
  || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:4399';
/** No + in any top bar, and nothing it used to reach is stranded. */
(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.evaluate(t => localStorage.setItem('atwe_token', t), process.env.TOK);

  for (const [world, r, want] of [
    ['home', '/', ['New post','New story','Sell an item','Post a job','Saved','Settings','Help & feedback']],
    ['beam', '/beam', ['New chat']],
  ]) {
    await p.goto(BASE + r, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(4200);
    const plus = await p.evaluate(() =>
      [...document.querySelectorAll('[aria-label="New"]')].filter(e => e.getBoundingClientRect().y < 70).length);
    const more = await p.evaluate(() => {
      const e = [...document.querySelectorAll('[aria-label="More"]')].find(x => x.getBoundingClientRect().y < 70);
      if (!e) return null; const b = e.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    if (!more) { console.log(`  BAD ${world}: no ... button`); continue; }
    await p.mouse.click(more.x, more.y);
    await p.waitForTimeout(800);
    const rows = await p.evaluate(() =>
      [...document.querySelectorAll('[role=button]')].map(e => e.getAttribute('aria-label')));
    const missing = want.filter(w => !rows.includes(w));
    console.log(`  ${plus === 0 && !missing.length ? 'ok ' : 'BAD'} ${world.padEnd(5)} ` +
      `+ in top bar: ${plus}   reachable from ...: ${want.length - missing.length}/${want.length}` +
      (missing.length ? `   MISSING: ${missing.join(', ')}` : ''));
  }
  console.log('errors:', errs.length);
  await b.close();
})();
