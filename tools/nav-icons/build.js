/* One generator for all five nav icons, so the family cannot drift apart.
   Every icon is produced at 512 and ends up as a white-on-transparent PNG mask —
   the same mechanism the app already used for its nav glyphs.

   - Beam / Engine / Account: the founder's OWN artwork, not a redraw. Normalised
     so all three rings land on the same radius, then the active state is the disc
     with their glyph punched out.
   - Home: their existing arch. The outline is the arch minus an eroded copy of
     itself, so the stroke follows their exact shape (including the doorway).
   - Notifications: mine to draw. No ring around it, per the brief — the bell's own
     form is what is rounded.                                                     */
const SP = process.env.PW_SCRATCH || '/tmp/';   // where playwright-core lives
const { chromium } = require(SP + 'node_modules/playwright-core');
const fs = require('fs');
const D = __dirname + '/';                      // artwork + output live beside this file
const N = 512, TARGET_R = 182;                 // the ring radius the set agrees on
/* ONE outline weight for all five, so nothing reads lighter than anything beside it.
   The founder drew their rings 34 units thick (182 outer, 148 inner). An earlier
   build derived Home and the bell with erode(shape, 34/2) — HALF that — which is why
   the Home outline looked thin next to the rings. Erosion by k leaves a k-thick edge,
   so the weight IS k. Overridable: `WEIGHT=52 node build.js`. */
const WEIGHT = Number(process.env.WEIGHT || 40);
const REF = { chat: 'ref-beam.jpg', search: 'ref-engine.jpg', profile: 'ref-account.jpg' };
const b64 = (f, mime) => `data:${mime};base64,` + fs.readFileSync(D + f).toString('base64');

/* A bell with no circle around it, rounder than a stock bell: the head is close to
   a true circle rather than a tapered dome, the rim is a fully-rounded bar, and the
   clapper is a disc. Sized so its visual mass matches the ringed icons beside it. */
const BELL = `
  <path d="M256 108a26 26 0 0 1 26 26v14a1 1 0 0 1-52 0v-14a26 26 0 0 1 26-26Z"/>
  <path d="M256 140c62 0 112 50 112 112v56a34 34 0 0 0 10 24l14 14a20 20 0 0 1-14 34H134a20 20 0 0 1-14-34l14-14a34 34 0 0 0 10-24v-56c0-62 50-112 112-112Z"/>
  <path d="M212 404h88a44 44 0 0 1-88 0Z"/>`;

(async () => {
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const p = await br.newPage();
  await p.goto('data:text/html,<body></body>');
  const res = await p.evaluate(async ({ N, TARGET_R, weight, refs, homeSrc, bell }) => {
    const load = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
    const ctx = () => { const c = document.createElement('canvas'); c.width = c.height = N; return c.getContext('2d', { willReadFrequently: true }); };
    const bits = (x) => { const d = x.getImageData(0, 0, N, N).data; const o = new Uint8Array(N * N);
      for (let i = 0; i < N * N; i++) o[i] = (d[i*4+3] > 128 && (d[i*4]*0.299 + d[i*4+1]*0.587 + d[i*4+2]*0.114) > 128) ? 1 : 0; return o; };
    /* Computed at 512 for accuracy, but SHIPPED at 160: these render at 17-24px, so
       160 is already 3x a retina tap target and the file is a fraction of the size. */
    const OUT = 160;
    const toPng = (mask) => { const c = document.createElement('canvas'); c.width = c.height = N;
      const x = c.getContext('2d'); const im = x.createImageData(N, N);
      for (let i = 0; i < N * N; i++) { im.data[i*4] = im.data[i*4+1] = im.data[i*4+2] = 255; im.data[i*4+3] = mask[i] ? 255 : 0; }
      x.putImageData(im, 0, 0);
      const s = document.createElement('canvas'); s.width = s.height = OUT;
      const sx = s.getContext('2d'); sx.imageSmoothingQuality = 'high';
      sx.drawImage(c, 0, 0, OUT, OUT);
      return s.toDataURL('image/png'); };
    // shrink a mask by k px — used to derive an outline from a filled shape
    const erode = (m, k) => { const o = new Uint8Array(N * N);
      for (let y = 0; y < N; y++) for (let x2 = 0; x2 < N; x2++) {
        if (!m[y*N+x2]) continue; let keep = 1;
        for (let dy = -k; dy <= k && keep; dy++) for (let dx = -k; dx <= k; dx++) {
          if (dx*dx + dy*dy > k*k) continue;
          const yy = y+dy, xx = x2+dx;
          if (yy < 0 || xx < 0 || yy >= N || xx >= N || !m[yy*N+xx]) { keep = 0; break; }
        }
        o[y*N+x2] = keep;
      } return o; };
    const bbox = (m) => { let x0=N,y0=N,x1=-1,y1=-1;
      for (let y=0;y<N;y++) for (let x2=0;x2<N;x2++) if (m[y*N+x2]) { if(x2<x0)x0=x2; if(x2>x1)x1=x2; if(y<y0)y0=y; if(y>y1)y1=y; }
      return { x0, y0, x1, y1, w: x1-x0+1, h: y1-y0+1 }; };
    const out = {};

    // ── the three the founder drew ───────────────────────────────────────────
    for (const [key, src] of Object.entries(refs)) {
      const probe = ctx(); probe.drawImage(await load(src), 0, 0, N, N);
      const pm = bits(probe);
      const row = N >> 1; let ox = -1, ix = -1;
      for (let x2 = 0; x2 < N; x2++) if (pm[row*N+x2]) { ox = x2; break; }
      if (ox >= 0) for (let x2 = ox; x2 < N; x2++) if (!pm[row*N+x2]) { ix = x2; break; }
      const scale = TARGET_R / (N/2 - ox);
      const c = ctx(); c.fillStyle = '#000'; c.fillRect(0,0,N,N);
      c.imageSmoothingQuality = 'high';
      const dw = N*scale, off = (N-dw)/2;
      c.drawImage(await load(src), off, off, dw, dw);
      const m = bits(c);
      const cx = N/2, drawnInner = TARGET_R - (ix - ox) * scale;
      /* Rebuild the ring at the shared WEIGHT and keep THEIR glyph exactly as drawn,
         so one number controls the whole set's weight without touching their shapes. */
      const innerR = TARGET_R - weight;
      const glyph = new Uint8Array(N*N), solid = new Uint8Array(N*N), outline = new Uint8Array(N*N);
      for (let y=0;y<N;y++) for (let x2=0;x2<N;x2++) {
        const r = Math.hypot(x2+0.5-cx, y+0.5-cx); const i = y*N+x2;
        glyph[i]   = (m[i] && r < drawnInner - 1) ? 1 : 0;           // their inner mark
        outline[i] = ((r <= TARGET_R && r >= innerR) || glyph[i]) ? 1 : 0;
        solid[i]   = (r <= TARGET_R && !glyph[i]) ? 1 : 0;
      }
      out[key] = { off: toPng(outline), on: toPng(solid), ring: [TARGET_R, +innerR.toFixed(1)] };
    }

    // ── Home: their arch, scaled to the family's size ────────────────────────
    {
      const raw = ctx(); raw.drawImage(await load(homeSrc), 0, 0, N, N);
      const rm = bits(raw); const bb = bbox(rm);
      // match the ringed icons' footprint (their disc is TARGET_R*2 across)
      const want = TARGET_R * 2, s = want / Math.max(bb.w, bb.h);
      const c = ctx(); c.imageSmoothingQuality = 'high';
      c.drawImage(await load(homeSrc), -bb.x0*s + (N-bb.w*s)/2, -bb.y0*s + (N-bb.h*s)/2, N*s, N*s);
      const solid = bits(c);
      const stroke = weight;   // erosion by k leaves a k-thick edge — the weight IS k
      const inner = erode(solid, stroke);
      const outline = new Uint8Array(N*N);
      for (let i = 0; i < N*N; i++) outline[i] = solid[i] && !inner[i] ? 1 : 0;
      out.home = { off: toPng(outline), on: toPng(solid), stroke };
    }

    // ── Notifications: the bell, no ring ─────────────────────────────────────
    {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><g fill="#fff">${bell}</g></svg>`;
      const img = await load('data:image/svg+xml;base64,' + btoa(svg));
      const c = ctx(); c.drawImage(img, 0, 0, N, N);
      const solid = bits(c); const bb = bbox(solid);
      // size the bell to the same footprint as the ringed icons
      const want = TARGET_R * 2, s = want / Math.max(bb.w, bb.h);
      const c2 = ctx(); c2.imageSmoothingQuality = 'high';
      c2.drawImage(img, -bb.x0*s + (N-bb.w*s)/2, -bb.y0*s + (N-bb.h*s)/2, N*s, N*s);
      const filled = bits(c2);
      const stroke = weight;
      const inner = erode(filled, stroke);
      const outline = new Uint8Array(N*N);
      for (let i = 0; i < N*N; i++) outline[i] = filled[i] && !inner[i] ? 1 : 0;
      out.notifs = { off: toPng(outline), on: toPng(filled), stroke };
    }
    return out;
  }, { N, TARGET_R, weight: WEIGHT,
       refs: Object.fromEntries(Object.entries(REF).map(([k,v]) => [k, b64(v, 'image/jpeg')])),
       homeSrc: b64('narch.png', 'image/png'), bell: BELL });

  const meta = {};
  for (const [k, v] of Object.entries(res)) {
    const w = (n, u) => { fs.writeFileSync(D + n, Buffer.from(u.split(',')[1], 'base64')); return fs.statSync(D + n).size; };
    const a = w(k + '-off.png', v.off), b = w(k + '-on.png', v.on);
    meta[k] = { off: v.off, on: v.on };
    console.log(`${k.padEnd(8)} off ${String(a).padStart(6)}B  on ${String(b).padStart(6)}B  ${v.ring ? 'ring ' + v.ring.join('/') : 'stroke ' + v.stroke}`);
  }
  fs.writeFileSync(D + 'built.json', JSON.stringify(meta));
  await br.close();
  console.log('built.json written');
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
