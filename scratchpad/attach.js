/* WHAT YOU ARE ABOUT TO SEND IS A THUMBNAIL, NOT THE MESSAGE.
 *
 * One photo used to fill the composer at up to 180px tall, inside a grey card, with the ✕
 * hanging OUTSIDE its top-left corner and a small eye+"1" chip underneath. The owner asked
 * for the size ChatGPT and Claude use: small square tiles in a row, the ✕ tucked inside the
 * top-right of each, and the eye gone.
 *
 * THE EYE WAS THE VIEW-ONCE TOGGLE — a real feature (a photo the other person can open
 * exactly once), so it was MOVED rather than deleted: into the attach menu beside Secret,
 * with a slim notice in the composer while it is armed. This probe holds that route open;
 * without it "remove the icon" would quietly remove the feature.
 *
 * The corner law is the one the owner keeps asking for: a tile sits 9 from the bar's edge,
 * so its radius must be the bar's minus that 9 — measured, never assumed.
 */
const { chromium } = require(process.env.PW ? process.env.PW + '/node_modules/playwright-core' : 'playwright-core');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:3262';
const IMG = (fill) => 'data:image/svg+xml;base64,' + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="${fill}"/></svg>`
).toString('base64');

(async () => {
  if (!process.env.TOK) { console.error('export TOK first'); process.exit(2); }
  const b = await chromium.launch({ executablePath: CHROME });
  let bad = 0;
  const say = (ok, m) => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : '✗   '} ${m}`); };

  for (const theme of ['black', 'light']) {
    const ctx = await b.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.evaluate(([t, th]) => { localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_theme', th); },
      [process.env.TOK, theme]);
    await p.goto(BASE + '/messages', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(5000);
    await p.evaluate(() => { const s = document.querySelector('#introSheet:not(.hidden)');
      if (s && typeof introDismiss === 'function') introDismiss(); });
    await p.locator('#acListScreen .ac-item[data-uid]').first().click({ timeout: 25000 });
    await p.waitForSelector('#acThreadScreen:not(.hidden)', { timeout: 25000 });
    await p.waitForTimeout(1400);

    const attach = (imgs) => p.evaluate(async (ds) => {
      AC.att = null; AC.imgs = ds; acRenderAttPrev(); acToggleSendMic();
      await new Promise(r => setTimeout(r, 350));
      const bar = document.querySelector('#acThreadScreen .msg-inbox');
      const B = bar.getBoundingClientRect();
      const tiles = [...bar.querySelectorAll('.ac-postimg-wrap')].map((n) => {
        const q = n.getBoundingClientRect();
        const x = n.querySelector('.msg-imgx'), X = x && x.getBoundingClientRect();
        return { w: Math.round(q.width), h: Math.round(q.height),
          r: parseFloat(getComputedStyle(n).borderTopLeftRadius),
          top: +(q.top - B.top).toFixed(1), left: +(q.left - B.left).toFixed(1),
          cy: +((q.top + q.bottom) / 2).toFixed(1),
          insideBar: q.left >= B.left - 0.5 && q.right <= B.right + 0.5
            && q.top >= B.top - 0.5 && q.bottom <= B.bottom + 0.5,
          xIn: !!X && X.left >= q.left - 0.5 && X.right <= q.right + 0.5
            && X.top >= q.top - 0.5 && X.bottom <= q.bottom + 0.5,
          xRight: X ? +(q.right - X.right).toFixed(1) : null,
          xTop: X ? +(X.top - q.top).toFixed(1) : null };
      });
      return { barH: Math.round(B.height), barR: parseFloat(getComputedStyle(bar).borderTopLeftRadius),
        tiles, eye: !!bar.querySelector('.ac-vo-chip') };
    }, imgs);

    const one = await attach([IMG('#dddddd')]);
    say(one.tiles.length === 1 && one.tiles[0].w === 56 && one.tiles[0].h === 56,
      `${theme}: one photo is a small square tile (${one.tiles[0] && one.tiles[0].w}x${one.tiles[0] && one.tiles[0].h})`);
    say(one.barH <= 130, `${theme}: and the composer stays a composer (${one.barH}px tall, was 200+ with a photo)`);
    say(!one.eye, `${theme}: no eye chip under the picture any more`);
    /* THE CORNER LAW: a shape inset by N inside a corner of radius R is concentric when its
       own radius is R − N. The tile sits in the bar's top-left, so both its insets must
       match each other AND its radius must be the bar's minus that inset. */
    const t = one.tiles[0];
    say(t.top === t.left, `${theme}: the tile is inset evenly from both edges of the corner (${t.left} / ${t.top})`);
    say(Math.abs(t.r - (one.barR - t.left)) <= 1,
      `${theme}: so its corner is concentric with the bar's — ${t.r} = ${one.barR} − ${t.left}`);
    say(t.xIn && t.xRight >= 2 && t.xRight <= 8 && t.xTop >= 2 && t.xTop <= 8,
      `${theme}: the ✕ is INSIDE its top-right corner (${t.xRight} from the right, ${t.xTop} from the top)`);

    const three = await attach([IMG('#dddddd'), IMG('#cc3333'), IMG('#338833')]);
    say(three.tiles.length === 3 && three.tiles.every((x) => x.w === 56),
      `${theme}: three photos are three tiles of the same size (${three.tiles.map(x => x.w).join(', ')})`);
    say(new Set(three.tiles.map((x) => x.cy)).size === 1,
      `${theme}: side by side on ONE row, never stacked`);
    say(three.tiles.every((x) => x.insideBar), `${theme}: and every one of them inside the bar`);
    say(three.barH === one.barH, `${theme}: three photos are no taller than one (${three.barH})`);

    /* VIEW ONCE still has a home. The tile lives in the menu's "More" half, exactly like
       Secret, so it is checked by its own inline display rather than the computed one. */
    const vo = await p.evaluate(async () => {
      AC.att = null; AC.imgs = [document.querySelector('.ac-postimg-wrap img').src];
      acRenderAttPrev(); acToggleAttachMenu();
      const tile = document.getElementById('acAtileViewOnce');
      const out = { exists: !!tile, offered: !!tile && tile.style.display !== 'none' };
      acToggleViewOnce();
      await new Promise(r => setTimeout(r, 250));
      out.armed = AC._viewOnce;
      out.notice = !document.getElementById('acViewOnceBar').classList.contains('hidden');
      acRemoveChatImg(0);
      await new Promise(r => setTimeout(r, 250));
      out.disarmed = !AC._viewOnce && document.getElementById('acViewOnceBar').classList.contains('hidden');
      return out;
    });
    say(vo.exists && vo.offered, `${theme}: view once moved to the attach menu, offered when a photo is attached`);
    say(vo.armed && vo.notice, `${theme}: arming it says so in the composer instead of badging the picture`);
    say(vo.disarmed, `${theme}: and taking the photo away disarms it, so the notice can never lie`);

    /* A file is a row of TEXT, so its ✕ goes at the END of the row — in a corner it lands
       on the filename, which is exactly what it did on the first attempt. */
    const file = await p.evaluate(async () => {
      AC.imgs = []; AC.att = { kind: 'file', name: 'Quarterly report.pdf', data: 'x' };
      acRenderAttPrev(); acToggleSendMic();
      await new Promise(r => setTimeout(r, 300));
      const card = document.querySelector('#acAttPrev .ac-att-card');
      const x = document.querySelector('#acAttPrev .msg-imgx');
      const nm = document.querySelector('#acAttPrev .ac-att-meta b');
      if (!card || !x || !nm) return null;
      const C = card.getBoundingClientRect(), X = x.getBoundingClientRect(), N = nm.getBoundingClientRect();
      const cs = getComputedStyle(card);
      const ic = getComputedStyle(card.querySelector('.ac-att-ic')).backgroundColor;
      const lum = (ic.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number)
        .reduce((a, v) => a + v, 0) / 3;
      return { clear: X.left >= N.right - 0.5, inCard: X.right <= C.right + 0.5,
        r: parseFloat(cs.borderTopLeftRadius), h: Math.round(C.height),
        bw: parseFloat(cs.borderTopWidth), ic, icLight: lum > 200 };
    });
    say(file && file.clear && file.inCard,
      `${theme}: a file's ✕ sits after its name, not on top of it`);
    say(file && Math.abs(file.r - (one.barR - 9)) <= 1,
      `${theme}: and the file card shares the tile's corner (${file && file.r})`);
    /* A DOCUMENT IS A BOX THE HEIGHT OF A PHOTO, WITH AN OUTLINE (owner). The height is
       what lets a PDF and a picture sit on one line; the outline is what stops it reading
       as loose text on the bar. Its icon is the page — light, with the glyph cut into it. */
    say(file && file.h === 56, `${theme}: a document is the same height as a photo tile (${file && file.h})`);
    say(file && file.bw >= 1, `${theme}: and it carries an outline (${file && file.bw}px)`);
    say(file && file.icLight, `${theme}: with a white page for its icon (${file && file.ic})`);

    say(errs.length === 0, `${theme}: no JS errors` + (errs.length ? ' — ' + errs[0] : ''));
    await ctx.close();
  }

  await b.close();
  console.log(bad ? `\n${bad} FAILED` : '\nattachments are thumbnails in a row, and view once still has a home');
  process.exit(bad ? 1 : 0);
})();
