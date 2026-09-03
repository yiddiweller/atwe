/* THE CHAT'S TOP EDGE, and the presence dot that flashed under it.
 *
 * Two things the owner caught on a real phone:
 *   1. Opening a chat showed a GREEN "they're online" dot for the first second even when
 *      the person was not online. The header is seeded instantly from cached data so the
 *      name never flashes — but the seeder never touched the DOT, so it kept whatever the
 *      PREVIOUS chat set. Worse, the markup shipped without `hidden`, so the first chat
 *      after a boot showed one whoever it was.
 *   2. The fade under the floating header read as a dark bar rather than as glass.
 *
 * The dot checks SAMPLE THROUGHOUT THE OPEN, not after it. A check that looks only at the
 * settled state passes on the bug — the whole complaint is about the second in between.
 */
const { chromium } = require(process.env.PW ? process.env.PW + '/node_modules/playwright-core' : 'playwright-core');
const { PNG } = require(process.env.PW ? process.env.PW + '/node_modules/pngjs' : 'pngjs');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:3262';

(async () => {
  if (!process.env.TOK) { console.error('export TOK first'); process.exit(2); }
  const b = await chromium.launch({ executablePath: CHROME });
  let bad = 0;
  const say = (ok, m) => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : '✗   '} ${m}`); };

  const open = async (theme) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    const p = await ctx.newPage();
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.evaluate(([t, th]) => { localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_theme', th); }, [process.env.TOK, theme]);
    await p.goto(BASE + '/messages', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(5000);
    await p.evaluate(() => { const s = document.querySelector('#introSheet:not(.hidden)'); if (s && typeof introDismiss === 'function') introDismiss(); });
    return { ctx, p };
  };

  const { ctx, p } = await open('black');
  const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  /* HOLD THE THREAD FETCH BACK. On this machine the server answers in ~10ms, so the flash
     the owner sees over 5G is shorter than a single sample and the check passes on the very
     bug it exists to catch — verified: with the fix removed and no delay, it went green.
     700ms is roughly what a phone on a real network gets. */
  await p.route('**/api/atchat/with/**', async (r) => { await new Promise((s) => setTimeout(s, 700)); r.continue(); });

  /* 1. The dot ships hidden. Anything else and the very first chat after a boot shows a
        green dot before a single line of JS has decided anything. */
  say(await p.evaluate(() => document.getElementById('acPeerDot').classList.contains('hidden')),
    'the dot starts hidden in the markup — nothing is claimed before it is known');

  /* 2. Open a chat with somebody who is NOT online, sampling all the way through. Nobody
        in this database has a live stream open, so every peer here is offline. */
  const flashed = await p.evaluate(async () => {
    const seen = [];
    const on = () => { const d = document.getElementById('acPeerDot');
      /* VISIBLE, not merely un-hidden: offline the dot stays in the box collapsed to
         nothing so that coming online can animate it open, so the class alone would
         report a dot nobody can see. */
      return !!d && !d.classList.contains('hidden') && d.getBoundingClientRect().width > 1; };
    const t = setInterval(() => seen.push(on()), 40);
    document.querySelector('#acListScreen .ac-item[data-uid]').click();
    await new Promise((r) => setTimeout(r, 3200));
    clearInterval(t);
    return { any: seen.some(Boolean), n: seen.length };
  });
  await p.waitForSelector('#acThreadScreen:not(.hidden)', { timeout: 20000 });
  await p.waitForTimeout(1200);
  say(!flashed.any, `no green dot at any point while an offline chat opens (${flashed.n} samples)`);
  say(!(await p.evaluate(() => { const d = document.getElementById('acPeerDot');
    return !!d && !d.classList.contains('hidden') && d.getBoundingClientRect().width > 1; })),
    'and none once it has settled');

  /* 3. It is not simply dead: told the peer IS online, it appears. */
  /* The dot now ANIMATES open, so it is not full-size in the same tick it is told to show.
     Give it the transition's own time before measuring, or this reads zero on correct code. */
  say(await p.evaluate(async () => { rtPresence[AC.peer.id] = { online: true, last_seen: null };
    acUpdatePeerPresence();
    await new Promise((r) => setTimeout(r, 450));
    const d = document.getElementById('acPeerDot');
    return !!d && !d.classList.contains('hidden') && d.getBoundingClientRect().width > 1; }),
    'and it DOES show when they really are online');
  await p.evaluate(() => { rtPresence[AC.peer.id] = { online: false, last_seen: new Date().toISOString() }; acUpdatePeerPresence(); });

  /* 4. Leaving an online chat for an offline one must not carry the dot across — this is
        the exact sequence the owner hit, and the reason the seeder had to change. */
  const carried = await p.evaluate(async () => {
    const rows = [...document.querySelectorAll('#acListScreen .ac-item[data-uid]')];
    if (rows.length < 2) return { skip: true };
    rtPresence[AC.peer.id] = { online: true, last_seen: null }; acUpdatePeerPresence();
    const vis = () => { const d = document.getElementById('acPeerDot');
      return !!d && !d.classList.contains('hidden') && d.getBoundingClientRect().width > 1; };
    await new Promise((r) => setTimeout(r, 450));   // let it animate open before reading it
    const wasOn = vis();
    acBackToList();
    await new Promise((r) => setTimeout(r, 700));   // …and closed again before the next chat
    const seen = [];
    const t = setInterval(() => seen.push(vis()), 40);
    document.querySelectorAll('#acListScreen .ac-item[data-uid]')[1].click();
    await new Promise((r) => setTimeout(r, 2200));
    clearInterval(t);
    return { wasOn, any: seen.some(Boolean) };
  });
  say(carried.skip || (carried.wasOn && !carried.any),
    carried.skip ? 'only one conversation — the carry-over case is not exercised'
      : 'the green dot does not carry over from a chat where they WERE online');
  await p.waitForTimeout(800);

  /* 5. THE TOP EDGE, and its ONE law: it is NEVER opaque. Content stays see-through the
        whole way up and just gets darker and blurrier. Three passes got this wrong the same
        way — they held SOLID BLACK for the first quarter of the band and only then began to
        fade, so the darkness appeared to switch on at a fixed distance below the top, which
        is what the owner kept reporting. Easing the curve did not help, because the plateau
        was the problem. The reference is the BOTTOM scrim, which has always peaked at .88
        and eased straight down; the top must match it.
        Read the real stops, not a screenshot: a dark gradient over dark content cannot be
        sampled honestly. */
  const ramp = await p.evaluate(() => {
    const cs = getComputedStyle(document.getElementById('acThreadScreen'), '::before');
    const bg = cs.backgroundImage;
    const stops = [...bg.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)\s+([\d.]+)%/g)]
      .map((m) => ({ a: m[4] === undefined ? 1 : +m[4], pos: +m[5] }));
    return { stops, h: Math.round(parseFloat(cs.height)) };
  });
  const bottom = await p.evaluate(() => {
    const bg = getComputedStyle(document.getElementById('acThreadScreen'), '::after').backgroundImage;
    return Math.max(...[...bg.matchAll(/rgba?\((?:\d+,\s*){2}\d+(?:,\s*([\d.]+))?\)/g)].map((m) => m[1] === undefined ? 1 : +m[1]));
  });
  const peak = Math.max(...ramp.stops.map((x) => x.a));
  say(peak < 1, `NOTHING in the band is opaque — you can see through all of it (peak ${peak})`);
  say(Math.abs(peak - bottom) < 0.001, `and it peaks exactly where the bottom scrim does (${peak} vs ${bottom})`);
  /* No flat section anywhere: a run of equal stops IS a plateau, whatever its alpha. */
  let flat = 0, run = 0;
  for (let i = 1; i < ramp.stops.length; i++) {
    run = Math.abs(ramp.stops[i].a - ramp.stops[i-1].a) < 0.005 ? run + 1 : 0;
    flat = Math.max(flat, run);
  }
  say(flat === 0, `it darkens continuously — no flat stretch anywhere (longest ${flat})`);
  say(ramp.stops.length >= 10, `the ramp is sampled finely enough not to band (${ramp.stops.length} stops)`);
  // biggest jump in alpha between neighbouring stops — the "shift" the owner could see
  let jump = 0;
  for (let i = 1; i < ramp.stops.length; i++) jump = Math.max(jump, Math.abs(ramp.stops[i].a - ramp.stops[i-1].a));
  say(jump <= 0.2, `and no single step in it is a visible shift (largest ${jump.toFixed(3)})`);
  say(ramp.stops[ramp.stops.length-1].a === 0 && ramp.stops[ramp.stops.length-2].a < 0.05,
    'it arrives at nothing gently rather than stopping dead');
  say(ramp.h >= 180, `the band is long enough to be gradual (${ramp.h}px)`);

  /* 6. And it is GLASS, not just a tint: a stack of blurs whose radius RAMPS. One flat
        backdrop-filter is a sheet of frost with a hard bottom edge, which is the thing
        that reads as cheap. */
  const glass = await p.evaluate(() => {
    const g = document.querySelector('#acThreadScreen .ac-topglass');
    if (!g) return null;
    const layers = [...g.children].map((n) => {
      const cs = getComputedStyle(n);
      return { blur: parseFloat((cs.backdropFilter.match(/blur\(([\d.]+)px\)/) || [])[1] || 0),
        mask: cs.webkitMaskImage || cs.maskImage };
    });
    const pill = document.querySelector('.ac-h3-pill').getBoundingClientRect();
    return { z: +getComputedStyle(g).zIndex, h: Math.round(g.getBoundingClientRect().height), layers,
      headBottom: Math.round(pill.bottom), headMid: Math.round(pill.top + pill.height / 2),
      strongest: Math.round(g.children[g.children.length-1].getBoundingClientRect().height),
      tintZ: +getComputedStyle(document.getElementById('acThreadScreen'), '::before').zIndex };
  });
  say(glass && glass.layers.length >= 3, `the blur ramps across several layers (${glass ? glass.layers.length : 0})`);
  say(glass && glass.layers.every((l, i) => i === 0 || l.blur > glass.layers[i-1].blur),
    `each layer is blurrier than the one before (${glass ? glass.layers.map(l => l.blur + 'px').join(' → ') : ''})`);
  say(glass && glass.layers.every((l) => /gradient/.test(l.mask)),
    'and every one is masked, so the frost fades out instead of ending on a line');
  say(glass && glass.z < glass.tintZ,
    `the blur sits UNDER the tint (${glass ? glass.z : '?'} < ${glass ? glass.tintZ : '?'}) — content is dissolved first, then tinted`);
  /* THE BLUR AND THE TINT ARE DELIBERATELY DIFFERENT LENGTHS, and this used to assert the
     opposite. They are different jobs: the tint is a long gentle fade so nothing ends on a
     line, while the frost belongs only where content passes UNDER the header. Sharing the
     tint's reach left visible softness ~170px down, on messages plainly in open space —
     the owner's "the blurriness starts too early". */
  say(glass && glass.h < ramp.h * 0.7,
    `the frost is confined to the header, not stretched over the whole fade (${glass ? glass.h : 0} vs the tint's ${ramp.h})`);
  /* It ends at the profile bar's own MID-LINE, not below the bar — the owner's last note,
     and the reason the band is built from that bar's geometry (its top inset + half a
     shape + a short tail) rather than from the float stack's height. */
  say(glass && Math.abs(glass.h - glass.headMid) <= 12,
    `it fades out at the profile bar's mid-line (${glass ? glass.h : 0}px against a mid-line at ${glass ? glass.headMid : '?'})`);
  say(glass && glass.strongest <= glass.headMid,
    `and the heaviest blur reaches no further than that (${glass ? glass.strongest : 0}px)`);
  /* Derived from the bar, NOT from --ac-head-h: the stack grows downward when a pin bar
     appears but the shapes row does not move, so the frost must not move either. */
  say(!/--ac-head-h/.test(await p.evaluate(() =>
    [...document.styleSheets].flatMap((ss) => { try { return [...ss.cssRules]; } catch { return []; } })
      .filter((r) => r.selectorText === '#acThreadScreen').map((r) => r.style.getPropertyValue('--ac-glass-h')).join(''))),
    'and it is built from the bar, not from the header stack that grows with a pin bar');

  /* 7. It really blurs. Painting a hard-edged stripe INTO the thread and reading it back
        under the band is the only honest proof — computed style says a filter is set, not
        that anything was filtered. */
  const blurred = await p.evaluate(async () => {
    const t = document.getElementById('acThread');
    /* The stripes must live INSIDE #acThreadScreen, below the glass's z-index. A body-level
       element cannot be "behind" it at all — #app is its own stacking context, so the first
       version of this painted both stripes on top of everything and the control read a flat
       zero, which is what a probe measuring nothing looks like. */
    const sc = document.getElementById('acThreadScreen');
    const mk = (top) => { const d = document.createElement('div');
      d.style.cssText = `position:absolute;left:0;right:0;top:${top}px;height:26px;z-index:1;background:repeating-linear-gradient(90deg,#fff 0 6px,#000 6px 12px);`;
      d.className = '_probe'; sc.appendChild(d); return d; };
    mk(40); mk(430);            // one under the frost, one well clear of it
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return true;
  });
  await p.waitForTimeout(200);
  const shot = PNG.sync.read(await p.screenshot());
  const rowSpread = (cssY) => {              // how much black-to-white contrast survives
    const y = Math.round(cssY * 3), w = shot.width; let lo = 255, hi = 0;
    for (let x = Math.round(w * 0.3); x < Math.round(w * 0.7); x++) {
      const i = (y * w + x) << 2; const v = shot.data[i];
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    return hi - lo;
  };
  const under = rowSpread(52), below = rowSpread(442);
  say(under < below * 0.6, `a hard-edged stripe is genuinely smeared under the band (contrast ${under} vs ${below} below it)`);
  await p.evaluate(() => document.querySelectorAll('._probe').forEach((n) => n.remove()));

  /* 9. THE SENT-BUT-UNSEEN BUBBLE is the owner's navy, not solid white. It used to be the
        loudest thing in the thread for the least important state. Both states are dark now,
        which is why the six dark-on-light overrides it needed are gone. */
  const bub = await p.evaluate(async () => {
    const now = new Date().toISOString();
    AC.messages.push({ id: 9001, created_at: now, mine: true, body: 'not seen yet', read_at: null });
    AC.messages.push({ id: 9002, created_at: now, mine: true, body: 'they read it', read_at: now });
    acRenderThread();
    await new Promise((r) => setTimeout(r, 1400));   // let the entrance animation finish
    const g = (id) => { const n = [...document.querySelectorAll('#acThread .msg-bubble')]
      .find((x) => (x.textContent || '').includes(id)); const c = getComputedStyle(n);
      return { bg: c.backgroundColor, ink: c.color }; };
    return { unseen: g('not seen yet'), seen: g('they read it') };
  });
  say(bub.unseen.bg === 'rgb(0, 34, 68)', `an unseen message is the owner's navy (${bub.unseen.bg})`);
  say(bub.unseen.ink === 'rgb(220, 235, 255)', `with near-white blue ink (${bub.unseen.ink})`);
  say(bub.seen.bg !== bub.unseen.bg, `and it still lights up once they read it (${bub.seen.bg})`);

  /* 10. A MONEY / CALL CARD NESTS. The icon is the shape in the card's top-left corner, so
         by the app's corner law its gap must be even and the card's radius must be the
         icon's plus that gap. It used to be an uneven 11/13 around a 10px-radius rounded
         square — a third corner radius belonging to no system, which is what read as off.
         Measure AFTER the entrance animation: it scales the card, and getBoundingClientRect
         includes transforms, so an early read reports every number ~0.82x and looks broken. */
  const card = await p.evaluate(async () => {
    AC.messages.push({ id: 9003, created_at: new Date().toISOString(), mine: false, body: '',
      meta: { t: 'money', amountCents: 100, note: 'Payment received' } });
    acRenderThread();
    await new Promise((r) => setTimeout(r, 1400));
    const row = [...document.querySelectorAll('#acThread .mc-inv-top')].pop();
    const c = row && row.closest('.meta-card'); if (!c) return null;
    const ic = row.querySelector('.mc-inv-ic,.mc-money-ic,.mc-call-ic');
    const C = c.getBoundingClientRect(), I = ic.getBoundingClientRect();
    return { cardR: parseFloat(getComputedStyle(c).borderTopLeftRadius),
      icR: getComputedStyle(ic).borderTopLeftRadius, icW: Math.round(I.width),
      left: +(I.left - C.left).toFixed(1), top: +(I.top - C.top).toFixed(1),
      bottom: +(C.bottom - I.bottom).toFixed(1) };
  });
  say(card && /50%|999/.test(card.icR), `the card's icon is a disc, not a third corner radius (${card ? card.icR : '?'})`);
  say(card && Math.abs(card.left - card.top) <= 1 && Math.abs(card.top - card.bottom) <= 1,
    `its gap is even on every side (${card ? card.left + ' / ' + card.top + ' / ' + card.bottom : '?'})`);
  say(card && Math.abs(card.cardR - (card.icW / 2 + card.left)) <= 1,
    `so the card's corner is concentric with it (${card ? card.cardR + ' = ' + card.icW / 2 + ' + ' + card.left : '?'})`);

  /* 11. THE ⋯ MENU OPENS OUT OF THE BUTTON, as the profile menu on Home does: it covers
         the ⋯ rather than hanging below it, and the ⋯ itself vanishes into it. */
  const menu = await p.evaluate(async () => {
    const d = document.getElementById('acThreadMenuBtn');
    const before = d.getBoundingClientRect();
    d.click();
    await new Promise((r) => setTimeout(r, 450));
    const sh = document.getElementById('acHeadMenuSheet').getBoundingClientRect();
    return { dotsTop: Math.round(before.top), dotsRight: Math.round(before.right),
      menuTop: Math.round(sh.top), menuRight: Math.round(sh.right),
      dotsOpacity: getComputedStyle(d).opacity };
  });
  say(Math.abs(menu.menuTop - menu.dotsTop) <= 2 && Math.abs(menu.menuRight - menu.dotsRight) <= 2,
    `it opens ON the ⋯, not under it (menu ${menu.menuTop}/${menu.menuRight} vs dots ${menu.dotsTop}/${menu.dotsRight})`);
  say(+menu.dotsOpacity === 0, 'and the ⋯ vanishes into it while it is open');
  const back = await p.evaluate(async () => {
    closeOverlay('acHeadMenu');
    await new Promise((r) => setTimeout(r, 700));
    return getComputedStyle(document.getElementById('acThreadMenuBtn')).opacity;
  });
  say(+back === 1, 'and comes back when the menu closes');

  say(errs.length === 0, `no JS errors${errs.length ? ' — ' + errs[0] : ''}`);
  await ctx.close();

  /* 8. Light theme: the same band, in white. */
  const l = await open('light');
  await l.p.locator('#acListScreen .ac-item[data-uid]').first().click({ timeout: 20000 });
  await l.p.waitForSelector('#acThreadScreen:not(.hidden)', { timeout: 20000 });
  await l.p.waitForTimeout(1500);
  const lt = await l.p.evaluate(() => {
    const cs = getComputedStyle(document.getElementById('acThreadScreen'), '::before');
    const first = (cs.backgroundImage.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/) || []).slice(1).map(Number);
    return { white: first[0] > 200 && first[1] > 200 && first[2] > 200,
      layers: document.querySelectorAll('#acThreadScreen .ac-topglass > *').length,
      dot: (() => { const d = document.getElementById('acPeerDot');
        return !!d && !d.classList.contains('hidden') && d.getBoundingClientRect().width > 1; })() };
  });
  say(lt.white, 'in Light the band fades to the page white, not to black');
  say(lt.layers >= 3, 'and the glass is there too');
  say(!lt.dot, 'and no phantom green dot in Light either');
  await l.ctx.close();

  await b.close();
  console.log(bad ? `\n${bad} FAILED` : '\nthe edge dissolves instead of dimming, and the dot only ever means what it says');
  process.exit(bad ? 1 : 0);
})();
