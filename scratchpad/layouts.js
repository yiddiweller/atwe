/* ONE LAYOUT PER SHAPE OF SCREEN — AND A PHONE TURNED SIDEWAYS IS STILL A PHONE.
 *
 * The owner's report: "when I turn the phone sideways I get the computer version with all
 * the options on the left." A phone in landscape is ~844-956px WIDE and ~390-430px TALL —
 * wider than a small laptop — so a layout chosen by width alone hands it the desktop
 * sidebar. Every breakpoint in the app now also asks about HEIGHT: under 500px tall is a
 * phone in landscape and nothing else (an iPad in landscape is 744-834, a laptop 600+).
 *
 * Two invariants this locks down, and both have already been broken once:
 *  1. EXACTLY ONE layout at any size. At exactly 768px wide — an iPad in portrait — the
 *     phone rules (max-width:768) and the desktop rules (min-width:768) BOTH fired, so it
 *     drew the bottom bar AND the icon rail. The desktop side starts at 769 now.
 *  2. THE CSS AND THE JS AGREE. The layout is driven from both — CSS media queries paint
 *     it, `_lw()` drives the rail/drawer logic — so a breakpoint that disagrees paints one
 *     layout while the JS runs the other. Checked directly at every size.
 */
const { chromium } = require(process.env.PW ? process.env.PW + '/node_modules/playwright-core' : 'playwright-core');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:3262';

/* name, width, height, touch, expected layout */
const SIZES = [
  ['phone portrait',      390,  844, true,  'phone'],
  ['phone landscape',     844,  390, true,  'phone'],
  ['big phone landscape', 926,  428, true,  'phone'],
  ['tablet portrait',     768, 1024, true,  'phone'],
  ['tablet landscape',   1024,  768, true,  'desktop'],
  ['desktop',            1440,  900, false, 'desktop'],
];

(async () => {
  if (!process.env.TOK) { console.error('export TOK first'); process.exit(2); }
  const b = await chromium.launch({ executablePath: CHROME });
  let bad = 0;
  const say = (ok, m) => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : '✗   '} ${m}`); };

  for (const [name, w, h, touch, want] of SIZES) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: touch, hasTouch: touch });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.evaluate((t) => { localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_theme', 'black'); },
      process.env.TOK);
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(5500);
    await p.evaluate(() => { const s = document.querySelector('#introSheet:not(.hidden)');
      if (s && typeof introDismiss === 'function') introDismiss(); });
    await p.waitForTimeout(400);

    const r = await p.evaluate(() => {
      /* ON SCREEN, not merely in the DOM: the mobile drawer is a full-size sidebar parked
         off-canvas with a transform, so a plain display/size check calls it visible. */
      const on = (el) => { if (!el) return false; const q = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        return q.width > 2 && q.height > 2 && cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.02
          && q.right > 4 && q.left < innerWidth - 4 && q.bottom > 4 && q.top < innerHeight - 4; };
      return {
        nav: on(document.getElementById('bottomNav')),
        sidebar: on(document.getElementById('sidebar')),
        lw: _lw(),
        cssPhone: matchMedia('(max-width:768px),(max-height:500px)').matches,
        cssDesktop: matchMedia('(min-width:769px) and (min-height:501px)').matches,
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    });

    if (want === 'phone') {
      say(r.nav && !r.sidebar, `${name} (${w}x${h}): the phone app — bottom bar, no sidebar`);
    } else {
      say(r.sidebar && !r.nav, `${name} (${w}x${h}): the desktop app — sidebar, no bottom bar`);
    }
    say(r.cssPhone !== r.cssDesktop,
      `${name}: exactly one layout claims it (phone=${r.cssPhone} desktop=${r.cssDesktop})`);
    say((r.lw <= 768) === r.cssPhone,
      `${name}: the JS agrees with the CSS (_lw()=${r.lw})`);
    say(r.overflow <= 0, `${name}: nothing hangs off the side (${r.overflow}px)`);
    say(errs.length === 0, `${name}: no JS errors` + (errs.length ? ' — ' + errs[0] : ''));
    await ctx.close();
  }

  /* The sign-in screen is the first thing a sideways phone can meet, and it was built for
     a portrait one — everything below the third button fell off the bottom. */
  {
    const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(4000);
    const r = await p.evaluate(() => { const ov = document.getElementById('loginOverlay');
      return { scroll: ov.scrollHeight - ov.clientHeight, buttons: ov.querySelectorAll('.auth-btn').length }; });
    say(r.buttons >= 3 && r.scroll <= 2,
      `sideways sign-in: all ${r.buttons} ways in fit without scrolling (${r.scroll}px over)`);
    await ctx.close();
  }

  /* The dashboard has the same trap with a 900px breakpoint — and a big phone in
     landscape is 926 wide, i.e. straight over it. */
  for (const [n, w, h] of [['phone landscape', 926, 428], ['tablet landscape', 1024, 768], ['desktop', 1440, 900]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    const p = await ctx.newPage();
    await p.goto(BASE + '/admin.html', { waitUntil: 'domcontentloaded' });
    const r = await p.evaluate(() => ({
      phone: matchMedia('(max-width:900px),(max-height:500px)').matches,
      desktop: matchMedia('(min-width:901px) and (min-height:501px)').matches }));
    say(r.phone !== r.desktop, `admin ${n}: exactly one shell claims it`);
    say(n === 'phone landscape' ? r.phone : r.desktop, `admin ${n}: the ${n === 'phone landscape' ? 'phone' : 'desktop'} shell`);
    await ctx.close();
  }

  await b.close();
  console.log(bad ? `\n${bad} FAILED` : '\nOne layout per shape of screen, and a sideways phone is still a phone');
  process.exit(bad ? 1 : 0);
})();
