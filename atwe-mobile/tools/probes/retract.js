const { chromium } = require(process.env.PW + '/node_modules/playwright-core');
const CHROME = process.env.CHROME
  || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:4399';
(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.evaluate(t => localStorage.setItem('atwe_token', t), process.env.TOK);

  for (const [name, r] of [['home','/'],['beam','/beam'],['engine','/engine'],['alerts','/notifications']]) {
    await p.goto(BASE + r, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(4000);
    // the bar is the topmost absolutely-positioned block with children
    const read = () => p.evaluate(() => {
      const cands = [...document.querySelectorAll('div')].filter(e => {
        const s = getComputedStyle(e);
        return s.position === 'absolute' && parseInt(s.zIndex || '0') >= 20
            && e.getBoundingClientRect().width > 300;
      });
      const e = cands[0]; if (!e) return null;
      const b = e.getBoundingClientRect();
      return Math.round(b.y);
    });
    const before = await read();
    await p.mouse.move(195, 600);
    for (let i = 0; i < 12; i++) { await p.mouse.wheel(0, 90); await p.waitForTimeout(60); }
    await p.waitForTimeout(700);
    const during = await read();
    for (let i = 0; i < 14; i++) { await p.mouse.wheel(0, -90); await p.waitForTimeout(60); }
    await p.waitForTimeout(700);
    const after = await read();
    const moved = before !== null && during !== null && (before - during) > 20;
    const back = after !== null && Math.abs(after - before) <= 3;
    console.log(`  ${moved && back ? 'ok  ' : 'BAD '} ${name.padEnd(8)} ${before} -> ${during} -> ${after}`);
  }
  await b.close();
})();
