/* Measures the composer bar through its real states at the founder's own phone size (375). */
const { chromium } = require(process.env.PW + '/node_modules/playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await b.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const p = await ctx.newPage();
  await p.goto('http://localhost:3262/', { waitUntil: 'domcontentloaded' });
  await p.evaluate((t) => { localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_theme','black'); }, process.env.TOK);
  await p.goto('http://localhost:3262/messages', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(5200);
  await p.evaluate(() => { const s=document.querySelector('#introSheet:not(.hidden)'); if(s&&typeof introDismiss==='function') introDismiss(); });
  await p.locator('#acListScreen .ac-item[data-uid]').first().click({ timeout: 25000 });
  await p.waitForSelector('#acThreadScreen:not(.hidden)', { timeout: 25000 });
  await p.waitForTimeout(1600);
  const M = async (label, text) => {
    await p.fill('#acInput', text);
    await p.evaluate(() => acAutosize());
    await p.waitForTimeout(420);
    const r = await p.evaluate(() => {
      const bar = document.querySelector('#acThreadScreen .msg-inbox');
      const B = bar.getBoundingClientRect();
      const ta = document.getElementById('acInput'); const T = ta.getBoundingClientRect();
      const cs = getComputedStyle(bar); const cta = getComputedStyle(ta);
      const btn = [...bar.querySelectorAll('.msg-send,.ac-mic')].find(n=>n.getBoundingClientRect().width>1);
      const S = btn.getBoundingClientRect();
      return { h:+B.height.toFixed(1), off:bar.offsetHeight, cli:bar.clientHeight, scr:bar.scrollHeight, w:Math.round(B.width), left:Math.round(B.left),
        right:Math.round(window.innerWidth-B.right), r:cs.borderTopLeftRadius,
        ml:bar.classList.contains('multiline'),
        taH:+T.height.toFixed(1), taMin:cta.minHeight, taPad:cta.padding,
        btnTop:+(S.top-B.top).toFixed(1), btnBot:+(B.bottom-S.bottom).toFixed(1),
        pad:cs.padding,minH:cs.minHeight,rowGap:cs.rowGap,bd:cs.borderTopWidth+'/'+cs.borderBottomWidth,box:cs.boxSizing,ai:cs.alignItems,kids:[...bar.children].map(n=>(()=>{const c=getComputedStyle(n),r=n.getBoundingClientRect();return (n.className||n.tagName)+':'+r.height.toFixed(1)+'+mt'+c.marginTop+'+mb'+c.marginBottom+' d='+c.display;})()) };
    });
    console.log(label.padEnd(16), JSON.stringify(r));
  };
  await M('EMPTY','');
  await M('ONE CHAR','H');
  await M('SHORT','Hi there');
  await M('FULL ONE LINE','i thnk we shud me');
  await M('WRAPS','i thnk we shud meet tomorow at 3 pm ok and then we can go over the whole plan');
  await b.close();
})().catch(e=>{console.error(e.message);process.exit(1);});
