const { chromium } = require(process.env.PW + '/node_modules/playwright-core');
const CHROME = process.env.CHROME
  || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:4399';
/**
 * Menu alignment: a card's right edge must land on its BUTTON's right edge.
 *
 * The buttons are picked BY POSITION, not by `.first()`. A post card's ⋯ also
 * carries aria-label "More", and since the world files now render their list
 * BEFORE the chrome bar (so the tab bar can find a scroller to minimise
 * against), a post's ⋯ comes first in the DOM — an earlier version of this
 * probe spent three runs testing a post's menu and reporting the top bar's as
 * broken.
 */
(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.evaluate(t => localStorage.setItem('atwe_token', t), process.env.TOK);

  let bad = 0;
  /* No 'New' — the top-bar + was removed at the founder's request and its
     destinations moved into the ... menu. `noplus.js` is what guards that. */
  for (const label of ['More', 'Your account']) {
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(4200);
    const at = await p.evaluate((lab) => {
      const e = [...document.querySelectorAll(`[aria-label="${lab}"]`)]
        .find(x => x.getBoundingClientRect().y < 70);      // in the top bar
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2,
               right: Math.round(r.right), bottom: Math.round(r.bottom) };
    }, label);
    if (!at) { console.log(`  BAD  ${label}: not in the top bar`); bad++; continue; }
    await p.mouse.click(at.x, at.y);
    await p.waitForTimeout(800);
    const card = await p.evaluate(() => {
      const scrim = document.querySelector('[aria-label="Close menu"]');
      if (!scrim) return null;
      const field = scrim.parentElement;
      const card = [...field.children].find(e => e !== scrim);
      const r = card.getBoundingClientRect();
      return { right: Math.round(r.right), top: Math.round(r.top), w: Math.round(r.width) };
    });
    if (!card) { console.log(`  BAD  ${label}: menu did not open`); bad++; continue; }
    const dx = card.right - at.right;
    const gap = card.top - at.bottom;
    const ok = Math.abs(dx) <= 2 && Math.abs(gap - 8) <= 2;
    if (!ok) bad++;
    console.log(`  ${ok ? 'ok  ' : 'BAD '} ${label.padEnd(13)} right delta=${dx}  gap=${gap}  width=${card.w}`);
  }
  console.log(`\n${bad} bad, ${errs.length} errors`);
  await b.close();
  process.exit(bad ? 1 : 0);
})();
