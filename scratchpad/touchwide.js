/* D1 — A TABLET IS A TOUCH DEVICE, AND NOBODY HAD EVER SIZED FOR ONE.
 * docs/DESIGN-UNIFICATION.md D1. The founder: "It should be perfect on all type of
 * devices like mobile tablet and desktop."
 *
 * A four-width sweep is the only thing that could have found this. At a phone width the
 * app is fine; at 1024x768 — an iPad in landscape, a genuinely common device — the layout
 * switches to DESKTOP (it keys off width AND height, and 768 tall is a tablet, not a phone
 * in landscape), so a touch device gets the mouse-built sidebar in full: 34-43px rows.
 * Seventeen control families were under the 44pt floor on every touch width.
 *
 * THE GATE IS `pointer:coarse`, NOT A WIDTH, and that is the whole finding. A 1024px iPad
 * wants big targets; a 1024px laptop does not. So this probe checks BOTH directions —
 * the overlays must be there on a touch device and ABSENT on the desktop one. A guard that
 * passes at every width is not testing the media query at all (the same lesson
 * `admintouch.js` records).
 *
 * IT MEASURES THE OVERLAY, IT DOES NOT RE-DO ITS ARITHMETIC. An inset resolves against the
 * PADDING box, so a control with a border comes out 2x its border short of the sum in the
 * stylesheet — and four controls had been claiming a size they never had for exactly that
 * reason, guarded by a probe that repeated the same sum. Ask the browser.
 *
 * NO OVERLAY MAY STEAL THE CONTROL NEXT DOOR. Growing over a neighbour is the cheap way to
 * pass this check and it trades one fault for a worse one.
 *
 * PATHS RESOLVE FROM __dirname — run-all.sh cds into scratchpad/.
 */
const path = require('path');
const fs = require('fs');
const SP = process.env.PW_SCRATCH || '/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const { chromium } = require(SP + '/node_modules/playwright-core');
const TOK = (process.env.TOK || (fs.existsSync('/tmp/tok.txt') ? fs.readFileSync('/tmp/tok.txt', 'utf8') : '')).trim();
if (!TOK) { console.log('skipped — needs TOK'); process.exit(0); }
const BASE = 'http://localhost:3262/';

/* Deliberately under the floor, each with its reason. Keyed on the first class. */
const ALLOWED = {
  'ac-post-av':     'a profile picture, not a control',
  'ac-ava-wrap':    'a profile picture',
  'story-cell':     'a Daily ring — the picture is the button',
  'story-add':      'grows away from the ring or it steals the ring own view tap (34, recorded)',
  'tb-feedtab-add': 'the Add label: 41 wide by design, its own ::before overlay',
  'bn-tab':         'a bottom-nav tab — the bar is 60 tall, the tab fills it',
  'sb-ico':         'an icon inside a sidebar row; the ROW is the target',
  'ac-badge':       'an unread count, not a control',
};

/* THE POST COMPOSER WAS NOT IN THIS LIST, and that is how a 370x68 invisible slab sat
   across its header swallowing every tap on Post for builds on end. Nine surfaces, none
   of them a sheet header. `tapown.js` now asks the "does a control get its own tap"
   question over fourteen surfaces; this one keeps the composer too so the size checks
   see it as well. */
const SURFACES = [
  ['Home',        null],
  ['Composer',    'acOpenPost()', { noNav: true }],   // a full-screen sheet: the bar is hidden on purpose
  ['Engine',      "appTab('search')"],
  ['Beam',        "appTab('chat')"],
  ['Account',     "appTab('profile')"],
  ['Settings',    'openSettings()'],
  ['Wallet',      'acOpenWallet()'],
  ['Marketplace', 'acOpenMarketplace()'],
  ['Orders',      "acOpenOrders('buyer')"],
  ['Your profile','acGoProfile()'],
];

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); }
  else { fail++; console.log('  FAIL ' + m + (x !== undefined ? '\n         ' + JSON.stringify(x).slice(0, 420) : '')); } };

/* Runs in the page. Returns every on-screen control that misses the floor, plus any
   overlay that reaches a neighbouring control's centre. */
const SCAN = (allowed) => {
  const n = (v) => parseFloat(v) || 0;
  const out = { small: [], steal: [], spill: 0, navs: [] };
  out.spill = Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
  const vis = (e) => { if (!e) return false; const c = getComputedStyle(e), r = e.getBoundingClientRect();
    return c.display !== 'none' && c.visibility !== 'hidden' && r.width > 4 && r.height > 4; };
  const bn = document.getElementById('bottomNav'), sb = document.getElementById('sidebar');
  if (vis(bn)) out.navs.push('bottom');
  if (vis(sb) && sb.getBoundingClientRect().left > -50) out.navs.push('sidebar');

  const ctrls = [...document.querySelectorAll('button,[role=button]')].filter((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) return false;
    /* ASK THE BROWSER whether it is genuinely on screen. An element inside a panel whose
       ANCESTOR is display:none or opacity:0 still reports a real rect, which is how an
       earlier run of this sweep reported the same five controls on all eight surfaces. */
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    /* OFF-CANVAS IS NOT ON SCREEN — the mobile drawer sits at a negative left while closed
       and still has a rect, so clip horizontally as well as vertically. */
    if (r.top < 0 || r.top > window.innerHeight - 4) return false;
    if (r.right <= 0 || r.left >= window.innerWidth) return false;
    /* A CHILD INSIDE A HORIZONTAL SCROLLER IS NOT ON SCREEN EITHER, and this repo has now
       learned that three times. `checkVisibility` says nothing about clipping, so the four
       Engine scope tabs scrolled past the end of #tbSearchScopes (540px wide, overflow-x:
       auto) still report their laid-out position — which lands under the desktop right
       rail and looked exactly like a rail covering four untappable tabs. Clip against
       every scrolling ancestor. */
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      /* Test the CONTROL'S CENTRE, not merely an overlap. A tab straddling the scroller's
         edge is partly on screen with its centre already clipped — and the centre is the
         point every check below presses, so a half-scrolled control is not a target. */
      const ar = a.getBoundingClientRect();
      const px = r.left + r.width / 2, py = r.top + r.height / 2;
      if (px <= ar.left || px >= ar.right || py <= ar.top || py >= ar.bottom) return false;
    }
    return true;
  });

  /* `getComputedStyle` REPORTS `left`/`right` BEFORE ANY TRANSFORM, so a pseudo centred
     with translate(-50%,-50%) reports a used `right` of about -50% of the box — and
     reading that as outward reach made this probe cry theft on seven perfectly-placed
     overlays the first time it ran. Two shapes, asked apart by the transform:
       centred  → the reach is the element's own centre plus half the overlay;
       inset    → the reach is each declared inset, which may be asymmetric
                  (.story-add and .frail-btn both grow away from a neighbour on purpose). */
  const hitBox = (el) => {
    const b = el.getBoundingClientRect();
    let uw = 0, uh = 0, gl = 0, gr = 0, gt = 0, gb = 0, centred = false;
    for (const pe of ['::before', '::after']) {
      const cs = getComputedStyle(el, pe);
      if (cs.content === 'none') continue;
      uw = Math.max(uw, n(cs.width)); uh = Math.max(uh, n(cs.height));
      if (cs.transform && cs.transform !== 'none') { centred = true; continue; }
      gl = Math.max(gl, -n(cs.left)); gr = Math.max(gr, -n(cs.right));
      gt = Math.max(gt, -n(cs.top));  gb = Math.max(gb, -n(cs.bottom));
    }
    /* The USED size wins when there is one; the inset sum is a fallback for a pseudo on
       a surface that is not laid out (an unopened sheet computes `auto`). */
    const w = uw > 0 ? Math.max(b.width, uw) : b.width + gl + gr;
    const h = uh > 0 ? Math.max(b.height, uh) : b.height + gt + gb;
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    const reach = centred
      ? { l: Math.min(b.left, cx - w / 2), r: Math.max(b.right, cx + w / 2),
          t: Math.min(b.top, cy - h / 2),  b: Math.max(b.bottom, cy + h / 2) }
      : { l: b.left - gl, r: b.right + gr, t: b.top - gt, b: b.bottom + gb };
    return { w, h, box: b, reach };
  };

  const boxes = ctrls.map((el) => ({ el, ...hitBox(el) }));
  for (const c of boxes) {
    const classes = (c.el.className || '').toString().split(/\s+/).filter(Boolean);
    const cls = classes[0] || c.el.id;
    /* MATCH ON EVERY CLASS, not the first. `.tb-feedtab-add` also carries `.tb-feedtab`,
       so keying on classes[0] walked straight past its own named exception. */
    const named = classes.some((k) => allowed[k]) || allowed[c.el.id];
    if (!named && (c.w < 43.5 || c.h < 43.5))
      out.small.push(cls + ':' + Math.round(c.w) + 'x' + Math.round(c.h));
  }
  /* ASK THE BROWSER WHO GETS THE TAP, do not infer it from two rectangles. Geometry alone
     cried theft on a decorative glow behind the Engine hero — a pseudo that reaches past
     its card but takes no pointer events and can steal nothing. `elementFromPoint` at each
     control's own centre settles it for real, z-index and pointer-events included: the
     topmost thing there must be that control, or something inside it. */
  for (const c of boxes) {
    const cx = c.box.left + c.box.width / 2, cy = c.box.top + c.box.height / 2;
    if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) continue;
    const top = document.elementFromPoint(cx, cy);
    if (!top) continue;
    if (c.el.contains(top) || top.contains(c.el)) continue;
    const thief = top.closest('button,[role=button]');
    if (!thief || thief === c.el) continue;
    /* "THE CONTROL NEXT DOOR" MEANS THE SAME LAYER. A screen behind an open overlay is
       still in the DOM and still reports a rect, so the first version of this called an
       Account row "stolen" by the Settings sheet sitting on top of it — a modal covering
       the page under it is how a modal works, not a fault. Both must live in the same
       overlay or screen for it to be theft. */
    const layer = (e) => e.closest('.overlay,.ac-screen,#acMeScreen,#app') || document.body;
    if (layer(thief) !== layer(c.el)) continue;
    const nm = (e) => (e.className || '').toString().split(/\s+/)[0] || e.id || e.tagName;
    out.steal.push(nm(thief) + ' → ' + nm(c.el));
  }
  return out;
};

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const WIDTHS = [['phone', 390, 844, true], ['tablet portrait', 768, 1024, true],
                  ['tablet landscape', 1024, 768, true], ['desktop', 1440, 900, false]];
  for (const [wn, w, h, touch] of WIDTHS) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: touch, isMobile: touch });
    await p.goto(BASE, { waitUntil: 'domcontentloaded' });
    await p.evaluate((t) => { localStorage.setItem('atwe_token', t);
      localStorage.setItem('atwe_intro_seen', '["beam","circles","ai","wallet"]'); }, TOK);
    await p.goto(BASE, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(4200);
    /* A SIGNED-OUT PAGE MEASURES THE LOGIN GATE, NOT THE APP — an earlier run reported the
       same five short controls everywhere because the login overlay was on top the whole
       time. NB `S` is a top-level const, NOT a window property. */
    const inApp = await p.evaluate(() => (typeof S !== 'undefined' && !!(S.user && S.user.username))
      && !document.querySelector('#loginOverlay:not(.hidden)'));
    if (!inApp) { ok(false, wn + ': signed in'); await p.close(); continue; }

    let small = [], steal = [], spill = [], navs = [];
    for (const [name, fn, opt] of SURFACES) {
      try { await p.evaluate(() => { document.querySelectorAll('.overlay:not(.hidden)')
        .forEach((o) => { try { closeOverlay(o.id, true); } catch (e) {} }); }); } catch (e) {}
      await p.waitForTimeout(250);
      if (fn) { try { await p.evaluate((f) => (0, eval)(f), fn); } catch (e) { continue; } }
      await p.waitForTimeout(1100);
      let r; try { r = await p.evaluate(SCAN, ALLOWED); } catch (e) { continue; }
      if (r.spill > 1) spill.push(name + ':' + r.spill);
      if (r.navs.length !== 1 && !(opt && opt.noNav)) navs.push(name + ':' + (r.navs.join('+') || 'none'));
      if (touch) { small.push(...r.small.map((x) => name + ' ' + x)); steal.push(...r.steal.map((x) => name + ' ' + x)); }
      else if (r.small.length) small.push(...r.small.map((x) => name + ' ' + x));
    }
    ok(!spill.length, wn + ': nothing spills sideways', spill.slice(0, 6));
    ok(!navs.length,  wn + ': exactly one nav on every surface', navs.slice(0, 6));
    if (touch) {
      ok(!small.length, wn + ': every control clears the 44pt floor', [...new Set(small)].slice(0, 12));
      ok(!steal.length, wn + ': no overlay steals the control next door', [...new Set(steal)].slice(0, 8));
    } else {
      /* THE GATE MUST DO WORK, and "some controls are under 44 here" does not prove it —
         that is true whether or not the block exists, so the first version of this check
         passed in BOTH halves of its own self-test. Name a control the block covers and
         require it to be its own drawn size on a mouse: no overlay, nothing grown. */
      const bare = await p.evaluate(() => {
        const e = document.querySelector('.tb-feedtab:not(.tb-feedtab-add)');
        if (!e) return { missing: true };
        const b = e.getBoundingClientRect(), a = getComputedStyle(e, '::after');
        return { h: Math.round(b.height), pseudo: a.content === 'none' ? 'none' : a.height };
      });
      ok(!bare.missing && bare.pseudo === 'none',
        'desktop: a control the touch block covers carries NO overlay on a mouse', bare);
    }
    await p.close();
  }
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' FAILED');
  process.exit(fail ? 1 : 0);
})();
