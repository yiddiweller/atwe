/* The offline / something-went-wrong takeover. Driven for real — including a
   browser genuinely put offline — because the whole point is a screen that works
   when nothing else does, and a mocked "offline" would not prove that. */
process.env.JWT_SECRET='scoresecret';
const crypto=require('crypto');
const SP='/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const {chromium}=require(SP+'node_modules/playwright-core');
const {Pool}=require('/home/user/atwe/node_modules/pg');
const auth=require('/home/user/atwe/auth');
const pool=new Pool({connectionString:'postgres://atwe:atwe@localhost:5432/atwescore'});
let pass=0,fail=0;
const ok=(c,m,d)=>{c?pass++:fail++;console.log('  '+(c?'ok  ':'FAIL')+' '+m+(d?'   ('+d+')':''));};
const lum=(r,g,b)=>{const f=c=>{c/=255;return c<=.03928?c/12.92:Math.pow((c+.055)/1.055,2.4)};
  return .2126*f(r)+.7152*f(g)+.0722*f(b)};
const ratio=(a,b)=>{const A=lum(...a),B=lum(...b);return (Math.max(A,B)+.05)/(Math.min(A,B)+.05)};

(async()=>{
  const e=crypto.randomUUID().slice(0,8)+'@t.local',h=await auth.hashPassword('x'.repeat(12));
  const u='os'+crypto.randomUUID().replace(/-/g,'').slice(0,9);
  const {rows}=await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded)
    VALUES ('Offline Tester',$1,$2,$3,true,true) RETURNING id`,[e,h,u]);
  const t=auth.signToken({id:rows[0].id,email:e,is_admin:false});
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",
    [crypto.createHash('sha256').update(t).digest('hex'),rows[0].id]);

  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const errs=[];

  // ── 1. a REAL cold boot with the network cut ────────────────────────────
  console.log('\n── cold boot, genuinely offline ──');
  let ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  let p=await ctx.newPage();
  p.on('pageerror',x=>errs.push(String(x).slice(0,140)));
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.evaluate(tk=>{localStorage.clear();localStorage.setItem('atwe_token',tk);
    localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},t);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(6000);
  // wipe the cached profile so there is nothing to fall back on, then cut the wire
  await p.evaluate(()=>{try{localStorage.removeItem('atwe_user');}catch(e){}});
  await ctx.setOffline(true);
  await p.goto('http://localhost:3262',{waitUntil:'domcontentloaded'}).catch(()=>{});
  await p.waitForTimeout(9000);
  let st=await p.evaluate(()=>{
    const el=document.getElementById('stateScreen');
    const shown=el&&!el.classList.contains('hidden');
    const svg=el&&el.querySelector('svg');
    return {shown, title:(document.getElementById('stTitle')||{}).textContent,
      sub:(document.getElementById('stSub')||{}).textContent,
      btn:(document.getElementById('stBtn')||{}).textContent,
      art:!!svg, artHidden:el&&el.querySelector('.st-art')?el.querySelector('.st-art').getAttribute('aria-hidden'):null,
      splash:!!document.getElementById('splash'),
      focused:document.activeElement&&(document.activeElement.className||document.activeElement.id),
      ring:(()=>{const b=document.getElementById('stBtn');
        return b?getComputedStyle(b).outlineWidth:null;})(),
      remote:[...document.querySelectorAll('img,image')].filter(n=>/^https?:/.test(n.getAttribute('src')||n.getAttribute('href')||'')).length};
  });
  ok(st.shown,'the offline screen comes up on a real cold boot with no network');
  ok(/offline/i.test(st.title||''),'it says you are offline',JSON.stringify(st.title));
  ok((st.sub||'').length>20,'with a line of plain explanation',JSON.stringify(st.sub));
  ok(/try again/i.test(st.btn||''),'and one clear action',JSON.stringify(st.btn));
  ok(st.art,'the satellite renders');
  ok(st.artHidden==='true','the picture is hidden from screen readers — the words carry the meaning');
  ok(!st.splash,'the splash is not left sitting on top of it');
  ok(/st-wrap/.test(String(st.focused)),'focus moves into the dialog',String(st.focused));
  ok(st.ring==='0px','and no focus ring is painted on a plain tap',String(st.ring));
  ok(st.remote===0,'nothing on this screen is fetched from the network',st.remote+' remote images');
  await p.screenshot({path:SP+'state-offline.png'});

  // the satellite must actually be VISIBLE, not white-on-white / black-on-black
  const shot=await p.screenshot();
  const {PNG}=require(SP+'node_modules/pngjs');
  const im=PNG.sync.read(shot);
  const px=(x,y)=>{const i=(im.width*y+x)<<2;return [im.data[i],im.data[i+1],im.data[i+2]];};
  const box=await p.evaluate(()=>{const r=document.querySelector('.st-art').getBoundingClientRect();
    return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};});
  const dpr=im.width/390;
  let lo=[255,255,255],hi=[0,0,0];
  for(let x=box.x+10;x<box.x+box.w-10;x+=2) for(let y=box.y+10;y<box.y+box.h-10;y+=2){
    const c=px(Math.round(x*dpr),Math.round(y*dpr));
    if(lum(...c)<lum(...lo)) lo=c; if(lum(...c)>lum(...hi)) hi=c;
  }
  ok(ratio(hi,lo)>3,'the satellite is genuinely visible against the page',
     'brightest '+hi.join(',')+' vs darkest '+lo.join(',')+' = '+ratio(hi,lo).toFixed(1)+':1');

  // ── 2. tapping Try again while STILL offline must not reload into the wall ──
  await p.click('#stBtn', {force:true}); await p.waitForTimeout(6500);
  const still=await p.evaluate(()=>({sub:document.getElementById('stSub').textContent,
    shown:!document.getElementById('stateScreen').classList.contains('hidden')}));
  ok(still.shown && /still no connection/i.test(still.sub),
     'tapping Try again with no connection says so instead of reloading into the same wall',
     JSON.stringify(still.sub));

  // ── 3. connection returns → it recovers on its own ──────────────────────
  await ctx.setOffline(false);
  await p.waitForTimeout(11000);   // the quiet 5s poll should notice on its own
  const back=await p.evaluate(()=>({shown:!document.getElementById('stateScreen').classList.contains('hidden'),
    text:(document.body.innerText||'').trim().length}));
  ok(!back.shown && back.text>2,'coming back online recovers by itself, no tap needed',
     JSON.stringify(back));
  await ctx.close();

  // ── 4. the error state + light theme ────────────────────────────────────
  console.log('\n── error state, both themes ──');
  for (const theme of ['black','light']){
    const c2=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
    const q=await c2.newPage();
    q.on('pageerror',x=>errs.push(String(x).slice(0,140)));
    await q.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await q.evaluate(([tk,th])=>{localStorage.clear();localStorage.setItem('atwe_token',tk);
      localStorage.setItem('atwe_theme',th);
      localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},[t,theme]);
    await q.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
    await q.waitForTimeout(6500);
    await q.evaluate(()=>acShowState('error'));
    await q.waitForTimeout(900);
    const r=await q.evaluate(()=>{
      const el=document.getElementById('stateScreen');
      const cs=getComputedStyle(el);
      return {shown:!el.classList.contains('hidden'), title:document.getElementById('stTitle').textContent,
        btn:document.getElementById('stBtn').textContent, bg:cs.backgroundColor};
    });
    ok(r.shown && /went wrong/i.test(r.title), theme+': the error state shows its own words', r.title);
    ok(/reload/i.test(r.btn), theme+': and its own action', r.btn);
    const pageBg=await q.evaluate(()=>getComputedStyle(document.body).backgroundColor);
    ok(r.bg===pageBg, theme+': it sits on the page colour, not a grey slab', r.bg+' vs '+pageBg);
    // and the clay must read against THAT background
    const sh=await q.screenshot(); const i2=PNG.sync.read(sh);
    const g=(x,y)=>{const i=(i2.width*y+x)<<2;return [i2.data[i],i2.data[i+1],i2.data[i+2]];};
    const bx=await q.evaluate(()=>{const r=document.querySelector('.st-art').getBoundingClientRect();
      return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};});
    const d2=i2.width/390; let a=[255,255,255],z=[0,0,0];
    for(let x=bx.x+10;x<bx.x+bx.w-10;x+=2) for(let y=bx.y+10;y<bx.y+bx.h-10;y+=2){
      const c=g(Math.round(x*d2),Math.round(y*d2));
      if(lum(...c)<lum(...a)) a=c; if(lum(...c)>lum(...z)) z=c;
    }
    ok(ratio(z,a)>3, theme+': the satellite reads against the page', ratio(z,a).toFixed(1)+':1');
    await q.screenshot({path:SP+'state-error-'+theme+'.png'});
    await c2.close();
  }

  /* ── 4b. the INLINE failure state, which is what the founder actually hit ──
     The app boots fine from a cached profile, so no takeover fires; only a panel
     inside it fails. acErr is the shared state behind that, and it used to say a
     generic "Something went wrong" with a small warning circle. */
  console.log('\n── the inline failure state ──');
  const c4=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  const f=await c4.newPage();
  f.on('pageerror',x=>errs.push(String(x).slice(0,140)));
  await f.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await f.evaluate(tk=>{localStorage.clear();localStorage.setItem('atwe_token',tk);
    localStorage.setItem('atwe_intro_seen',JSON.stringify(['beam','circles','ai','wallet']));},t);
  await f.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await f.waitForTimeout(6500);
  await f.evaluate(()=>{const el=document.getElementById('acFeed'); acErr(el,'acLoadFeed()');});
  await f.waitForTimeout(600);
  const inl=await f.evaluate(()=>{
    const box=document.querySelector('#acFeed .ac-err');
    return {sat:!!(box&&box.querySelector('.ac-err-sat svg')),
      w:box&&box.querySelector('.ac-err-sat')?Math.round(box.querySelector('.ac-err-sat').getBoundingClientRect().width):0,
      title:box?box.querySelector('.ac-err-title').textContent:null,
      drift:box&&box.querySelector('.st-float')?getComputedStyle(box.querySelector('.st-float')).animationName:null};
  });
  ok(inl.sat,'the inline failure state draws the same satellite, not a warning circle');
  ok(inl.w>150&&inl.w<200,'the satellite is bigger here than the first pass',inl.w+'px');
  /* Centred in the space it actually occupies, not sitting near the top. .ac-err is
     only as tall as its content and the feed starts just under the tab row, so the
     block used to ride high. A blanket CSS min-height would be wrong (the same state
     renders inside small sheets), so acErr measures the room at render time. */
  const ctr=await f.evaluate(()=>{
    const box=document.querySelector('#acFeed .ac-err');
    const r=box.getBoundingClientRect();
    const art=box.querySelector('.ac-err-sat')||box.querySelector('.ac-err-ic');
    const btn=box.querySelector('.ac-err-btn');
    const blockMid=(art.getBoundingClientRect().top + btn.getBoundingClientRect().bottom)/2;
    return {minH:Math.round(parseFloat(getComputedStyle(box).minHeight)||0),
      blockMid:Math.round(blockMid), boxMid:Math.round(r.top+r.height/2),
      screenMid:Math.round(innerHeight/2)};
  });
  console.log('     content midpoint '+ctr.blockMid+'   screen midpoint '+ctr.screenMid+'   (min-height '+ctr.minH+')');
  ok(ctr.minH>380,'the state stretches to fill the room it is given',ctr.minH+'px');
  ok(Math.abs(ctr.blockMid-ctr.screenMid)<70,
     'and the content sits near the middle of the screen, not up near the top',
     'off by '+Math.abs(ctr.blockMid-ctr.screenMid)+'px');
  ok(inl.drift==='stDrift','and it drifts like the full screen does',String(inl.drift));
  await f.screenshot({path:SP+'state-inline.png'});
  // now with the wire cut: the wording must become the offline one
  await c4.setOffline(true);
  await f.evaluate(()=>{const el=document.getElementById('acFeed'); acErr(el,'acLoadFeed()');});
  await f.waitForTimeout(5500);
  const off=await f.evaluate(()=>{const b=document.querySelector('#acFeed .ac-err');
    return b?b.querySelector('.ac-err-title').textContent:null;});
  ok(/offline/i.test(String(off)),
     'and with the wire genuinely cut it says you are offline, not "something went wrong"',
     String(off));
  await c4.close();

  // ── 5. reduced motion stops the drift ───────────────────────────────────
  const c3=await b.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  const w=await c3.newPage();
  w.on('pageerror',x=>errs.push(String(x).slice(0,140)));
  await w.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await w.evaluate(tk=>{localStorage.clear();localStorage.setItem('atwe_token',tk);},t);
  await w.goto('http://localhost:3262',{waitUntil:'domcontentloaded'});
  await w.waitForTimeout(6500);
  await w.evaluate(()=>{document.body.classList.add('reduce-motion');acShowState('offline');});
  await w.waitForTimeout(500);
  const rm=await w.evaluate(()=>getComputedStyle(document.querySelector('.st-float')).animationName);
  ok(rm==='none','reduced motion stops the drift',rm);
  await c3.close();

  ok(errs.length===0,'no JS errors',errs.slice(0,2).join(' | ')||'0');
  console.log('\n═══ '+pass+' passed, '+fail+' failed ═══');
  await b.close(); await pool.end();
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
