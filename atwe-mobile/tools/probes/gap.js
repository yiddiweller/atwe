const { chromium } = require(process.env.PW + '/node_modules/playwright-core');
const CHROME = process.env.CHROME
  || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:4399';
/** How much empty space sits between the chrome bar and the first real content. */
const INSET = 59;
(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.evaluate(t => localStorage.setItem('atwe_token', t), process.env.TOK);
  for (const [name, r] of [['home','/'], ['beam','/beam'], ['engine','/engine'],
                           ['alerts','/notifications'], ['account','/profile']]) {
    await p.goto(BASE + r, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(4200);
    const m = await p.evaluate(() => {
      /* the floating bar */
      const bar = [...document.querySelectorAll('div')].find(e => {
        const s = getComputedStyle(e);
        return s.position === 'absolute' && parseInt(s.zIndex || '0') === 20
          && e.getBoundingClientRect().width > 300 && e.getBoundingClientRect().y < 5;
      });
      const barBottom = bar ? Math.round(bar.getBoundingClientRect().bottom) : null;
      /* the topmost thing that is actually drawn in the scroller */
      const scroller = [...document.querySelectorAll('div')].find(e => {
        const s = getComputedStyle(e);
        return (s.overflowY === 'scroll' || s.overflowY === 'auto') && e.getBoundingClientRect().height > 400;
      });
      let firstTop = null;
      if (scroller) {
        for (const e of scroller.querySelectorAll('*')) {
          const b = e.getBoundingClientRect();
          const s = getComputedStyle(e);
          const paints = (e.textContent || '').trim().length
            || s.backgroundColor !== 'rgba(0, 0, 0, 0)' || e.tagName === 'IMG';
          if (b.height > 8 && b.width > 40 && paints && b.top > 0) {
            firstTop = firstTop === null ? b.top : Math.min(firstTop, b.top);
          }
        }
      }
      return { barBottom, firstTop: firstTop === null ? null : Math.round(firstTop) };
    });
    const gap = m.barBottom !== null && m.firstTop !== null ? m.firstTop - m.barBottom : null;
    console.log(`  ${name.padEnd(8)} bar ends ${String(m.barBottom).padStart(4)}   content starts ` +
      `${String(m.firstTop).padStart(4)}   gap ${gap === null ? '?' : gap + 'pt'}`);
  }
  await b.close();
})();
