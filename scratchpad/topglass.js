/* THE WORLD BARS ARE GLASS, NOT A BLACK WALL.
 *
 * The founder: content should pass UNDER the bar and dissolve as it rises — blurriest
 * and most tinted at the very top, clearest at the bar's bottom edge — instead of
 * vanishing behind an opaque slab. Same material as a conversation's own top edge.
 *
 * What this guards:
 *  1. the bar paints NO fill of its own on Home / Beam / Engine / Notifications, and
 *     carries a .tb-glass layer that really is a progressive blur (four stacked passes,
 *     each with a real backdrop-filter, radii increasing toward the top);
 *  2. the tint is NEVER opaque — an opaque plateau reads as a slab switching on at a
 *     fixed distance down the screen, which is the mistake three passes on the chat
 *     edge made before it was written down;
 *  3. content genuinely shows THROUGH it: with the glass removed the same scrolled
 *     screen looks materially different in the bar's own band;
 *  4. the glass stays PINNED to the top of the screen while the bar slides up as the
 *     brand row collapses — it must not shrink with the bar, or the dissolve collapses
 *     into a hard edge exactly when it is most needed;
 *  5. an inside page's plain bar gets no glass (nothing scrolls under it, so a tint
 *     there is just an unexplained shadow).
 *
 * Self-test: put the black wall back and this goes red — but revert the right rule.
 * `.topbar{background}` is (0,1,0) and is NOT what governs the installed app; the mode
 * under test is brand-collapse, whose own `body.brand-collapse .topbar.tb-home` rule is
 * (0,3,0) and wins. Reverting the base rule changes nothing and the probe passes, which
 * is not the probe being weak — it is the wrong revert. Reverting the brand-collapse one
 * gives 0px of difference in the bar's band against a comfortable pass.
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const PORT = process.env.PORT || 3262;
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const STANDALONE = `(() => { const mm = window.matchMedia.bind(window);
  window.matchMedia = (q) => (String(q).includes('display-mode: standalone')
    ? { matches:true, media:q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} } : mm(q)); })();`;
let ok = 0; const fails = [];
const chk = (c, m) => { if (c) ok++; else fails.push(m); };

const WORLDS = [
  { name: 'Home',          go: null,               bar: '.topbar' },
  { name: 'Beam',          go: "appTab('chat')",   bar: '.topbar' },
  { name: 'Engine',        go: "appTab('search')", bar: '.topbar' },
  { name: 'Notifications', go: 'acNavNotifs()',    bar: '#notifHead' },
];

(async () => {
  const tok = fs.readFileSync('/tmp/tok.txt', 'utf8').trim();
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });

  for (const theme of ['black', 'light']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    await p.addInitScript(STANDALONE);
    await p.addInitScript(([t, th]) => { localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_theme', th); }, [tok, theme]);
    await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(4500);
    await p.evaluate(() => { const s = document.querySelector('#introSheet:not(.hidden)');
      if (s && typeof introDismiss === 'function') introDismiss(); });

    for (const w of WORLDS) {
      if (w.go) { await p.evaluate((g) => { try { eval(g); } catch (e) {} }, w.go); await p.waitForTimeout(2200); }
      const r = await p.evaluate((sel) => {
        const bar = [...document.querySelectorAll(sel)].find((e) => {
          const q = e.getBoundingClientRect(); return q.height > 20 && getComputedStyle(e).display !== 'none';
        });
        if (!bar) return { missing: true };
        const g = bar.querySelector('.tb-glass');
        if (!g) return { noGlass: true };
        const gs = getComputedStyle(g);
        const layers = [...g.children].map((i) => {
          const cs = getComputedStyle(i);
          const m = (cs.backdropFilter || cs.webkitBackdropFilter || '').match(/blur\((\d+(?:\.\d+)?)px\)/);
          return m ? parseFloat(m[1]) : 0;
        });
        // every alpha the tint gradient declares — none may reach 1
        const alphas = (gs.backgroundImage.match(/rgba\([^)]*\)/g) || []).map((c) => {
          const n = c.match(/[\d.]+/g); return n && n.length === 4 ? parseFloat(n[3]) : 1;
        });
        return { barBg: getComputedStyle(bar).backgroundColor, layers,
          maxAlpha: alphas.length ? Math.max(...alphas) : 1, nAlphas: alphas.length,
          display: gs.display };
      }, w.bar);
      const T = `${theme} ${w.name}:`;
      if (r.missing) { chk(false, `${T} the bar was not found`); continue; }
      if (r.noGlass) { chk(false, `${T} the bar carries no glass layer`); continue; }
      chk(/rgba\(.*,\s*0\)/.test(r.barBg), `${T} the bar paints no fill of its own (${r.barBg})`);
      chk(r.display === 'block', `${T} the glass is showing (${r.display})`);
      chk(r.layers.length >= 4 && r.layers.every((x) => x > 0),
        `${T} four real blur passes (${r.layers.join('/')})`);
      chk(r.layers[0] < r.layers[r.layers.length - 1],
        `${T} the blur RAMPS — strongest at the top, not one flat frost (${r.layers.join('/')})`);
      chk(r.maxAlpha <= 0.92 && r.nAlphas >= 8,
        `${T} the tint is never opaque and has no flat step (max ${r.maxAlpha}, ${r.nAlphas} stops)`);
      await p.evaluate(() => { document.querySelectorAll('.overlay:not(.hidden)').forEach((o) => closeOverlay(o.id, true)); });
      await p.waitForTimeout(400);
    }
    await ctx.close();
  }

  /* Content really does show through — measured against the same screen with the glass
     removed, so this cannot pass on a bar that is merely transparent over the page. */
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    await p.addInitScript(STANDALONE);
    await p.addInitScript((t) => localStorage.setItem('atwe_token', t), tok);
    await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(4500);
    await p.evaluate(() => { const s = document.querySelector('#introSheet:not(.hidden)');
      if (s && typeof introDismiss === 'function') introDismiss(); });
    /* PUT KNOWN CONTENT UNDER THE BAR. Relying on whatever the feed happened to serve
       made this flaky by a factor of ten (4150px one run, 408 the next): the already-seen
       filter serves different posts every time, and on a run where the band under the bar
       was empty page there was nothing to reveal and the check failed on correct code.
       A bright block of a known size removes the feed from the question entirely. */
    const scroll = () => p.evaluate(() => {
      const f = document.getElementById('acFeed');
      let d = document.getElementById('__glassProbe');
      if (!d) { d = document.createElement('div'); d.id = '__glassProbe';
        d.style.cssText = 'height:420px;background:#ffffff;'; f.insertBefore(d, f.firstChild); }
      /* Stop where the block is actually UNDER the bar. The feed is padded by the bar's
         full height, so at a scrollTop of ~300 the block spans the whole top band; at 720
         it has scrolled clean past and there is nothing bright left to reveal — which is
         how an earlier version of this passed with the black wall put back. */
      f.scrollTop = 0; for (let i = 0; i < 5; i++) { f.scrollTop += 60; f.dispatchEvent(new Event('scroll')); }
    });
    await scroll(); await p.waitForTimeout(700);

    /* 4. PINNED while the bar slides. The bar's own top goes negative as the brand row
       collapses; the glass must stay at 0 and keep its height. */
    const pin = await p.evaluate(() => {
      const tb = document.querySelector('.topbar'), g = tb.querySelector('.tb-glass');
      return { barTop: tb.getBoundingClientRect().top, glassTop: g.getBoundingClientRect().top,
        glassH: g.getBoundingClientRect().height, hide: tb.style.getPropertyValue('--tb-hide') };
    });
    chk(pin.barTop < -8, `the bar really does slide up as the brand row collapses (${pin.barTop.toFixed(0)})`);
    chk(Math.abs(pin.glassTop) < 1.5, `the glass stays pinned to the top of the screen (${pin.glassTop.toFixed(1)})`);
    chk(pin.glassH > 100, `and keeps its full height rather than shrinking with the bar (${pin.glassH.toFixed(0)})`);

    /* THE BAND MUST BE THE BAR'S OWN BOX, not the whole top of the screen. The glass
       runs on BELOW the bar as a tail, and that tail dissolves content whether or not
       the bar itself is see-through — so a band that includes it largely measures the
       tail and nearly passed with the bar's black wall put back (5287px against a 5990
       bar). Restricted to the bar's own visible height, an opaque bar has almost
       nothing to reveal and the check separates cleanly. */
    const band = await p.evaluate(() => {
      const tb = document.querySelector('.topbar'); const r = tb.getBoundingClientRect();
      return { x: 0, y: 0, width: 390, height: Math.max(24, Math.round(r.bottom)) };
    });
    const withGlass = await p.screenshot({ clip: band });
    await p.addStyleTag({ content: '.tb-glass{display:none!important}' });
    await p.waitForTimeout(400);
    const without = await p.screenshot({ clip: band });
    const diff = await p.evaluate(async ([a, c]) => {
      const load = (b64) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + b64; });
      const [ia, ib] = await Promise.all([load(a), load(c)]);
      const cv = document.createElement('canvas'); cv.width = ia.width; cv.height = ia.height;
      const g = cv.getContext('2d');
      g.drawImage(ia, 0, 0); const A = g.getImageData(0, 0, cv.width, cv.height).data;
      g.clearRect(0, 0, cv.width, cv.height); g.drawImage(ib, 0, 0);
      const B = g.getImageData(0, 0, cv.width, cv.height).data;
      let n = 0, worst = 0;
      for (let i = 0; i < A.length; i += 4) {
        const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]));
        if (d > 12) n++; if (d > worst) worst = d;
      }
      return { n, worst, total: A.length / 4 };
    }, [withGlass.toString('base64'), without.toString('base64')]);
    chk(diff.n > diff.total * 0.25 && diff.worst > 30,
      `content really shows through the bar — the band changes when the glass is removed (${diff.n} px, worst ${diff.worst})`);
    await ctx.close();
  }
  await b.close();
  if (fails.length) console.log('== FAILS ==\n' + fails.map((f) => '  FAIL ' + f).join('\n'));
  console.log(`ok checks: ${ok}`);
  console.log(fails.length ? `${fails.length} FAILED` : 'the top bar is glass, and content dissolves into it');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
