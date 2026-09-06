/* NOTHING HERE YET, SAID PROPERLY — AND THE MARKETPLACE'S OWN CONTROLS.
 *
 * Seven screens had a real empty state (a glyph, a headline, a sentence, a way out) and
 * dozens had a bare grey line — "You haven't ordered anything yet." — which tells a person
 * nothing about what the screen is for or what to do next. The money and shop screens now
 * share ONE component, `acEmpty`, so they cannot drift apart again.
 *
 * And the marketplace's filter row answered with a native OS dropdown and native square
 * checkboxes — the only unstyled system controls left in the app, sitting directly under a
 * row of full pills. They are the app's own controls now, with the BEHAVIOUR untouched:
 * still a real <select> and real checkboxes, so keyboard and screen reader work as before.
 */
const { chromium } = require(process.env.PW ? process.env.PW + '/node_modules/playwright-core' : __dirname + '/node_modules/playwright-core');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:3262';
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (x !== undefined ? ' :: ' + String(x).slice(0, 160) : '')); } };

/* screen, how to open it, and whether it should offer a way out */
const SCREENS = [
  ['Orders',              'acOpenOrders("buyer")',  true],
  ['Sales',               'acOpenOrders("seller")', true],
  ['Saved items',         'acOpenSaved()',          true],
  ['Invoices',            'acOpenInvoices()',       false],
  ['Quotes',              'acOpenQuotes()',         false],
  ['Splits',              'acOpenSplits()',         false],
  ['Pools',               'acOpenPools()',          false],
  ['Scheduled payments',  'acOpenSchedPays()',      false],
];

(async () => {
  if (!process.env.TOK) { console.error('export TOK first'); process.exit(2); }
  const b = await chromium.launch({ executablePath: CHROME });
  for (const theme of ['black', 'light']) {
    const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.evaluate(([t, th]) => { localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_theme', th); }, [process.env.TOK, theme]);
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(5200);
    await p.evaluate(() => { const s = document.querySelector('#introSheet:not(.hidden)');
      if (s && typeof introDismiss === 'function') introDismiss(); });

    for (const [name, open, wantsCta] of SCREENS) {
      try { await p.evaluate((f) => eval(f), open); } catch (e) { ok(false, theme + ': ' + name + ' opens', String(e).slice(0, 80)); continue; }
      await p.waitForTimeout(1500);
      const r = await p.evaluate(() => {
        const e = document.querySelector('.overlay:not(.hidden) .ac-feed-empty');
        if (!e) {
          /* Not empty is fine — this account may genuinely have rows. Say which, so a
             failure is never mistaken for "the empty state is missing". */
          const any = document.querySelector('.overlay:not(.hidden)');
          return { none: true, hasRows: !!(any && any.querySelectorAll('.ac-item,.ac-job-card,.ord-card,.inv-row').length) };
        }
        const cta = e.querySelector('.ac-feed-empty-cta');
        const ic = e.querySelector('.ac-feed-empty-ic svg');
        const line = e.querySelector('.ac-feed-empty-line');
        const sub = e.querySelector('.ac-feed-empty-sub');
        const cs = cta ? getComputedStyle(cta) : null;
        return { line: line && line.textContent.trim(), sub: sub && sub.textContent.trim().length,
          hasIcon: !!ic && ic.getBoundingClientRect().width > 8, cta: cta && cta.textContent.trim(),
          ctaRuns: cta ? (cta.getAttribute('onclick') || '') : '', ctaRadius: cs && cs.borderRadius };
      });
      if (r.none) { ok(r.hasRows, theme + ': ' + name + ' has rows, so no empty state to check', 'neither rows nor an empty state'); continue; }
      ok(!!r.line && r.line.length > 3 && !/\.$/.test(r.line), theme + ': ' + name + ' says what is empty ("' + r.line + '")');
      ok(r.hasIcon, theme + ': ' + name + ' shows a glyph, not just a line of text');
      ok(r.sub > 20, theme + ': ' + name + ' explains what the screen is for');
      if (wantsCta) {
        ok(!!r.cta, theme + ': ' + name + ' offers a way out ("' + r.cta + '")');
        /* A button that does nothing is worse than no button: the function must exist. */
        const fn = (r.ctaRuns.match(/([A-Za-z_$][\w$]*)\s*\(/g) || []).map(x => x.replace(/\s*\($/, ''));
        const missing = await p.evaluate((names) => names.filter(n => typeof window[n] !== 'function'), fn);
        ok(missing.length === 0, theme + ': ' + name + '’s button goes somewhere real', 'missing: ' + missing.join(','));
      }
      await p.evaluate(() => { document.querySelectorAll('.overlay:not(.hidden)').forEach(o => closeOverlay(o.id)); });
      await p.waitForTimeout(400);
    }

    /* The marketplace filters: the app's own controls, not the browser's. */
    await p.evaluate(() => acOpenMarketplace());
    await p.waitForTimeout(1600);
    const f = await p.evaluate(() => {
      const sel = document.getElementById('mktSort'), lab = document.querySelector('.mkt-fstock');
      const box = lab && lab.querySelector('input[type=checkbox]');
      const cs = getComputedStyle(sel), cl = getComputedStyle(lab);
      const before = cl.backgroundColor;
      box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true }));
      return { selAppearance: cs.appearance, selRadius: cs.borderRadius, selTag: sel.tagName,
        pillRadius: cl.borderRadius, before, isCheckbox: box.type === 'checkbox' };
    });
    /* The fill is read a FRAME after the tick: getComputedStyle in the same tick as the
       property change can hand back the value from before it. */
    await p.waitForTimeout(300);
    f.after = await p.evaluate(() => getComputedStyle(document.querySelector('.mkt-fstock')).backgroundColor);
    ok(f.selTag === 'SELECT' && f.isCheckbox, theme + ': they are still a real select and real checkboxes');
    ok(f.selAppearance === 'none', theme + ': the OS dropdown chrome is gone');
    ok(parseFloat(f.selRadius) > 100, theme + ': the sort control is a pill like everything around it (' + f.selRadius + ')');
    ok(parseFloat(f.pillRadius) > 100, theme + ': and so is each tick (' + f.pillRadius + ')');
    ok(f.before !== f.after, theme + ': ticking one fills it in, the way the chips above do');
    ok(errs.length === 0, theme + ': no JS errors' + (errs.length ? ' — ' + errs[0] : ''));
  }
  await b.close();
  console.log(fail ? `\n${fail} FAILED` : '\nEvery empty screen says what it is for, and the filters are the app’s own');
  process.exit(fail ? 1 : 0);
})();
