const { chromium } = require(process.env.PW + '/node_modules/playwright-core');
const CHROME = process.env.CHROME
  || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:4399';
const WANT = ['Home','Beam','Engine','Alerts','Account','Collections','Communities',
              'Circles','Marketplace','Settings','Help & feedback','New post','Your account'];
(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.evaluate(([t,th]) => { localStorage.setItem('atwe_token',t); localStorage.setItem('atwe_theme',th); },
    [process.env.TOK, process.env.THEME || 'black']);
  for (const [name, r] of [['home','/'], ['beam','/beam']]) {
    await p.goto(BASE + r, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(4200);
    const at = await p.evaluate(() => {
      /* Pick the VISIBLE one. A tab navigator keeps its sibling screens
         mounted, so Home's menu button is still in the tree with zero bounds at
         0,0 when Beam is showing — an earlier version of this probe clicked
         that and reported Beam's drawer as broken three times. */
      const e = [...document.querySelectorAll('[aria-label="Menu"]')]
        .find(x => { const b = x.getBoundingClientRect(); return b.width > 0 && b.y < 140; });
      if (!e) return null; const b = e.getBoundingClientRect();
      return { x: b.x + b.width/2, y: b.y + b.height/2, left: Math.round(b.x) };
    });
    if (!at) { console.log(`  BAD ${name}: no menu button`); continue; }
    await p.mouse.click(at.x, at.y);
    await p.waitForTimeout(900);
    const rows = await p.evaluate(() =>
      [...document.querySelectorAll('[role=button]')].map(e => e.getAttribute('aria-label')).filter(Boolean));
    const missing = WANT.filter(w => !rows.includes(w));
    console.log(`  ${missing.length ? 'BAD ' : 'ok  '} ${name.padEnd(5)} menu at x=${at.left}  ` +
      `rows ${WANT.length - missing.length}/${WANT.length}` + (missing.length ? `  MISSING: ${missing}` : ''));
    if (process.env.OUT) await p.screenshot({ path: `${process.env.OUT}/drawer-${name}.png` });
  }
  console.log('errors:', errs.length); errs.slice(0,3).forEach(e => console.log('  !', e.slice(0,110)));
  await b.close();
})();
