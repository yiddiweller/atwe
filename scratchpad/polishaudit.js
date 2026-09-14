/* AUDIT ONLY - changes nothing. Walks the real app and collects the numbers
   section 3 of the polish brief asks about, so the pass is driven by measurement
   rather than opinion. Prints, per family, every DISTINCT value in use and where. */
process.env.JWT_SECRET = 'scoresecret';
const SP = '/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const { chromium } = require(SP + 'node_modules/playwright-core');
const TOK = require('fs').readFileSync('/tmp/tok.txt', 'utf8').trim();

// world, opener, and how long its content needs
const SURFACES = [
  ['Home',          `appTab('home')`,            3000],
  ['Beam',          `appTab('chat')`,            2500],
  ['Engine',        `appTab('search')`,          2500],
  ['Notifications', `acNavNotifs()`,             2500],
  ['Account',       `appTab('profile')`,         2000],
  ['Settings',      `openSettings()`,            1500],
  ['Wallet',        `acOpenWallet()`,            2500],
  ['Orders',        `acOpenOrders('buyer')`,     2000],
  ['Marketplace',   `acOpenMarketplace()`,       2500],
  ['Jobs',          `acOpenJobs&&acOpenJobs()`,  2000],
];

const collect = () => {
  const out = { rows: [], icons: [], chevrons: [], avatars: [], pills: [], radii: [],
                dividers: [], cards: [], text: [] };
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0
           && getComputedStyle(e).visibility !== 'hidden';
  };
  const px = (v) => Math.round(parseFloat(v) * 10) / 10;
  /* className on an SVG element is an SVGAnimatedString, NOT a string - closest('[class]')
     happily returns <g>/<svg> nodes, so .split() throws and the whole surface reports an
     error while the page itself is perfectly fine. */
  const cn = (e) => (e && typeof e.className === 'string' ? e.className
                     : (e && e.getAttribute && e.getAttribute('class')) || '');

  // ── list rows: anything that reads as a tappable row in a list
  document.querySelectorAll('.me-row,.iset-row,.ac-item,.notif-row,.sm-row,.site-row').forEach((e) => {
    if (!vis(e)) return;
    const cs = getComputedStyle(e);
    out.rows.push({ cls: cn(e).split(' ').filter(c => c && !c.startsWith('js-'))[0] || '?',
                    h: px(e.getBoundingClientRect().height),
                    minH: cs.minHeight, pad: cs.padding });
  });

  // ── icons: an svg or masked glyph inside a control
  document.querySelectorAll('svg').forEach((e) => {
    if (!vis(e)) return;
    const r = e.getBoundingClientRect();
    if (r.width > 60 || r.width < 6) return;          // not a glyph
    const host = e.closest('[class]');
    out.icons.push({ cls: cn(host).split(' ')[0] || '?',
                     w: px(r.width), h: px(r.height),
                     stroke: getComputedStyle(e).strokeWidth });
  });

  // ── chevrons specifically (the > at the end of a row)
  document.querySelectorAll('.iset-chev,.me-chev,.sm-chev,.ac-chev').forEach((e) => {
    if (!vis(e)) return;
    const r = e.getBoundingClientRect();
    out.chevrons.push({ cls: cn(e).split(' ')[0], w: px(r.width), h: px(r.height) });
  });

  // ── avatars
  document.querySelectorAll('.user-avatar,.ac-prof-ava,.me-hero-av,.notif-av').forEach((e) => {
    if (!vis(e)) return;
    const r = e.getBoundingClientRect();
    out.avatars.push({ cls: cn(e).split(' ')[0], w: px(r.width), h: px(r.height),
                       rad: getComputedStyle(e).borderRadius });
  });

  // ── pills / tabs
  document.querySelectorAll('.tb-feedtab,.ntf-tab,.ac-ptab,.ac-jv,.ac-scope-chip,.ev-tab,.bk-tab,.mkt-kind')
    .forEach((e) => {
      if (!vis(e)) return;
      const cs = getComputedStyle(e), r = e.getBoundingClientRect();
      out.pills.push({ cls: cn(e).split(' ')[0], h: px(r.height),
                       padX: cs.paddingLeft + '/' + cs.paddingRight,
                       padY: cs.paddingTop + '/' + cs.paddingBottom,
                       fs: cs.fontSize, rad: cs.borderRadius });
    });

  // ── radii of any painted block wider than 120px (cards, panels, sheets)
  document.querySelectorAll('div,section,article,button').forEach((e) => {
    if (!vis(e)) return;
    const r = e.getBoundingClientRect();
    if (r.width < 120 || r.height < 28) return;
    const cs = getComputedStyle(e);
    const painted = (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)')
                 || (cs.backgroundImage && cs.backgroundImage !== 'none');
    if (!painted) return;
    const rad = parseFloat(cs.borderTopLeftRadius) || 0;
    if (rad < 2) return;                                // square blocks are fine
    const eff = Math.min(rad, r.height / 2);
    if (Math.abs(eff - r.height / 2) < 1.5) return;     // a capsule is its own thing
    out.radii.push({ cls: cn(e).split(' ')[0] || e.tagName.toLowerCase(),
                     rad: px(rad), w: px(r.width) });
  });

  // ── dividers: a 1-2px painted line
  document.querySelectorAll('*').forEach((e) => {
    if (!vis(e)) return;
    const cs = getComputedStyle(e);
    ['Top', 'Bottom'].forEach((side) => {
      const w = parseFloat(cs['border' + side + 'Width']);
      if (w > 0 && w <= 2 && cs['border' + side + 'Style'] === 'solid') {
        const c = cs['border' + side + 'Color'];
        if (c && c !== 'rgba(0, 0, 0, 0)') {
          out.dividers.push({ cls: cn(e).split(' ')[0] || e.tagName.toLowerCase(),
                              side, w: px(w), colour: c });
        }
      }
    });
  });

  // ── every text colour actually painted, with its size
  const seen = new Set();
  document.querySelectorAll('*').forEach((e) => {
    if (!vis(e)) return;
    const hasOwnText = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!hasOwnText) return;
    const cs = getComputedStyle(e);
    const key = cs.color + '|' + cs.fontSize + '|' + cs.fontWeight;
    if (seen.has(key)) return;
    seen.add(key);
    out.text.push({ cls: cn(e).split(' ')[0] || e.tagName.toLowerCase(),
                    colour: cs.color, fs: cs.fontSize, fw: cs.fontWeight });
  });

  return out;
};

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  await p.goto('http://localhost:3262', { waitUntil: 'domcontentloaded' });
  await p.evaluate((t) => {
    localStorage.clear();
    localStorage.setItem('atwe_token', t);
    localStorage.setItem('atwe_intro_seen', JSON.stringify(['beam', 'circles', 'ai', 'wallet']));
  }, TOK);
  await p.goto('http://localhost:3262', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(6000);

  const all = {};
  for (const [name, opener, wait] of SURFACES) {
    try {
      await p.evaluate((o) => { try { eval(o); } catch (e) { /* surface may not exist */ } }, opener);
      await p.waitForTimeout(wait);
      all[name] = await p.evaluate(collect);
      // close any overlay so the next opener starts clean
      await p.evaluate(() => { try { document.querySelectorAll('.overlay:not(.hidden)').forEach(o => o.id && closeOverlay(o.id, true)); } catch (e) {} });
      await p.waitForTimeout(400);
    } catch (e) { all[name] = { error: String(e).slice(0, 400) }; console.log('ERR '+name+': '+String(e).slice(0,400)); }
  }

  // ── report: for each family, the distinct values and who uses them
  const tally = (fam, keyFn, labelFn) => {
    const m = new Map();
    for (const [surf, data] of Object.entries(all)) {
      (data[fam] || []).forEach((it) => {
        const k = keyFn(it);
        if (!m.has(k)) m.set(k, { n: 0, who: new Set(), where: new Set() });
        const e = m.get(k); e.n++; e.who.add(labelFn(it)); e.where.add(surf);
      });
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  };

  const show = (title, fam, keyFn, labelFn, note) => {
    const t = tally(fam, keyFn, labelFn);
    console.log('\n━━ ' + title + '  (' + t.length + ' distinct values)');
    if (note && t.length > 1) console.log('   ' + note);
    t.slice(0, 14).forEach(([k, e]) => {
      console.log('   ' + String(k).padEnd(26) + String(e.n).padStart(4) + 'x   ' +
        [...e.who].slice(0, 4).join(', ') + (e.who.size > 4 ? ' +' + (e.who.size - 4) : '') +
        '   [' + [...e.where].slice(0, 4).join(' ') + ']');
    });
  };

  console.log('\n================  ATWE POLISH AUDIT - measured, nothing changed  ================');
  console.log('390x844, Black theme, signed in. Surfaces: ' + Object.keys(all).join(', '));

  show('LIST ROW HEIGHT', 'rows', r => r.h + 'px', r => r.cls,
       'the brief asks for one row height; --row-h is 55');
  show('ICON SIZE (glyphs in controls)', 'icons', i => i.w + 'x' + i.h, i => i.cls,
       'a glyph set should read as one size');
  show('CHEVRON SIZE', 'chevrons', c => c.w + 'x' + c.h, c => c.cls, '');
  show('AVATAR SIZE', 'avatars', a => a.w + 'x' + a.h, a => a.cls, '');
  show('PILL HEIGHT', 'pills', p2 => p2.h + 'px', p2 => p2.cls, 'rule 9b: every tab row is one object');
  show('PILL PADDING', 'pills', p2 => p2.padY + ' | ' + p2.padX, p2 => p2.cls, '');
  show('CARD RADIUS (painted, >120px wide)', 'radii', r => r.rad + 'px', r => r.cls,
       'one roundness everywhere is the founder\'s own rule');
  show('DIVIDER COLOUR', 'dividers', d => d.colour, d => d.cls, '');
  show('TEXT COLOUR', 'text', t => t.colour, t => t.cls,
       'primary / secondary / tertiary should be a short list');

  console.log('\n── JS errors while walking: ' + (errs.length ? errs.join(' | ') : 'none'));
  const failed = Object.entries(all).filter(([, d]) => d.error);
  if (failed.length) console.log('── surfaces that would not open: ' + failed.map(f => f[0]).join(', '));
  await b.close();
})().catch(e => { console.error('CRASH', e); process.exit(2); });
