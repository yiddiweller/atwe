/* ONE-OFF: what a member can actually SEE. The source sweep proves the copy is clean and the
   wrapper proves the AI is; this asks the different question the founder asked, which is what
   ends up rendered on a real screen once the app has built it out of live data. Member-written
   content (a post body, a message bubble, a person's own name) is the founder's own exception
   and is reported separately rather than failed on. */
const SP = '/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const { chromium } = require(SP + 'node_modules/playwright-core');
const fs = require('fs');
const BASE = 'http://localhost:3262';
const TOK = (process.env.TOK || fs.readFileSync('/tmp/tok.txt', 'utf8')).trim();

/* Where a member's OWN words legitimately live. A dash found inside one of these is somebody
   having typed it, which is exactly what must not be edited. */
const MEMBER_CONTENT = ['.ac-post-body', '.msg-bubble', '.ac-post-name', '.ac-post-handle',
  '.ac-item-name', '.ac-item-sub', '.notif-text', '.mc-prod', '.ac-pf-body', '.lp-title', '.lp-desc'];

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  await p.addInitScript((t) => { try { localStorage.setItem('atwe_token', t); } catch (e) {} }, TOK);
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));

  const scan = async (label) => p.evaluate(({ label, MEMBER_CONTENT }) => {
    const out = { label, chrome: [], member: 0 };
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (!/[—–]/.test(n.nodeValue)) continue;
      const el = n.parentElement;
      if (!el || !el.offsetParent) continue;                       // not on screen
      if (MEMBER_CONTENT.some((s) => el.closest(s))) { out.member++; continue; }
      out.chrome.push((el.className || el.tagName) + ' :: ' + n.nodeValue.trim().slice(0, 90));
    }
    return out;
  }, { label, MEMBER_CONTENT });

  const go = async (label, fn) => {
    await fn();
    await p.waitForTimeout(1400);
    const r = await scan(label);
    console.log('  ' + (r.chrome.length ? 'DASH ' : 'ok   ') + label.padEnd(24) +
      (r.member ? '(' + r.member + ' in member content, correctly left)' : ''));
    r.chrome.forEach((c) => console.log('        ' + c));
    return r.chrome.length;
  };

  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  try { await p.waitForFunction(() => typeof S !== 'undefined' && S.user && S.user.id, null, { timeout: 40000 }); }
  catch (e) {
    console.log('  state: ' + await p.evaluate(() => JSON.stringify({
      hasS: typeof S !== 'undefined', user: window.S && S.user && S.user.id, tok: !!localStorage.getItem('atwe_token'),
      visible: [...document.querySelectorAll('.overlay')].filter((o) => o.offsetParent).map((o) => o.id).slice(0, 4) })));
    throw e;
  }
  await p.waitForTimeout(1200);

  /* SELF-TEST: a scan that finds nothing everywhere might not be scanning. Plant one in the
     app's own chrome and require it to be reported. */
  await p.evaluate(() => { const t = document.querySelector('.tb-feedtab'); if (t) t.textContent = 'planted \u2014 dash'; });
  const plant = await scan('self-test');
  console.log('  ' + (plant.chrome.length ? 'ok   the scan really reports one when it is there' : 'FAIL the scan cannot see a planted dash'));
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof S !== 'undefined' && S.user && S.user.id, null, { timeout: 40000 });
  await p.waitForTimeout(1200);

  let bad = plant.chrome.length ? 0 : 1;
  bad += await go('Home', async () => {});
  bad += await go('Notifications', () => p.evaluate(() => acNavNotifs()));
  bad += await go('a notification opened', () => p.evaluate(() => { const r = document.querySelector('.notif-row'); if (r) r.click(); }));
  bad += await go('Beam', () => p.evaluate(() => { closeOverlay('notifOverlay', true); appTab('chat'); }));
  bad += await go('a conversation', () => p.evaluate(async () => {
    const r = await API.req('GET', '/api/atchat/conversations'); const c = (r.conversations || r || [])[0];
    if (c) acOpenChat(c.peerId || c.id, c.threadId || null);
  }));
  bad += await go('Atwe AI', () => p.evaluate(() => appTab('ai')));
  bad += await go('Engine', () => p.evaluate(() => { acAiBack(); appTab('search'); }));
  bad += await go('Account', () => p.evaluate(() => appTab('profile')));
  bad += await go('Settings', () => p.evaluate(() => openSettings()));
  bad += await go('Wallet', () => p.evaluate(() => { closeSettings(true); acOpenWallet(); }));

  console.log('\n' + (errs.length ? 'JS errors: ' + errs.join(' | ') : 'no JS errors'));
  console.log(bad ? ('*** ' + bad + ' dashes in the app\'s OWN text') : 'nothing Atwe wrote carries one, on any surface opened');
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('CRASH ' + e.stack); process.exit(1); });
