// The profile header is a CARD, not a full-bleed strip.
//
// What this guards, and why each one is here:
//  1. the banner is inset by --feed-gutter on both sides and turns on --post-card-r,
//     so it belongs to the same system as every post card below it;
//  2. the back arrow is a SOLID grey circle nested CONCENTRICALLY in the card's
//     top-left corner — the app's corner law, outer radius = inner radius + gap.
//     Asserted as a relationship, not as a number, so changing --post-card-r or the
//     button's size keeps it honest;
//  3. the profile picture's VISIBLE circle (not its box — the 4px ring is
//     page-coloured and deliberately hangs outside) sits on the card's left edge,
//     and the name below sits on the same line;
//  4. the two round action buttons are SOLID, not bare glyphs. They used to carry
//     their fill on :hover only, which never happens on a phone;
//  5. the two places where the picture's cut meets the card's outline are FILLETED —
//     blended with an arc tangent to both curves — instead of meeting at a corner.
//     Checked two ways: the arithmetic of the live path (so a future change to the
//     card's radius or the picture's size that breaks tangency fails), and REAL
//     PIXELS (the banner's own edge stops much higher up the card, and reaches much
//     further along the bottom, than a plain circular cut would leave it);
//  6. the loading skeleton is the same shape, so nothing changes shape as it lands.
//
// Self-test: revert .ac-prof-banner to full-bleed, or .ac-icon-btn to transparent,
// and this goes red.
const { chromium } = require('playwright-core');
const fs = require('fs');
const PORT = process.env.PORT || 3262;
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let ok = 0; const fails = [];
const chk = (c, m) => { if (c) ok++; else fails.push(m); };
const near = (a, b, t, m) => chk(Math.abs(a - b) <= t, `${m} (${a} vs ${b})`);

(async () => {
  const tok = fs.readFileSync('/tmp/tok.txt', 'utf8').trim();
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });

  for (const theme of ['black', 'light']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    await p.addInitScript(([t, th]) => { localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_theme', th); }, [tok, theme]);
    await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3500);
    await p.evaluate(() => acGoProfile('emptytester'));
    await p.waitForTimeout(2200);

    const m = await p.evaluate(() => {
      const box = s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e); return { l: r.left, t: r.top, r: r.right, w: r.width, h: r.height,
          rad: parseFloat(cs.borderRadius) || 0, bg: cs.backgroundColor, ring: parseFloat(cs.borderLeftWidth) || 0 }; };
      const cs = getComputedStyle(document.body);
      return { banner: box('#acProfileBody .ac-prof-banner'), ava: box('#acProfileBody .ac-prof-ava'),
        back: box('#acProfileScreen .ac-prof-back'), icon: box('#acProfileScreen .ac-prof-actions .ac-icon-btn'),
        actions: box('#acProfileScreen .ac-prof-actions'), name: box('#acProfileBody .ac-prof-name'),
        gutter: parseFloat(cs.getPropertyValue('--feed-gutter')), cardR: parseFloat(cs.getPropertyValue('--post-card-r')),
        s2: cs.getPropertyValue('--s2').trim(), pageW: window.innerWidth };
    });
    const T = `${theme}:`;

    // 1. the banner is a card on the post-card gutter and the post-card corner
    near(m.banner.l, m.gutter, 0.6, `${T} banner starts on the gutter`);
    near(m.pageW - m.banner.r, m.gutter, 0.6, `${T} banner ends on the gutter`);
    near(m.banner.rad, m.cardR, 0.6, `${T} banner turns on --post-card-r`);
    chk(m.banner.t >= m.gutter - 0.6, `${T} banner has a gap above it (${m.banner.t})`);

    // 2. back arrow: solid, and concentric in the card's corner
    chk(m.back.w === m.back.h, `${T} back arrow is a circle`);
    const gapL = m.back.l - m.banner.l, gapT = m.back.t - m.banner.t;
    near(gapL, gapT, 0.6, `${T} back arrow is evenly inset into the corner`);
    near(m.cardR, m.back.w / 2 + gapL, 0.6, `${T} back arrow is CONCENTRIC (card r = button r + gap)`);
    chk(!/rgba\(.*,\s*0\)/.test(m.back.bg), `${T} back arrow has a real fill, not transparent (${m.back.bg})`);

    // 3. the picture's visible circle, and the name, sit on the card's left edge
    near(m.ava.l + m.ava.ring, m.banner.l, 0.6, `${T} picture's visible circle is flush with the card`);
    near(m.name.l, m.banner.l, 0.6, `${T} name sits on the same line as the picture`);
    chk(m.ava.ring > 0, `${T} the picture keeps its ring (it separates it from the photo)`);

    // 4. the round action buttons are solid, and end on the card's right edge
    chk(!/rgba\(.*,\s*0\)/.test(m.icon.bg), `${T} action buttons are SOLID, not bare (${m.icon.bg})`);
    near(m.actions.r, m.banner.r, 0.6, `${T} actions end on the card's right edge`);

    await ctx.close();
  }

  // 5. the fillets — arithmetic first, then real pixels
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    await p.addInitScript(t => localStorage.setItem('atwe_token', t), tok);
    await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3500);
    await p.evaluate(() => acGoProfile('emptytester'));
    await p.waitForTimeout(2500);

    /* (a) THE TWO BLENDS MUST BE THE SAME SIZE. The founder read the left one as
       visibly bigger, and it was: the cut meets the bottom edge almost square-on but
       the left edge at a shallow angle, so one radius sweeps far more curve there.
       What is asserted is the OUTCOME on the shipped path — equal ARC LENGTH — not a
       re-run of the maths, so a change to how it is solved is still judged by the
       eye's own measure. */
    const geo = await p.evaluate(() => {
      const n = document.querySelector('#acProfileBody .ac-prof-notch');
      const ava = document.querySelector('#acProfileBody .ac-prof-ava');
      const banner = document.querySelector('#acProfileBody .ac-prof-banner');
      const d = (n.style.clipPath || '').replace(/^path\(['"]?|['"]?\)$/g, '');
      // M x y  A r r 0 0 s x y  (x3 for: bottom fillet, the cut, left fillet)
      const nums = (d.match(/-?\d+(\.\d+)?/g) || []).map(Number);
      const arcs = []; let i = 0;
      const re = /([MLA])([^MLAZ]*)/g; let m, pen = null;
      while ((m = re.exec(d))) {
        const v = (m[2].match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
        if (m[1] === 'M' || m[1] === 'L') pen = [v[0], v[1]];
        else if (m[1] === 'A' && pen) {
          const to = [v[5], v[6]];
          arcs.push({ r: v[0], chord: Math.hypot(to[0] - pen[0], to[1] - pen[1]) });
          pen = to;
        }
      }
      const len = (a) => a.r * 2 * Math.asin(Math.min(1, a.chord / (2 * a.r)));
      return { arcs: arcs.map((a) => ({ r: a.r, len: +len(a).toFixed(2) })),
        avaR: ava.getBoundingClientRect().width / 2,
        cardR: parseFloat(getComputedStyle(banner).borderBottomLeftRadius) || 0,
        clipped: !!n.style.clipPath, nums: nums.length };
    });
    chk(geo.clipped, 'the cut is a clipped shape, not an unclipped slab');
    chk(geo.arcs.length >= 3, `the shape is fillet + cut + fillet (${geo.arcs.length} arcs)`);
    if (geo.arcs.length >= 3) {
      const [f2, cut, f1] = geo.arcs;
      near(cut.r, geo.avaR, 0.6, "the cut follows the picture's own edge");
      chk(f2.r >= 4 && f1.r >= 4, `both blends are real curves, not hairlines (${f1.r} / ${f2.r})`);
      chk(Math.abs(f1.len - f2.len) <= Math.max(f1.len, f2.len) * 0.03,
        `the two blends draw the same LENGTH of curve, so they read as one pair (${f1.len} vs ${f2.len})`);
      chk(Math.abs(f1.r - f2.r) > 0.5,
        `...which needs two different radii, because the cut meets each edge at a different angle (${f1.r} vs ${f2.r})`);
    }

    /* (b) REAL PIXELS. A plain circular cut leaves the banner's own left edge running
       down to where the circle crosses it; the fillet takes it away far higher, and
       carries the banner further along the bottom. Both are measured against what the
       un-filleted shape would give, which is why hiding the overlay fails this. */
    /* Paint the banner a flat bright colour first: the check reads where the BANNER
       ends, and against a real photo (or the default dark gradient) "banner" and
       "page" are not separable — an early version read the grey default avatar as
       banner and reported the same number either way. */
    await p.evaluate(() => { const b = document.querySelector('#acProfileBody .ac-prof-banner');
      b.style.backgroundImage = 'none'; b.style.backgroundColor = '#ffffff'; });
    await p.waitForTimeout(200);
    const edges = async () => {
      const shot = await p.screenshot({ clip: { x: 0, y: 0, width: 200, height: 220 } });
      return p.evaluate(async (b64) => {
        const img = new Image(); img.src = 'data:image/png;base64,' + b64;
        await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        const S = c.width / 200;                       // device pixels per css px
        const banner = document.querySelector('#acProfileBody .ac-prof-banner');
        const bb = banner.getBoundingClientRect();
        // only the flat white banner clears this — never the grey avatar, never the page
        const lit = (x, y) => { const i = ((y * c.width) + x) * 4 | 0; return px[i] + px[i + 1] + px[i + 2] > 690; };
        // lowest point at which the banner still touches its own left edge
        let low = 0;
        const xs = Math.round((bb.left + 2) * S);
        for (let y = Math.round(bb.top * S); y < Math.round((bb.top + bb.height) * S); y++) if (lit(xs, y)) low = y;
        // furthest right the banner reaches along its own bottom edge
        let right = 0;
        const ys = Math.round((bb.top + bb.height - 2) * S);
        for (let x = Math.round(bb.left * S); x < c.width; x++) if (lit(x, ys)) { right = x; break; }
        return { lowFromBottom: (bb.top + bb.height) - low / S, rightFromLeft: right / S - bb.left };
      }, shot.toString('base64'));
    };
    const withFillet = await edges();
    await p.evaluate(() => { document.querySelector('#acProfileBody .ac-prof-notch').style.display = 'none'; });
    await p.waitForTimeout(200);
    const plain = await edges();
    chk(withFillet.lowFromBottom > plain.lowFromBottom + 8,
      `the cut leaves the card's left edge far higher than a plain circle would (${withFillet.lowFromBottom.toFixed(1)} vs ${plain.lowFromBottom.toFixed(1)})`);
    /* The gain here is smaller than the fillet's tangent point suggests (its arc has
       already curved back in by the row being read), so the bar is set to what the
       un-filleted shape genuinely cannot reach, not to the tangent point. */
    chk(withFillet.rightFromLeft > plain.rightFromLeft + 3.5,
      `and carries further along the bottom edge (${withFillet.rightFromLeft.toFixed(1)} vs ${plain.rightFromLeft.toFixed(1)})`);
    await ctx.close();
  }

  // 6. the loading skeleton is the same shape (hold the profile fetch open)
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    await p.addInitScript(t => localStorage.setItem('atwe_token', t), tok);
    await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3500);
    await p.route('**/api/social/profile/**', async r => { await new Promise(z => setTimeout(z, 6000)); r.abort(); });
    await p.evaluate(() => acGoProfile('emptytester'));
    await p.waitForTimeout(700);
    const s = await p.evaluate(() => {
      const e = document.querySelector('#acProfileBody .skel'); if (!e) return null;
      const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
      const a = document.querySelector('#acProfileBody .skel-ava');
      const ar = a ? a.getBoundingClientRect() : null; const aw = a ? parseFloat(getComputedStyle(a).borderLeftWidth) || 0 : 0;
      return { l: r.left, r: r.right, rad: parseFloat(cs.borderRadius) || 0, h: r.height,
        avaInk: ar ? ar.left + aw : null, gutter: parseFloat(getComputedStyle(document.body).getPropertyValue('--feed-gutter')),
        cardR: parseFloat(getComputedStyle(document.body).getPropertyValue('--post-card-r')), pageW: window.innerWidth };
    });
    chk(!!s, 'skeleton renders while the profile loads');
    if (s) {
      near(s.l, s.gutter, 0.6, 'skeleton banner starts on the gutter');
      near(s.pageW - s.r, s.gutter, 0.6, 'skeleton banner ends on the gutter');
      near(s.rad, s.cardR, 0.6, 'skeleton banner turns on --post-card-r');
      near(s.h, 148, 1, 'skeleton banner is the real banner height');
      near(s.avaInk, s.gutter, 0.6, 'skeleton picture is flush with the card too');
    }
    await ctx.close();
  }

  await b.close();
  if (fails.length) { console.log('== FAILS ==\n' + fails.map(f => '  FAIL ' + f).join('\n')); }
  console.log(`ok checks: ${ok}`);
  console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
