/* DOES THE FEED SKELETON REMEMBER WHAT THE LAST FEED LOOKED LIKE?
 *
 * The grey placeholder is drawn before the feed arrives, so it cannot know what is
 * coming — and a post is 269-653px depending on the shape of its photo, or whether it
 * has one at all. One fixed guess for every slot is what made a post jump as the real
 * thing replaced it.
 *
 * So it remembers: after each feed render the app notes, per slot, how tall that post's
 * picture was, and the next skeleton reserves exactly that. This proves the memory is
 * written, that a genuine SECOND visit uses it, and that a first visit is unchanged.
 *
 * NB this cannot fix settle.js's Home check, and is not meant to: that probe uses a
 * BRAND-NEW account, whose second feed fetch returns a completely different set of
 * posts (the already-seen filter guarantees it), so no memory of the first set could
 * predict the second. A returning person's feed keeps roughly the same shape, which is
 * the case this helps.
 */
const { chromium } = require(__dirname + '/node_modules/playwright-core');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:3262';
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (x !== undefined ? ' :: ' + x : '')); } };

(async () => {
  if (!process.env.TOK) { console.error('export TOK first'); process.exit(2); }
  const b = await chromium.launch({ executablePath: CHROME });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));

  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.evaluate((t) => { localStorage.clear(); localStorage.setItem('atwe_token', t); }, process.env.TOK);

  /* Hold the feed back so the skeleton is on screen long enough to read. One route
     for the whole run, toggled by a flag — calling unroute while a request is still
     in flight throws "Route is already handled". */
  let slowFeed = true;
  await p.route('**/api/social/feed**', async (r) => {
    if (slowFeed) await new Promise((x) => setTimeout(x, 3500));
    await r.continue();
  });

  /* ── first visit: nothing remembered, so the skeleton is the old fixed shape ── */
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  const firstSkel = await p.evaluate(() => [...document.querySelectorAll('#acFeed .skel-post')]
    .map((c) => { const m = c.querySelector('.skel-media'); return m ? Math.round(m.getBoundingClientRect().height) : 0; }));
  ok(firstSkel.length > 0, 'a first visit still shows a skeleton', JSON.stringify(firstSkel));
  ok(await p.evaluate(() => !localStorage.getItem('atwe_feed_skel')),
     'and it had nothing remembered to go on');

  slowFeed = false;
  await p.waitForTimeout(6000);
  await p.evaluate(() => { const s = document.querySelector('#introSheet:not(.hidden)'); if (s && typeof introDismiss === 'function') introDismiss(); });
  await p.waitForTimeout(1200);

  const mem = await p.evaluate(() => { try { return JSON.parse(localStorage.getItem('atwe_feed_skel') || 'null'); } catch (e) { return null; } });
  ok(mem && Array.isArray(mem.slots) && mem.slots.length > 0,
     'once the real feed lands, its shape is remembered', JSON.stringify(mem));
  ok(mem && mem.w === 390, 'keyed to the viewport width — a picture is a different height on a wider screen', mem && mem.w);
  ok(mem && String(mem.who).length > 0, 'and to the account, so one person’s feed never shapes another’s');

  /* ── second visit: the skeleton should now match what actually arrives ── */
  const real = await p.evaluate(() => [...document.querySelectorAll('#acFeed .ac-post:not(.skel-post)')].slice(0, 5)
    .map((c) => { const m = c.querySelector('.ac-post-img, .ac-imggrid, .ac-vid-wrap'); return m ? Math.round(m.getBoundingClientRect().height) : 0; }));

  slowFeed = true;
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  const secondSkel = await p.evaluate(() => [...document.querySelectorAll('#acFeed .skel-post')]
    .map((c) => { const m = c.querySelector('.skel-media'); return m ? Math.round(m.getBoundingClientRect().height) : 0; }));

  console.log('    real posts      ' + JSON.stringify(real.slice(0, 5)));
  console.log('    1st-visit skel  ' + JSON.stringify(firstSkel.slice(0, 5)));
  console.log('    2nd-visit skel  ' + JSON.stringify(secondSkel.slice(0, 5)));

  ok(secondSkel.length > 0, 'the second visit still shows a skeleton');
  const near = (a, bb) => Math.abs(a - bb) <= 8;
  const matched = secondSkel.slice(0, Math.min(3, real.length)).filter((h, i) => near(h, real[i])).length;
  ok(matched >= Math.min(3, real.length),
     'and each slot now reserves the height the real post actually had',
     'skel=' + JSON.stringify(secondSkel.slice(0, 3)) + ' real=' + JSON.stringify(real.slice(0, 3)));

  const firstErr = firstSkel.slice(0, 3).reduce((n, h, i) => n + Math.abs(h - (real[i] || 0)), 0);
  const secondErr = secondSkel.slice(0, 3).reduce((n, h, i) => n + Math.abs(h - (real[i] || 0)), 0);
  ok(secondErr < firstErr, 'so the room reserved is closer than the fixed guess was',
     'off by ' + firstErr + 'px before, ' + secondErr + 'px after');

  ok(errs.length === 0, 'no JS errors', errs[0]);
  await b.close();
  console.log(fail ? `\n${fail} FAILED` : '\nThe skeleton reserves the room the feed actually needs');
  process.exit(fail ? 1 : 0);
})();
