/* NOTHING THE APP TRIES TO SHOW MAY BE HIDDEN BY A CSS RULE.
 *
 * The founder's team went to use a group's shared Cloud and found it gone. It had not
 * been deleted — every line of it was still there, and the JS that reveals its button
 * was still running. The 1779 chat-header redesign added
 *
 *     #acThreadScreen .ac-head-acts .ac-callbtn:not(.ac-head-more){display:none!important}
 *
 * to move CALLING into the ⋯ menu, and #acCloudBtn is the same class. It was hidden with
 * them and never given a row in that menu, so for several builds the whole Cloud — and a
 * group's video call and Go live — were unreachable. Nothing errored. Every probe passed.
 *
 * The fingerprint of that bug is exact and mechanical: the app sets an inline
 * `style.display` to something visible, and a CSS rule computes it back to `none`. That is
 * always a bug — the code believes the control is on screen and the stylesheet disagrees.
 * This walks the app looking for exactly that, and separately checks that the three
 * recovered doors really do open.
 *
 * Self-test: put the `!important` rule back over #acCloudBtn and this goes red by name.
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const PORT = process.env.PORT || 3262;
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let ok = 0; const fails = [];
const chk = (c, m) => { if (c) ok++; else fails.push(m); };

/* Every element the app is actively showing must actually be showing. Ignore anything
   inside a container that is itself hidden — a closed overlay legitimately holds
   `display:flex` children, and that is state, not a stylesheet fighting the code. */
const SCAN = () => {
  const bad = [];
  document.querySelectorAll('[style*="display"]').forEach((el) => {
    const want = el.style.display;
    if (!want || want === 'none') return;
    if (getComputedStyle(el).display !== 'none') return;
    // is an ANCESTOR the reason? then this element is not the fault.
    let p = el.parentElement, hiddenParent = false;
    while (p) { if (getComputedStyle(p).display === 'none') { hiddenParent = true; break; } p = p.parentElement; }
    if (hiddenParent) return;
    bad.push((el.id || el.className || el.tagName) + ' wants ' + want);
  });
  return bad;
};

(async () => {
  const tok = fs.readFileSync('/tmp/tok.txt', 'utf8').trim();
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.addInitScript((t) => localStorage.setItem('atwe_token', t), tok);
  await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(5000);
  await p.evaluate(async () => {
    if (typeof API !== 'undefined') { try { await API.req('POST', '/api/onboarding/finish', { intent: 'explore' }); } catch (e) {} }
    document.getElementById('onboardingFlow')?.classList.add('hidden');
    const s = document.querySelector('#introSheet:not(.hidden)');
    if (s && typeof introDismiss === 'function') introDismiss();
  });
  await p.waitForTimeout(800);

  /* A GROUP, made through the real API — the header is the surface that broke, and a DM
     exercises a different branch of the same code. */
  const gid = await p.evaluate(async () => {
    try {
      const mine = await API.req('GET', '/api/atchat/groups');
      const list = mine.groups || mine || [];
      if (list.length) return list[0].id;
      /* A CONTACT group — casual, no @handle. Two things 400 this if you get them wrong:
         the public kind demands a unique username, and EVERY group needs at least one
         other person ("Add at least one other person."). Both silently produced no group
         in earlier versions of this probe, so it reported the check failed rather than
         the setup. */
      const who = await API.req('GET', '/api/social/mention-search?q=a');
      const other = (who.users || who || []).find((u) => u.id !== S.user.id);
      if (!other) return null;
      const g = await API.req('POST', '/api/atchat/groups',
        { name: 'Reachability', contact: true, members: [other.id], memberIds: [other.id] });
      return (g.group || g).id;
    } catch (e) { return null; }
  });
  chk(!!gid, 'a group to open (the surface that broke)');

  const WORLDS = [
    ['Home', "appTab('home')"],
    ['Beam', "appTab('chat')"],
    ['Engine', "appTab('search')"],
    ['Account', "appTab('profile')"],
    ['a conversation', null],
    ['a group', null],
  ];
  for (const [name, go] of WORLDS) {
    if (go) await p.evaluate((g) => { try { eval(g); } catch (e) {} }, go);
    else if (name === 'a group' && gid) await p.evaluate((g) => acOpenGroup(g), gid);
    else if (name === 'a conversation') await p.evaluate(() => { try { acOpenChat(S.user.id); } catch (e) {} });
    await p.waitForTimeout(2000);
    const bad = await p.evaluate(SCAN);
    chk(bad.length === 0, `${name}: nothing the app is showing is hidden by a rule (${bad.join(' | ')})`);
  }

  /* And positively: the three doors that were lost really do open again. */
  if (gid) {
    await p.evaluate((g) => acOpenGroup(g), gid);
    await p.waitForTimeout(1800);
    const rows = await p.evaluate(() => {
      acThreadMenu(document.getElementById('acThreadMenuBtn'));
      return [...document.querySelectorAll('#acHeadMenuSheet .mm-item')].map((e) => e.textContent.trim());
    });
    for (const want of ['Cloud', 'Video call', 'Go live']) {
      chk(rows.some((r) => r === want || r.startsWith(want)), `a group's ⋯ menu offers "${want}" (${rows.length} rows)`);
    }
    await p.evaluate(() => closeOverlay('acHeadMenu', true));
    await p.waitForTimeout(400);
    const opened = await p.evaluate(async () => {
      acOpenCloud();
      await new Promise((r) => setTimeout(r, 1400));
      const o = document.getElementById('cloudOverlay');
      return { shown: o && !o.classList.contains('hidden'), add: !!document.getElementById('cloudAddBtn') };
    });
    chk(opened.shown, 'and tapping Cloud really opens it');
    chk(opened.add, 'with the + that adds a sheet, checklist, note or file');
  }

  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  chk(errs.length === 0, 'no JS errors');
  await ctx.close(); await b.close();
  if (fails.length) console.log('== FAILS ==\n' + fails.map((f) => '  FAIL ' + f).join('\n'));
  console.log(`ok checks: ${ok}`);
  console.log(fails.length ? `${fails.length} FAILED` : 'every door the app opens is a door you can reach');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
