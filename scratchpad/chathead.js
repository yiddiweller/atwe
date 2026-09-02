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
  const openDm = async (p) => {
    await p.evaluate(() => { const r = document.querySelector('#acListScreen .ac-item[data-uid]'); if (r) r.click(); });
    await p.waitForTimeout(2600);
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
  say(geo.back.w === geo.back.h && geo.more.w === geo.more.h, 'both end buttons are true circles');

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
  say(pres.on.online && !pres.on.hidden, 'online shows a green dot');
  say(!pres.on.subShown, 'and drops the second line, so the name centres in the pill — as drawn');
  say(!pres.off.online && !pres.off.hidden, 'offline shows a grey dot');
  say(/last seen/i.test(pres.off.sub), `with "Last seen …" back under the name ("${pres.off.sub}")`);

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
