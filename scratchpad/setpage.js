/* The Settings page after the rebuild: no account card, search inline at the TOP,
   built from the same component as the Account page's bar, title sized to match. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto'), fs=require('fs');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {PNG}=require(SP+'node_modules/pngjs');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0; const ok=(c,m,x)=>{if(c){pass++;console.log('  ok   '+m);}else{fail++;console.log('  FAIL '+m+(x!==undefined?'\n         '+String(x).slice(0,300):''));}};
(async()=>{
  const email=crypto.randomUUID().slice(0,8)+'@t.local',hash=await auth.hashPassword('x'.repeat(12));
  const h='sp'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,is_admin,plan) VALUES ('S',$1,$2,$3,true,true,true,'pro') RETURNING id`,[email,hash,h]);
  const token=auth.signToken({id:rows[0].id,email,is_admin:true});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",[crypto.createHash('sha256').update(token).digest('hex'),rows[0].id]);
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[]; const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  p.on('pageerror',e=>errs.push(String(e).slice(0,180)));
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(t=>{localStorage.clear();localStorage.setItem('atwe_token',t);localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},token);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(5200);

  // Opening Settings must not throw — a removed-but-still-referenced variable would.
  const opened = await p.evaluate(()=>{ try { openSettings(); return 'ok'; } catch(e){ return String(e.message); } });
  ok(opened==='ok', 'openSettings() runs without throwing', opened);
  await p.waitForTimeout(1300);

  // First, capture the Account page's bar to compare against.
  const meRef = await p.evaluate(async()=>{
    closeSettings(); appTab('profile');
    /* Wait for it to be LAID OUT, not merely present: a fixed sleep measured it at
       height 0 while the Account page was still building, and a zero reference makes
       every comparison below meaningless. */
    let s=null;
    for (let i=0;i<40;i++){ s=document.querySelector('.me-search');
      if (s && s.getBoundingClientRect().height > 0) break;
      await new Promise(r=>setTimeout(r,150)); }
    if(!s || !s.getBoundingClientRect().height) return null;
    const c=getComputedStyle(s), r=s.getBoundingClientRect();
    return {radius:c.borderRadius, bg:c.backgroundColor, border:c.borderTopWidth,
            pad:c.padding, left:Math.round(r.left), barH:Math.round(r.height)};
  });
  ok(!!meRef && meRef.barH>0, 'the Account page bar is laid out and can be compared against',
     JSON.stringify(meRef));
  await p.evaluate(()=>{ openSettings(); }); await p.waitForTimeout(1300);

  const r = await p.evaluate(()=>{
    const ov=document.getElementById('settingsOverlay');
    const bar=ov.querySelector('.iset-search'), head=ov.querySelector('.iset-head');
    const hub=ov.querySelector('.iset-body[data-page="hub"]');
    const grp=hub?hub.querySelector('.iset-group'):null;
    const title=document.getElementById('setTitle');
    const c=bar?getComputedStyle(bar):null, R=e=>e?e.getBoundingClientRect():null;
    return {
      acctCard: !!ov.querySelector('.iset-acct'),
      hasBar: !!bar, position: c?c.position:null,
      radius:c?c.borderRadius:null, bg:c?c.backgroundColor:null,
      border:c?c.borderTopWidth:null, pad:c?c.padding:null,
      barLeft:R(bar)?Math.round(R(bar).left):null, barH:R(bar)?Math.round(R(bar).height):null,
      belowHead: !!(bar&&head&&R(bar).top >= R(head).bottom - 1),
      aboveGroups: !!(bar&&grp&&(bar.compareDocumentPosition(grp)&Node.DOCUMENT_POSITION_FOLLOWING)),
      titleSize: title?getComputedStyle(title).fontSize:null,
      titleWeight: title?getComputedStyle(title).fontWeight:null,
      secTitleSize: (()=>{const d=document.createElement('span');d.className='me-sectitle';
        document.body.appendChild(d); const f=getComputedStyle(d).fontSize; d.remove(); return f;})(),
      cardPadBottom: getComputedStyle(ov.querySelector('.settings-card')).paddingBottom,
    };
  });
  console.log('  '+JSON.stringify(r));
  ok(r.acctCard===false, 'the profile card at the top is gone entirely');
  ok(r.hasBar, 'the search bar exists');
  ok(r.position!=='fixed', 'it is inline in the page, not pinned to the bottom of the screen', r.position);
  ok(r.belowHead, 'it sits directly under the Settings header');
  ok(r.aboveGroups, 'and above the option cards');
  ok(r.radius===meRef.radius, 'same corners as the Account page bar', r.radius+' vs '+meRef.radius);
  ok(r.bg===meRef.bg, 'same fill', r.bg+' vs '+meRef.bg);
  ok(r.border==='0px', 'solid, no outline (design rule)', r.border);
  ok(r.pad===meRef.pad, 'same padding', r.pad+' vs '+meRef.pad);
  ok(Math.abs(r.barH-meRef.barH)<=1, 'same height', r.barH+' vs '+meRef.barH);
  ok(r.titleSize===r.secTitleSize, 'the "Settings" title is the same size as an Account section title',
     r.titleSize+' vs '+r.secTitleSize);
  ok(r.titleWeight==='800', 'and the same weight', r.titleWeight);
  ok(parseInt(r.cardPadBottom,10) < 60, 'the old floating-bar headroom at the bottom is gone', r.cardPadBottom);

  // one clear button, not two (type=search paints its own)
  await p.evaluate(()=>{const i=document.getElementById('setSearch');i.value='password';i.dispatchEvent(new Event('input'));i.blur();});
  await p.waitForTimeout(400);
  const box = await p.evaluate(()=>{const q=document.querySelector('.iset-search').getBoundingClientRect();
    return {x:Math.round(q.left+q.width*0.72),y:Math.round(q.top),width:Math.round(q.width*0.28),height:Math.round(q.height)};});
  const f=SP+'icons/SET-x.png'; await p.screenshot({path:f, clip:box});
  const png=PNG.sync.read(fs.readFileSync(f));
  const bgpx=[png.data[0],png.data[1],png.data[2]]; const cols=[];
  for(let x=0;x<png.width;x++){let ink=0;
    for(let y=0;y<png.height;y++){const i=(png.width*y+x)<<2;
      if(Math.abs(png.data[i]-bgpx[0])+Math.abs(png.data[i+1]-bgpx[1])+Math.abs(png.data[i+2]-bgpx[2])>40) ink++;}
    cols.push(ink>0);}
  /* Same run-grouping as mesearchx.js: a gap of >6 empty columns separates two
     blobs. NB the input must NOT be focused — the accent focus ring is its own blob. */
  const runs=[]; let run=null;
  cols.forEach((on,x)=>{ if(on){ if(!run) run={a:x,b:x}; else run.b=x; }
    else if(run && x-run.b>6){ runs.push(run); run=null; } });
  if(run) runs.push(run);
  ok(runs.length===1, 'exactly ONE clear button in the field, not the browser\u2019s as well',
     'found '+runs.length+' blobs: '+JSON.stringify(runs));

  // searching works
  const sr = await p.evaluate(()=>{
    const res=document.getElementById('setSearchResults');
    return {shown:!res.classList.contains('hidden'), n:res.querySelectorAll('.iset-row').length,
      first:(res.querySelector('.iset-row')||{}).textContent||''};
  });
  ok(sr.shown && sr.n>0, 'typing shows results', JSON.stringify(sr));
  ok(/password/i.test(sr.first), 'and the top result matches', sr.first.trim().slice(0,60));
  await p.evaluate(()=>setSearchClear()); await p.waitForTimeout(400);
  const cl = await p.evaluate(()=>({val:document.getElementById('setSearch').value,
    hidden:document.getElementById('setSearchResults').classList.contains('hidden'),
    hubShown:!document.querySelector('.iset-body[data-page="hub"]').classList.contains('hidden')}));
  ok(cl.val==='' && cl.hidden && cl.hubShown, 'clearing restores the hub', JSON.stringify(cl));

  // hub only — a sub-page hides it (iOS Settings behaviour)
  await p.evaluate(()=>setNav('privacy')); await p.waitForTimeout(700);
  const sub = await p.evaluate(()=>{
    const bar=document.querySelector('#settingsOverlay .iset-search');
    return {vis:getComputedStyle(bar).display, title:document.getElementById('setTitle').textContent};
  });
  ok(sub.vis==='none', 'a sub-page hides the search bar', sub.vis);
  ok(/privacy/i.test(sub.title), 'and shows that page’s title', sub.title);
  await p.evaluate(()=>setBack()); await p.waitForTimeout(700);
  const back = await p.evaluate(()=>getComputedStyle(document.querySelector('#settingsOverlay .iset-search')).display);
  ok(back!=='none', 'coming back to the hub shows it again', back);

  ok(errs.length===0,'no JS errors',errs.join(' | '));
  await b.close(); await pool.end();
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2);});
