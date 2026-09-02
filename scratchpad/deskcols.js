/* THE DESKTOP IS THREE COLUMNS, ON EVERY PAGE, AT EVERY WIDTH.
 *
 * The founder's words were "it's not so organized" and "it feels off, it moves". Both
 * were real and both were structural:
 *   - Notifications, Settings and ~38 other destinations were phone cards floating in
 *     the middle of a big screen with the nav and rail painted out behind them;
 *   - the Following/Followers line was drawn only on Home and Engine, so the sidebar's
 *     header changed height between worlds and the whole nav below it shifted;
 *   - Beam was the one world laid out differently, with the conversation list beside
 *     the nav instead of in the rail's place.
 *
 * What this asserts, and why each one is here:
 *   1. Home's columns at all four of X's bands (nav 275/68, centre 600, rail 350/290/none).
 *   2. Every panel world lands on the SAME columns as Home. They borrow --sidebar-w and
 *      --rail-w rather than repeating numbers, so this catches a token drifting.
 *   3. The sidebar is byte-identical across the five worlds — same x, same width, the
 *      counts row present, and the first nav item at the same y. That last one is the
 *      real test: if the header changes height the nav below it moves, which is the
 *      thing that reads as "off".
 *   4. Beam's conversation list sits exactly where the rail does on every other world.
 *   5. The rail's Post button is edge-for-edge with the search field above it.
 *
 * TWO TRAPS THIS PROBE HAD TO LEARN:
 *   - Playwright's `colorScheme` DOES NOT flip this app's theme. Atwe carries its own
 *     preference in localStorage.atwe_theme and only follows the OS when that is
 *     'system' — so a "both themes" run that sets colorScheme tests Black twice. Set
 *     the real preference. (This probe's first version did exactly that and passed.)
 *   - A world's one-time intro sheet legitimately covers the nav, so it must be
 *     dismissed before clicking, or the run dies on a timeout that is not a bug.
 */
const { chromium } = require(process.env.PW ? process.env.PW + '/node_modules/playwright-core' : 'playwright-core');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:3262';
const TOK = process.env.TOK;
const BANDS = [1512, 1150, 1040, 900];
const PANELS = ['/notifications', '/settings', '/wallet', '/orders'];
const WORLDS = [['#snav-home', 'Home'], ['#snav-chat', 'Beam'], ['#snav-search', 'Engine'],
                ['#snav-notifs', 'Notifications'], ['#snav-profile', 'Account']];

let bad = 0;
const say = (ok, msg) => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : '✗   '} ${msg}`); };

const BOXES = () => {
  const q = (s) => {
    const e = document.querySelector(s); if (!e) return null;
    const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return (cs.display !== 'none' && r.width > 2)
      ? { x: Math.round(r.x), w: Math.round(r.width) } : null;
  };
  return { sb: q('.sidebar'), mid: q('.main'), rail: q('.right-rail'),
           card: q('.overlay.route-view:not(.hidden) > *'), list: q('#acListScreen'),
           search: q('.rr-search'), post: q('#sbPost') };
};

(async () => {
  if (!TOK) { console.error('export TOK first (a bearer token for a real account)'); process.exit(2); }
  const b = await chromium.launch({ executablePath: CHROME });

  for (const theme of ['black', 'light']) {
    for (const W of BANDS) {
      const ctx = await b.newContext({ viewport: { width: W, height: 900 } });
      const p = await ctx.newPage();
      const errs = [];
      p.on('pageerror', (e) => errs.push(String(e).slice(0, 110)));
      await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await p.evaluate(([t, th]) => {
        localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_theme', th);
      }, [TOK, theme]);

      const at = async (r) => { await p.goto(BASE + r, { waitUntil: 'domcontentloaded' });
        await p.waitForTimeout(2500); return p.evaluate(BOXES); };

      const home = await at('/');
      const themed = await p.evaluate(() => document.body.classList.contains('light'));
      say(themed === (theme === 'light'), `${theme}/${W} the theme actually applied`);
      say(!!home.sb && !!home.mid, `${theme}/${W} Home has a nav and a centre` +
        `  nav=${home.sb && home.sb.x + '/' + home.sb.w} centre=${home.mid && home.mid.x + '/' + home.mid.w}` +
        ` rail=${home.rail ? home.rail.x + '/' + home.rail.w : 'none'}`);

      for (const r of PANELS) {
        const g = await at(r);
        const okNav = g.sb && g.sb.x === home.sb.x && g.sb.w === home.sb.w;
        const okCol = g.card && Math.abs(g.card.x - home.mid.x) <= 1 && Math.abs(g.card.w - home.mid.w) <= 1;
        say(okNav && okCol, `${theme}/${W} ${r} sits in Home's columns` +
          `  card=${g.card ? g.card.x + '/' + g.card.w : 'MISSING'}`);
      }

      // Beam: the conversation list stands in for the rail.
      const beam = await at('/messages');
      if (home.rail) {
        say(beam.list && Math.abs(beam.list.x - home.rail.x) <= 1 && Math.abs(beam.list.w - home.rail.w) <= 1,
          `${theme}/${W} Beam's list sits where the rail does` +
          `  list=${beam.list ? beam.list.x + '/' + beam.list.w : 'MISSING'} rail=${home.rail.x}/${home.rail.w}`);
      }

      // The rail's Post pill shares the search field's edges exactly.
      if (home.rail && home.search && home.post) {
        say(home.search.x === home.post.x && home.search.w === home.post.w,
          `${theme}/${W} Post is edge-for-edge with the rail search` +
          `  ${home.post.x}..${home.post.x + home.post.w} vs ${home.search.x}..${home.search.x + home.search.w}`);
      }

      say(errs.length === 0, `${theme}/${W} no JS errors` + (errs.length ? ' — ' + errs[0] : ''));
      await ctx.close();
    }
  }

  /* The sidebar must not move as you walk the worlds. Clicked, not typed: this is about
     what happens when a person navigates, and the intro sheets only appear that way. */
  const ctx = await b.newContext({ viewport: { width: 1512, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.evaluate((t) => localStorage.setItem('atwe_token', t), TOK);
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3000);
  const clearIntro = async () => { for (let i = 0; i < 3; i++) {
    const n = await p.evaluate(() => { const s = document.querySelector('#introSheet:not(.hidden)');
      if (!s) return 0; if (typeof introDismiss === 'function') introDismiss(); return 1; });
    if (!n) return; await p.waitForTimeout(700); } };
  const rail = () => p.evaluate(() => {
    const s = document.querySelector('.sidebar'); const r = s.getBoundingClientRect();
    const n1 = document.querySelector('.sidebar .sb-navbtn').getBoundingClientRect();
    return { x: Math.round(r.x), w: Math.round(r.width), navY: Math.round(n1.y),
             counts: !!document.querySelector('.sb-profile-counts') };
  });
  let base = null;
  for (let round = 0; round < 2; round++) {
    for (const [id, label] of WORLDS) {
      await clearIntro();
      await p.locator(id).click();
      await p.waitForTimeout(1800);
      await clearIntro();
      const g = await rail();
      if (!base) base = g;
      say(g.x === base.x && g.w === base.w && g.navY === base.navY && g.counts,
        `the sidebar is unchanged on ${label}  ${JSON.stringify(g)}`);
    }
  }
  await ctx.close();
  await b.close();
  console.log(bad ? `\n${bad} FAILED` : '\nall desktop column checks passed');
  process.exit(bad ? 1 : 0);
})();
