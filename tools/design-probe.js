/* The design + accessibility sweep, run inside the page by tools/design-sweep.js.
 * Exported as a PLAIN FUNCTION so Playwright can serialise it — no closures over
 * anything on the Node side.
 *
 * Returns, for whatever is on screen right now:
 *   contrast  text failing WCAG AA against what is actually behind it
 *   targets   interactive things a finger would struggle to hit
 *   clipped   text genuinely cut off (no ellipsis, no wrap)
 *   overflow  the page scrolling sideways
 *   unnamed   icon-only controls a screen reader cannot name
 *
 * Deliberately strict about what it REPORTS and generous about what it skips: a
 * sweep that cries wolf gets ignored, which is worse than no sweep.
 *
 * tools/design-probe.test.js plants a known defect of each kind and proves this
 * catches it — run that whenever you touch this file. A check that cannot fail
 * is worse than no check, and this one silently became exactly that once.
 */
module.exports = function probe() {
  const out = { contrast: [], targets: [], clipped: [], overflow: [], unnamed: [] };
  const seen = new Set();

  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    // Off-screen or behind a closed panel: not on screen, not this sweep's problem.
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
    return true;
  };
  const hiddenAncestor = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (n.classList && n.classList.contains('hidden')) return true;
      if (n.getAttribute && n.getAttribute('aria-hidden') === 'true') return true;
      const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden') return true;
    }
    return false;
  };
  const rgb = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(',').map(parseFloat);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => ({                     // fg composited onto bg
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1,
  });
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05); };
  // What is really behind this element: walk up compositing every background
  // until something opaque. Give up (and skip) on an image or a gradient — the
  // contrast there depends on the picture, not on CSS.
  const behind = (el) => {
    let acc = null;
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.backgroundImage && s.backgroundImage !== 'none') return null;
      const c = rgb(s.backgroundColor);
      if (!c || c.a === 0) continue;
      acc = acc ? over(acc, c) : c;
      if (acc.a >= 0.99) return acc;
    }
    return acc && acc.a >= 0.99 ? acc : null;
  };
  const label = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48);

  // ── the page scrolling sideways ────────────────────────────────────────────
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) out.overflow.push({ sw: de.scrollWidth, vw: de.clientWidth });

  // ── text contrast ──────────────────────────────────────────────────────────
  const TEXT = 'p,span,div,a,button,label,h1,h2,h3,h4,h5,h6,li,td,th,small,strong,b,em,i,input,textarea';
  for (const el of document.querySelectorAll(TEXT)) {
    if (out.contrast.length > 40) break;
    // Only elements whose OWN text is what we're judging.
    let own = '';
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.nodeValue;
    own = own.replace(/\s+/g, ' ').trim();
    if (!own || own.length < 2) continue;
    if (!visible(el) || hiddenAncestor(el)) continue;
    const s = getComputedStyle(el);
    const fg = rgb(s.color); if (!fg || fg.a < 0.95) continue;   // faded-out text is usually mid-transition
    const bg = behind(el); if (!bg) continue;
    const size = parseFloat(s.fontSize) || 14;
    const weight = parseInt(s.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const r = ratio(fg, bg);
    if (r >= need) continue;
    const key = 'c|' + own + '|' + s.color;
    if (seen.has(key)) continue; seen.add(key);
    out.contrast.push({ r: Math.round(r * 10) / 10, need, size: Math.round(size), t: own.slice(0, 40), color: s.color });
  }

  // ── tap targets ────────────────────────────────────────────────────────────
  const HIT = 'button,a[href],[role="button"],input[type="checkbox"],input[type="radio"],select,[onclick]';
  for (const el of document.querySelectorAll(HIT)) {
    if (out.targets.length > 30) break;
    if (!visible(el) || hiddenAncestor(el)) continue;
    if (el.disabled) continue;
    if (el.tagName === 'SELECT') continue;             // a native select is the size the OS makes it
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (el.tagName === 'A' && s.display === 'inline') continue;
    const words = (el.innerText || '').replace(/\s+/g, ' ').trim();
    // A name, a handle or a #hashtag inside a sentence is a LINK, not a finger
    // target — flagging those buries the icon buttons that genuinely are too
    // small. Text controls only count when they are shaped like a button.
    if (words) {
      const looksLikeAButton = /btn|pill|tab|chip|action|cta|follow|submit/i.test(el.className || '')
        || (s.backgroundColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)')
        || (s.borderTopWidth && parseFloat(s.borderTopWidth) > 0);
      if (!looksLikeAButton) continue;
      if (r.height >= 30) continue;                    // a normal text button, fine
    }
    if (r.width < 6 || r.height < 6) continue;                    // decorative slivers, not controls
    // What a FINGER actually hits, not what the box measures. A 32px icon often
    // sits in a padded row that takes the tap for it, and reporting the icon's
    // own size would send someone off to "fix" something that is already fine.
    // Probe a 44x44 area centred on it and see how much of that resolves here.
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let lo = -22, hiX = 22, loY = -22, hiY = 22;
    // A padded ancestor only extends the target if IT is clickable too — a plain
    // background div wrapping the icon does not make the icon easier to hit.
    // (Counting any ancestor made every target look 44px and the check useless;
    // the self-test caught it.)
    const clickable = (n) => !!n && (n.onclick || n.getAttribute('onclick')
      || n.tagName === 'BUTTON' || n.tagName === 'A' || n.tagName === 'LABEL'
      || n.getAttribute('role') === 'button');
    const owns = (x, y) => {
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
      const h = document.elementFromPoint(x, y);
      if (!h) return false;
      return h === el || el.contains(h) || (h.contains(el) && clickable(h));
    };
    while (lo < 0 && !owns(cx + lo, cy)) lo += 2;
    while (hiX > 0 && !owns(cx + hiX, cy)) hiX -= 2;
    while (loY < 0 && !owns(cx, cy + loY)) loY += 2;
    while (hiY > 0 && !owns(cx, cy + hiY)) hiY -= 2;
    const hit = { width: Math.max(r.width, hiX - lo), height: Math.max(r.height, hiY - loY) };
    if (hit.width >= 40 && hit.height >= 40) continue;            // comfortable in practice
    const t = label(el) || el.getAttribute('aria-label') || el.className || el.tagName;
    const key = 't|' + t + Math.round(hit.width) + 'x' + Math.round(hit.height);
    if (seen.has(key)) continue; seen.add(key);
    const what = (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '');
    out.targets.push({ w: Math.round(hit.width), h: Math.round(hit.height), t: String(t).slice(0, 40), sel: what.slice(0, 60) });
  }

  // ── text cut off ───────────────────────────────────────────────────────────
  for (const el of document.querySelectorAll(TEXT)) {
    if (out.clipped.length > 25) break;
    if (!visible(el) || hiddenAncestor(el)) continue;
    const s = getComputedStyle(el);
    if (s.overflow === 'visible' && s.overflowX === 'visible') continue;
    if (s.textOverflow === 'ellipsis') continue;                 // cut off ON PURPOSE, with a "…"
    if (s.overflowX === 'auto' || s.overflowX === 'scroll') continue;  // a scroller is meant to be scrolled
    // Only judge elements whose OWN text could be clipped. A flex row reports a
    // scrollWidth wider than its box whenever its children COULD lay out wider —
    // even though they wrap perfectly — and reporting those buries the real ones.
    const hasElementChildren = el.children && el.children.length > 0;
    if (hasElementChildren && s.whiteSpace !== 'nowrap' && s.whiteSpace !== 'pre') continue;
    const t = label(el);
    if (!t) continue;
    if (el.scrollWidth > el.clientWidth + 2) {
      const key = 'x|' + t;
      if (seen.has(key)) continue; seen.add(key);
      out.clipped.push({ sw: el.scrollWidth, cw: el.clientWidth, t: t.slice(0, 40) });
    }
  }

  // ── icon-only controls with no name ────────────────────────────────────────
  for (const el of document.querySelectorAll('button,[role="button"],a[href]')) {
    if (out.unnamed.length > 25) break;
    if (!visible(el) || hiddenAncestor(el)) continue;
    if (el.getAttribute('aria-hidden') === 'true') continue;
    const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
    if (text) continue;                                          // has visible words: named
    const named = el.getAttribute('aria-label') || el.getAttribute('title')
      || el.getAttribute('aria-labelledby') || (el.querySelector('img[alt]') || {}).alt;
    if (named && String(named).trim()) continue;
    const what = (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
    if (!what) continue;
    const key = 'u|' + what;
    if (seen.has(key)) continue; seen.add(key);
    out.unnamed.push({ t: what.slice(0, 60) });
  }

  return out;
};
