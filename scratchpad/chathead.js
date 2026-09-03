/* THE CHAT PAGE, redesigned to the owner's drawing (build 1778).
 *
 * The header is no longer a BAR. It is three shapes floating on the page colour — a round
 * back button, a pill carrying the photo + name + a presence dot, and a round ⋯ — with the
 * conversation scrolling UP BEHIND them. That last part is the owner's explicit ask
 * ("instead of a black bar on top it goes behind the three new options") and it is what
 * forced the structure: the header and everything that used to sit between it and the
 * thread (call banner, pin bar, in-chat search, secret notice) now live in one absolutely
 * positioned stack, so the scroller can be the full height of the screen.
 *
 * Because that stack is out of flow, NOTHING pushes the conversation down — its height is
 * measured into --ac-head-h and pads the top of the message list. That number has to
 * follow the stack when a pin bar or the in-chat search appears, which is asserted here.
 *
 * Phone and video left the header for the ⋯ menu, where Voice call and Video call were
 * already its first two rows. The buttons stay in the DOM (other code shows and hides them
 * by id) and are hidden with CSS — so "not in the header" is checked by GEOMETRY, not by
 * absence.
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

  const open = async (theme, w, h) => {
    const ctx = await b.newContext({ viewport: { width: w || 390, height: h || 844 },
      isMobile: (w || 390) < 769, hasTouch: (w || 390) < 769, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.evaluate(([t, th]) => { localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_theme', th); },
      [process.env.TOK, theme]);
    await p.goto(BASE + '/messages', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(5000);
    await p.evaluate(() => { const s = document.querySelector('#introSheet:not(.hidden)');
      if (s && typeof introDismiss === 'function') introDismiss(); });
    await p.waitForTimeout(300);
    return { ctx, p };
  };
  /* Open a DM and WAIT for it. A bare querySelector().click() silently does nothing when
     the list has not rendered yet — on a cold server that left every geometry check
     measuring a hidden screen (zero-size rects reported as "0 / 390"). The locator waits
     for the row, and the thread is confirmed on screen before anything is measured. */
  const openDm = async (p) => {
    await p.locator('#acListScreen .ac-item[data-uid]').first().click({ timeout: 20000 });
    await p.waitForSelector('#acThreadScreen:not(.hidden)', { timeout: 20000 });
    await p.waitForFunction(() => {
      const b = document.querySelector('.ac-h3-pill');
      return b && b.getBoundingClientRect().width > 50;
    }, { timeout: 20000 });
    await p.waitForTimeout(1800);
  };

  const { ctx, p } = await open('black');
  const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  await openDm(p);

  /* 1. THREE SHAPES, one line, even gaps. */
  const geo = await p.evaluate(() => {
    const r = (s) => { const e = typeof s === 'string' ? document.querySelector(s) : s; if (!e) return null;
      const b = e.getBoundingClientRect();
      return { l: Math.round(b.left), t: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), r: Math.round(b.right) }; };
    const head = document.querySelector('.ac-head3');
    return { back: r('.ac-h3-btn'), pill: r('.ac-h3-pill'), more: r('#acThreadMenuBtn'),
      vw: window.innerWidth,
      headBg: getComputedStyle(head).backgroundColor,
      headBorder: getComputedStyle(head).borderBottomWidth,
      floatPos: getComputedStyle(document.getElementById('acTopFloat')).position };
  });
  say(geo.back.h === geo.pill.h && geo.pill.h === geo.more.h,
    `the back button, the pill and the ⋯ are one height (${geo.back.h} / ${geo.pill.h} / ${geo.more.h})`);
  say(geo.back.t === geo.pill.t && geo.pill.t === geo.more.t, 'and sit on one line');
  const gapL = geo.pill.l - geo.back.r, gapR = geo.more.l - geo.pill.r;
  say(Math.abs(gapL - gapR) <= 1, `the gaps between them match (${gapL} / ${gapR})`);
  say(geo.back.l === geo.vw - geo.more.r, `and the row is inset evenly from both edges (${geo.back.l} / ${geo.vw - geo.more.r})`);
  /* THE GAP BETWEEN THE SHAPES IS SMALLER THAN THE INSET AROUND THEM, and the ratio comes
     off Safari's own bar — the owner's reference — where the gap is 0.21 of the circle's
     diameter. Ours was 0.33, which is what made the pill read as narrow with too much air
     beside it. Asserted as a RATIO, not as 10px, so resizing --h3-size keeps it honest. */
  say(gapL < geo.back.l && gapL / geo.back.h < 0.26,
    `the shapes sit closer to each other than to the screen edge (gap ${gapL} on a ${geo.back.h} circle = ${(gapL / geo.back.h).toFixed(2)}, inset ${geo.back.l})`);
  say(geo.back.w === geo.back.h && geo.more.w === geo.more.h, 'both end buttons are true circles');

  /* 1a. THE TOP FADE — run FIRST, while the thread is untouched: it prepends a probe
         element and scrolls to the top, and anything that re-renders the thread would
         wipe it (an earlier ordering did exactly that and read a ramp of 0).
         THE TOP FADE, and this is the one the owner cared most about: it used to hold the
         page colour solid and then step to clear over a short stretch — "a small tiny part
         where it shifts". It has to darken the way the BOTTOM one does, gradually, over a
         long run.
         Measured on real pixels, and deterministically: a tall white block is dropped in at
         the top of the thread, so the ramp being measured is the gradient's own alpha
         rather than whatever message happened to be there. The number that matters is how
         far the brightness takes to travel from a quarter-lit to three-quarters-lit —
         short means a step, long means a fade. */
  const fade = await p.evaluate(async () => {
    const th = document.getElementById('acThread');
    const d = document.createElement('div');
    d.id = '__fadeprobe'; d.style.cssText = 'height:420px;background:#fff;margin:0 -14px;';
    th.prepend(d); SC.jumpTo(0);
    await new Promise(r => setTimeout(r, 400));
    return { top: Math.round(d.getBoundingClientRect().top),
      scrimH: parseFloat(getComputedStyle(document.getElementById('acThreadScreen'), '::before').height) };
  });
  const shot = PNG.sync.read(await p.screenshot());
  const colX = Math.round(195 * 2);                       // mid-screen, inside the white block
  const lum = (y) => shot.data[(shot.width * Math.round(y * 2) + colX) * 4];
  /* THE LAW CHANGED IN 1787 AND THIS CHECK HAD TO CHANGE WITH IT. It used to measure how
     far the brightness travelled from a quarter-lit to three-quarters, on the assumption
     that the band STARTS fully black. It no longer does — nothing in it is opaque, so the
     white block is already showing through at the very top and that distance is naturally
     shorter. Loosening the number would have been the wrong fix; what is worth asserting
     now is the law itself: something shows through at the top, and the brightness climbs
     without a jump anywhere. */
  const samples = [];
  for (let y = fade.top + 2; y < fade.top + Math.round(fade.scrimH); y += 2) samples.push(lum(y));
  const topLum = samples[0];
  /* A STEP is an ACCELERATION, not a big number. This curve is legitimately steepest right
     at the top and flattens out below — measured 90,108,122,133,142,149,155,160,163,166…,
     i.e. jumps of 18,14,11,9,7,6,5,3,3… — so a flat "largest jump" ceiling fails on a
     perfectly smooth fade (it did, at 18 against a guessed 12). What a step actually looks
     like is a run of nothing and then a lurch: 0,0,0,0,40,60. So the test is that brightness
     only ever climbs, and that no jump is more than twice the one before it. The floor of 6
     absorbs 1-vs-3 quantisation noise down at the flat end, where doubling is meaningless. */
  let dropped = 0, spike = null;
  for (let i = 1; i < samples.length; i++) {
    const d = samples[i] - samples[i-1];
    if (d < -2) dropped++;
    if (i > 1 && d > Math.max(6, 2 * (samples[i-1] - samples[i-2]))) spike = spike || `${samples[i-2]}→${samples[i-1]}→${samples[i]}`;
  }
  if (process.env.DEBUG_FADE) console.log('    samples', samples.join(','));
  say(fade.scrimH >= 170, `the fade runs a long way down the screen (${fade.scrimH}px, was ~108)`);
  say(topLum > 12, `you can see through the band even at its darkest (white reads ${topLum}/255 at the top, not 0)`);
  say(dropped === 0, `it only ever gets lighter going down (${dropped} reversals)`);
  say(!spike, `and never lurches — no jump is twice the one before it${spike ? ' (' + spike + ')' : ''}`);
  await p.evaluate(() => { document.getElementById('__fadeprobe')?.remove(); });


  /* 1b. Each shape carries a thin rim (owner). This is NOT a break with "solid, never
         outlined" — a dark-grey fill plus a hairline IS the app's own secondary-button
         treatment, and that is what these three are. */
  const rims = await p.evaluate(() => {
    const w = (s) => parseFloat(getComputedStyle(document.querySelector(s)).borderTopWidth) || 0;
    return { back: w('.ac-h3-btn'), pill: w('.ac-h3-pill'), more: w('#acThreadMenuBtn') };
  });
  say(rims.back >= 1 && rims.pill >= 1 && rims.more >= 1,
    `all three shapes carry a thin rim (${rims.back} / ${rims.pill} / ${rims.more})`);

  /* 1c. The name is WHITE, and said so explicitly. A <button> does not inherit colour, and
         on iOS Safari its default text is the system BLUE — which is why the name came out
         blue on a real phone while every headless screenshot showed it white. Checked
         against the accent so a regression to blue fails rather than passes. */
  const nm = await p.evaluate(() => {
    const hex = (c) => { const m = c.match(/\d+/g); return m ? '#' + m.slice(0,3).map(n => (+n).toString(16).padStart(2,'0')).join('') : c; };
    return { name: hex(getComputedStyle(document.getElementById('acPeerName')).color),
      accent: getComputedStyle(document.body).getPropertyValue('--accent').trim().toLowerCase() };
  });
  say(nm.name !== nm.accent, `the name is not the accent blue (${nm.name})`);
  say(/^#(f|e|d)/.test(nm.name), `it is a plain light colour (${nm.name})`);

  /* 1d. The ⋯ lies FLAT, as drawn — three dots side by side, not stacked. */
  const dots = await p.evaluate(() => [...document.querySelectorAll('#acThreadMenuBtn svg circle')]
    .map(c => ({ x: +c.getAttribute('cx'), y: +c.getAttribute('cy') })));
  say(dots.length === 3 && dots.every(d => d.y === dots[0].y) && new Set(dots.map(d => d.x)).size === 3,
    `the ⋯ is flat, not stacked (${dots.map(d => d.x + ',' + d.y).join(' ')})`);

  /* 2. IT IS NOT A BAR. No fill of its own, no divider. */
  say(/rgba\(0, 0, 0, 0\)|transparent/.test(geo.headBg), `the header paints no bar behind the shapes (${geo.headBg})`);
  say(parseFloat(geo.headBorder) === 0, 'and draws no divider under them');

  /* 3. The conversation runs BEHIND them — the owner's ask. The scroller starts at the very
        top of the screen, and the message list is padded so the newest content still opens
        clear of the header rather than under it. */
  const under = await p.evaluate(() => ({
    pos: getComputedStyle(document.getElementById('acTopFloat')).position,
    vpTop: Math.round(document.getElementById('acThreadVP').getBoundingClientRect().top),
    screenTop: Math.round(document.getElementById('acThreadScreen').getBoundingClientRect().top),
    headH: parseFloat(document.getElementById('acThreadScreen').style.getPropertyValue('--ac-head-h')) || 0,
    padTop: parseFloat(getComputedStyle(document.getElementById('acThread')).paddingTop) || 0,
  }));
  say(under.pos === 'absolute', 'the top chrome floats rather than sitting in the flow');
  say(under.vpTop === under.screenTop, `the scroller reaches the top of the screen, so messages pass behind (${under.vpTop} vs ${under.screenTop})`);
  say(under.padTop >= under.headH, `the first message still clears the header (${under.padTop}px of padding for a ${under.headH}px header)`);

  /* 4. …and a tap in the GAP between two shapes must reach the conversation, not be
        swallowed by the invisible full-width stack sitting over it. */
  const hit = await p.evaluate(() => {
    const back = document.querySelector('.ac-h3-btn').getBoundingClientRect();
    const pill = document.querySelector('.ac-h3-pill').getBoundingClientRect();
    const el = document.elementFromPoint((back.right + pill.left) / 2, back.top + back.height / 2);
    return el ? (el.id || el.className.toString().split(' ')[0]) : null;
  });
  /* NB the stack AND the header row inside it both span the full width, so it is not
     enough for the stack alone to be transparent to the pointer — with only that, a tap
     between the back button and the pill landed on `.msg-top`. */
  say(hit !== 'ac-topfloat' && hit !== 'msg-top',
    `a tap in the gap falls through to what is behind it (hit "${hit}")`);

  /* 5. Calling moved to the ⋯ menu. Checked by geometry — the buttons are still in the DOM
        because other code toggles them by id. */
  const calls = await p.evaluate(async () => {
    const vis = (id) => { const e = document.getElementById(id); if (!e) return false;
      const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).display !== 'none'; };
    document.getElementById('acThreadMenuBtn').click();
    await new Promise(r => setTimeout(r, 400));
    const rows = [...document.querySelectorAll('#acHeadMenuSheet .mm-label')].map(x => x.textContent.trim());
    document.body.click();
    return { audio: vis('acCallAudio'), video: vis('acCallVideo'), rows: rows.slice(0, 4) };
  });
  say(!calls.audio && !calls.video, 'no phone or video button is drawn in the header');
  say(calls.rows.includes('Voice call') && calls.rows.includes('Video call'),
    `Voice call and Video call are in the ⋯ menu (${calls.rows.join(', ')})`);

  /* 6. Presence is ONE dot. Green with nothing under the name when they are here; grey with
        "Last seen …" when they are not. */
  const pres = await p.evaluate(async () => {
    const out = {};
    rtPresence[AC.peer.id] = { online: true }; acUpdatePeerPresence();
    await new Promise(r => setTimeout(r, 200));
    const d = document.getElementById('acPeerDot');
    out.on = { online: d.classList.contains('online'), hidden: d.classList.contains('hidden'),
      sub: document.getElementById('acPeerHandle').textContent,
      subShown: document.getElementById('acPeerHandle').getBoundingClientRect().height > 0 };
    rtPresence[AC.peer.id] = { online: false, last_seen: new Date(Date.now() - 3600e3).toISOString() }; acUpdatePeerPresence();
    await new Promise(r => setTimeout(r, 200));
    out.off = { online: d.classList.contains('online'), hidden: d.classList.contains('hidden'),
      sub: document.getElementById('acPeerHandle').textContent };
    return out;
  });
  say(!pres.on.hidden, 'online shows a green dot');
  /* THE DOT AND THE WORDS, TOGETHER (owner, build 1795 — this assertion used to say the
     opposite). The dot alone was the whole message and the second line was dropped, which
     left the pill saying nothing about WHY the dot was there: a green dot is a signal you
     have to already know how to read. */
  say(pres.on.subShown && /active now/i.test(pres.on.sub),
    `and says "Active now" under the name ("${pres.on.sub}")`);
  /* NO grey dot (owner): away is said by "Last seen …" under the name, and a second, dimmer
     signal for the same fact only read as a smudge. */
  say(pres.off.hidden, 'offline shows NO dot at all');
  say(/last seen/i.test(pres.off.sub), `just "Last seen …" under the name ("${pres.off.sub}")`);

  /* 7. The floating stack GROWS when the in-chat search opens, and the padding follows it —
        otherwise the search bar would cover the newest messages. */
  const grow = await p.evaluate(async () => {
    const pad = () => parseFloat(getComputedStyle(document.getElementById('acThread')).paddingTop);
    const before = pad();
    acThreadSearchOpen(); await new Promise(r => setTimeout(r, 700));
    const open = pad(), barTop = Math.round(document.getElementById('acSearchBar').getBoundingClientRect().top);
    acThreadSearchClose(); await new Promise(r => setTimeout(r, 700));
    return { before, open, after: pad(), barTop };
  });
  say(grow.open > grow.before + 20, `opening the in-chat search grows the top padding with it (${grow.before} → ${grow.open})`);
  say(grow.after === grow.before, `and closing it puts it back (${grow.after})`);
  say(grow.barTop > 0, `the search bar sits below the header, not under it (y=${grow.barTop})`);

  /* 8. The composer: a blue mic, and the SAME blue on send, so the control does not change
        colour the moment you start typing. */
  const comp = await p.evaluate(() => {
    const acc = getComputedStyle(document.body).getPropertyValue('--accent').trim();
    const mic = document.querySelector('#acThreadScreen .ac-mic');
    const send = document.querySelector('#acThreadScreen .msg-send');
    const hex = (c) => { const m = c.match(/\d+/g); return m ? '#' + m.slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('') : c; };
    return { accent: acc.toLowerCase(), mic: mic ? hex(getComputedStyle(mic).backgroundColor) : null,
      send: send ? hex(getComputedStyle(send).backgroundColor) : null };
  });
  say(comp.mic === comp.accent, `the mic is the accent blue (${comp.mic})`);
  say(comp.send === comp.mic, `and send is the same blue, so it does not flip colour as you type (${comp.send})`);
  /* THE BAR ITSELF — fully rounded ends, and the three things in it evenly placed.
     The + is a bare glyph and the mic is a filled circle, so matching their BOXES is not
     enough: the boxes were even at 6 while the INK sat at 13.5 on the left against the
     circle's 6 on the right, which is what the owner spotted. Both visible shapes are
     measured here, not their boxes. They were also 1px apart vertically, because the row
     bottom-aligns (right — the buttons must stay put when the text grows) and the boxes
     were 38 against 36. */
  const bar = await p.evaluate(() => {
    const box = document.querySelector('#acThreadScreen .msg-inbox');
    const plus = box.querySelector('.msg-attach'), mic = box.querySelector('.ac-mic') || box.querySelector('.msg-send');
    const ta = box.querySelector('textarea'), svg = plus.querySelector('svg');
    const r = (e) => e.getBoundingClientRect();
    const B = r(box), M = r(mic), S = r(svg), T = r(ta);
    const n = (v) => Math.round(v * 10) / 10;
    return { h: n(B.height), radius: parseFloat(getComputedStyle(box).borderTopLeftRadius),
      inkLeft: n(S.left - B.left), micRight: n(B.right - M.right),
      inkCy: n(S.top + S.height / 2 - B.top), micCy: n(M.top + M.height / 2 - B.top),
      textGap: n(T.left + parseFloat(getComputedStyle(ta).paddingLeft) - S.right) };
  });
  say(bar.h >= 50, `the message box sits taller than the flat original (${bar.h}px, was 44)`);
  say(bar.radius >= bar.h / 2 - 1, `its ends are fully rounded — a true capsule at any height (${bar.radius} for a ${bar.h}px bar)`);
  /* THEY ARE DELIBERATELY NOT EVEN, and this assertion used to say the opposite (build
     1795). Both ends sat at 10 and were geometrically even — and the owner still saw the +
     as jammed against the wall, because a bare 24px glyph carries less visual weight than a
     solid 36px disc and needs more air to read as equally placed. ChatGPT's own bar gives
     the + ~17 and the send ~9 for exactly this reason. So the rule is now optical: the +
     gets MORE room than the filled button opposite it, and neither drifts out of range. */
  say(bar.inkLeft > bar.micRight + 3,
    `the bare + is given more room than the filled button opposite it (${bar.inkLeft} / ${bar.micRight})`);
  say(bar.inkLeft <= 20 && bar.micRight >= 8,
    `and neither has drifted out of range (${bar.inkLeft} / ${bar.micRight})`);
  say(Math.abs(bar.inkCy - bar.micCy) <= 0.6, `and share one centre line (${bar.inkCy} / ${bar.micCy})`);
  /* The placeholder clears the + by a real reading gap. It used to be tied to the + 's own
     inset, which stopped meaning anything once that inset became an optical correction for
     the SCREEN EDGE rather than a rhythm — ink-to-ink is a different relationship. */
  say(bar.textGap >= 8 && bar.textGap <= 18,
    `"Message" clears the + by a clean reading gap (${bar.textGap})`);

  /* Calling is the menu's own FIRST SECTION, drawn as a grouped block rather than two loose
     rows above a hairline. It is absent only where there is genuinely nobody to call — a
     chat with yourself — which is why it looked missing in a self-chat screenshot. */
  const callGrp = await p.evaluate(async () => {
    document.getElementById('acThreadMenuBtn').click();
    await new Promise(r => setTimeout(r, 400));
    const g = document.querySelector('#acHeadMenuSheet .mm-group');
    const first = document.querySelector('#acHeadMenuSheet .mm-item .mm-label');
    const out = { has: !!g, rows: g ? [...g.querySelectorAll('.mm-label')].map(x => x.textContent.trim()) : [],
      firstRow: first ? first.textContent.trim() : null,
      r: g ? parseFloat(getComputedStyle(g).borderTopLeftRadius) : 0,
      rowR: g ? parseFloat(getComputedStyle(g.querySelector('.mm-item')).borderTopLeftRadius) : 0,
      pad: g ? parseFloat(getComputedStyle(g).paddingTop) : 0,
      rowH: g ? Math.round(g.querySelector('.mm-item').getBoundingClientRect().height) : 0 };
    document.body.click();
    return out;
  });
  say(callGrp.has && callGrp.rows.join(' / ') === 'Voice call / Video call',
    `the ⋯ menu opens with calling as its own section (${callGrp.rows.join(' / ')})`);
  say(callGrp.firstRow === 'Voice call', `and it is the FIRST thing in the menu (${callGrp.firstRow})`);
  say(Math.abs(callGrp.r - (Math.min(callGrp.rowR, callGrp.rowH / 2) + callGrp.pad)) <= 1,
    `the section's corner hugs its rows (${callGrp.r} = ${Math.min(callGrp.rowR, callGrp.rowH / 2)} + ${callGrp.pad})`);

  /* 9. The attach menu: Camera · Photos · Files, big round discs. */
  const att = await p.evaluate(async () => {
    document.querySelector('#acThreadScreen .msg-inbox .msg-attach').click();
    await new Promise(r => setTimeout(r, 500));
    const m = document.getElementById('acAttachMenu');
    const rows = [...m.querySelectorAll('.aat-l')].map(x => x.textContent.trim());
    const ic = m.querySelector('.aat-ic').getBoundingClientRect();
    const out = { rows3: rows.slice(0, 3), total: rows.length, disc: Math.round(ic.width),
      round: getComputedStyle(m.querySelector('.aat-ic')).borderRadius };
    m.classList.add('hidden');
    return out;
  });
  say(att.rows3.join(' · ') === 'Camera · Photos · Files', `the menu leads with ${att.rows3.join(' · ')}`);
  say(att.total >= 18, `and still carries everything else (${att.total} rows)`);
  say(att.disc >= 44, `the icon discs are the bigger size (${att.disc}px)`);

  /* 9b. It OPENS SHORT — five options and a "More" (owner). Eighteen rows at this size was
         a wall. More opens the rest out and takes itself away; re-opening starts short
         again, or the second open would jump straight to the full list. */
  const aa = await p.evaluate(async () => {
    const sh = document.getElementById('acAttachMenu');
    document.querySelector('#acThreadScreen .msg-inbox .msg-attach').click();
    await new Promise(r => setTimeout(r, 450));
    const vis = () => [...sh.querySelectorAll('.aatile')].filter(r => r.offsetParent !== null)
      .map(r => r.querySelector('.aat-l').textContent.trim());
    const box = sh.getBoundingClientRect(), ic = sh.querySelector('.aat-ic').getBoundingClientRect();
    const short = { rows: vis(), w: Math.round(box.width), h: Math.round(box.height),
      cardR: parseFloat(getComputedStyle(sh).borderTopLeftRadius),
      disc: Math.round(ic.width), insetX: Math.round(ic.left - box.left), insetY: Math.round(ic.top - box.top) };
    sh.querySelector('.aa-more').click();
    await new Promise(r => setTimeout(r, 600));
    const long = { rows: vis().length, h: Math.round(sh.getBoundingClientRect().height),
      moreGone: sh.querySelector('.aa-more').offsetParent === null };
    // close and reopen — it must come back short
    sh.classList.add('hidden');
    document.querySelector('#acThreadScreen .msg-inbox .msg-attach').click();
    await new Promise(r => setTimeout(r, 450));
    const again = vis().length;
    sh.classList.add('hidden');
    return { short, long, again };
  });
  say(aa.short.rows.length === 6 && aa.short.rows[5] === 'More',
    `it opens at five options and a More (${aa.short.rows.join(' · ')})`);
  say(aa.long.rows > aa.short.rows.length && aa.long.h > aa.short.h,
    `More opens the rest out (${aa.short.rows.length} rows / ${aa.short.h}px → ${aa.long.rows} / ${aa.long.h}px)`);
  say(aa.long.moreGone, 'and takes itself away once everything is showing');
  say(aa.again === 6, `re-opening starts short again (${aa.again} rows)`);
  say(aa.short.w <= 270, `it is narrower — less dead space beside the labels (${aa.short.w}px)`);

  /* 9c. THE CORNERS NEST, which is the thing the owner cares most about: the card's radius
         is the disc's radius plus the gap around it, so the corner hugs the icon instead of
         going pointy beside it. NB the radius is on the card's OUTER edge, so its own 1px
         border counts in that gap — being one pixel out is exactly what "less rounded, more
         pointy" looked like. */
  const want = aa.short.disc / 2 + aa.short.insetX;
  say(aa.short.insetX === aa.short.insetY,
    `the disc sits the same distance from the card's edge both ways (${aa.short.insetX} / ${aa.short.insetY})`);
  say(Math.abs(aa.short.cardR - want) <= 1,
    `and the card's corner is concentric with it (${aa.short.cardR} vs ${want} = ${aa.short.disc / 2} + ${aa.short.insetX})`);
  say(errs.length === 0, `no JS errors${errs.length ? ' — ' + errs[0] : ''}`);
  await ctx.close();

  /* 10. A GROUP has no presence to report — no dot at all. */
  const g = await open('black');
  const grp = await g.p.evaluate(async () => {
    const row = document.querySelector('#acListScreen .ac-item[data-gid]');
    if (!row) return { skip: true };
    row.click(); await new Promise(r => setTimeout(r, 2600));
    return { hidden: document.getElementById('acPeerDot').classList.contains('hidden'),
      sub: document.getElementById('acPeerHandle').textContent };
  });
  say(grp.skip || grp.hidden, `a group header shows no presence dot${grp.skip ? ' (no group to test)' : ' ("' + grp.sub + '" under the name)'}`);
  await g.ctx.close();

  /* 11. LIGHT THEME, and this is where two real bugs were found rather than designed away:
         the composer was white on a white page, and a sent-but-unseen bubble was too. The
         bubble's rule reaches for --accent-tint, which despite the comment above it is
         WHITE (it means "text on a solid blue fill"). Both must differ from the page. */
  const l = await open('light');
  await openDm(l.p);
  const light = await l.p.evaluate(() => {
    const rgb = (c) => (c.match(/\d+/g) || []).slice(0, 3).map(Number);
    const diff = (a, b) => Math.max(...a.map((x, i) => Math.abs(x - b[i])));
    const page = rgb(getComputedStyle(document.body).backgroundColor);
    const inbox = rgb(getComputedStyle(document.querySelector('#acThreadScreen .msg-inbox')).backgroundColor);
    const un = document.querySelector('#acThread .msg-row.me .msg-bubble.msg-unseen');
    return { inbox: diff(page, inbox), unseen: un ? diff(page, rgb(getComputedStyle(un).backgroundColor)) : null };
  });
  say(light.inbox >= 6, `in Light the message box is visibly a step off the page (${light.inbox})`);
  say(light.unseen === null || light.unseen >= 6,
    `and a sent-but-unseen bubble is too, instead of white on white (${light.unseen})`);
  await l.ctx.close();

  await b.close();
  console.log(bad ? `\n${bad} FAILED` : '\nthree shapes on the page, the conversation running behind them');
  process.exit(bad ? 1 : 0);
})();
