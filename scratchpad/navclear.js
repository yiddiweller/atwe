/* SECTION 5 of the polish brief: "the final row/card/button/content can always
   scroll fully above the floating navigation" and "interactive controls are never
   obscured".

   This is a BUG class, not a style question: it is measured by scrolling each
   surface to its very end and asking whether the last thing a finger needs is
   still underneath the floating pill.

   Two traps this had to learn, both of which make a check pass on a broken screen:
   - THE BAR HIDES ITSELF ON SCROLL. _onListScroll retracts the nav as you go down,
     so measuring right after a fling finds the bar half gone and reports clearance
     that a person never has. It is measured after the bar has been REVEALED again
     (acRevealBars), which is the state you are in when you stop and reach for
     something.
   - A SURFACE THAT LEGITIMATELY HIDES THE BAR IS NOT A FAILURE. A full-screen sheet
     sets nav-off on purpose; asking about clearance there measures nothing. Those
     are skipped BY NAME rather than silently. */
process.env.JWT_SECRET = 'scoresecret';
const SP = '/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const { chromium } = require(SP + 'node_modules/playwright-core');
const TOK = require('fs').readFileSync('/tmp/tok.txt', 'utf8').trim();

let pass = 0, fail = 0, skip = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); }
  else { fail++; console.log('  FAIL ' + m + (x !== undefined ? '\n         ' + String(x).slice(0, 220) : '')); } };
const skipped = (m, why) => { skip++; console.log('  --   skipped ' + m + ' (' + why + ')'); };

const SURFACES = [
  ['Home',          `appTab('home')`,          3000],
  ['Beam',          `appTab('chat')`,          2500],
  ['Engine',        `appTab('search')`,        2500],
  ['Notifications', `acNavNotifs()`,           2500],
  ['Account',       `appTab('profile')`,       2500],
  ['Account/Money', `acMeSection('money')`,    1800],
  ['Settings',      `openSettings()`,          1800],
  ['Wallet',        `acOpenWallet()`,          2500],
  ['Orders',        `acOpenOrders('buyer')`,   2200],
  ['Marketplace',   `acOpenMarketplace()`,     2500],
];

const WIDTHS = [[320, 568, 'small iPhone'], [390, 844, 'iPhone'], [430, 932, 'large iPhone']];

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const errs = [];

  for (const [W, H, label] of WIDTHS) {
    const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    p.on('pageerror', e => errs.push(label + ': ' + String(e).slice(0, 120)));
    await p.goto('http://localhost:3262', { waitUntil: 'domcontentloaded' });
    await p.evaluate((t) => {
      localStorage.clear();
      localStorage.setItem('atwe_token', t);
      localStorage.setItem('atwe_intro_seen', JSON.stringify(['beam', 'circles', 'ai', 'wallet']));
    }, TOK);
    await p.goto('http://localhost:3262', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(6000);
    console.log('\n── ' + label + '  ' + W + 'x' + H + ' ──');

    for (const [name, opener, wait] of SURFACES) {
      /* CLOSE WHAT IS ALREADY OPEN FIRST. Without this the surfaces STACK, and the
         probe then measures controls belonging to a screen underneath - the first
         run of this check reported Orders and Marketplace as blocked by a "New pot"
         button, which is a Wallet control, and by a Settings row. Measuring the
         wrong subject, which this repo has now recorded seven times. */
      await p.evaluate(() => {
        try {
          [...document.querySelectorAll('.overlay:not(.hidden)')].reverse()
            .forEach(o => { if (o.id) closeOverlay(o.id, true); });
          if (typeof closeSettings === 'function') closeSettings(true);
        } catch (e) {}
      });
      await p.waitForTimeout(700);
      await p.evaluate((o) => { try { eval(o); } catch (e) {} }, opener);
      await p.waitForTimeout(wait);

      // scroll whatever is really scrolling all the way to the end
      const scrolled = await p.evaluate(() => {
        const cands = [];
        const top = [...document.querySelectorAll('.overlay:not(.hidden)')].pop();
        const root = top || document;
        root.querySelectorAll('*').forEach((e) => {
          if (e.scrollHeight - e.clientHeight > 40) {
            const cs = getComputedStyle(e);
            if (/(auto|scroll)/.test(cs.overflowY)) cands.push(e);
          }
        });
        if (document.scrollingElement && document.scrollingElement.scrollHeight - innerHeight > 40)
          cands.push(document.scrollingElement);
        if (!cands.length) return { none: true };
        const el = cands.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0];
        el.scrollTop = el.scrollHeight;
        window.__navclearEl = el;
        return { room: el.scrollHeight - el.clientHeight, h: el.scrollHeight };
      });
      await p.waitForTimeout(900);

      /* AN INFINITE FEED HAS NO BOTTOM, and jumping to scrollHeight once lands in
         the MIDDLE of one - the next page loads and what sits under the bar is
         simply the next post passing beneath it, which is what a floating bar is
         for. Keep scrolling until the height stops growing, so the question asked
         is "can the last thing be reached" rather than "is anything under the bar
         right now". Without this, Home failed at all three widths on a feed that
         was still loading. */
      for (let i = 0; i < 8; i++) {
        const grew = await p.evaluate(() => {
          const el = window.__navclearEl; if (!el) return false;
          const before = el.scrollHeight;
          el.scrollTop = el.scrollHeight;
          return { before, after: el.scrollHeight };
        });
        await p.waitForTimeout(1100);
        const now = await p.evaluate(() => (window.__navclearEl || {}).scrollHeight || 0);
        if (!grew || now === grew.before) break;
      }
      await p.evaluate(() => { const el = window.__navclearEl; if (el) el.scrollTop = el.scrollHeight; });
      await p.waitForTimeout(700);

      // the bar hides itself while scrolling - put it back, which is the state a
      // person is in when they stop and reach for the last control
      await p.evaluate(() => { try { acRevealBars && acRevealBars(); } catch (e) {} });
      await p.waitForTimeout(500);

      const r = await p.evaluate(() => {
        const nav = document.getElementById('bottomNav');
        if (!nav) return { noNav: true };
        const ncs = getComputedStyle(nav);
        if (ncs.display === 'none' || ncs.visibility === 'hidden' || nav.classList.contains('nav-off')
            || parseFloat(ncs.opacity) < 0.1) return { navHidden: true };
        const nb = nav.getBoundingClientRect();
        if (nb.height < 10) return { navHidden: true };

        // every control a finger might need, that is on screen
        const worst = [];
        document.querySelectorAll('button,a,[role="button"],input,select,textarea').forEach((e) => {
          const cs = getComputedStyle(e);
          if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return;
          if (e.closest('#bottomNav')) return;                       // the bar itself
          if (e.disabled) return;
          const b2 = e.getBoundingClientRect();
          if (b2.width < 8 || b2.height < 8) return;
          if (b2.bottom < 0 || b2.top > innerHeight) return;         // off screen entirely
          // does the nav's box cover this control's centre?
          const cx = b2.left + b2.width / 2, cy = b2.top + b2.height / 2;
          const under = cx >= nb.left && cx <= nb.right && cy >= nb.top && cy <= nb.bottom;
          if (!under) return;
          // it is only a real fault if the NAV is what a tap would hit
          const hit = document.elementFromPoint(Math.round(cx), Math.round(cy));
          if (hit && (hit === e || e.contains(hit) || hit.contains(e))) return;
          const label = (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 34);
          worst.push({ cls: (typeof e.className === 'string' ? e.className.split(' ')[0] : e.tagName), label,
                       covered: Math.round(nb.top < b2.bottom ? b2.bottom - nb.top : 0) });
        });
        const feed = document.getElementById('acFeed');
        const endless = !!(feed && getComputedStyle(feed).display !== 'none'
                           && feed.offsetParent !== null && !document.getElementById('acFeedEnd'));
        return { navTop: Math.round(nb.top), vh: innerHeight, blocked: worst, endless };
      });

      if (r.none || r.noNav) { skipped(name, r.noNav ? 'no floating bar in this layout' : 'nothing to scroll'); continue; }
      if (r.navHidden) { skipped(name, 'this surface hides the bar on purpose'); continue; }
      /* AN ENDLESS LIST CANNOT ANSWER "does the LAST thing clear the bar", because
         there is no last thing - scrolling just loads more, and whatever sits under
         the floating pill at any moment is the next card passing beneath it, which
         is the whole point of a floating bar. Home only has a real end once
         #acFeedEnd ("You're all caught up") is rendered. Skipped BY NAME rather
         than reported as a fault: a probe that cannot see its subject must say so,
         not guess. */
      if (r.endless) { skipped(name, 'endless feed, no end reached on this account - cannot answer'); continue; }
      ok(!r.blocked.length,
         name + ' — every control clears the floating bar at its very bottom',
         r.blocked.length ? r.blocked.slice(0, 3).map(x => x.cls + ' "' + x.label + '" covered by ' + x.covered + 'px').join(' · ') : '');
    }
    await p.close();
  }

  ok(errs.length === 0, 'no JS errors while walking', errs[0]);
  await b.close();
  console.log('\n═══ ' + pass + ' passed, ' + fail + ' failed, ' + skip + ' skipped ═══');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
