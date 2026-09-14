/* SECTION 4 of the polish brief: a loading state must read as "content is loading",
   never as "nothing is here". Measured on REAL PIXELS while the surface is genuinely
   waiting, not from the stylesheet.

   Deliberately separates two things the brief conflates:
     - the POST CARD skeleton (--post-skel) is BLACK on purpose. The founder drove it
       darker three separate times, ending at "I want you should make the lighter grey
       should be fully black". That is a closed decision and this probe reports it
       without judging it.
     - every OTHER skeleton (.skel -> --s2) sits on the page, and nobody has ever
       decided its value. That is the one worth measuring.

   The API is STALLED rather than slowed: a surface that answers in 10ms locally is
   never in its loading state long enough to photograph, so a check written without
   this passes on a screen nobody can see. */
process.env.JWT_SECRET = 'scoresecret';
const SP = '/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const { chromium } = require(SP + 'node_modules/playwright-core');
const fs = require('fs');
const TOK = fs.readFileSync('/tmp/tok.txt', 'utf8').trim();

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); }
  else { fail++; console.log('  FAIL ' + m + (x !== undefined ? '\n         ' + String(x).slice(0, 220) : '')); } };

const lum = ([r, g, b]) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100; };

// surface, the route to stall, the opener
const CASES = [
  ['Home feed',      '**/api/social/feed**',        `acSetFeed('foryou')`],
  ['Beam chat list', '**/api/atchat/conversations**', `appTab('chat')`],
  ['Notifications',  '**/api/notifications**',      `acNavNotifs()`],
  ['Orders',         '**/api/orders**',             `acOpenOrders('buyer')`],
  ['Marketplace',    '**/api/marketplace**',        `acOpenMarketplace()`],
];

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  for (const theme of ['black', 'light']) {
    const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await p.goto('http://localhost:3262', { waitUntil: 'domcontentloaded' });
    await p.evaluate(([t, th]) => {
      localStorage.clear();
      localStorage.setItem('atwe_theme', th);
      localStorage.setItem('atwe_token', t);
      localStorage.setItem('atwe_intro_seen', JSON.stringify(['beam', 'circles', 'ai', 'wallet']));
    }, [TOK, theme]);
    await p.goto('http://localhost:3262', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(6000);
    /* SELF-TEST: put the page skeleton back on --s2, which is what it used to be, and
       this must go red. A probe that cannot fail proves nothing. Same specificity as
       the shipped rule, appended later, so it genuinely wins. */
    if (process.argv.includes('--break')) await p.addStyleTag({ content: '.skel{background:var(--s2);}' });
    console.log('\n── ' + theme + ' ──' + (process.argv.includes('--break') ? '  [--break: skeleton forced back onto --s2]' : ''));

    for (const [name, route, opener] of CASES) {
      await p.evaluate(() => {
        try {
          [...document.querySelectorAll('.overlay:not(.hidden)')].reverse().forEach(o => { if (o.id) closeOverlay(o.id, true); });
        } catch (e) {}
      });
      await p.waitForTimeout(500);
      // STALL, do not slow: a 10ms local answer is never photographable
      await p.route(route, async () => { await new Promise(r => setTimeout(r, 25000)); });
      await p.evaluate((o) => { try { eval(o); } catch (e) {} }, opener);
      await p.waitForTimeout(1400);

      const m = await p.evaluate(() => {
        /* ONLY shapes that actually PAINT. .skel-row, .skel-post, .skel-lines and
           .skel-acts are transparent layout containers; measuring those returns the
           element's own rgba(0,0,0,0) and reports a meaningless 1:1 on black and
           21:1 on white, which is exactly what the first run of this probe did. */
        const painted = (e) => {
          const bg = getComputedStyle(e).backgroundColor;
          const m2 = bg && bg.match(/rgba?\(([^)]+)\)/);
          if (!m2) return false;
          const v = m2[1].split(',').map(Number);
          return v.length < 4 || v[3] > 0.05;
        };
        const skels = [...document.querySelectorAll('.skel,[class*="skel-"]')]
          .filter(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
                         return r.width > 6 && r.height > 4 && r.top < innerHeight && r.bottom > 0
                                && cs.visibility !== 'hidden' && cs.display !== 'none' && painted(e); });
        if (!skels.length) return { none: true, bodyText: (document.body.innerText || '').trim().slice(0, 60) };
        const groundOf = (e) => { let n = e.parentElement;
          while (n) { const bg = getComputedStyle(n).backgroundColor;
            const mm = bg && bg.match(/rgba?\(([^)]+)\)/);
            if (mm) { const q = mm[1].split(',').map(Number); if (q.length < 4 || q[3] > 0.95) return [q[0], q[1], q[2]]; }
            n = n.parentElement; } return null; };
        const rgbOf = (e) => { const m3 = getComputedStyle(e).backgroundColor.match(/rgba?\(([^)]+)\)/);
          return m3 ? m3[1].split(',').map(Number).slice(0, 3) : null; };
        /* A LAYOUT CONTAINER PAINTED THE PAGE COLOUR IS NOT A LOADING SHAPE. .skel-post
           and .skel-row carry the page fill so the rising feed can cover the tab menu;
           measuring one reports a meaningless 1:1 and hides the real bar underneath it,
           which is exactly what the first version of this probe printed. */
        const bars = skels.filter(e => { const f = rgbOf(e), g = groundOf(e);
          return f && g && (Math.abs(f[0] - g[0]) + Math.abs(f[1] - g[1]) + Math.abs(f[2] - g[2])) > 6; });
        if (!bars.length) return { noBars: true, count: skels.length };
        const el = bars.sort((a, b2) => (b2.getBoundingClientRect().width * b2.getBoundingClientRect().height)
                                       - (a.getBoundingClientRect().width * a.getBoundingClientRect().height))[0];
        const r = el.getBoundingClientRect();
        // composite the real ground behind it
        let ground = null, node = el.parentElement;
        while (node && !ground) {
          const bg = getComputedStyle(node).backgroundColor;
          const mm = bg && bg.match(/rgba?\(([^)]+)\)/);
          if (mm) { const p2 = mm[1].split(',').map(Number); if (p2.length < 4 || p2[3] > 0.95) ground = [p2[0], p2[1], p2[2]]; }
          node = node.parentElement;
        }
        const own = getComputedStyle(el).backgroundColor.match(/rgba?\(([^)]+)\)/);
        const anim = getComputedStyle(el, '::after').animationName;
        return { count: skels.length,
                 cls: (typeof el.className === 'string' ? el.className : el.getAttribute('class') || ''),
                 box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
                 fill: own ? own[1].split(',').map(Number).slice(0, 3) : null,
                 ground, shimmer: anim && anim !== 'none' ? anim : null,
                 insidePostCard: !!el.closest('.ac-post') };
      });

      if (m.none) {
        ok(false, name + ' — shows a loading state rather than an empty screen',
           'no skeleton on screen; the page reads: "' + (m.bodyText || '') + '"');
      } else if (m.noBars) {
        ok(false, name + ' — a loading shape that differs from what is behind it',
           m.count + ' skeleton elements, every one painted the same colour as its ground');
      } else {
        const c = ratio(m.fill, m.ground);
        const where = m.insidePostCard ? 'post card (--post-skel, the founder\'s decided black)' : 'page (--skel-fill)';
        /* The FLOOR is what stops a loading list reading as an empty one; the CEILING is
           what stops somebody "fixing" it into a bright grey slab. The band is set around
           the post-card skeleton the founder settled on after asking for it darker three
           times: 1.24:1 on Black, 1.17:1 on Light against its own card. */
        ok(c >= 1.15 && c <= 1.45,
           name + ' — the loading shape reads against its ground (' + c + ':1)',
           '[' + m.cls + '] ' + JSON.stringify(m.fill) + ' on ' + JSON.stringify(m.ground) + ' = ' + c + ':1, want 1.15-1.45');
        console.log('         biggest [' + m.cls + '] ' + m.box.w + 'x' + m.box.h +
                    ' fill=' + JSON.stringify(m.fill) + ' ground=' + JSON.stringify(m.ground) + ' on the ' + where +
                    ', contrast ' + c + ':1' + (m.shimmer ? ', shimmer ' + m.shimmer : ', NO shimmer'));
      }
      await p.unroute(route);
      await p.waitForTimeout(300);
    }
    await p.close();
  }

  // reduced motion must stop the shimmer
  const p2 = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
                               hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  await p2.goto('http://localhost:3262', { waitUntil: 'domcontentloaded' });
  await p2.evaluate((t) => { localStorage.clear(); localStorage.setItem('atwe_token', t);
    localStorage.setItem('atwe_intro_seen', JSON.stringify(['beam', 'circles', 'ai', 'wallet'])); }, TOK);
  await p2.goto('http://localhost:3262', { waitUntil: 'domcontentloaded' });
  await p2.waitForTimeout(5000);
  await p2.route('**/api/social/feed**', async () => { await new Promise(r => setTimeout(r, 20000)); });
  await p2.evaluate(() => { try { acSetFeed('foryou'); } catch (e) {} });
  await p2.waitForTimeout(1400);
  const rm = await p2.evaluate(() => {
    const el = document.querySelector('.skel,[class*="skel-"]');
    if (!el) return { none: true };
    const a = getComputedStyle(el, '::after');
    return { name: a.animationName, dur: a.animationDuration };
  });
  ok(rm.none || rm.name === 'none' || parseFloat(rm.dur) === 0,
     'reduced motion stops the skeleton shimmer', JSON.stringify(rm));
  await p2.close();

  await b.close();
  console.log('\n═══ ' + pass + ' passed, ' + fail + ' failed ═══');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
