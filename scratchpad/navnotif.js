/* AN UNREAD NOTIFICATION TURNS THE BELL BLUE — it does not pin a dot to its corner.
 *
 * The owner's call (build 1795): Beam's tab already says "something new" by painting its
 * own icon accent-blue, and two different languages for the same idea in one 5-icon bar is
 * one too many. So `acSetNavNotif` — Beam's own mechanism — now drives the bell too, and
 * the two little corner badges (#bnavNotifBadge, #sbNotifBadge) are retired.
 *
 * The COUNT is not lost: it still shows on the Notifications ROW in the Account/Settings
 * lists (#notifBadge), which is a list item with room for a number rather than a 34px icon.
 *
 * Measured on the icon's own MASK, not on the tab's colour: the nav artwork is a PNG mask
 * painted with `background`, so `getComputedStyle(tab).color` reports white whatever the
 * state is — an earlier version of this check read exactly that and could never have failed.
 */
const { chromium } = require(process.env.PW ? process.env.PW + '/node_modules/playwright-core' : 'playwright-core');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:3262';

(async () => {
  if (!process.env.TOK) { console.error('export TOK first'); process.exit(2); }
  const b = await chromium.launch({ executablePath: CHROME });
  let bad = 0;
  const say = (ok, m) => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : '✗   '} ${m}`); };

  for (const theme of ['black', 'light']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.evaluate(([t, th]) => { localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_theme', th); },
      [process.env.TOK, theme]);
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(4200);
    await p.evaluate(() => { const s = document.querySelector('#introSheet:not(.hidden)');
      if (s && typeof introDismiss === 'function') introDismiss(); });

    const read = () => p.evaluate(() => {
      const ink = (id) => { const e = document.getElementById(id); if (!e) return null;
        const m = e.querySelector('.bn-ico .nv-off'); return m ? getComputedStyle(m).backgroundColor : null; };
      const shown = (id) => { const e = document.getElementById(id);
        return !!e && !e.classList.contains('hidden') && e.getBoundingClientRect().width > 0; };
      /* Compared against ACCOUNT, not Home: Home is the tab we are standing on, and an
         active tab is painted differently (visibly so in Light). The question here is
         "does the bell differ from a quiet tab", so the reference must be a quiet one. */
      return { bell: ink('bnav-notifs'), beam: ink('bnav-chat'), home: ink('bnav-profile'),
        accent: getComputedStyle(document.body).getPropertyValue('--accent').trim(),
        navBadge: shown('bnavNotifBadge') || shown('sbNotifBadge'),
        rowBadge: (() => { const e = document.getElementById('notifBadge');
          return e ? { hidden: e.classList.contains('hidden'), text: e.textContent } : null; })() };
    });

    await p.evaluate(() => { setNotifBadge(0); acSetNavNotif('chat', false); });
    await p.waitForTimeout(250);
    const off = await read();
    say(off.bell === off.home, `${theme}: with nothing unread the bell is the same ink as any other quiet tab (${off.bell})`);
    say(!off.navBadge, `${theme}: and no badge is pinned to it`);

    await p.evaluate(() => { setNotifBadge(3); acSetNavNotif('chat', true); });
    await p.waitForTimeout(250);
    const on = await read();
    say(on.bell !== off.bell && on.bell === on.beam,
      `${theme}: an unread notification paints the bell exactly like Beam's tab (${on.bell} / ${on.beam})`);
    say(on.bell !== on.home, `${theme}: and unlike a tab with nothing new (${on.home})`);
    say(!on.navBadge, `${theme}: still no corner dot on the icon`);
    say(on.rowBadge && !on.rowBadge.hidden && on.rowBadge.text === '3',
      `${theme}: the COUNT survives on the Notifications row ("${on.rowBadge && on.rowBadge.text}")`);

    /* 99+ is the cap on that row — a four-digit number would blow the pill open. */
    const big = await p.evaluate(async () => { setNotifBadge(1204); await new Promise(r => setTimeout(r, 150));
      return document.getElementById('notifBadge').textContent; });
    say(big === '99+', `${theme}: and is capped at 99+ ("${big}")`);
    await ctx.close();
  }

  await b.close();
  console.log(bad ? `\n${bad} FAILED` : '\nthe bell turns blue, and keeps its count where there is room for it');
  process.exit(bad ? 1 : 0);
})();
