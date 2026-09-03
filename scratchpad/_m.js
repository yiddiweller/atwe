const { chromium } = require(process.env.PW + '/node_modules/playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const p = await ctx.newPage();
  await p.goto('http://localhost:3262/', { waitUntil: 'domcontentloaded' });
  await p.evaluate((t) => { localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_theme','black'); }, process.env.TOK);
  await p.goto('http://localhost:3262/messages', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(5200);
  await p.evaluate(() => { const s=document.querySelector('#introSheet:not(.hidden)'); if(s&&typeof introDismiss==='function') introDismiss(); });
  await p.locator('#acListScreen .ac-item[data-uid]').first().click({ timeout: 25000 });
  await p.waitForSelector('#acThreadScreen:not(.hidden)', { timeout: 25000 });
  await p.waitForTimeout(1800);
  const one = await p.evaluate(() => {
    const bar = document.querySelector('#acThreadScreen .msg-inbox').getBoundingClientRect();
    const R=(s)=>{const n=document.querySelector('#acThreadScreen '+s); if(!n) return null; const q=n.getBoundingClientRect();
      return {L:+(q.left-bar.left).toFixed(1), R:+(bar.right-q.right).toFixed(1), w:Math.round(q.width)};};
    const svgIn=(s)=>{const n=document.querySelector('#acThreadScreen '+s+' svg'); if(!n) return null; const q=n.getBoundingClientRect();
      return {L:+(q.left-bar.left).toFixed(1), R:+(bar.right-q.right).toFixed(1), w:+q.width.toFixed(1)};};
    const ta=document.getElementById('acInput').getBoundingClientRect();
    return { barW:Math.round(bar.width), plusBox:R('.msg-attach'), plusInk:svgIn('.msg-attach'),
      micBox:R('.ac-mic'), sendBox:R('.msg-send'),
      textL:+(ta.left-bar.left+parseFloat(getComputedStyle(document.getElementById('acInput')).paddingLeft)).toFixed(1) };
  });
  await p.screenshot({ path:'scratchpad/out/n-bar1.png', clip:{x:0,y:770,width:390,height:74} });
  await p.fill('#acInput','The only way I could do that is if I had a lot more time to work on it properly');
  await p.evaluate(()=>acAutosize()); await p.waitForTimeout(600);
  const two = await p.evaluate(() => {
    const bar = document.querySelector('#acThreadScreen .msg-inbox').getBoundingClientRect();
    const inp = document.getElementById('acInput'); const ta = inp.getBoundingClientRect();
    const R=(s)=>{const n=document.querySelector('#acThreadScreen '+s); if(!n) return null; const q=n.getBoundingClientRect();
      return {L:+(q.left-bar.left).toFixed(1), R:+(bar.right-q.right).toFixed(1), B:+(bar.bottom-q.bottom).toFixed(1)};};
    const svgIn=(s)=>{const n=document.querySelector('#acThreadScreen '+s+' svg'); if(!n) return null; const q=n.getBoundingClientRect();
      return {L:+(q.left-bar.left).toFixed(1), B:+(bar.bottom-q.bottom).toFixed(1)};};
    return { radius:getComputedStyle(document.querySelector('#acThreadScreen .msg-inbox')).borderTopLeftRadius,
      plusInk:svgIn('.msg-attach'), micBox:R('.ac-mic'), sendBox:R('.msg-send'),
      textL:+(ta.left-bar.left+parseFloat(getComputedStyle(inp).paddingLeft)).toFixed(1) };
  });
  await p.screenshot({ path:'scratchpad/out/n-bar2.png', clip:{x:0,y:726,width:390,height:118} });
  const rowcy = await p.evaluate(() => {
    const bar=document.querySelector('#acThreadScreen .msg-inbox').getBoundingClientRect();
    const cy=(sel)=>{const n=document.querySelector('#acThreadScreen .msg-inbox '+sel);
      if(!n) return null; const q=n.getBoundingClientRect();
      return q.width<1?null:+((q.top+q.bottom)/2 - bar.top).toFixed(1);};
    return { plus:cy('.msg-attach'), plusSvg:cy('.msg-attach svg'), ai:cy('.ac-fixbtn'),
      send:cy('.msg-send'), mic:cy('.ac-mic') };
  });
  const dot = await p.evaluate(() => {
    const pill=document.querySelector('.ac-h3-pill').getBoundingClientRect();
    const d=document.getElementById('acPeerDot');
    d.classList.remove('hidden','off');
    const q=d.getBoundingClientRect();
    return { size:Math.round(q.width), right:+(pill.right-q.right).toFixed(1),
      top:+(q.top-pill.top).toFixed(1), bottom:+(pill.bottom-q.bottom).toFixed(1) };
  });
  const head = await p.evaluate(() => {
    const R=(s)=>{const n=document.querySelector(s); if(!n) return null; const q=n.getBoundingClientRect();
      return {x:Math.round(q.left), r:Math.round(q.right), w:Math.round(q.width)};};
    const row = document.querySelector('#acThreadScreen .ac-head3').getBoundingClientRect();
    const back=R('#acThreadScreen .ac-h3-btn'), pill=R('.ac-h3-pill'), dots=R('#acThreadMenuBtn');
    return { rowW:Math.round(row.width), back, pill, dots,
      outerL:back?back.x-Math.round(row.left):null, outerR:dots?Math.round(row.right)-dots.r:null,
      gap1:(back&&pill)?pill.x-back.r:null, gap2:(pill&&dots)?dots.x-pill.r:null };
  });
  // online peer + a notification, so "Active now" and the blue bell both show
  await p.evaluate(() => { rtPresence[AC.peer.id] = { online: true, last_seen: null }; acUpdatePeerPresence(); setNotifBadge(3); });
  await p.waitForTimeout(400);
  const live = await p.evaluate(() => ({
    sub: document.getElementById('acPeerHandle').textContent,
    dot: !document.getElementById('acPeerDot').classList.contains('hidden'),
    bellBlue: document.getElementById('bnav-notifs').classList.contains('bn-notif'),
    bellBadge: !document.getElementById('bnavNotifBadge').classList.contains('hidden') }));
  await p.evaluate(() => { const t=document.getElementById('acThreadScreen'); t.scrollTop=0; });
  await p.screenshot({ path:'scratchpad/out/n-head.png', clip:{x:0,y:0,width:390,height:110} });
  /* THE BOTTOM BAR IS HIDDEN INSIDE A CONVERSATION — go back to the list to see it.
     An earlier version hid #acThreadScreen instead and photographed black. */
  await p.evaluate(() => acBackToList());
  await p.waitForTimeout(900);
  await p.evaluate(() => { setNotifBadge(3); acSetNavNotif('chat', true); });
  await p.waitForTimeout(500);
  const nav = await p.evaluate(() => {
    const g=(id)=>{const e=document.getElementById(id); if(!e) return null;
      const ic=e.querySelector('.bn-ico .nv-off'); return { blue:e.classList.contains('bn-notif'),
        ink:ic?getComputedStyle(ic).backgroundColor:null }; };
    return { notifs:g('bnav-notifs'), chat:g('bnav-chat'), home:g('bnav-home'),
      badge:!document.getElementById('bnavNotifBadge').classList.contains('hidden') };
  });
  const r = await p.evaluate(() => { const q=document.getElementById('bottomNav').getBoundingClientRect();
    return {x:Math.floor(q.left),y:Math.floor(q.top)-6,width:Math.ceil(q.width),height:Math.ceil(q.height)+12}; });
  await p.screenshot({ path:'scratchpad/out/n-nav.png', clip:r });
  console.log('NAV      ', JSON.stringify(nav));
  console.log('LIVE     ', JSON.stringify(live));
  console.log('ONE-ROW  ', JSON.stringify(one));
  console.log('MULTILINE', JSON.stringify(two));
  console.log('HEADER   ', JSON.stringify(head));
  console.log('DOT      ', JSON.stringify(dot));
  console.log('ROW-CY   ', JSON.stringify(rowcy));
  await b.close();
})().catch(e=>{console.error(e.message);process.exit(1);});
