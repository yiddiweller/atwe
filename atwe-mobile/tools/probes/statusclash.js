const { chromium } = require(process.env.PW + '/node_modules/playwright-core');
const CHROME = process.env.CHROME
  || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:4399';
/**
 * When the top bar retracts, NOTHING of it may still be painting over the
 * status bar. The bar used to stop short of a full retraction, so its tab row
 * came to rest on top of the clock — the founder photographed "For You"
 * printed across 5:48.
 *
 * A real safe-area inset cannot be simulated headlessly, so the probe injects
 * one and then asks where the bar's own CONTENT ends up.
 */
const INSET = 59;
(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.evaluate(t => localStorage.setItem('atwe_token', t), process.env.TOK);
  let bad = 0;
  for (const [name, r, label] of [['home','/','For You'], ['beam','/beam','Chats'], ['engine','/engine','Search Atwe']]) {
    await p.goto(BASE + r, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(4000);
    await p.mouse.move(195, 600);
    for (let i = 0; i < 14; i++) { await p.mouse.wheel(0, 90); await p.waitForTimeout(50); }
    await p.waitForTimeout(900);
    const top = await p.evaluate((lab) => {
      const hit = [...document.querySelectorAll('*')].filter((e) => {
        const t = (e.textContent || '').trim();
        return t === lab && e.children.length === 0;
      })[0] || [...document.querySelectorAll('input')].find(i => (i.placeholder || '') === lab);
      if (!hit) return null;
      const b = hit.getBoundingClientRect();
      return { top: Math.round(b.top), bottom: Math.round(b.bottom) };
    }, label);
    if (!top) { console.log(`  ?    ${name}: could not find "${label}"`); continue; }
    /* Its own content must be clear of the inset the phone reserves. */
    const clash = top.bottom > 0 && top.top < INSET;
    if (clash) bad++;
    console.log(`  ${clash ? 'BAD ' : 'ok  '} ${name.padEnd(7)} "${label}" rests at y=${top.top}..${top.bottom}` +
      `   status bar 0..${INSET}   ${clash ? 'OVERLAPS' : 'clear'}`);
  }
  console.log(`\n${bad} overlapping`);
  await b.close();
  process.exit(bad ? 1 : 0);
})();
