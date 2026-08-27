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
const WEIGHT = Number(process.env.WEIGHT || 38);
/* How far to round the Home arch's feet — the founder asked for the point taken off them.
   34 is the most rounding the shape survives: at 42 the CLOSE fills the doorway's bottom
   and the two legs fuse into an arch. Overridable: `FOOT=28 node build.js`. */
const FOOT = Number(process.env.FOOT || 34);
/* And the DOORWAY's two inside corners, separately and MORE — the founder wants those
   rounder while the feet stay put. Applied locally (see roundInnerFeet), so unlike a global
   radius it cannot eat the doorway. `DOORWAY=60 node build.js`. */
const DOORWAY = Number(process.env.DOORWAY || 60);
const REF = { chat: 'ref-beam.jpg', search: 'ref-engine.jpg', profile: 'ref-account.jpg' };
const b64 = (f, mime) => `data:${mime};base64,` + fs.readFileSync(D + f).toString('base64');

/* THE BELL. No ring around it and no hanger ball on top, and the sides lean OUT a little
   rather than dropping straight (owner: a perfectly vertical bell read as too rigid).

   The lean is built TANGENTIALLY, and that is the whole point of this construction. The
   first version drew a full semicircle dome and then started the slanted side from its
   end point — but a semicircle's edge arrives VERTICAL, so the outward slant began with a
   visible kink. The founder called it "the twist" and asked for one even, straight slant
   instead. So the dome stops short on each side, exactly where its tangent already equals
   the side's lean, and the straight side continues from there: curve flows into line with
   no corner at all. LEAN is that angle in degrees, and every point below is derived from it —
   nothing here is a hand-placed coordinate, so changing LEAN keeps the shape correct.
   LARGE-ARC IS 0, and getting that wrong is not subtle: the tangent points sit ABOVE the
   circle's centre, so the arc over the top is SHORTER than a semicircle (180 - 2*LEAN).
   Asking for the large arc makes SVG choose a different circle through the same two points
   entirely, and the side develops a visible bulge — worse than the kink this replaces.

   CORNER rounds the two bottom corners. The fillet's tangent length is cr/tan(45deg+LEAN/2)
   — not simply cr — because the corner is not a right angle once the side leans out.

   The clapper renders SOLID rather than outlined and that is inherent, not a bug: the
   outline is derived by eroding by WEIGHT, and a shape barely thicker than WEIGHT has
   nothing left to hollow out. */
const LEAN   = Number(process.env.LEAN   || 20);   // degrees the sides lean out from vertical
const CORNER = Number(process.env.CORNER || 82);   // radius of the two bottom corners
/* THE CAP IS AN ELLIPSE, and that is the whole reason it can be both wide and shallow.
   With a circular dome its width and its height are ONE number, so making the sides read
   as straight lines (which needs a short cap) also made the top narrow — the founder saw
   that immediately: "you made the top narrow, I want it wider and more rounded, matching
   the other icons". An ellipse splits them:
     DOME_W  how WIDE and round the top is   — the thing being matched to the ring icons
     DOME_H  how TALL the cap is             — what keeps the sides long and straight
   Tangency still holds, so there is still no kink: the join angle t solves
   tan t = (DOME_H/DOME_W)·tan(LEAN), and every point below is derived from it.
   Measured against a ring icon: at 88/88 the cap ran 27% of the bell's height but the
   shoulders sat only 84 from centre and it read pinched; a wide-and-shallow 112/76 fixed
   the width but left a visible BEND at the shoulder, which the founder marked. That bend
   is a CURVATURE jump, not a kink: a tangent-continuous arc meeting a line still goes from
   the arc's curvature to zero in one step, and the tighter the arc is there, the more it
   shows. The curvature radius at the join is what to watch — 112/76 gives 54, and the
   shipped 104/104 gives 104, nearly twice as gentle. So the cap is back to a TRUE CIRCLE,
   but a much bigger one than the 88 that read pinched, with LEAN at 20 to keep the sides
   long and straight underneath it. Past about 128/64 the shape flattens and stops reading
   as a bell. */
const DOME_W = Number(process.env.DOME_W || 104);  // cap half-width
const DOME_H = Number(process.env.DOME_H || 104);  // cap height
/* And the INNER shape's two bottom corners, which came to a sharp point (founder: "the
   inside bottom corners are still pointy... a little round, similar to the home icon").
   Applied LOCALLY, exactly like roundInnerFeet on the arch: a global open also rounds
   the inner dome and visibly thickens the shoulders, and a generous carve-box does the
   same thing more slowly — 1.1x the radius is tight enough to stay at the bottom.
   IT IS 0, AND THAT IS THE FIX, NOT A REGRESSION. Artificially rounding the inner corner
   is what made the bottom look wrong: the founder marked it as "the inside is more rounded
   than the outside". The real relationship is exact — a stroke of width WEIGHT around an
   outer corner of radius CORNER leaves an inner radius of exactly CORNER - WEIGHT. At
   CORNER=44 that was 6, nearly sharp, which is why the inner corner ever needed help; the
   help then overshot the outside. Raising CORNER to 82 gives 82-38 = 44 inside, so the two
   curves are CONCENTRIC BY CONSTRUCTION — evenly round by definition, nothing to tune.
   Keep this at 0 unless the stroke and the corner stop being able to do that on their own. */
const BELL_INNER = Number(process.env.BELL_INNER || 0);
const BELL = () => {
  const A = DOME_W, B = DOME_H, CX = 256, TOP = 150, CY = TOP + B, YB = 376;  // top stays put
  const th = LEAN * Math.PI / 180;
  // Where the ellipse's tangent already equals the side's lean — the join with no kink.
  const t = Math.atan((B / A) * Math.tan(th));
  const txR = CX + A * Math.cos(t), txL = CX - (txR - CX), ty = CY - B * Math.sin(t);
  const run = (YB - ty) / Math.cos(th);            // how far the straight side travels
  const bxR = txR + run * Math.sin(th), bxL = CX - (bxR - CX);
  const d = CORNER / Math.tan(Math.PI / 4 + th / 2);   // fillet tangent length
  const f = (n) => (+n).toFixed(1);
  const aR = [bxR - d * Math.sin(th), YB - d * Math.cos(th)], bR = [bxR - d, YB];
  const aL = [bxL + d * Math.sin(th), YB - d * Math.cos(th)], bL = [bxL + d, YB];
  return `
  <path d="M${f(txL)} ${f(ty)}A${A} ${B} 0 0 1 ${f(txR)} ${f(ty)}L${f(aR[0])} ${f(aR[1])}A${CORNER} ${CORNER} 0 0 1 ${f(bR[0])} ${f(bR[1])}H${f(bL[0])}A${CORNER} ${CORNER} 0 0 1 ${f(aL[0])} ${f(aL[1])}Z"/>
  <path d="M212 400h88a44 44 0 0 1-88 0Z"/>`;
};

(async () => {
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const p = await br.newPage();
  await p.goto('data:text/html,<body></body>');
  const res = await p.evaluate(async ({ N, TARGET_R, weight, foot, doorway, bellInner, refs, homeSrc, bell }) => {
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
    // grow a mask by k px — the counterpart to erode, used to round corners
    const dilate = (m, k) => { const o = new Uint8Array(N * N);
      for (let y = 0; y < N; y++) for (let x2 = 0; x2 < N; x2++) {
        if (!m[y*N+x2]) continue;
        for (let dy = -k; dy <= k; dy++) for (let dx = -k; dx <= k; dx++) {
          if (dx*dx + dy*dy > k*k) continue;
          const yy = y+dy, xx = x2+dx;
          if (yy >= 0 && xx >= 0 && yy < N && xx < N) o[yy*N+xx] = 1;
        }
      } return o; };
    /* Round a shape's convex corners: an OPEN (erode then dilate) at radius r. On the Home
       arch that is the two outer feet AND the two inner corners where each leg meets the
       doorway — all four are convex, so one open moves them together. */
    const roundCorners = (m, r) => dilate(erode(m, r), r);
    /* The founder wants the DOORWAY's two inside corners rounder than the feet, and the feet
       left exactly as they are. A bigger open would round all four; a CLOSE is the wrong tool
       entirely (it rounds CONCAVE corners, and these are convex — all it actually did was
       fill the doorway in from the bottom and turn the arch into a blob once the radius
       passed half the doorway's width).
       So: open the whole shape at the bigger radius, then keep that result ONLY inside a
       small box around each inner corner. An open only ever removes pixels, so this carves
       those two corners and cannot touch anything else. */
    /* Round the INNER shape's two bottom corners — the bell's, which came to a sharp
       point. Same idea as roundInnerFeet: open the whole thing, then keep that result
       only inside a TIGHT box at each bottom corner. An open can only remove pixels, so
       nothing outside those boxes can change. The box is 1.1x the radius on purpose: at
       1.6x it reached far enough up to round the inner dome as well and thicken the
       shoulders, which is the very thing a global open does wrong. */
    const roundBottomCorners = (m, r) => {
      if (!(r > 0)) return m;
      let yb = -1;
      for (let y = N - 1; y >= 0 && yb < 0; y--) for (let x = 0; x < N; x++) if (m[y*N+x]) { yb = y; break; }
      if (yb < 0) return m;
      const row = Math.max(0, yb - 2);
      let xa = -1, xb = -1;
      for (let x = 0; x < N; x++) if (m[row*N+x]) { if (xa < 0) xa = x; xb = x; }
      if (xa < 0) return m;
      const o = roundCorners(m, r), out = m.slice(), box = Math.round(r * 0.9);
      for (let y = yb - box; y <= yb + 2; y++) {
        if (y < 0 || y >= N) continue;
        for (let x = xa - box; x <= xa + box; x++) if (x >= 0 && x < N) out[y*N+x] = o[y*N+x];
        for (let x = xb - box; x <= xb + box; x++) if (x >= 0 && x < N) out[y*N+x] = o[y*N+x];
      }
      return out;
    };
    const roundInnerFeet = (m, r) => {
      if (!(r > 0)) return m;
      let yb = -1;
      for (let y = N - 1; y >= 0 && yb < 0; y--) for (let x = 0; x < N; x++) if (m[y*N+x]) { yb = y; break; }
      if (yb < 0) return m;
      // A few rows up from the very bottom, where the feet's own rounding has not yet
      // narrowed the legs — that is where the doorway's true edges are.
      const probe = Math.max(0, yb - Math.round(r * 0.6));
      const runs = []; let inRun = false;
      for (let x = 0; x < N; x++) {
        const on = !!m[probe*N+x];
        if (on && !inRun) { runs.push({ a: x, b: x }); inRun = true; }
        else if (on) runs[runs.length-1].b = x;
        else inRun = false;
      }
      if (runs.length !== 2) return m;                       // not the two-legged shape — leave it
      const gapL = runs[0].b, gapR = runs[1].a;
      /* Cap the radius against the LEG's own width, not the doorway's. Past roughly the leg
         width the open eats the leg itself and the carve-box lets the damage through — the
         foot squares off and the arch reads as chopped. Derived rather than hardcoded so the
         knob stays safe if the artwork is ever redrawn at a different weight. */
      const legW = runs[0].b - runs[0].a;
      const rr = Math.min(r, Math.round(legW * 0.6));
      const big = dilate(erode(m, rr), rr);
      const out = new Uint8Array(m);
      const pad = Math.round(rr * 1.25);
      for (let y = yb - pad; y <= yb; y++) {
        if (y < 0) continue;
        for (let x = gapL - pad; x <= gapL; x++) if (x >= 0) out[y*N+x] = big[y*N+x];
        for (let x = gapR; x <= gapR + pad; x++) if (x < N) out[y*N+x] = big[y*N+x];
      }
      return out;
    };
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
      // Feet first (all four convex corners), then extra rounding on the doorway's two only.
      const solid = roundInnerFeet(roundCorners(bits(c), foot), doorway);
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
      const inner = roundBottomCorners(erode(filled, stroke), bellInner);
      const outline = new Uint8Array(N*N);
      for (let i = 0; i < N*N; i++) outline[i] = filled[i] && !inner[i] ? 1 : 0;
      out.notifs = { off: toPng(outline), on: toPng(filled), stroke };
    }
    return out;
  }, { N, TARGET_R, weight: WEIGHT, foot: FOOT, doorway: DOORWAY, bellInner: BELL_INNER,
       refs: Object.fromEntries(Object.entries(REF).map(([k,v]) => [k, b64(v, 'image/jpeg')])),
       homeSrc: b64('narch.png', 'image/png'), bell: BELL() });

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
