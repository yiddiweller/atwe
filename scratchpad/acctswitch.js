/* THE ACCOUNT SWITCHER on the Account page (owner, modelled on Gmail's).
 *
 * The hero's round chevron opens a panel IN THE SCROLL FLOW, so the wallet card and every
 * section below genuinely move down — that pushing-apart IS the behaviour being copied,
 * and an overlay would not do it. It lists the other signed-in accounts and "Add another
 * account", which used to sit at the bottom of the page above Log out.
 *
 * Nothing underneath is new: `Accounts`, `switchAccount` and `addExistingAccount` already
 * existed. What this asserts is the door, the motion, and that nothing was lost by moving
 * the old row — including that it is still findable from app-wide search.
 */
const { chromium } = require(process.env.PW ? process.env.PW + '/node_modules/playwright-core' : 'playwright-core');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:3262';

(async () => {
  if (!process.env.TOK) { console.error('export TOK first'); process.exit(2); }
  const b = await chromium.launch({ executablePath: CHROME });
  let bad = 0;
  const say = (ok, m) => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : '✗   '} ${m}`); };

  /* Two extra signed-in accounts, so the panel has something to list. They are local
     sessions by design — that is how the multi-account store already works. */
  const open = async (w, theme, mob) => {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 }, isMobile: mob, hasTouch: mob, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.evaluate(([t, th]) => { localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_theme', th);
      localStorage.setItem('atwe_accounts', JSON.stringify([
        { token: 'x1', id: 999001, name: 'Atwe Studio', username: 'atwestudio', avatar: null },
        { token: 'x2', id: 999002, name: 'Second You', username: 'second', avatar: null }])); }, [process.env.TOK, theme]);
    await p.goto(BASE + '/me', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(5200);
    await p.evaluate(() => { const s = document.querySelector('#introSheet:not(.hidden)'); if (s && typeof introDismiss === 'function') introDismiss(); });
    await p.waitForTimeout(600);
    return { ctx, p };
  };

  for (const [w, theme, mob, label] of [[390, 'black', true, 'phone'], [1440, 'black', false, 'desktop'], [390, 'light', true, 'phone/light']]) {
    const { ctx, p } = await open(w, theme, mob);
    const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));

    /* 1. The old row is gone from the bottom of the page. */
    const foot = await p.evaluate(() => [...document.querySelectorAll('.me-row .me-lbl')].map((n) => n.textContent.trim()));
    say(!foot.includes('Add account'), `${label}: "Add account" no longer sits above Log out`);
    say(foot.includes('Log out'), `${label}: and Log out is still there`);

    /* 2. The hero's small chevron is now a round button. */
    const btn = await p.evaluate(() => { const n = document.getElementById('meHeroSwitch'); if (!n) return null;
      const r = n.getBoundingClientRect(), cs = getComputedStyle(n);
      return { w: Math.round(r.width), h: Math.round(r.height), radius: cs.borderRadius, bg: cs.backgroundColor }; });
    say(btn && btn.w === btn.h && /50%|999/.test(btn.radius), `${label}: the hero has a round switcher button (${btn ? btn.w + 'x' + btn.h + ' ' + btn.radius : 'MISSING'})`);
    say(await p.evaluate(() => document.querySelectorAll('.me-hero button').length === 2),
      `${label}: and it is a SEPARATE control from the one that opens the profile`);

    /* 3. Opening it pushes the page down — the Gmail behaviour, not an overlay. */
    const before = await p.evaluate(() => Math.round(document.querySelector('.me-wallet').getBoundingClientRect().top));
    await p.click('#meHeroSwitch');
    await p.waitForTimeout(700);
    const after = await p.evaluate(() => {
      const box = document.getElementById('meSwitch');
      return { wallet: Math.round(document.querySelector('.me-wallet').getBoundingClientRect().top),
        h: Math.round(box.getBoundingClientRect().height),
        rows: box.querySelectorAll('.me-acct').length,
        add: !!box.querySelector('.me-acct-add-ic'),
        open: document.getElementById('meHero').classList.contains('open'),
        expanded: document.getElementById('meHeroSwitch').getAttribute('aria-expanded'),
        ava: Math.round(document.querySelector('.me-hero-ava .user-avatar').getBoundingClientRect().width),
        /* An overlay would sit ON TOP of the wallet; this must be a real block in the flow. */
        inFlow: getComputedStyle(box).position === 'static' };
    });
    say(after.wallet > before + 100, `${label}: everything below moves down instead of being covered (${before} → ${after.wallet})`);
    say(after.inFlow, `${label}: because the panel is a real block in the page, not an overlay`);
    say(after.rows === 3 && after.add, `${label}: it lists the other accounts and "Add another account" (${after.rows} rows)`);
    say(after.open && after.expanded === 'true', `${label}: the chevron reads as open, for a screen reader too`);
    say(after.ava > 62, `${label}: and the account bubble grows (${after.ava}px)`);

    /* 4. Closing it puts the page back exactly. */
    await p.click('#meHeroSwitch');
    await p.waitForTimeout(700);
    const closed = await p.evaluate(() => ({
      wallet: Math.round(document.querySelector('.me-wallet').getBoundingClientRect().top),
      h: Math.round(document.getElementById('meSwitch').getBoundingClientRect().height),
      expanded: document.getElementById('meHeroSwitch').getAttribute('aria-expanded') }));
    say(closed.wallet === before && closed.h === 0 && closed.expanded === 'false',
      `${label}: closing puts the page back exactly (${closed.wallet} vs ${before}, panel ${closed.h}px)`);

    /* 5. It is still findable by name from a search bar — the thing that got lost the last
          time a row left this page. */
    if (label === 'phone') {
      const found = await p.evaluate(() => acFindPlaces('add account', 40).map((x) => x.label));
      say(found.includes('Add account'), `search still finds "Add account" (${found.slice(0, 3).join(', ')})`);
      const wired = await p.evaluate(() => {
        const it = acFindPlaces('add account', 40).find((x) => x.label === 'Add account');
        const fn = (it && it.run || '').match(/^([A-Za-z0-9_$]+)\(/);
        return !!(fn && typeof window[fn[1]] === 'function');
      });
      say(wired, 'and what it runs is a function that really exists');
    }

    say(errs.length === 0, `${label}: no JS errors${errs.length ? ' — ' + errs[0] : ''}`);
    await ctx.close();
  }

  await b.close();
  console.log(bad ? `\n${bad} FAILED` : '\nthe accounts open out of the hero, and the page makes room for them');
  process.exit(bad ? 1 : 0);
})();
