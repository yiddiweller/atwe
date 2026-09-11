/* THE FOUR WORLDS' TAB ROW — Apple Fitness+'s own geometry, and a row that is on
 * screen the instant you arrive.
 *
 * Two things the founder's team asked for, guarded together because they are the same
 * row:
 *
 * 1. THE SIZE AND THE SPACES. Both reference screenshots are a 375pt iPhone at 3x, so
 *    every number is a measurement divided by 3, never an estimate:
 *        pill height      Apple 132px = 44.0pt   Atwe was 96px = 32.0pt
 *        padding per side Apple  50px = 16.7pt   Atwe 48px = 16.0pt  <- KEPT AT 16
 *    The side padding stays the app's own 16, not Apple's 16.7: the founder asked for it
 *    back after seeing both, and they are right that two thirds of a point is invisible
 *    while 16 is the number every other inset in the app already uses.
 *        gap between      Apple  30px = 10.0pt   Atwe was 24px =  8.0pt
 *        clearance below  Apple  45px = 15.0pt   Atwe was        ~9.0pt
 *    The height was the one genuinely wrong: the side padding was already within a
 *    third of a point, so "too close to each other" was never the horizontal spacing.
 *    44pt is also exactly the touch minimum, so the target is now REAL rather than
 *    simulated by the invisible ::after the 44pt block draws round it.
 *    LEFT MARGIN IS DELIBERATELY 14, NOT APPLE'S 16. It is --feed-gutter, shared with
 *    the post cards, the profile banner and the Account page; moving it for the tabs
 *    alone would stop them lining up with the cards directly beneath them, which is a
 *    worse fault than 2pt. Asserted as "the same as the gutter", never as 14.
 *
 * 2. THE ROW IS THERE BEFORE THE CONTENT IS. On Home, Beam and Engine the tabs come
 *    from static markup in the top bar, so they paint with the header. Notifications
 *    built its row INSIDE acRenderNotifList, i.e. inside the element that the skeleton
 *    replaces — so it did not exist until the fetch returned, two or three seconds
 *    later on a phone. It also DERIVED which tabs to show from the loaded rows, so
 *    there was nothing to draw before the data arrived even in principle.
 *
 * Self-tested: `node tabrow.js --break` puts the old padding and the old
 *    build-after-the-fetch behaviour back and must go red.
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORT = process.env.PORT || 3262;
const BREAK = process.argv.includes('--break');
const TOK = process.env.TOK || (fs.existsSync('/tmp/tok.txt') ? fs.readFileSync('/tmp/tok.txt', 'utf8').trim() : '');
if (!TOK) { console.log('skipped — export TOK first'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (c, what, detail) => { c ? pass++ : fail++; console.log((c ? '  ok  ' : 'FAIL  ') + what + (c || detail === undefined ? '' : '   -> ' + detail)); };
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 0.6 : tol);

/* Apple Fitness+, measured off the founder's own screenshot at 3x on a 375pt phone. */
const APPLE = { h: 44, padX: 16, gap: 10, below: 15 };
const WORLDS = ['Home', 'Beam', 'Engine', 'Notifications'];

const MEAS = () => {
  const vis = (sel) => { for (const e of document.querySelectorAll(sel)) if (e.getBoundingClientRect().height > 0) return e; return null; };
  /* querySelector returns the FIRST match and Home's #tbFeedTabs comes before Beam's
     #tbChatTabs in the source, so asking for '.tb-feedtabs' on Beam hands back Home's
     hidden row — take the first VISIBLE one. */
  const row = vis('#notifOverlay:not(.hidden) .ntf-tabs') || vis('.topbar .tb-feedtabs') || vis('#acSearchScopes');
  if (!row) return null;
  const kids = [...row.children].filter((e) => e.getBoundingClientRect().height > 0
    && !e.classList.contains('tb-feedtab-add'));
  if (kids.length < 2) return null;
  const a = kids[0].getBoundingClientRect(), bcs = getComputedStyle(kids[0]);
  const b = kids[1].getBoundingClientRect();
  return {
    h: +a.height.toFixed(1), w: +a.width.toFixed(1),
    top: +a.top.toFixed(1), left: +a.left.toFixed(1),
    padL: parseFloat(bcs.paddingLeft), padR: parseFloat(bcs.paddingRight),
    radius: parseFloat(bcs.borderRadius),
    gap: +(b.left - a.right).toFixed(1),
    below: (() => {
      for (const sel of ['#acFeed .ac-post', '#acList .ac-item', '#acSearchScroll .ac-explore > *',
                         '#notifList .notif-row', '#notifList .skel-row']) {
        const e = document.querySelector(sel); if (!e) continue;
        const q = e.getBoundingClientRect();
        if (q.height > 4 && q.top > a.bottom - 2) return +(q.top - a.bottom).toFixed(1);
      }
      return null;
    })(),
    gutter: parseFloat(getComputedStyle(document.body).getPropertyValue('--feed-gutter')) || 14,
    selected: kids.filter((e) => e.classList.contains('active') || e.classList.contains('on')).length,
  };
};

(async () => {
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });

  /* ── 1. geometry, both themes ─────────────────────────────────────────── */
  for (const theme of ['black', 'light']) {
    const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    if (BREAK) await p.addInitScript(() => {
      addEventListener('DOMContentLoaded', () => {
        const st = document.createElement('style');
        st.textContent = '.topbar.tb-solo.tb-home .tb-feedtab:not(.tb-feedtab-add),.topbar.tb-solo.tb-chat .tb-feedtab:not(.tb-feedtab-add),.topbar.tb-solo.tb-engine .tb-feedtab:not(.tb-feedtab-add),.ntf-tab{padding:7px 15px!important}';
        document.head.appendChild(st);
      });
    });
    await p.goto('http://localhost:' + PORT, { waitUntil: 'domcontentloaded' });
    await p.evaluate(([t, th]) => { localStorage.clear(); localStorage.setItem('atwe_token', t);
      localStorage.setItem('atwe_theme', th);
      localStorage.setItem('atwe_intro_seen', JSON.stringify(['beam', 'circles', 'ai', 'wallet'])); }, [TOK, theme]);
    await p.goto('http://localhost:' + PORT, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(5200);

    const m = {};
    for (const w of WORLDS) {
      if (w === 'Notifications') { await p.evaluate(() => acNavNotifs()); await p.waitForTimeout(2200); }
      else {
        await p.evaluate((t) => { [...document.querySelectorAll('.overlay:not(.hidden)')]
          .forEach((e) => { try { closeOverlay(e.id, true); } catch (x) {} }); appTab(t); },
          w === 'Home' ? 'home' : w === 'Beam' ? 'chat' : 'search');
        await p.waitForTimeout(1500);
      }
      m[w] = await p.evaluate(MEAS);
    }
    const tag = theme + '  ';
    const missing = WORLDS.filter((w) => !m[w]);
    if (missing.length) { ok(false, tag + 'all four worlds have a tab row', missing.join(',')); await p.close(); continue; }

    for (const w of WORLDS) {
      const x = m[w];
      ok(near(x.h, APPLE.h, 1), tag + w + ': the pill is Apple Fitness+\'s 44pt tall', x.h);
      ok(near(x.padL, APPLE.padX, 1) && near(x.padR, APPLE.padX, 1),
        tag + w + ': …with Apple\'s side padding', x.padL + '/' + x.padR);
      ok(near(x.gap, APPLE.gap, 1), tag + w + ': …and Apple\'s gap between pills', x.gap);
      /* A capsule's radius CLAMPS to half its short side, so a declared 9999 renders as
         h/2. getComputedStyle reports the DECLARED value, not the clamped one — asking it
         to equal h/2 fails on a perfectly round pill, which is how this check first went
         red on correct code. What matters is that it is at least half the height. */
      ok(x.radius >= x.h / 2 - 0.5, tag + w + ': …still a true capsule', x.radius + ' of ' + x.h);
      /* 44pt in BOTH axes: at this height the touch target is the control itself. */
      ok(x.h >= 44 && x.w >= 44, tag + w + ': …and clears the touch floor on its own', x.w + 'x' + x.h);
      ok(near(x.left, x.gutter, 1),
        tag + w + ': starts on the feed gutter, so the tabs line up with the cards below',
        x.left + ' vs gutter ' + x.gutter);
      ok(x.selected === 1, tag + w + ': exactly one tab is selected', x.selected);
      /* The clearance below the row is NOT on the scroller's own box — .tb-feedtabs has
         no bottom padding, the .tb-tabrow around it carries it — so measure the gap to
         the first thing a person actually reads. Apple leaves 15pt; the floor here is 12
         because a notification row brings its own top padding. */
      ok(x.below === null || x.below >= 12,
        tag + w + ': …and Apple\'s clearance below the row before the content starts', x.below);
    }
    const same = (f, label) => {
      const v = WORLDS.map((w) => f(m[w]));
      ok(v.every((x) => near(x, v[0], 1)), tag + label, WORLDS.map((w, i) => w + '=' + v[i]).join(' '));
    };
    same((x) => x.h, 'all four pills are the same height');
    same((x) => x.top, '…and sit on the same line');
    same((x) => x.left, '…and start on the same edge');
    same((x) => x.gap, '…and are spaced the same');
    await p.close();
  }

  /* ── 2. the row is on screen before the content is ────────────────────── */
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  if (BREAK) await p.addInitScript(() => {
    /* put the old behaviour back: the pills only exist once the rows are rendered */
    addEventListener('load', () => setTimeout(() => {
      try { window.acNotifTabsHtml = () => ''; } catch (e) {}
    }, 50));
  });
  await p.goto('http://localhost:' + PORT, { waitUntil: 'domcontentloaded' });
  await p.evaluate((t) => { localStorage.clear(); localStorage.setItem('atwe_token', t);
    localStorage.setItem('atwe_theme', 'black');
    localStorage.setItem('atwe_intro_seen', JSON.stringify(['beam', 'circles', 'ai', 'wallet'])); }, TOK);
  await p.goto('http://localhost:' + PORT, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(5200);
  /* Hold the fetch the way a phone on mobile data does. WITHOUT THIS THE CHECK IS
     WORTHLESS: against a server on the same machine the rows arrive within a frame or
     two, so the broken build and the fixed one measure identically. */
  await p.route('**/api/notifications*', async (r) => { await new Promise((x) => setTimeout(x, 2500)); r.continue(); });
  await p.evaluate(() => { [...document.querySelectorAll('.overlay:not(.hidden)')]
    .forEach((e) => { try { closeOverlay(e.id, true); } catch (x) {} }); appTab('home'); });
  await p.waitForTimeout(1200);
  const t0 = Date.now();
  await p.evaluate(() => acNavNotifs());
  let firstTabs = null, firstRows = null, sawSkeleton = false;
  for (let i = 0; i < 16 && (firstTabs === null || firstRows === null); i++) {
    await p.waitForTimeout(160);
    const s = await p.evaluate(() => ({
      tabs: document.querySelectorAll('#notifList .ntf-tab').length,
      rows: document.querySelectorAll('#notifList .notif-row').length,
      skel: !!document.querySelector('#notifList .skel-row'),
      head: !!document.querySelector('#notifHead .tb-brand-word-txt'),
    }));
    if (s.skel) sawSkeleton = true;
    if (firstTabs === null && s.tabs >= 4) firstTabs = Date.now() - t0;
    if (firstRows === null && s.rows > 0) firstRows = Date.now() - t0;
  }
  ok(firstTabs !== null && firstTabs < 700,
    'Notifications: the tab pills are on screen within a few hundred ms', firstTabs + 'ms');
  ok(sawSkeleton, '…while the list below is still a skeleton');
  ok(firstRows !== null && firstTabs !== null && firstRows - firstTabs > 1500,
    '…a long time before the notifications themselves land',
    'tabs ' + firstTabs + 'ms, rows ' + firstRows + 'ms');
  /* and the set does not CHANGE when the data lands, or the row would visibly reshuffle */
  const after = await p.evaluate(() => [...document.querySelectorAll('#notifList .ntf-tab')].map((e) => e.textContent.trim()));
  ok(after.length === 4 && after[0] === 'All',
    '…and the same four pills are still there afterwards, unchanged', after.join(' · '));
  await p.close();

  /* ── 3. the top-right circles, and no blue on any button ──────────────── */
  const p3 = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  if (BREAK) await p3.addInitScript(() => {
    addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style');
      st.textContent = 'body{--ctl-fill:radial-gradient(90% 130% at 50% 128%,rgba(var(--accent-rgb),.11),transparent 72%),rgba(18,18,21,.90)!important}'
        + '.topbar.tb-solo .tb-brandrow,#notifHead.tb-brandrow{--tb-brand-circle:36px!important}';
      document.head.appendChild(st);
    });
  });
  await p3.goto('http://localhost:' + PORT, { waitUntil: 'domcontentloaded' });
  await p3.evaluate((t) => { localStorage.clear(); localStorage.setItem('atwe_token', t);
    localStorage.setItem('atwe_theme', 'black');
    localStorage.setItem('atwe_intro_seen', JSON.stringify(['beam', 'circles', 'ai', 'wallet'])); }, TOK);
  await p3.goto('http://localhost:' + PORT, { waitUntil: 'domcontentloaded' });
  await p3.waitForTimeout(5200);
  for (const w of WORLDS) {
    if (w === 'Notifications') { await p3.evaluate(() => acNavNotifs()); await p3.waitForTimeout(2200); }
    else {
      await p3.evaluate((t) => { [...document.querySelectorAll('.overlay:not(.hidden)')]
        .forEach((e) => { try { closeOverlay(e.id, true); } catch (x) {} }); appTab(t); },
        w === 'Home' ? 'home' : w === 'Beam' ? 'chat' : 'search');
      await p3.waitForTimeout(1500);
    }
    /* APPLE FITNESS+ MEASURED: its two top-right circles are 132px on a 375pt phone at
       3x, i.e. 44.0pt, with a 36px (12.0pt) gap. Ours were 36 with the same 12 gap, so
       only the diameter was adrift. 44 is also the touch minimum, which is why the same
       number lands on the tab pill. */
    const c = await p3.evaluate(() => {
      const root = document.querySelector('#notifOverlay:not(.hidden) #notifHead') || document.querySelector('.topbar .tb-brandrow:not([hidden])');
      const acts = [...(root ? root.querySelectorAll('.tb-brand-act') : [])]
        .filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.getBoundingClientRect());
      if (acts.length < 2) return null;
      return { w: +acts[0].width.toFixed(1), h: +acts[0].height.toFixed(1),
        gap: +(acts[1].left - acts[0].right).toFixed(1), n: acts.length };
    });
    if (!c) { ok(false, w + ': the top-right circles are on screen'); continue; }
    ok(near(c.w, 44, 1) && near(c.h, 44, 1), w + ': the top-right circle is Apple\'s 44pt', c.w + 'x' + c.h);
    ok(near(c.gap, 12, 1), w + ': …and Apple\'s 12pt gap between them', c.gap);
  }
  /* NO BLUE ON A BUTTON — measured in REAL PIXELS, not from the computed style. The wash
     that was removed was a radial INSIDE the fill, so a rule elsewhere could paint one
     again and a token check would not notice. A grey button's three channels must stay
     within a few points of each other; the old pill read [16,16,18] at its top and
     [16,23,33] at its bottom, i.e. blue 17 above red. */
  await p3.evaluate(() => { [...document.querySelectorAll('.overlay:not(.hidden)')]
    .forEach((e) => { try { closeOverlay(e.id, true); } catch (x) {} }); appTab('home'); });
  await p3.waitForTimeout(1500);
  const box = await p3.evaluate(() => {
    const row = [...document.querySelectorAll('.topbar .tb-feedtabs')].find((e) => e.getBoundingClientRect().height > 0);
    const rest = [...row.children].find((e) => e.getBoundingClientRect().height > 0
      && !e.classList.contains('active') && !e.classList.contains('tb-feedtab-add'));
    const q = rest.getBoundingClientRect();
    return { x: Math.round(q.left + q.width / 2), top: Math.round(q.top + 3), bot: Math.round(q.bottom - 4) };
  });
  const shot = await p3.screenshot();
  const png = require('zlib'), sharpless = null; // no image lib: read pixels through the page instead
  const cast = await p3.evaluate(async ({ x, top, bot, data }) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + data;
    await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    cv.getContext('2d').drawImage(img, 0, 0);
    const dpr = img.width / window.innerWidth;
    const px = (yy) => { const d = cv.getContext('2d').getImageData(Math.round(x * dpr), Math.round(yy * dpr), 1, 1).data;
      return [d[0], d[1], d[2]]; };
    return { top: px(top), bot: px(bot) };
  }, { ...box, data: shot.toString('base64') });
  const blueCast = (c) => c[2] - c[0];
  ok(blueCast(cast.bot) <= 6, 'a resting pill carries NO blue wash at its bottom edge',
    'rgb(' + cast.bot.join(',') + ')');
  ok(blueCast(cast.top) <= 6, '…nor at its top', 'rgb(' + cast.top.join(',') + ')');
  await p3.close();

  await b.close();
  console.log(`\n═══ ${pass} passed, ${fail} failed ═══`);
  process.exit(fail ? 1 : 0);
})();
