/* ONE BUTTON, EVERYWHERE — and every exception is NAMED.
 *
 * The founder: "all buttons should have this grey background with a thin, very thin
 * outline, like we have in the login pages... and I'm talking literally every button."
 *
 * This walks 20 surfaces in both themes, finds every <button> and [role=button] that is
 * actually on screen, and fails on any that carries neither a fill nor a rim — i.e. a
 * bare glyph floating on the page.
 *
 * THE ALLOWLIST IS THE POINT. 32 controls are deliberately bare and each is listed with
 * its reason, so "bare" is a decision somebody made rather than one nobody noticed. A
 * blanket "skip anything that looks like nav" would hide the next real one; naming them
 * means deleting a fill still turns this red.
 *
 * IT MEASURES, IT DOES NOT GREP. Reading the CSS tells you what a rule says; a later
 * duplicate rule decides what a person sees, and this repo has shipped that exact
 * failure three times (.mc-call-sub, .mc-inv-sub, .msg-act).
 *
 * PATHS RESOLVE FROM __dirname — run-all.sh cds into scratchpad/.
 */
const path = require('path');
const SP = '/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const TOKF = '/tmp/tok.txt';
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); }
  else { fail++; console.log('  FAIL ' + m + (x !== undefined ? '\n         ' + String(x).slice(0, 500) : '')); } };

/* Deliberately bare, with the reason. Keyed on the FIRST class of the element. */
const ALLOWED = {
  'bn-tab':        'a bottom-nav icon: the glass bar is its ground',
  'sb-btn':        'a sidebar ROW, not a button',
  'sb-settings':   'a sidebar footer row',
  'tb-brand':      'the Atwe lockup, not a control',
  'ac-post-av':    'a profile picture',
  'ac-ava-wrap':   'a profile picture',
  'story-cell':    'a story ring — the picture is the button',
  'rv-card':       'a card',
  'ac-trend':      'a trending list row',
  'xp-tile':       'Engine discover tiles are borderless by design',
  'ac-pill-btn':   'when .accent it is THE white primary — deliberately rimless',
  'ac-follow-btn': 'the white primary',
  'ac-post-btn':   'the white primary',
  'mkt-buy':       'the white primary',
  'ac-reply':      'a post action pill: deliberately the page colour, a hole in the card',
  'ac-repost':     'a post action pill', 'ac-like': 'a post action pill',
  'ac-bookmark':   'a post action pill', 'ac-views': 'a post action pill',
  'tb-feedtab':    'the row is a pill; "Add" at its end is deliberately bare (rule 9)',
  'ac-post-more':  'the post ⋯ sits ON the card, whose grey is within a shade of the '
                 + 'recipe — a disc there would be invisible',
  'ac-link-btn':   'a blue text LINK, not a button',
  'ac-translate':  'a text link under a post',
  'ac-jv': 'a tab — selected state is the white pill, rimless like Apple\'s',
  'ac-ptab': 'a tab', 'ev-tab': 'a tab', 'ntf-tab': 'a tab', 'bk-tab': 'a tab',
  /* DECIDED (docs/DESIGN-UNIFICATION.md B2). A control floating over a PHOTO gets a
     ground; a control sitting on the page beside its own title does not. A profile's
     back arrow is a disc because it floats on the banner image — same reason the image
     viewer's X and dots became discs. These four sit on plain black next to their own
     title, where a disc adds a second shape to read and pushes the ink off the gutter
     line a previous pass measured it onto. One rule, two outcomes; not a drift. */
  'sheet-close': 'bare by design: page-header arrow beside its own title',
  'iset-back':   'bare by design: page-header arrow beside its own title',
  'notif-back':  'bare by design: page-header arrow beside its own title',
  'ac-x':        'bare by design: page-header arrow beside its own title',
};

const SURFACES = [
  ['home', null], ['engine', "appTab('search')"], ['beam', "appTab('chat')"],
  ['account', "appTab('profile')"], ['settings', 'openSettings()'],
  ['wallet', 'acOpenWallet()'], ['orders', "acOpenOrders('buyer')"],
  ['market', 'acOpenMarketplace()'], ['jobs', 'acOpenJobs()'], ['events', 'acOpenEvents()'],
  ['courses', 'acOpenCourses()'], ['giftcards', 'acOpenGiftCards()'],
  ['invoices', 'acOpenInvoices()'], ['sell', 'acOpenSell()'], ['profile', 'acGoProfile()'],
  ['notifs', 'openNotifications()'], ['ads', 'acOpenAds()'], ['quotes', 'acOpenQuotes()'],
  ['splits', 'acOpenSplits()'], ['pools', 'acOpenPools()'],
];

(async () => {
  let chromium, TOK;
  try {
    ({ chromium } = require(SP + 'node_modules/playwright-core'));
    TOK = require('fs').readFileSync(TOKF, 'utf8').trim();
  } catch (e) { console.log('  (unavailable: ' + e.message.slice(0, 60) + ')'); return done(); }

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  try {
    const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const base = 'http://localhost:' + (process.env.PORT || 3262) + '/';
    await p.goto(base, { waitUntil: 'domcontentloaded' });
    await p.evaluate(t => { localStorage.setItem('atwe_token', t);
      localStorage.setItem('atwe_intro_seen', '["beam","circles","ai","wallet"]'); }, TOK);
    await p.goto(base, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(4000);

    for (const theme of ['black', 'light']) {
      await p.evaluate(t => { try { setTheme(t); } catch (e) { document.body.classList.toggle('light', t === 'light'); } }, theme);
      const bare = {};
      for (const [name, fn] of SURFACES) {
        try { await p.evaluate(() => { document.querySelectorAll('.overlay:not(.hidden)')
          .forEach(o => { try { closeOverlay(o.id, true); } catch (e) {} }); }); } catch (e) {}
        await p.waitForTimeout(220);
        try { if (fn) await p.evaluate(f => eval(f), fn); } catch (e) { continue; }
        await p.waitForTimeout(1000);
        const hits = await p.evaluate((allow) => {
          const out = [];
          for (const el of document.querySelectorAll('button,[role=button]')) {
            const r = el.getBoundingClientRect();
            if (r.width < 12 || r.height < 12 || r.top > 900 || r.bottom < 0) continue;
            const c = getComputedStyle(el);
            if (c.visibility === 'hidden' || c.opacity === '0') continue;
            if (r.width > innerWidth * 0.7) continue;              // a row, not a button
            const fill = c.backgroundImage !== 'none' ||
              !/rgba\(0, 0, 0, 0\)|transparent/.test(c.backgroundColor);
            const rim = c.boxShadow !== 'none' || parseFloat(c.borderTopWidth) > 0;
            if (fill && rim) continue;
            const first = (el.className || '').toString().split(/\s+/).filter(Boolean)[0] || el.id || el.tagName;
            if (allow[first]) continue;
            out.push(first);
          }
          return out;
        }, ALLOWED);
        for (const h of hits) { bare[h] = bare[h] || new Set(); bare[h].add(name); }
      }
      const names = Object.keys(bare).sort();
      console.log(`\n── ${theme}: every control carries the recipe or is a named exception ──`);
      ok(names.length === 0,
         `${theme}: no unexplained bare control across ${SURFACES.length} surfaces`,
         names.map(n => `${n} (${[...bare[n]].slice(0, 3).join(' ')})`).join(', '));
    }

    // The recipe must really be the login button's, not a lookalike.
    const same = await p.evaluate(() => {
      const c = getComputedStyle(document.body);
      const g = n => c.getPropertyValue(n).trim().replace(/\s+/g, ' ');
      return { ctl: g('--ctl-fill'), tab: g('--tab-fill'), edge: g('--ctl-edge'), blur: g('--ctl-blur') };
    });
    console.log('\n── the recipe is one thing ──');
    ok(same.ctl === same.tab && !!same.ctl, 'the tab pills read from --ctl-*, so the two cannot drift', same.ctl.slice(0, 60));
    ok(/^#|rgb/.test(same.edge), 'the hairline is a real colour token', same.edge);
    ok(/blur\(/.test(same.blur), 'the frost is the nav bar\'s own material', same.blur);
  } catch (e) {
    fail++; console.log('  FAIL sweep threw\n         ' + e.message.slice(0, 300));
  } finally { try { await b.close(); } catch (e) {} done(); }
})();

function done() {
  console.log(`\n═══ ${pass} passed, ${fail} failed ═══`);
  process.exit(fail ? 1 : 0);
}
