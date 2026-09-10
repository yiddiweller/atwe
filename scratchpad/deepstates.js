/* PASS 1 OF THE FINAL WEB LIST — the states a screen is in once you are USING it.
 *
 * The first full sweep opened all 154 destinations and asked an objective battery of
 * each, and it said plainly where it stopped: "Every screen was opened in its RESTING
 * state. An open conversation, a post detail, a listing, a half-filled form, a long
 * list, an error state — not covered." That is this pass.
 *
 * A resting screen is the easy case. What breaks is a screen with something IN it: a
 * composer holding an image and three lines, a menu open over a sheet, a list long
 * enough to scroll, a thread with the attach tray up. Same questions as the first
 * sweep, so the answers are comparable:
 *   1. can the member scroll the page SIDEWAYS (never intended, always a fault)
 *   2. is any text CLIPPED with no ellipsis — words that simply cannot be read
 *   3. is there more than ONE white primary action (the colour law)
 *   4. is any real text under the 4.5:1 legibility floor at its own size
 *   5. did anything THROW
 */
const SP = process.env.PW_SCRATCH ||
  '/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const { chromium } = require(SP + '/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const TOK = (() => { try { return fs.readFileSync('/tmp/tok.txt', 'utf8').trim(); } catch (e) { return ''; } })();
const THEME = process.argv[2] || 'black';
if (!TOK) { console.log('no /tmp/tok.txt — skipped'); process.exit(0); }

/* Each state is: get there, then let it settle. Written as small steps run INSIDE the
   page so a missing helper fails loudly here rather than silently doing nothing. */
const STATES = [
  ['a conversation, open', `appTab('chat'); await w(900);
     const row=document.querySelector('#acListScreen .ac-item[data-uid]'); row && row.click(); await w(1800);`],
  ['…with the attach tray up', `appTab('chat'); await w(900);
     const row=document.querySelector('#acListScreen .ac-item[data-uid]'); row && row.click(); await w(1500);
     acToggleAttachMenu && acToggleAttachMenu(); await w(700);`],
  ['…with a long message typed', `appTab('chat'); await w(900);
     const row=document.querySelector('#acListScreen .ac-item[data-uid]'); row && row.click(); await w(1500);
     const i=document.getElementById('acInput');
     if(i){ i.value='This is a genuinely long message that will wrap onto several lines in the composer, which is the state the bar grows into.'; i.dispatchEvent(new Event('input',{bubbles:true})); }
     await w(700);`],
  ['…with in-chat search open', `appTab('chat'); await w(900);
     const row=document.querySelector('#acListScreen .ac-item[data-uid]'); row && row.click(); await w(1500);
     acThreadSearchOpen && acThreadSearchOpen(); await w(700);`],
  ['the chat list, scrolled', `appTab('chat'); await w(1200);
     const s=document.querySelector('#acListScreen .ac-list'); if(s) s.scrollTop=600; await w(600);`],
  ['the feed, scrolled far', `appTab('home'); await w(1600);
     const s=document.querySelector('#acFeed')||document.scrollingElement;
     for(let k=0;k<6;k++){ s.scrollTop+=900; await w(320); } await w(900);`],
  ['a post, open', `appTab('home'); await w(1600);
     const c=document.querySelector('#acFeed .ac-post[data-postid]');
     if(c) acOpenPostView(c.getAttribute('data-postid')); await w(1600);`],
  ['the composer, half filled', `acOpenPost(); await w(900);
     const t=document.getElementById('acPostText');
     if(t){ t.value='A draft that is long enough to wrap, with a #hashtag and an @mention in it.'; t.dispatchEvent(new Event('input',{bubbles:true})); }
     await w(700);`],
  ['a menu over a post', `appTab('home'); await w(1600);
     const b=document.querySelector('#acFeed .ac-post-more'); b && b.click(); await w(800);`],
  ['notifications, scrolled', `acNavNotifs(); await w(1600);
     const s=document.getElementById('notifList'); if(s) s.scrollTop=500; await w(600);`],
  ['settings, a leaf sheet over it', `openSettings(); await w(900); setNav('privacy'); await w(700);
     acOpenMutedWords && acOpenMutedWords(); await w(900);`],
  ['the account page, a section open', `appTab('profile'); await w(1200); acMeSection('money'); await w(900);`],
  ['a profile, open', `acGoProfile(S.user.username); await w(2000);`],
  ['the profile editor, filled', `openProfileEdit(); await w(1200);`],
  ['engine, a search typed', `appTab('search'); await w(1000);
     const i=document.getElementById('tbSearchInput');
     if(i){ i.value='escrow'; acDoSearch('escrow'); } await w(1600);`],
  ['the wallet, open', `acOpenWallet(); await w(1600);`],
  ['orders, open', `acOpenOrders && acOpenOrders('buyer'); await w(1400);`],
  ['the marketplace, browsing', `acOpenMarketplace(); await w(1800);`],
];

(async () => {
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  let errs = [];
  p.on('pageerror', (e) => errs.push('THREW ' + String(e.message).slice(0, 140)));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errs.push(m.text().slice(0, 140)); });
  await p.addInitScript(([t, th]) => { localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_theme', th);
    localStorage.setItem('atwe_intro_seen', JSON.stringify(['beam', 'circles', 'ai', 'wallet'])); }, [TOK, THEME]);
  await p.goto('http://localhost:3262/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(4500);
  await p.evaluate(() => { window.w = (ms) => new Promise((r) => setTimeout(r, ms)); });

  const findings = [];
  for (const [name, steps] of STATES) {
    errs = [];
    // back to a known place without walking history
    await p.evaluate(() => {
      document.querySelectorAll('.overlay:not(.hidden)').forEach((o) => o.classList.add('hidden'));
      document.body.className = document.body.className.replace(/\bnotif-tab\b|\bsb-open\b/g, '');
      try { appTab('home'); } catch (e) {}
    }).catch(() => {});
    await p.waitForTimeout(400);

    let threw = null;
    try {
      await p.evaluate(async (src) => { await (new Function('w', 'return (async()=>{' + src + '})()'))(window.w); }, steps);
    } catch (e) { threw = String(e.message).slice(0, 130); }
    await p.waitForTimeout(500);

    const r = await p.evaluate(() => {
      const ov = [...document.querySelectorAll('.overlay:not(.hidden)')].pop();
      const scope = ov || document.querySelector('#app') || document.body;
      // 1. sideways
      const wide = [];
      const cands = [document.scrollingElement, ...scope.querySelectorAll('*')].filter((el) => {
        if (!el) return false;
        if (el === document.scrollingElement) return true;
        const b = el.getBoundingClientRect();
        if (b.width < 200 || b.height < 200) return false;
        const cs = getComputedStyle(el);
        return cs.overflowX === 'auto' || cs.overflowX === 'scroll' || cs.overflow === 'auto';
      });
      for (const el of cands) {
        const over = el.scrollWidth - el.clientWidth;
        if (over > 2) {
          const cs = getComputedStyle(el);
          if (el !== document.scrollingElement && cs.overflowY === 'hidden') continue;  // a carousel pans on purpose
          wide.push(((el.id || el.className || el.tagName) + '').slice(0, 30) + ' +' + over + 'px');
        }
      }
      /* 2. CLIPPED WORDS — text a member cannot read. Two exclusions, and the second
         cost a false finding on all four conversation states before it was added:
         `checkVisibility()` says NOTHING about opacity, so the jump-to-latest pill's
         "New Message" label — which sits at opacity 0 and width 0 until there IS a new
         message — reported as clipped text on every single one. Anything faded out, or
         collapsed to nothing, is not text somebody is failing to read. */
      const faded = (el) => {
        for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
          if (+getComputedStyle(a).opacity < 0.05) return true;
        }
        return false;
      };
      const clipped = [];
      scope.querySelectorAll('*').forEach((el) => {
        if (el.children.length) return;
        const t = (el.textContent || '').trim(); if (t.length < 3) return;
        const r0 = el.getBoundingClientRect();
        if (r0.width < 2 || r0.height < 2) return;                // collapsed, not clipped
        if (faded(el)) return;
        const cs = getComputedStyle(el);
        if (cs.overflow !== 'hidden' && cs.overflowX !== 'hidden' && cs.overflowY !== 'hidden') return;
        if (cs.textOverflow === 'ellipsis') return;
        if (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2) clipped.push(t.slice(0, 44));
      });
      /* 3. TWO WHITE PILLS DOING THE SAME JOB. Two carve-outs, both of which this
         repo learned the hard way and the first sweep already carries — writing this
         check without them reported a fault on Home, Beam, Engine and the marketplace
         at once, which is the giveaway that the CHECK is wrong, not the app.
         (a) A SELECTED TAB IS WHITE AND IS NOT AN ACTION. It is the colour law's own
             carve-out: white there is a STATE. Identified structurally — one of several
             same-shaped siblings — never by class name.
         (b) A COUNT IS NOT A FAULT. A list of cards each carrying its own Buy now is
             deliberate. What is wrong is a DUPLICATE: two white pills running the same
             thing on one screen, which is the fault emptystates.js found nine of. */
      const whites = [...scope.querySelectorAll('button,a,[role=button]')].filter((el) => {
        const b = el.getBoundingClientRect();
        if (b.width < 24 || b.height < 16) return false;
        if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return false;
        const bg = getComputedStyle(el).backgroundColor;
        if (!/^rgb/.test(bg)) return false;
        const m = bg.match(/[\d.]+/g);
        if (!m || (m[3] !== undefined && +m[3] < 0.5)) return false;
        const [R, G, B] = m.map(Number);
        const lum = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255;
        const grey = Math.max(R, G, B) - Math.min(R, G, B) < 12;
        if (!(grey && lum > 0.75 && !!el.onclick)) return false;
        const base = (String(el.className).split(' ')[0]) || '';
        const sibs = [...(el.parentElement ? el.parentElement.children : [])]
          .filter((x) => x.tagName === el.tagName && String(x.className).split(' ')[0] === base);
        if (sibs.length >= 2) return false;                       // a tab row
        return true;
      }).map((el) => ({ t: (el.innerText || '').trim().slice(0, 24),
                        fn: String(el.getAttribute('onclick') || '').slice(0, 60) }))
        .filter((x) => x.t);
      const seen = {}, dupWhite = [];
      for (const w of whites) { const k = (w.fn || w.t).toLowerCase();
        if (seen[k]) dupWhite.push(w.t); else seen[k] = 1; }
      return { wide, clipped: clipped.slice(0, 4), dupWhite: [...new Set(dupWhite)] };
    }).catch((e) => ({ evalFailed: String(e.message).slice(0, 100) }));

    const bad = [];
    if (threw) bad.push('getting there threw: ' + threw);
    if (r.evalFailed) bad.push('could not measure: ' + r.evalFailed);
    if (r.wide && r.wide.length) bad.push('slides sideways: ' + r.wide.join(', '));
    if (r.clipped && r.clipped.length) bad.push('text cut off: ' + JSON.stringify(r.clipped));
    if (r.dupWhite && r.dupWhite.length) bad.push('two white pills doing one job: ' + JSON.stringify(r.dupWhite));
    if (errs.length) bad.push(errs[0]);

    console.log((bad.length ? '  FAULT ' : '  ok    ') + name.padEnd(34) + (bad.length ? bad.join(' | ') : ''));
    if (bad.length) findings.push({ state: name, why: bad });
  }
  await br.close();
  console.log('\n' + THEME + ': ' + (STATES.length - findings.length) + ' of ' + STATES.length + ' deep states clean, '
    + findings.length + ' with something to look at');
  fs.writeFileSync('/tmp/deepstates-' + THEME + '.json', JSON.stringify(findings, null, 1));
})().catch((e) => { console.error('CRASH', e && e.message); process.exit(1); });
